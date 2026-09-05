from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.api.v2 as v2_module
from app.api.afg import (
    apply_afg_route_requests,
    apply_afg_route_requests_safe,
    create_afg_melt_lot,
    delete_afg_melt_lot,
)
from app.api.v2 import _apply_log_workbook_artifact_inputs, _office_preview_for_kind
from app.database import Base
from app.models.afg_melt_lot import AfgMeltLot
from app.models.afg_melt_lot_history import AfgMeltLotHistory
from app.models.enums import (
    MetalTypeEnum,
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
from app.schemas.afg import AfgMeltLotCreateRequest, AfgRouteRequest
from app.services import document_artifact_service
from app.services.document_artifact_service import get_artifact_record
from app.utils.helpers import utc_now


def _fk_enforced_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _turn_on_sqlite_fk(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


async def _seed_session_chain(
    session: AsyncSession,
    *,
    admin: User,
    customer: User,
    session_code: str,
    issued_at=None,
    line_count: int = 2,
) -> list[TransactionLine]:
    """PosSession + PosDocument + Transaction + satırlar (log/workspace tohumu)."""
    issued_at = issued_at or utc_now()
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
        customer_phone=customer.phone,
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

    weights = [Decimal("15.00"), Decimal("10.00")]
    lines: list[TransactionLine] = []
    for index in range(line_count):
        line = TransactionLine(
            transaction_id=transaction.id,
            line_no=index + 1,
            product_type="jewelry",
            metal_type="yellow_gold",
            weight_grams=weights[index],
            purity_karat="22",
            purity_percentage=Decimal("91.70"),
            pure_gold_grams=Decimal("13.76"),
            rate_dkk=Decimal("859.48"),
            margin_percent=Decimal("0.00"),
            line_total_dkk=Decimal("8787.14"),
        )
        lines.append(line)
    session.add_all(lines)
    await session.flush()
    return lines


def _seed_users() -> tuple[User, User]:
    admin = User(
        email="atomic-admin@test.local",
        password_hash="x",
        name="Admin",
        role=RoleEnum.ADMIN,
    )
    customer = User(
        email="atomic-customer@test.local",
        password_hash="x",
        name="Customer",
        role=RoleEnum.CUSTOMER,
        phone="24917296",
    )
    return admin, customer


@pytest.mark.asyncio
async def test_log_workbook_import_is_atomic_on_mid_apply_failure():
    """Workbook import savepoint'i: ortadaki adım patlarsa yarım import KALICI olmamalı.

    Eski davranış: her route-apply/lot işlemi kendi commit'ini attığı için ilk
    satırın ürünü kalıcıya yazılıyor, ikinci satırda patlayınca yarım import
    veritabanında kalıyordu (batch-apply savepoint'i iç commit yüzünden ölüydü).
    """
    engine = _fk_enforced_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        admin, customer = _seed_users()
        session.add_all([admin, customer])
        await session.flush()
        lines = await _seed_session_chain(
            session, admin=admin, customer=customer, session_code="ATOMIC1"
        )
        await session.commit()
        line_one_id, line_two_id = lines[0].id, lines[1].id

        from app.api import afg as afg_module

        parsed = SimpleNamespace(
            base_version=None,
            route_updates=[
                SimpleNamespace(
                    payload=AfgRouteRequest(
                        line_ids=[line_one_id, line_two_id],
                        destination="inventory",
                        classification="standard",
                    )
                )
            ],
            lot_creates=[],
            lot_updates=[],
        )

        real_parse = v2_module.parse_log_workbook_inputs_from_workbook
        real_create = afg_module.create_product_service
        call_count = {"n": 0}

        async def failing_create(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] >= 2:
                raise RuntimeError("test: ikinci ürün oluşturma kasıtlı patladı")
            return await real_create(*args, **kwargs)

        v2_module.parse_log_workbook_inputs_from_workbook = lambda *args, **kwargs: parsed
        afg_module.create_product_service = failing_create
        try:
            with pytest.raises(RuntimeError) as exc_info:
                await _apply_log_workbook_artifact_inputs(
                    session, year=2026, workbook_bytes=b"", create_snapshot=False
                )
        finally:
            v2_module.parse_log_workbook_inputs_from_workbook = real_parse
            afg_module.create_product_service = real_create

        assert "kasıtlı" in str(exc_info.value).lower()

        product_count = await session.scalar(select(func.count()).select_from(Product))
        assert product_count == 0, "yarım import'un ürün kalıntısı kalıcı olmamalı"

        lot_count = await session.scalar(select(func.count()).select_from(AfgMeltLot))
        assert lot_count == 0

        reloaded = (
            await session.execute(
                select(TransactionLine).where(
                    TransactionLine.id.in_([line_one_id, line_two_id])
                )
            )
        ).scalars().all()
        assert all(item.product_id is None for item in reloaded)

        artifact = await get_artifact_record(session, "log.live.2026")
        assert artifact is None, "başarısız import artifact yazmamalı"

        # Savepoint sonrası oturum kullanılabilir kalmalı; normal apply+commit
        # çalışmaya devam eder (retry/kompanzasyon yolu sağlam).
        await apply_afg_route_requests(
            db=session,
            route_requests=[
                AfgRouteRequest(
                    line_ids=[line_one_id],
                    destination="inventory",
                    classification="standard",
                )
            ],
            actor_id=admin.id,
        )
        product_count = await session.scalar(select(func.count()).select_from(Product))
        assert product_count == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_apply_afg_route_requests_safe_rolls_back_half_applied_request():
    """safe varyant: tek istek içinde ortadaki adım raise ederse o isteğin yarım
    işleri savepoint ile geri alınmalı; sonraki başarılı istek persist olmalı."""
    engine = _fk_enforced_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        admin, customer = _seed_users()
        session.add_all([admin, customer])
        await session.flush()
        lines = await _seed_session_chain(
            session, admin=admin, customer=customer, session_code="SAFEHLF1"
        )
        await session.commit()
        line_one_id, line_two_id = lines[0].id, lines[1].id

        from app.api import afg as afg_module

        real_update_status = afg_module.update_status
        call_count = {"n": 0}

        async def failing_update_status(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] >= 1:
                # Yarım yol: istek içinde en az bir ürün oluşturulduktan sonra
                # status güncellemesinde patla (create gerçek servisle akar).
                raise RuntimeError("test: status güncellemesi kasıtlı patladı")
            return await real_update_status(*args, **kwargs)

        afg_module.update_status = failing_update_status
        try:
            response, failures = await apply_afg_route_requests_safe(
                db=session,
                route_requests=[
                    AfgRouteRequest(
                        line_ids=[line_one_id, line_two_id],
                        destination="inventory",
                        classification="standard",
                    )
                ],
                actor_id=admin.id,
            )
        finally:
            afg_module.update_status = real_update_status

        assert response.processed_line_ids == []
        assert sorted(str(lid) for lid, _ in failures) == sorted(
            str(lid) for lid in (line_one_id, line_two_id)
        )
        assert call_count["n"] >= 1, "yarım yol senaryosu tetiklenmiş olmalı"

        # Savepoint: isteğin yarım işleri (oluşturulan ürün(ler)) kalıcı olmamalı.
        product_count = await session.scalar(select(func.count()).select_from(Product))
        assert product_count == 0

        reloaded_two = await session.get(TransactionLine, line_two_id)
        assert reloaded_two.product_id is None

        # Savepoint rollback sonrası oturum zehirlenmemiş; aynı istek artık akar.
        response_two, failures_two = await apply_afg_route_requests_safe(
            db=session,
            route_requests=[
                AfgRouteRequest(
                    line_ids=[line_one_id],
                    destination="inventory",
                    classification="standard",
                )
            ],
            actor_id=admin.id,
        )
        assert failures_two == []
        assert response_two.processed_line_ids == [line_one_id]

        # safe varyant commit etmez; kalıcılık dış commit ile doğrulanır.
        await session.commit()
        product_count = await session.scalar(select(func.count()).select_from(Product))
        assert product_count == 1
        reloaded = await session.get(TransactionLine, line_one_id)
        assert reloaded.product_id is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_delete_afg_melt_lot_cleans_history_and_preserves_deleted_audit():
    """Lot silme: geçmiş lot ile birlikte temizlenir (PostgreSQL FK 500 düzeltmesi),
    terminal "deleted" audit kaydı ise lot_id=None ile lot bağımsız kalır."""
    engine = _fk_enforced_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        admin, customer = _seed_users()
        session.add_all([admin, customer])
        await session.flush()
        lines = await _seed_session_chain(
            session, admin=admin, customer=customer, session_code="DELLOT1", line_count=1
        )

        # Eritme kuyruğunun dolu görünmesi için satıra operation_destination="melt"
        # taşıyan bağlı ürün gerekli.
        product = Product(
            product_number="DEL01",
            display_name="Delete test gold",
            product_type=ProductTypeEnum.JEWELRY,
            metal_type=MetalTypeEnum.YELLOW_GOLD,
            weight_grams=Decimal("15.00"),
            purity_karat="22K",
            purity_percentage=Decimal("91.70"),
            pure_gold_grams=Decimal("13.76"),
            unit_count=1,
            total_weight_grams=Decimal("15.00"),
            purchase_date=utc_now().date(),
            purchase_price_dkk=Decimal("8787.14"),
            gold_rate_at_purchase=Decimal("859.48"),
            commission=Decimal("0.00"),
            seller_customer_id=customer.id,
            gdpr_release_date=utc_now().date() + timedelta(days=14),
            is_gdpr_locked=False,
            status=ProductStatusEnum.IN_INVENTORY,
            operation_destination="melt",
        )
        session.add(product)
        await session.flush()
        lines[0].product_id = product.id
        await session.commit()

        lot = await create_afg_melt_lot(
            session,
            payload=AfgMeltLotCreateRequest(
                metal_bucket="gold",
                notes="test lotu",
            ),
            actor=admin,
        )
        lot_id = UUID(str(lot.id))
        lines[0].melt_lot_id = lot_id
        await session.commit()

        history_before = (
            await session.execute(
                select(func.count())
                .select_from(AfgMeltLotHistory)
                .where(AfgMeltLotHistory.lot_id == lot_id)
            )
        ).scalar_one()
        assert history_before >= 1

        # PRAGMA foreign_keys=ON: geçmiş silinmeden lot silinseydi IntegrityError
        # (PostgreSQL'de 500) oluşurdu. Fix bu sırayı garanti eder.
        await delete_afg_melt_lot(session, lot_id=lot_id, actor=admin)

        lot_count = await session.scalar(
            select(func.count()).select_from(AfgMeltLot).where(AfgMeltLot.id == lot_id)
        )
        assert lot_count == 0

        linked_lines = (
            await session.execute(
                select(TransactionLine).where(TransactionLine.melt_lot_id == lot_id)
            )
        ).scalars().all()
        assert linked_lines == []

        remaining = (
            await session.execute(select(AfgMeltLotHistory))
        ).scalars().all()
        assert len(remaining) == 1
        deleted_audit = remaining[0]
        assert deleted_audit.action == "deleted"
        assert deleted_audit.lot_id is None, "terminal audit kaydı lot'a bağlı kalmamalı"
        assert deleted_audit.old_value is not None
        assert deleted_audit.old_value.get("lot_id") == str(lot_id)
        assert deleted_audit.performed_by_email == admin.email

    await engine.dispose()


@pytest.mark.asyncio
async def test_office_log_preview_uses_key_year_for_workspace_projection(monkeypatch, tmp_path):
    """Office preview/status geçmiş yıl anahtarına GÜNCEL yıl verisi yazmamalı."""
    past_year = (utc_now() - timedelta(days=2 * 365)).year
    engine = _fk_enforced_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        admin, customer = _seed_users()
        session.add_all([admin, customer])
        await session.flush()
        await _seed_session_chain(
            session,
            admin=admin,
            customer=customer,
            session_code="YEARPRJ1",
            issued_at=utc_now() - timedelta(days=2 * 365),
        )
        await session.commit()

        real_build = v2_module.build_log_workspace
        calls: dict = {}

        async def spy_build(db, *, q=None, year=None, limit=200):
            workspace = await real_build(db, q=q, year=year, limit=limit)
            calls["year"] = year
            calls["workspace"] = workspace
            return workspace

        monkeypatch.setattr(v2_module, "build_log_workspace", spy_build)
        monkeypatch.setattr(document_artifact_service, "_document_root", lambda: tmp_path)

        preview, can_write = await _office_preview_for_kind(
            session, kind="log", key=str(past_year), admin=admin
        )

        assert calls["year"] == past_year, "workspace anahtarın yılından kurulmalı"
        assert calls["workspace"].summary.total_documents == 1, (
            "geçmiş yıl belgesi preview workspace'inde görünmeli "
            "(bug: güncel yıl verisi geçmiş yıl anahtarına yazılıyordu)"
        )
        assert can_write is False
        assert preview is not None

        record = await get_artifact_record(session, f"log.live.{past_year}")
        assert record is not None
        assert str(past_year) in record.file_name

        # Status yolu da aynı projeksiyonu kullanmalı (artifact'i olmayan yıl ile
        # build dalının gerçekten çalışması için yeni anahtar).
        calls.clear()
        stub_host = SimpleNamespace(
            live_sync_status=lambda *args, **kwargs: ("idle", None, None),
            provider_for_kind=lambda kind: "stub",
            provider_label_for_kind=lambda kind: "Stub",
            provider_branding_level_for_kind=lambda kind: "minimal",
            is_available=_async_true,
        )
        monkeypatch.setattr(v2_module, "office_host_service", stub_host)

        from app.api.v2 import _office_status_for_kind

        status_out = await _office_status_for_kind(
            session, kind="log", key=str(past_year - 1), admin=admin
        )
        assert calls["year"] == past_year - 1
        assert status_out.artifact is not None

    await engine.dispose()


async def _async_true(_kind: str) -> bool:
    return True
