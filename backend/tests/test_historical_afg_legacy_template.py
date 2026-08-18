from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import Workbook
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

REFERENCE_ROOT = Path(__file__).resolve().parents[2] / "referans"


def _legacy_workbook_bytes() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Afregningsbilag"

    sheet["C5"] = "Afregningsnr."
    sheet["D5"] = "A-1234"
    sheet["C6"] = "Dato"
    sheet["D6"] = datetime(2019, 5, 20)

    sheet["C16"] = "Navn:"
    sheet["D16"] = "Jens Hansen"
    sheet["F16"] = "CPR nr."
    sheet["G16"] = "200580-1234"
    sheet["C17"] = "Adresse:"
    sheet["D17"] = "Gammelvej 3"
    sheet["F17"] = "Tlf."
    sheet["G17"] = "+4512345678"
    sheet["C18"] = "Postnr.:"
    sheet["D18"] = "8000"
    sheet["F18"] = "E-mail"
    sheet["G18"] = "jens@example.com"

    # Satırlar bilinçli olarak güncel şablonun sabit satır aralığının dışında:
    # okuma hücre numarasından değil tür/ayar imzasından yapılmalı.
    sheet["C25"] = "Guld 14 kt"
    sheet["D25"] = 10
    sheet["G25"] = 2500.00
    sheet["C27"] = "Sterling sølv 925"
    sheet["D27"] = 100
    sheet["G27"] = 450.00

    sheet["C30"] = "Subtotal"
    sheet["D30"] = 2360.00
    sheet["C31"] = "Moms 25%"
    sheet["D31"] = 590.00
    sheet["C32"] = "I alt"
    sheet["D32"] = 2950.00

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_legacy_template_is_detected_and_current_reference_is_not() -> None:
    assert looks_like_legacy_afg_template(_legacy_workbook_bytes()) is True
    reference_bytes = (REFERENCE_ROOT / "Afregningsbilag ( alis frontumuz).xlsm").read_bytes()
    assert looks_like_legacy_afg_template(reference_bytes) is False


def test_legacy_rows_parse_by_signature_and_totals_are_preserved() -> None:
    upload = HistoricalAfgUpload.from_content(filename="eski-afg.xlsx", content=_legacy_workbook_bytes())
    parsed = _parse_upload(upload)

    assert parsed.template_profile == "legacy"
    assert parsed.errors == []
    assert parsed.legacy_document_number == "A-1234"
    assert parsed.issued_at is not None and parsed.issued_at.date().isoformat() == "2019-05-20"

    assert [line.row_key for line in parsed.lines] == ["gold:14", "silver:3"]
    gold, silver = parsed.lines
    assert gold.weight_grams == Decimal("10.00")
    assert gold.purity_percentage == Decimal("58.50")
    assert gold.line_total_dkk == Decimal("2500.00")
    assert silver.weight_grams == Decimal("100.00")
    assert silver.line_total_dkk == Decimal("450.00")

    # Tarihsel tutarlar belgeden birebir; yeniden değerleme yok.
    assert parsed.total_amount_dkk == Decimal("2950.00")
    assert parsed.net_amount_dkk == Decimal("2360.00")
    assert parsed.vat_amount_dkk == Decimal("590.00")

    customer = parsed.customer
    assert getattr(customer, "name") == "Jens Hansen"
    assert getattr(customer, "cpr_number") == "200580-1234"
    assert getattr(customer, "phone") == "+4512345678"
    assert getattr(customer, "postal_code") == "8000"


@pytest.mark.asyncio
async def test_same_legacy_file_cannot_be_imported_twice() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    content = _legacy_workbook_bytes()
    upload = HistoricalAfgUpload.from_content(filename="eski-afg.xlsx", content=content)

    async with Session() as db:
        admin = User(
            email="legacy-import-admin@example.com",
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
                issued_at=datetime(2019, 5, 20),
                net_amount_dkk=Decimal("2360.00"),
                vat_amount_dkk=Decimal("590.00"),
                gross_amount_dkk=Decimal("2950.00"),
                vat_rate_percent=Decimal("25.00"),
                historical_import_hash=upload.source_hash,
            )
        )
        await db.commit()

    async with Session() as db:
        preview = await preview_historical_afg_import(db, uploads=[upload])
        assert preview.already_imported_count == 1
        assert preview.items[0].status == "already_imported"

    await engine.dispose()
