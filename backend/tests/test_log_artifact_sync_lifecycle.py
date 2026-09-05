"""M3 log-modern bulguları — log artifact senkron yaşam döngüsü.

Kapsam:
- Veri değişmediğinde live log workbook senkronu revision şişirmiyor ve
  dosyayı yeniden yazmıyor (her indirmede revision+1 → B'nin base_version'ı
  başkasının export'uyla bayatlıyor → 409 döngüsü).
- Aynı saniyede alınan iki snapshot birbirini EZMİYOR (saniye çözünürlüklü
  snapshot anahtarı unique artifact_key ile çakışıp ilk snapshot'ı sessizce
  ezliyor ya da IntegrityError → 500 döndürüyordu).
- Reopen, finalize ile aynı artifact senkronunu yapıyor (yeniden açılan lot
  indirilen workbook'ta hâlâ 'finalized' görünüyordu).
- /log/recent ve /log/workspace v2 yüzeyi limit/kind kısıtlarını beyan eder
  (legacy fonksiyon Python'dan çağrıldığında FastAPI Query bypass
  ediliyordu: limit=-1 → limitsiz sorgu, kind=xyz → filtre tamamen kalkıyor).
- Bozuk dosya reconcile-preview'da 500 yerine blocking_errors döner.
"""

from __future__ import annotations

import inspect
import io
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import UploadFile
from fastapi.params import Query as QueryParam
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.services.document_artifact_service as document_artifact_service
from app.api.afg import (
    build_log_workspace,
    create_afg_melt_lot,
    finalize_afg_melt_lot,
    update_afg_melt_lot,
)
from app.api.v2 import _default_artifact_year
from app.api.v2_log import (
    get_log_recent_v2,
    get_log_workspace_v2,
    post_log_melt_lot_reopen_v2,
    post_log_workbook_reconcile_preview_v2,
)
from app.database import Base
from app.models.enums import (
    PosDocumentTypeEnum,
    PosRateSourceEnum,
    PosTradeSideEnum,
    ProductStatusEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.product import Product
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.afg import AfgMeltLotCreateRequest, AfgMeltLotUpdateRequest
from app.services.document_artifact_service import (
    get_artifact_record,
    list_artifact_records,
    sync_log_workbook_artifact,
)


def _seed_users() -> tuple[User, User]:
    admin = User(email="sync-admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
    customer = User(email="sync-customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
    return admin, customer


async def _seed_melt_queue(session: AsyncSession, *, admin: User, customer: User, session_code: str) -> None:
    """Log workspace'inin eritme kuyruğuna düşen tek satırlık belge zinciri."""
    issued_at = datetime(2026, 6, 1, 8, 0, 0, tzinfo=timezone.utc)
    pos_session = PosSession(
        session_code=session_code,
        display_token=f"display-{session_code.lower()}",
        clerk_user_id=admin.id,
        customer_id=customer.id,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        rate_source=PosRateSourceEnum.LIVE,
    )
    session.add(pos_session)
    await session.flush()

    document = PosDocument(
        pos_session_id=pos_session.id,
        document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
        issued_at=issued_at,
        gross_amount_dkk=Decimal("20000.00"),
        net_amount_dkk=Decimal("20000.00"),
        customer_name=customer.name,
    )
    session.add(document)
    await session.flush()

    transaction = Transaction(
        pos_session_id=pos_session.id,
        pos_document_sequence_no=document.sequence_no,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER.value,
        status="confirmed",
        customer_id=customer.id,
        clerk_user_id=admin.id,
        gross_amount_dkk=Decimal("20000.00"),
        net_amount_dkk=Decimal("20000.00"),
        confirmed_at=issued_at,
    )
    session.add(transaction)
    await session.flush()

    product = Product(
        product_number="P001",
        product_type=ProductTypeEnum.JEWELRY,
        metal_type="yellow_gold",
        weight_grams=Decimal("15.00"),
        purity_percentage=Decimal("91.70"),
        pure_gold_grams=Decimal("13.76"),
        purchase_date=issued_at.date(),
        purchase_price_dkk=Decimal("20000.00"),
        gdpr_release_date=issued_at.date() + timedelta(days=14),
        status=ProductStatusEnum.PURCHASED,
        operation_destination="melt",
    )
    session.add(product)
    await session.flush()

    session.add(
        TransactionLine(
            transaction_id=transaction.id,
            product_id=product.id,
            line_no=1,
            product_type="jewelry",
            metal_type="yellow_gold",
            weight_grams=Decimal("15.00"),
            purity_karat="22",
            purity_percentage=Decimal("91.70"),
            pure_gold_grams=Decimal("13.76"),
            rate_dkk=Decimal("859.48"),
            margin_percent=Decimal("0.00"),
            line_total_dkk=Decimal("8787.14"),
        )
    )


async def _make_session(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AsyncSession:
    monkeypatch.setattr(document_artifact_service, "_document_root", lambda: tmp_path)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return await Session().__aenter__()


async def _seed_admin_customer(session: AsyncSession) -> tuple[User, User]:
    admin, customer = _seed_users()
    session.add_all([admin, customer])
    await session.flush()
    return admin, customer


@pytest.mark.asyncio
async def test_unchanged_log_workspace_does_not_bump_revision(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session = await _make_session(tmp_path, monkeypatch)
    try:
        admin, customer = await _seed_admin_customer(session)
        await _seed_melt_queue(session, admin=admin, customer=customer, session_code="SYNCNO1")
        await session.commit()

        first = await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=2026), year=2026, create_snapshot=False
        )
        await session.commit()
        assert first.artifact.revision == 1

        # Aynı veri, yeni workspace nesnesi: senkron dokunmamalı.
        second = await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=2026), year=2026, create_snapshot=False
        )
        await session.commit()
        assert second.artifact.id == first.artifact.id
        assert second.artifact.revision == 1, "değişmeyen veri revision'ı şişirmemeli"
        assert second.artifact.checksum_sha256 == first.artifact.checksum_sha256
        # İndirme yanıtı canlı dosyanın güncel baytlarını döndürmeli.
        live_path = tmp_path / "log" / "live" / "Log-2026.xlsx"
        assert second.content == live_path.read_bytes()
        # Parmak izi yan dosyası yazılmış olmalı.
        assert (tmp_path / "log" / "live" / "Log-2026.xlsx.fp").exists()
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_changed_log_data_bumps_revision_exactly_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session = await _make_session(tmp_path, monkeypatch)
    try:
        admin, customer = await _seed_admin_customer(session)
        await _seed_melt_queue(session, admin=admin, customer=customer, session_code="SYNCCH1")
        await session.commit()

        year = _default_artifact_year(None)
        await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=year), year=year, create_snapshot=False
        )
        await session.commit()

        lot = await create_afg_melt_lot(
            session, payload=AfgMeltLotCreateRequest(metal_bucket="gold"), actor=admin
        )
        changed = await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=year), year=year, create_snapshot=False
        )
        await session.commit()
        assert changed.artifact.revision == 2, "veri değişince revision bir kez ilerlemeli"

        # Tek alan güncellemesi → yeni veri → tam olarak bir bump daha.
        await update_afg_melt_lot(
            session, lot_id=lot.id, payload=AfgMeltLotUpdateRequest(insurance_dkk=Decimal("10"))
        )
        after_update = await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=year), year=year, create_snapshot=False
        )
        await session.commit()
        assert after_update.artifact.revision == 3
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_same_second_snapshots_do_not_overwrite_each_other(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session = await _make_session(tmp_path, monkeypatch)
    try:
        admin, customer = await _seed_admin_customer(session)
        await _seed_melt_queue(session, admin=admin, customer=customer, session_code="SNAPUN1")
        await session.commit()

        year = _default_artifact_year(None)
        lot = await create_afg_melt_lot(
            session, payload=AfgMeltLotCreateRequest(metal_bucket="gold"), actor=admin
        )
        await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=year), year=year, create_snapshot=True
        )
        await session.commit()
        await update_afg_melt_lot(
            session, lot_id=lot.id, payload=AfgMeltLotUpdateRequest(insurance_dkk=Decimal("25"))
        )
        await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=year), year=year, create_snapshot=True
        )
        await session.commit()

        snapshots = await list_artifact_records(
            session,
            module_name="log",
            document_type="log_workbook",
            business_key=str(year),
            version_kind="snapshot",
        )
        keys = {snapshot.artifact_key for snapshot in snapshots}
        assert len(snapshots) == 2, "aynı saniyedeki ikinci snapshot ilkini ezmemeli"
        assert len(keys) == len(snapshots), "snapshot artifact_key'leri benzersiz olmalı"
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_reopen_syncs_log_artifact_like_finalize(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session = await _make_session(tmp_path, monkeypatch)
    try:
        admin, customer = await _seed_admin_customer(session)
        await _seed_melt_queue(session, admin=admin, customer=customer, session_code="REOPEN1")
        await session.commit()

        year = _default_artifact_year(None)
        lot = await create_afg_melt_lot(
            session, payload=AfgMeltLotCreateRequest(metal_bucket="gold"), actor=admin
        )
        # Finalize önkoşulu: payout toplamı + satış tarihi.
        await update_afg_melt_lot(
            session,
            lot_id=lot.id,
            payload=AfgMeltLotUpdateRequest(
                payout_total_dkk=Decimal("12000"),
                sale_date=datetime(2026, 6, 15, tzinfo=timezone.utc).date(),
            ),
        )
        await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=year), year=year, create_snapshot=False
        )
        await session.commit()

        await finalize_afg_melt_lot(session, lot_id=lot.id, actor=admin, reverse=False)
        finalized = await sync_log_workbook_artifact(
            session, await build_log_workspace(session, q=None, year=year), year=year, create_snapshot=False
        )
        await session.commit()
        revision_after_finalize = finalized.artifact.revision
        assert revision_after_finalize == 2

        # Reopen finalize ile aynı senkronu yapmalı; aksi halde indirilen
        # workbook lotu hâlâ finalized gösterir.
        await post_log_melt_lot_reopen_v2(lot_id=lot.id, db=session, admin=admin)
        await session.commit()
        session.expire_all()
        record = await get_artifact_record(session, f"log.live.{year}")
        assert record is not None
        assert record.revision > revision_after_finalize, (
            "reopen artifact'ı senkronlamalı (draft durumu workbook'a yazılmalı)"
        )
    finally:
        await session.close()


def _query_constraints(param: object) -> dict:
    """fastapi Query default'undaki ge/le/pattern kısıtlarını toplar."""
    constraints: dict = {}
    for meta in getattr(param, "metadata", None) or []:
        for key in ("ge", "le", "pattern"):
            value = getattr(meta, key, None)
            if value is not None:
                constraints[key] = value
    return constraints


def test_v2_log_recent_and_workspace_declare_query_constraints() -> None:
    """Legacy get_pos_documents Python'dan çağrıldığında Query kısıtları
    bypass ediliyordu; v2 yüzeyi aynı sözleşmeyi kendi imzasında taşımalı."""
    recent_sig = inspect.signature(get_log_recent_v2)
    limit = recent_sig.parameters["limit"].default
    assert isinstance(limit, QueryParam), "limit Query ile kısıtlanmalı"
    assert _query_constraints(limit) == {"ge": 1, "le": 300}
    kind = recent_sig.parameters["kind"].default
    assert isinstance(kind, QueryParam), "kind Query ile kısıtlanmalı"
    assert _query_constraints(kind) == {"pattern": "^(afregningsbilag|faktura)$"}

    workspace_sig = inspect.signature(get_log_workspace_v2)
    workspace_limit = workspace_sig.parameters["limit"].default
    assert isinstance(workspace_limit, QueryParam), "workspace limit Query ile kısıtlanmalı"
    assert _query_constraints(workspace_limit) == {"ge": 1, "le": 10000}


@pytest.mark.asyncio
async def test_reconcile_preview_corrupt_file_returns_blocking_errors_not_500(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = await _make_session(tmp_path, monkeypatch)
    try:
        admin, customer = await _seed_admin_customer(session)
        await _seed_melt_queue(session, admin=admin, customer=customer, session_code="PREVIO1")
        await session.commit()

        upload = UploadFile(file=io.BytesIO(b"this is not an xlsx zip"), filename="broken.xlsx")
        preview = await post_log_workbook_reconcile_preview_v2(
            year=2026, workbook=upload, db=session, _=admin
        )
        assert preview.editable is False
        assert preview.blocking_errors, "bozuk dosya blocking_error üretmeli (500 değil)"
        assert "Geçersiz Excel dosyası" in preview.blocking_errors[0]
    finally:
        await session.close()
