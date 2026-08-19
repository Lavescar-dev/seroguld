from __future__ import annotations

import os
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import (
    PosDocumentTypeEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.user import User
from app.services.historical_afg_import import (
    HistoricalAfgUpload,
    _parse_upload,
    looks_like_legacy_afg_template,
    preview_historical_afg_import,
)

FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures" / "historical_afg"
REFERENCE_ROOT = Path(__file__).resolve().parents[2] / "referans"


def _upload(name: str) -> HistoricalAfgUpload:
    content = (FIXTURE_ROOT / name).read_bytes()
    return HistoricalAfgUpload.from_content(filename=name, content=content)


def test_legacy_template_is_detected_and_current_reference_is_not() -> None:
    assert looks_like_legacy_afg_template(_upload("TEST-AFREGNING-11001-2026-07-15-mads-jensen.xlsx").content) is True
    # Boş referans şablonda etiketler var ama D/G değerleri yok → legacy değil.
    reference_bytes = (REFERENCE_ROOT / "Afregningsbilag ( alis frontumuz).xlsm").read_bytes()
    assert looks_like_legacy_afg_template(reference_bytes) is False


def test_individual_file_parses_with_exact_totals() -> None:
    parsed = _parse_upload(_upload("TEST-AFREGNING-11001-2026-07-15-mads-jensen.xlsx"))
    assert parsed.template_profile == "legacy"
    assert parsed.errors == []
    assert parsed.legacy_document_number == "11001"
    assert parsed.issued_at is not None and parsed.issued_at.date().isoformat() == "2026-07-15"
    # Satırlar sabit hücre numarasından değil tür/ayar imzasından okunur:
    # 8K (12.4g × 267.69), 14K (4.8g × 501.03 ≈ ...), Sterling (80g × 14.1).
    assert [line.row_key for line in parsed.lines] == ["gold:8", "gold:14", "silver:3"]
    assert parsed.lines[0].weight_grams == Decimal("12.40")
    assert parsed.lines[0].rate_dkk == Decimal("267.69")
    assert parsed.lines[2].line_total_dkk == Decimal("1128.00")
    # Belgedeki tamamlanmış tutarlar birebir: yeniden değerleme yok.
    assert parsed.total_amount_dkk == Decimal("6852.30")
    assert parsed.vat_amount_dkk == Decimal("0.00")
    # Müşteri alanları D/G değer hücrelerinden.
    assert getattr(parsed.customer, "name") == "Mads Jensen"
    assert getattr(parsed.customer, "phone") == "+45 20 00 10 01"
    assert getattr(parsed.customer, "email") == "testkunde01@example.com"
    # "2200 København N" doğru bölünür.
    assert getattr(parsed.customer, "postal_code") == "2200"
    assert getattr(parsed.customer, "city") == "København N"
    # Tireli tam CPR normalize edilir; doğum tarihi bölümü ayrıca izlenir.
    assert getattr(parsed.customer, "cpr_number") == "1503851001"
    assert parsed.birth_date_text == "150385"
    assert parsed.is_company is False


def test_22k_916_and_plet_rows_are_recognized() -> None:
    parsed = _parse_upload(_upload("TEST-AFREGNING-11016-2026-08-03-louise-hoejbjerg.xlsx"))
    assert parsed.errors == []
    row_keys = [line.row_key for line in parsed.lines]
    assert "gold:22" in row_keys  # E27=916
    assert "silver:5" in row_keys  # C33='Plet'
    plet = next(line for line in parsed.lines if line.row_key == "silver:5")
    assert plet.weight_grams == Decimal("900.00")
    assert parsed.total_amount_dkk == Decimal("1889.07")


def test_company_file_keeps_vat_and_maps_cvr_identity() -> None:
    parsed = _parse_upload(_upload("TEST-AFREGNING-11017-2026-08-05-nordisk-testhandel-aps.xlsx"))
    assert parsed.errors == []
    assert parsed.is_company is True
    # CVR değeri CPR olarak KAYDEDİLMEZ; şirket kimliği ayrı alanda izlenir
    # (belgede zaten kimlik varsa o korunur, CVR onu ezmez).
    assert getattr(parsed.customer, "cpr_number", None) is None
    assert getattr(parsed.customer, "identity_doc_number", None)
    # Tarihsel %25 KDV birebir korunur.
    assert parsed.vat_amount_dkk == Decimal("18603.67")
    assert parsed.total_amount_dkk == Decimal("93018.34")
    assert parsed.net_amount_dkk == Decimal("74414.67")


@pytest.mark.asyncio
async def test_preview_matches_apply_validation_and_blocks_duplicates() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    upload = _upload("TEST-AFREGNING-11020-2026-08-09-oeresund-demo-design-aps.xlsx")

    async with Session() as db:
        preview = await preview_historical_afg_import(db, uploads=[upload])
        item = preview.items[0]
        # Preview apply ile aynı doğrulamayı koşar → gerçek dosya 'ready'.
        assert item.status == "ready"
        assert item.template_profile == "legacy"
        assert item.is_company is True
        assert item.source_vat_amount_dkk == Decimal("10600.30")
        assert item.source_gross_amount_dkk == Decimal("53001.50")

        # Aynı hash daha önce içe aktarılmışsa ikinci import bloklanır.
        admin = User(
            email="legacy-admin@example.com",
            password_hash="unused",
            name="Admin",
            role=RoleEnum.ADMIN,
            is_active=True,
        )
        db.add(admin)
        await db.flush()
        pos_session = PosSession(
            session_code="IMP-LEGACY",
            display_token="token-imp-legacy",
            clerk_user_id=admin.id,
            trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
            margin_percent_internal=Decimal("0"),
            status=PosSessionStatusEnum.CONFIRMED,
            visible_snapshot={},
        )
        db.add(pos_session)
        await db.flush()
        db.add(
            PosDocument(
                pos_session_id=pos_session.id,
                document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
                issued_at=datetime(2026, 8, 9),
                net_amount_dkk=Decimal("42401.20"),
                vat_amount_dkk=Decimal("10600.30"),
                gross_amount_dkk=Decimal("53001.50"),
                vat_rate_percent=Decimal("25.00"),
                historical_import_hash=upload.source_hash,
            )
        )
        await db.commit()

    async with Session() as db:
        second = await preview_historical_afg_import(db, uploads=[upload])
        assert second.items[0].status == "already_imported"

    await engine.dispose()


@pytest.mark.skipif(
    not os.environ.get("HISTORICAL_AFG_SAMPLE_DIR"),
    reason="Tam 20-dosya kabulü: HISTORICAL_AFG_SAMPLE_DIR ile manuel koşulur",
)
def test_manual_full_sample_acceptance() -> None:
    sample_dir = Path(os.environ["HISTORICAL_AFG_SAMPLE_DIR"])
    files = sorted(sample_dir.glob("TEST-AFREGNING-*.xlsx"))
    assert len(files) >= 20
    company_count = 0
    for path in files:
        parsed = _parse_upload(HistoricalAfgUpload.from_content(filename=path.name, content=path.read_bytes()))
        assert parsed.errors == [], f"{path.name}: {parsed.errors}"
        assert parsed.legacy_document_number
        assert parsed.issued_at is not None
        assert parsed.total_amount_dkk > 0
        if parsed.is_company:
            company_count += 1
            assert parsed.vat_amount_dkk and parsed.vat_amount_dkk > 0
        else:
            assert parsed.vat_amount_dkk == Decimal("0.00")
    assert company_count == 4
