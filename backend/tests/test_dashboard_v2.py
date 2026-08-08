"""DASH-001 regression: /api/v2/dashboard (v2._build_dashboard_screen).

Kapsam:
- boş DB'de dürüst zero-state (NameError regresyonu dahil 500 yerine 200-veri)
- POS purchase fixture'ı ile gerçek sayılar ve paymentMethod çözümü
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v2 import _build_dashboard_screen
from app.database import Base
from app.models.enums import PosDocumentTypeEnum, PosSessionStatusEnum, PosTradeSideEnum, RoleEnum
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.user import User


def _make_session_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def test_dashboard_empty_db_returns_zero_state():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = _make_session_factory(engine)
        async with Session() as session:
            admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            session.add(admin)
            await session.commit()

            result = await _build_dashboard_screen(session, admin)

            assert result.alisSayisi == 0
            assert result.alisToplamKr == 0
            assert result.sonAlislar == []
            assert result.faturaAdedi == 0
        await engine.dispose()

    import asyncio

    asyncio.run(run())


def test_dashboard_with_purchase_fixture_counts_and_payment_method():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = _make_session_factory(engine)
        async with Session() as session:
            admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            session.add(admin)
            await session.flush()

            pos_session = PosSession(
                session_code="DASH0001",
                display_token="dash-display-token",
                clerk_user_id=admin.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("8.00"),
                status=PosSessionStatusEnum.CONFIRMED,
                visible_snapshot={},
                notes='Betaling: Kontant',
            )
            session.add(pos_session)
            await session.flush()

            document = PosDocument(
                pos_session_id=pos_session.id,
                document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
                gross_amount_dkk=Decimal("1000.00"),
                net_amount_dkk=Decimal("800.00"),
                customer_name="Test Kunde",
            )
            session.add(document)
            await session.commit()

            result = await _build_dashboard_screen(session, admin)

            assert result.alisSayisi == 1
            assert result.alisToplamKr == 1000.0
            assert len(result.sonAlislar) == 1
            row = result.sonAlislar[0]
            assert row.musteri == "Test Kunde"
            assert row.total == 1000.0
            # DASH-001 regresyon koruması: paymentMethod session notes'tan çözülür
            assert row.paymentMethod == "cash"
        await engine.dispose()

    import asyncio

    asyncio.run(run())
