from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.afg import build_log_workspace
from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosDocumentTypeEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User


def _user(email: str, role: RoleEnum) -> User:
    return User(email=email, password_hash="x", name=email, role=role)


async def _seed_receipt(session: AsyncSession, *, clerk, customer, issued_at: datetime) -> None:
    pos_session = PosSession(
        session_code=f"S{int(issued_at.timestamp())}-{issued_at.microsecond}",
        display_token=f"disp-{issued_at.timestamp()}-{issued_at.microsecond}",
        clerk_user_id=clerk.id,
        customer_id=customer.id,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        live_rate_dkk=Decimal("900.00"),
        rate_source="live",
        margin_percent_internal=Decimal("0.00"),
        status=PosSessionStatusEnum.CONFIRMED,
        visible_snapshot={},
    )
    session.add(pos_session)
    await session.flush()
    document = PosDocument(
        pos_session_id=pos_session.id,
        document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
        issued_at=issued_at,
        gross_amount_dkk=Decimal("100.00"),
        net_amount_dkk=Decimal("100.00"),
        vat_rate_percent=Decimal("0.00"),
        vat_amount_dkk=Decimal("0.00"),
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
        clerk_user_id=clerk.id,
        gross_amount_dkk=Decimal("100.00"),
        net_amount_dkk=Decimal("100.00"),
        vat_rate_percent=Decimal("0.00"),
        vat_amount_dkk=Decimal("0.00"),
    )
    session.add(transaction)
    await session.flush()
    session.add(
        TransactionLine(
            transaction_id=transaction.id,
            line_no=1,
            product_type=ProductTypeEnum.JEWELRY.value,
            metal_type=MetalTypeEnum.YELLOW_GOLD.value,
            weight_grams=Decimal("5.00"),
            purity_karat="24K",
            purity_percentage=Decimal("99.90"),
            pure_gold_grams=Decimal("4.99"),
            rate_dkk=Decimal("900.00"),
            margin_percent=Decimal("0.00"),
            line_total_dkk=Decimal("100.00"),
        )
    )


def test_past_year_documents_survive_recent_window():
    """205 belge 2026'da + 3 belge 2024'te. Eski 'en yeni 200' penceresi 2024'ü
    tamamen düşürüyordu; yıl filtresi SQL'e taşındıktan sonra 2024 gelmeli."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = _user("clerk@test.dk", RoleEnum.ADMIN)
            customer = _user("cust@test.dk", RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()

            for i in range(205):
                await _seed_receipt(session, clerk=clerk, customer=customer, issued_at=datetime(2026, 6, 1, 8, 0, i % 60, i, tzinfo=timezone.utc))
            for i in range(3):
                await _seed_receipt(session, clerk=clerk, customer=customer, issued_at=datetime(2024, 3, 1, 9, 0, i, tzinfo=timezone.utc))
            await session.commit()

            ws_2024 = await build_log_workspace(session, q=None, year=2024)
            docs_2024 = [*ws_2024.gold.documents, *ws_2024.silver.documents]
            assert len(docs_2024) == 3  # eskiden 0 gelirdi (recent-200 penceresi)
            assert all(d.issued_at and d.issued_at.year == 2024 for d in docs_2024)

            ws_2026 = await build_log_workspace(session, q=None, year=2026)
            docs_2026 = [*ws_2026.gold.documents, *ws_2026.silver.documents]
            assert len(docs_2026) == 205

        await engine.dispose()

    asyncio.run(run())
