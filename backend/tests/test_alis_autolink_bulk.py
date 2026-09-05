"""auto-link-customers toplu eşleştirme (MEDIUM: N+1 sorgu döngüsü).

Yeniden yazım sonrası davranış sözleşmesi: transactions/pos_sessions toplu
sorgulanır, limit uygulanır ve eşlenen (sequence_no, customer_id) listesi
denetim için döner.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.api.v2  # noqa: F401  # dairesel import sırası
import app.api.v2_alis as v2_alis
from app.database import Base
from app.models.enums import PosDocumentTypeEnum, PosRateSourceEnum, PosTradeSideEnum, RoleEnum
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.transaction import Transaction
from app.models.user import User


async def _seed_historical_document(
    session: AsyncSession,
    *,
    admin: User,
    index: int,
    customer_email: str | None,
    customer_name: str | None = None,
    customer_phone: str | None = None,
) -> PosSession:
    pos_session = PosSession(
        session_code=f"AUTOLNK{index:02d}",
        display_token=f"autolink-display-{index}",
        clerk_user_id=admin.id,
        customer_id=None,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        rate_source=PosRateSourceEnum.LIVE,
    )
    session.add(pos_session)
    await session.flush()

    document = PosDocument(
        pos_session_id=pos_session.id,
        document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
        gross_amount_dkk=Decimal("500.00"),
        net_amount_dkk=Decimal("400.00"),
        customer_name=customer_name,
        customer_phone=customer_phone,
        customer_email=customer_email,
        uniconta_sync_status="historical",
    )
    session.add(document)
    await session.flush()

    transaction = Transaction(
        pos_session_id=pos_session.id,
        pos_document_sequence_no=document.sequence_no,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER.value,
        status="confirmed",
        clerk_user_id=admin.id,
        gross_amount_dkk=Decimal("500.00"),
        net_amount_dkk=Decimal("400.00"),
        confirmed_at=document.issued_at,
    )
    session.add(transaction)
    await session.flush()
    return pos_session


@pytest.mark.asyncio
async def test_auto_link_customers_bulk_result_and_matches():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        admin = User(email="autolink-admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
        cust_shared_a = User(
            email="ayse-a@example.com", password_hash="x", name="Ayse Test", role=RoleEnum.CUSTOMER, phone="20112233"
        )
        cust_shared_b = User(
            email="ayse-b@example.com", password_hash="x", name="Ayse Test", role=RoleEnum.CUSTOMER, phone="20112233"
        )
        cust_unique = User(
            email="unique@example.com", password_hash="x", name="Bent Test", role=RoleEnum.CUSTOMER, phone="30445566"
        )
        session.add_all([admin, cust_shared_a, cust_shared_b, cust_unique])
        await session.commit()

        session_linked = await _seed_historical_document(
            session, admin=admin, index=1,
            customer_email="unique@example.com", customer_name="Bent Test", customer_phone="30445566",
        )
        await _seed_historical_document(
            session, admin=admin, index=2,
            customer_email=None, customer_name="Ayse Test", customer_phone="20112233",
        )
        await _seed_historical_document(
            session, admin=admin, index=3,
            customer_email="ghost@example.com", customer_name="Hayalet Kayit",
        )
        await session.commit()

        result = await v2_alis.post_alis_documents_auto_link_customers_v2(
            limit=100,
            db=session,
            admin=admin,
        )

        assert result["ok"] is True
        assert result["scanned"] == 3
        assert result["linked"] == 1
        assert result["ambiguous"] == 1
        assert result["unmatched"] == 1
        assert len(result["matches"]) == 1
        assert result["matches"][0]["customer_id"] == str(cust_unique.id)

        # Bağlanan belgenin transaction + session bağları güncellendi.
        transaction = (
            await session.execute(select(Transaction).where(Transaction.customer_id == cust_unique.id))
        ).scalars().first()
        assert transaction is not None
        session_row = (
            await session.execute(select(PosSession).where(PosSession.id == session_linked.id))
        ).scalar_one()
        assert session_row.customer_id == cust_unique.id

    await engine.dispose()
