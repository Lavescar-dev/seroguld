"""M2 customers düzeltme testleri.

Kapsam:
- M2-F7: mock müşteri temizliği FK sırasına saygılıdır (Transaction/Line →
  ActivityEvent → PosDocument/Audit/SessionLine → PosSession) ve Woo fetch
  başarısızsa veriyi silmeden önce durur (erken commit yok).
- M2-F8: müşteri notu güncelleme/silme atomik compare-and-swap'tir — eski
  base_version ile ikinci istek 409 alır, revizyon zinciri bozulmaz.
- M2-F9: Woo içe aktarımı satır başına commit yerine savepoint+parti
  commit kullanır; hatalı satır yalnız kendisini geri alır.
- M2-F10: liste/arama yanıtları plaintext CPR/belge numarası taşımaz,
  maskeli alanlar dolu gelir.
- M2-F11: telefon çakışması serbest-format eski kayıtları da yakalar
  (tüm tabloyu Python'a çekmeden); e-posta çakışması case-insensitive.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from typing import Any

import pytest
from fastapi import HTTPException, status
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.api.customers as customers_api
from app.api.customers import (
    _delete_mock_customers,
    delete_customer_note,
    get_customers,
    import_woocommerce_customers,
    put_customer_note,
    search_customers,
)
from app.database import Base
from app.models.customer_activity import CustomerActivityEvent
from app.models.customer_identity import CustomerIdentityDocument
from app.models.customer_note import CustomerNote, CustomerNoteRevision
from app.models.enums import PosDocumentTypeEnum, RoleEnum
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.customer import CustomerCreate, CustomerNoteUpdate, CustomerWooImportRequest
from app.services.customer_service import create_customer
from app.utils.security import encrypt_field, hash_cpr, hash_sensitive_value, verify_password


def _admin() -> User:
    return User(
        email="m2-admin@test.local",
        password_hash="x",
        name="Admin",
        role=RoleEnum.ADMIN,
        is_active=True,
    )


def _mock_customer() -> User:
    return User(
        email="mock.customer.77@local.seroguld",
        password_hash="x",
        name="Mock Musteri 77",
        role=RoleEnum.CUSTOMER,
        is_active=True,
    )


async def _make_session(*, enforce_foreign_keys: bool = False) -> tuple[AsyncSession, Any]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    if enforce_foreign_keys:
        @event.listens_for(engine.sync_engine, "connect")
        def _enable_sqlite_fk(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return factory(), engine


async def _seed_mock_graph(db: AsyncSession) -> User:
    """POS testi yapılmış mock müşteri: oturum + belge + işlem + satır + etkinlik."""
    admin = _admin()
    mock_user = _mock_customer()
    db.add_all([admin, mock_user])
    await db.flush()

    session = PosSession(
        session_code="POS-77",
        display_token="tok-77",
        clerk_user_id=admin.id,
        customer_id=mock_user.id,
    )
    db.add(session)
    await db.flush()

    document = PosDocument(
        pos_session_id=session.id,
        document_type=PosDocumentTypeEnum.SALE_INVOICE,
        gross_amount_dkk=Decimal("100.00"),
        net_amount_dkk=Decimal("80.00"),
    )
    transaction = Transaction(
        pos_session_id=session.id,
        trade_side="buy_from_customer",
        customer_id=mock_user.id,
        gross_amount_dkk=Decimal("100.00"),
        net_amount_dkk=Decimal("80.00"),
    )
    db.add_all([document, transaction])
    await db.flush()
    db.add(TransactionLine(transaction_id=transaction.id, line_no=1, line_total_dkk=Decimal("80.00")))
    db.add(CustomerActivityEvent(customer_id=mock_user.id, pos_session_id=session.id))
    await db.commit()
    return mock_user


@pytest.mark.asyncio
async def test_mock_cleanup_respects_fk_order() -> None:
    """M2-F7: FK'lar zorlanırken bile mock temizliği IntegrityError almadan siler."""
    db, engine = await _make_session(enforce_foreign_keys=True)
    try:
        mock_user = await _seed_mock_graph(db)

        deleted = await _delete_mock_customers(db)
        # Temizlik artık kendi commit'ini atmaz — çağıran transaction'ında kalır.
        await db.commit()
        assert deleted == 1

        assert await db.get(User, mock_user.id) is None
        assert (await db.scalars(select(PosSession.id))).all() == []
        assert (await db.scalars(select(PosDocument.sequence_no))).all() == []
        assert (await db.scalars(select(Transaction.id))).all() == []
        assert (await db.scalars(select(TransactionLine.id))).all() == []
        assert (await db.scalars(select(CustomerActivityEvent.id))).all() == []
        # Admin (clerk) dokunulmaz.
        assert (await db.scalars(select(User).where(User.role == RoleEnum.ADMIN))).all()
    finally:
        await engine.dispose()


class _ExplodingWooService:
    async def fetch_customers(self, *, limit: int = 1000) -> list[dict]:
        raise RuntimeError("woo 502")


@pytest.mark.asyncio
async def test_mock_cleanup_waits_for_successful_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    """M2-F7: Woo fetch patlarsa mock veri YERİNDE kalır (erken silme/commit yok)."""
    monkeypatch.setattr(customers_api, "WooCommerceService", lambda: _ExplodingWooService())

    db, engine = await _make_session()
    try:
        admin = _admin()
        mock_user = _mock_customer()
        db.add_all([admin, mock_user])
        await db.commit()

        with pytest.raises(RuntimeError):
            await import_woocommerce_customers(
                payload=CustomerWooImportRequest(),
                db=db,
                _=admin,
            )

        survivor = await db.scalar(select(User).where(User.email == mock_user.email))
        assert survivor is not None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_note_update_is_atomic_compare_and_swap() -> None:
    """M2-F8: eski base_version ile ikinci yazma 409 alır; snapshot doğru body'i taşır."""
    db, engine = await _make_session()
    try:
        admin = _admin()
        customer = _mock_customer()
        db.add_all([admin, customer])
        await db.flush()
        note = CustomerNote(customer_id=customer.id, author_user_id=admin.id, body="v1")
        db.add(note)
        await db.commit()

        first = await put_customer_note(
            customer_id=customer.id,
            note_id=note.id,
            payload=CustomerNoteUpdate(body="v2", base_version=1),
            db=db,
            admin=admin,
        )
        assert first.version == 2

        # Bayat base_version ile ikinci istek: check-then-write race kapalıdır.
        with pytest.raises(HTTPException) as stale:
            await put_customer_note(
                customer_id=customer.id,
                note_id=note.id,
                payload=CustomerNoteUpdate(body="paralel yazar", base_version=1),
                db=db,
                admin=admin,
            )
        assert stale.value.status_code == 409

        revisions = (await db.scalars(select(CustomerNoteRevision).where(CustomerNoteRevision.note_id == note.id))).all()
        assert [revision.action for revision in revisions] == ["updated"]
        assert revisions[0].body_snapshot == "v1"
        assert revisions[0].version == 1
        refreshed = await db.get(CustomerNote, note.id)
        assert refreshed is not None and refreshed.body == "v2" and refreshed.version == 2
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_note_delete_is_atomic_compare_and_swap() -> None:
    """M2-F8: silmede de atomik CAS — bayat base_version 409, not yerinde kalır."""
    db, engine = await _make_session()
    try:
        admin = _admin()
        customer = _mock_customer()
        db.add_all([admin, customer])
        await db.flush()
        note = CustomerNote(customer_id=customer.id, author_user_id=admin.id, body="v1")
        db.add(note)
        await db.commit()

        with pytest.raises(HTTPException) as stale:
            await delete_customer_note(customer_id=customer.id, note_id=note.id, base_version=2, db=db, admin=admin)
        assert stale.value.status_code == 409

        response = await delete_customer_note(customer_id=customer.id, note_id=note.id, base_version=1, db=db, admin=admin)
        assert response.status_code == status.HTTP_204_NO_CONTENT

        revisions = (await db.scalars(select(CustomerNoteRevision).where(CustomerNoteRevision.note_id == note.id))).all()
        assert [revision.action for revision in revisions] == ["deleted"]
        assert revisions[0].body_snapshot == "v1"
    finally:
        await engine.dispose()


def _wc_customer(**overrides: Any) -> dict:
    payload = {
        "id": 11,
        "email": "one@example.dk",
        "first_name": "Bir",
        "last_name": "Kisi",
        "role": "customer",
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_import_savepoint_keeps_created_rows_when_one_row_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """M2-F9: hatalı satır yalnız kendisini geri alır; parti kayıtları korunur."""
    monkeypatch.setattr(customers_api, "_env_value", lambda key: "EnvPass123!")

    wc_customers = [
        _wc_customer(id=1, email="one@example.dk"),
        # Geçersiz e-posta → CustomerCreate doğrulaması patlar → savepoint rollback.
        _wc_customer(id=2, email="gecersiz-eposta"),
        _wc_customer(id=3, email="three@example.dk"),
    ]

    class _StubWooService:
        async def fetch_customers(self, *, limit: int = 1000) -> list[dict]:
            return wc_customers

    monkeypatch.setattr(customers_api, "WooCommerceService", lambda: _StubWooService())

    db, engine = await _make_session()
    try:
        admin = _admin()
        db.add(admin)
        await db.commit()

        response = await import_woocommerce_customers(
            payload=CustomerWooImportRequest(),
            db=db,
            _=admin,
        )

        assert response.created == 2
        assert len(response.errors) == 1
        assert "wc_customer_id=2" in response.errors[0]

        one = await db.scalar(select(User).where(User.email == "one@example.dk"))
        three = await db.scalar(select(User).where(User.email == "three@example.dk"))
        assert one is not None and three is not None
        # Parti commit'i kayıtları kalıcılaştırdı ve hash içe aktarım başına bir kez üretildi.
        assert verify_password("EnvPass123!", one.password_hash) is True
        assert one.must_change_password is True
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_list_and_search_responses_are_masked() -> None:
    """M2-F10: liste/arama plaintext CPR/belge no dönmez; maskeli alanlar dolu."""
    db, engine = await _make_session()
    try:
        admin = _admin()
        customer = User(
            email="ada@example.dk",
            password_hash="x",
            name="Ada Yilmaz",
            role=RoleEnum.CUSTOMER,
            is_active=True,
            cpr_number_encrypted=encrypt_field("0102030405"),
            cpr_hash=hash_cpr("0102030405"),
            cpr_last4="0405",
        )
        db.add_all([admin, customer])
        await db.flush()
        db.add(CustomerIdentityDocument(
            user_id=customer.id,
            identity_doc_type=None,
            identity_doc_number_encrypted=encrypt_field("P123456"),
            identity_doc_number_hash=hash_sensitive_value("P123456"),
        ))
        await db.commit()

        listing = await get_customers(page=1, page_size=20, sort_by="created_at", customer_status="active", db=db, _=admin)
        assert listing.total == 1
        row = listing.items[0]
        assert row.cpr_number is None
        assert row.cpr_number_masked == "******0405"
        assert row.identity_doc_number is None
        assert row.identity_doc_number_masked == "***3456"

        matches = await search_customers(q="Ada", customer_status="active", db=db, _=admin)
        assert len(matches) == 1
        assert matches[0].cpr_number is None
        assert matches[0].cpr_number_masked == "******0405"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_phone_duplicate_detects_legacy_spaced_variant() -> None:
    """M2-F11: serbest-format eski telefon kaydıyla çakışma sorgu yoluyla yakalanır."""
    db, engine = await _make_session()
    try:
        db.add(User(
            email="eski@example.dk",
            password_hash="x",
            name="Eski Kayit",
            role=RoleEnum.CUSTOMER,
            phone="12 34 56 78",  # normalize dışı eski serbest format
            is_active=True,
        ))
        await db.commit()

        with pytest.raises(HTTPException) as conflict:
            await create_customer(
                db,
                CustomerCreate(name="Yeni Musteri", email="yeni@example.dk", phone="12345678"),
            )
        assert conflict.value.status_code == 409
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_email_duplicate_is_case_insensitive() -> None:
    """M2-F11: 'Ada@Example.dk' ile 'ada@example.dk' aynı kayda çarpar (409)."""
    db, engine = await _make_session()
    try:
        db.add(User(
            email="Ada@Example.dk",
            password_hash="x",
            name="Ada Yilmaz",
            role=RoleEnum.CUSTOMER,
            is_active=True,
        ))
        await db.commit()

        with pytest.raises(HTTPException) as conflict:
            await create_customer(
                db,
                CustomerCreate(name="Ada Yilmaz Kopya", email="ada@example.dk"),
            )
        assert conflict.value.status_code == 409
        assert "Email" in conflict.value.detail
    finally:
        await engine.dispose()
