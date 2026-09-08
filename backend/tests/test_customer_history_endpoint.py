"""Müşteri belge geçmişi uç noktası testleri (GET /api/customers/{id}/history).

Saha hatası (0.3.36): get_customer_history PosDocumentListItemOut'u
vat_rate_percent OLMADAN kuruyordu — schema'da alan zorunlu olduğu için
müşterinin en az bir belgesi varsa yanıt doğrulamayı geçemiyor ve HTTP
katmanında 500'e düşüyordu (boş müşteride [] dönüyordu, testler yeşildi).

Ayrıca liste yalnız Transaction.pos_document_sequence_no INNER JOIN'i üzerinden
geliyordu; PosSession.customer_id ile bağlı belgeler listede yoktu ama
get_customer_workspace document_count onları sayıyordu → "Belgeler (0)" + sayım
şişmesi.

Kapsam:
- işlem-bağlı belge → 200 + liste + item.vat_rate_percent dolu (regresyon),
- yalnız oturum-bağlı belge → listede GÖRÜNÜR + sayım tutarlı,
- boş müşteri → [],
- iki kaynağın kesişimi → tekrarsız.

Veriler tamamen sentetiktir (Testove TESTSEN, uydurma tutarlar).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.customers import get_customer_history, get_customer_workspace
from app.database import Base
from app.models.enums import (
    PosDocumentTypeEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.transaction import Transaction
from app.models.user import User

NOW = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)


async def _make_session() -> tuple[async_sessionmaker[AsyncSession], Any]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return factory, engine


async def _seed_users(db: AsyncSession, *, suffix: str) -> tuple[User, User]:
    clerk = User(
        email=f"history-clerk-{suffix}@test.local",
        password_hash="x",
        name="Kasiyer Testci",
        role=RoleEnum.ADMIN,
        is_active=True,
    )
    customer = User(
        email=f"history-customer-{suffix}@test.local",
        password_hash="x",
        name="Testove TESTSEN",
        role=RoleEnum.CUSTOMER,
        is_active=True,
    )
    db.add_all([clerk, customer])
    await db.flush()
    return clerk, customer


async def _add_document(
    db: AsyncSession,
    clerk: User,
    *,
    tag: str,
    session_customer: User | None = None,
    transaction_customer: User | None = None,
    with_transaction: bool = True,
    issued_at: datetime = NOW,
) -> PosDocument:
    """Onaylanmış bir POS oturumu + belge (+ isteğe bağlı Transaction) ekler.

    transaction_customer=None ve with_transaction=True → işlem var ama müşteri
    bağlı değil (yalnız oturum-bağlı senaryo).
    with_transaction=False → hiç işlem yok (yalnız oturum-bağlı, işlem satırı yok).
    """
    pos_session = PosSession(
        session_code=f"HIST-{tag}",
        display_token=f"history-{tag}-token",
        clerk_user_id=clerk.id,
        customer_id=session_customer.id if session_customer else None,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        status=PosSessionStatusEnum.CONFIRMED,
        confirmed_at=issued_at,
        visible_snapshot={},
    )
    db.add(pos_session)
    await db.flush()

    document = PosDocument(
        pos_session_id=pos_session.id,
        document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
        issued_at=issued_at,
        currency_code="DKK",
        gross_amount_dkk=Decimal("1250.00"),
        net_amount_dkk=Decimal("1000.00"),
        vat_rate_percent=Decimal("25.00"),
        vat_amount_dkk=Decimal("250.00"),
        customer_name="Testove TESTSEN",
    )
    db.add(document)
    await db.flush()

    if with_transaction:
        db.add(
            Transaction(
                pos_session_id=pos_session.id,
                pos_document_sequence_no=document.sequence_no,
                trade_side="buy_from_customer",
                status="confirmed",
                customer_id=transaction_customer.id if transaction_customer else None,
                clerk_user_id=clerk.id,
                currency_code="DKK",
                gross_amount_dkk=Decimal("1250.00"),
                net_amount_dkk=Decimal("1000.00"),
                vat_rate_percent=Decimal("25.00"),
                vat_amount_dkk=Decimal("250.00"),
                confirmed_at=issued_at,
            )
        )
        await db.flush()
    return document


@pytest.mark.asyncio
async def test_transaction_bound_document_returns_list_with_vat_rate() -> None:
    """İşlem-bağlı belge listelenir ve vat_rate_percent dolu gelir.

    REGRESYON: vat_rate_percent schema'da zorunlu; olmadan kurulan yanıt
    doğrulamadan geçemez ve HTTP'de 500 olur (saha patlaması).
    """
    factory, engine = await _make_session()
    async with factory() as db:
        clerk, customer = await _seed_users(db, suffix="tx")
        await _add_document(db, clerk, tag="TX1", session_customer=customer, transaction_customer=customer)
        await db.commit()

        items = await get_customer_history(customer_id=customer.id, limit=100, db=db, _=clerk)

        assert len(items) == 1
        item = items[0]
        assert item.document_number
        assert item.customer_name == "Testove TESTSEN"
        assert item.vat_rate_percent == Decimal("25.00")
        assert item.vat_amount_dkk == Decimal("250.00")
        assert item.gross_amount_dkk == Decimal("1250.00")
        # sayım == liste uzunluğu (aynı küme kaynağı)
        workspace = await get_customer_workspace(customer_id=customer.id, db=db, _=clerk)
        assert workspace.document_count == len(items)


@pytest.mark.asyncio
async def test_session_bound_document_is_listed_and_counted() -> None:
    """Yalnız PosSession.customer_id ile bağlı belgeler listede görünür.

    Öncesinde bu belgeler listede yoktu ama workspace document_count onları
    sayıyordu → "Belgeler (0)" + şişen sayım.
    """
    factory, engine = await _make_session()
    async with factory() as db:
        clerk, customer = await _seed_users(db, suffix="session")
        # İşlem var ama müşteri işlemde bağlı değil.
        await _add_document(db, clerk, tag="S1", session_customer=customer, transaction_customer=None)
        # Hiç işlem satırı olmayan oturum-bağlı belge.
        await _add_document(db, clerk, tag="S2", session_customer=customer, with_transaction=False, issued_at=NOW)
        await db.commit()

        items = await get_customer_history(customer_id=customer.id, limit=100, db=db, _=clerk)

        assert len(items) == 2
        # İşlemi olmayan belge oturum durumu ile döner.
        assert all(item.vat_rate_percent == Decimal("25.00") for item in items)

        workspace = await get_customer_workspace(customer_id=customer.id, db=db, _=clerk)
        assert workspace.document_count == 2
        assert workspace.document_count == len(items)


@pytest.mark.asyncio
async def test_customer_without_documents_returns_empty_list() -> None:
    """Belgesiz müşteri boş liste döner ve sayım da sıfırdır."""
    factory, engine = await _make_session()
    async with factory() as db:
        clerk, customer = await _seed_users(db, suffix="empty")
        await db.commit()

        items = await get_customer_history(customer_id=customer.id, limit=100, db=db, _=clerk)

        assert items == []
        workspace = await get_customer_workspace(customer_id=customer.id, db=db, _=clerk)
        assert workspace.document_count == 0


@pytest.mark.asyncio
async def test_document_matched_by_both_sources_is_not_duplicated() -> None:
    """Hem işlem-bağlı hem oturum-bağlı belge tek satır olarak gelir."""
    factory, engine = await _make_session()
    async with factory() as db:
        clerk, customer = await _seed_users(db, suffix="both")
        # Oturum ve işlem AYNI müşteriye bağlı → UNION kesişimi.
        await _add_document(db, clerk, tag="B1", session_customer=customer, transaction_customer=customer)
        # Başka müşteriye bağlı oturum; işlemi bu müşteriye ait (işlem-bağlı tek kaynak).
        other = User(
            email="history-other@test.local",
            password_hash="x",
            name="Diger MUSTERI",
            role=RoleEnum.CUSTOMER,
            is_active=True,
        )
        db.add(other)
        await db.flush()
        await _add_document(db, clerk, tag="B2", session_customer=other, transaction_customer=customer)
        await db.commit()

        items = await get_customer_history(customer_id=customer.id, limit=100, db=db, _=clerk)

        sequence_numbers = [item.sequence_no for item in items]
        assert len(items) == 2
        assert len(set(sequence_numbers)) == 2

        workspace = await get_customer_workspace(customer_id=customer.id, db=db, _=clerk)
        assert workspace.document_count == 2
        assert workspace.document_count == len(items)


@pytest.mark.asyncio
async def test_other_customers_documents_stay_out_of_the_list() -> None:
    """Başka müşterinin işlemine VE oturumuna bağlı belgeler bu müşteride görünmez."""
    factory, engine = await _make_session()
    async with factory() as db:
        clerk, customer = await _seed_users(db, suffix="isolation")
        other = User(
            email="history-isolation-other@test.local",
            password_hash="x",
            name="Baska KIMSE",
            role=RoleEnum.CUSTOMER,
            is_active=True,
        )
        db.add(other)
        await db.flush()
        await _add_document(db, clerk, tag="X1", session_customer=other, transaction_customer=other)
        await db.commit()

        items = await get_customer_history(customer_id=customer.id, limit=100, db=db, _=clerk)

        assert items == []
        workspace = await get_customer_workspace(customer_id=customer.id, db=db, _=clerk)
        assert workspace.document_count == 0
