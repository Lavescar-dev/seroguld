from __future__ import annotations

import asyncio
import json
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosDocumentTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.transaction import Transaction
from app.models.user import User


def _users():
    admin = User(email="relink-admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
    wrong = User(email="relink-wrong@test.local", password_hash="x", name="Duplike Musteri", role=RoleEnum.CUSTOMER)
    correct = User(email="relink-right@test.local", password_hash="x", name="Firat Ucler", role=RoleEnum.CUSTOMER)
    return admin, wrong, correct


async def _seed_historical_document(session: AsyncSession, *, clerk: User, customer: User) -> PosDocument:
    pos_session = PosSession(
        session_code="RLNK0001",
        display_token="display-relink",
        clerk_user_id=clerk.id,
        customer_id=customer.id,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        rate_source=PosRateSourceEnum.MANUAL,
        live_rate_dkk=Decimal("615.50"),
        status=PosSessionStatusEnum.CONFIRMED,
        visible_snapshot={},
        notes=json.dumps({"kind": "purchase_workspace_v1"}),
    )
    session.add(pos_session)
    await session.flush()
    document = PosDocument(
        pos_session_id=pos_session.id,
        document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
        currency_code="DKK",
        gross_amount_dkk=Decimal("19166.44"),
        net_amount_dkk=Decimal("19166.44"),
        vat_rate_percent=Decimal("0.00"),
        vat_amount_dkk=Decimal("0.00"),
        customer_name="Firat Ucler",
        uniconta_sync_status="historical",
    )
    session.add(document)
    await session.flush()
    session.add(
        Transaction(
            pos_session_id=pos_session.id,
            pos_document_sequence_no=document.sequence_no,
            trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER.value,
            status="confirmed",
            customer_id=customer.id,
            clerk_user_id=clerk.id,
            currency_code="DKK",
            gross_amount_dkk=Decimal("19166.44"),
            net_amount_dkk=Decimal("19166.44"),
            vat_rate_percent=Decimal("0.00"),
            vat_amount_dkk=Decimal("0.00"),
        )
    )
    await session.commit()
    return document


def test_historical_document_can_be_relinked_to_correct_customer() -> None:
    """R2-17 — yanlış (duplike) müşteriye bağlanan tarihsel belge elle düzeltilir.

    Otomatik eşleşme duplike müşteri yaratıp belgeyi ona bağladığında müşteri
    kartı 0 gösteriyordu. Relink: Transaction.customer_id + PosSession.customer_id
    doğru müşteriye taşınır, audit düşer; canlı belgede reddedilir.
    """
    # v2 ↔ v2_alis döngüsü: uygulama gibi önce v2 yüklenir (app.main sırası).
    import app.api.v2  # noqa: F401
    from app.api.v2_alis import AlisDocumentLinkCustomerIn, post_alis_document_link_customer_v2

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            admin, wrong, correct = _users()
            session.add_all([admin, wrong, correct])
            await session.flush()
            document = await _seed_historical_document(session, clerk=admin, customer=wrong)

            result = await post_alis_document_link_customer_v2(
                sequence_no=document.sequence_no,
                payload=AlisDocumentLinkCustomerIn(customer_id=correct.id),
                db=session,
                admin=admin,
            )
            assert result["ok"] is True
            assert result["customer_name"] == "Firat Ucler"

            txn = (
                await session.scalars(
                    select(Transaction).where(Transaction.pos_document_sequence_no == document.sequence_no)
                )
            ).first()
            assert txn is not None and txn.customer_id == correct.id
            pos_session = await session.get(PosSession, document.pos_session_id)
            assert pos_session is not None and pos_session.customer_id == correct.id

            # Canlı (historical olmayan) belge reddedilir.
            document.uniconta_sync_status = "synced"
            await session.commit()
            with pytest.raises(HTTPException) as blocked:
                await post_alis_document_link_customer_v2(
                    sequence_no=document.sequence_no,
                    payload=AlisDocumentLinkCustomerIn(customer_id=wrong.id),
                    db=session,
                    admin=admin,
                )
            assert blocked.value.status_code == 422

        await engine.dispose()

    asyncio.run(scenario())
