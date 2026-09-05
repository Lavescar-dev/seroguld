"""Kayıtlı alışlar listesi PII minimizasyonu (MEDIUM: maskesiz CPR sızıntısı).

Liste satırı ham CPR / kimlik belge numarası taşımaz; yalnız maskeli CPR.
Tam değerler tek belge detayında (/alis/documents/{seq}) karşılanır.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v2 import _build_alis_saved_purchase_items
from app.database import Base
from app.models.customer_identity import CustomerIdentityDocument
from app.models.enums import (
    IdentityDocTypeEnum,
    PosDocumentTypeEnum,
    PosRateSourceEnum,
    PosTradeSideEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.transaction import Transaction
from app.models.user import User
from app.utils.security import decrypt_field, encrypt_field


@pytest.mark.asyncio
async def test_saved_purchase_list_returns_masked_cpr_only():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        clerk = User(email="pii-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
        customer = User(
            email="pii-customer@test.local",
            password_hash="x",
            name="CPR Kunde",
            role=RoleEnum.CUSTOMER,
            cpr_number_encrypted=encrypt_field("0101901234"),
        )
        session.add_all([clerk, customer])
        await session.flush()

        pos_session = PosSession(
            session_code="PII0001",
            display_token="pii-display-token",
            clerk_user_id=clerk.id,
            customer_id=customer.id,
            trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
            rate_source=PosRateSourceEnum.LIVE,
        )
        session.add(pos_session)
        await session.flush()

        document = PosDocument(
            pos_session_id=pos_session.id,
            document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
            gross_amount_dkk=Decimal("1000.00"),
            net_amount_dkk=Decimal("800.00"),
            customer_name="CPR Kunde",
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
            gross_amount_dkk=Decimal("1000.00"),
            net_amount_dkk=Decimal("800.00"),
            confirmed_at=document.issued_at,
        )
        session.add(transaction)
        session.add(
            CustomerIdentityDocument(
                user_id=customer.id,
                identity_doc_type=IdentityDocTypeEnum.PASSPORT,
                identity_doc_number_encrypted=encrypt_field("PASS-999999"),
            )
        )
        await session.commit()

        items = await _build_alis_saved_purchase_items(session, admin=clerk, q=None, date=None, limit=100)

        assert len(items) == 1
        item = items[0]
        # Ham CPR ve kimlik belge numarası liste yüzeyinde bulunmaz (şemadan
        # da kaldırıldı); yalnız maskeli CPR döner.
        assert not hasattr(item, "customer_cpr")
        assert not hasattr(item, "customer_identity_doc_number")
        # Maskeli CPR üretildi ve ham değer herhangi bir alanda sızmıyor.
        assert item.customer_cpr_masked is not None
        assert "0101901234" not in item.model_dump_json()
        assert "PASS-999999" not in item.model_dump_json()

        # Kaynak hâlâ decrypt edilebilir; minimizasyon yalnız liste düzeyinde.
        assert decrypt_field(customer.cpr_number_encrypted) == "0101901234"

    await engine.dispose()
