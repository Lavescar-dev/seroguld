"""A6 customers düzeltim testleri.

Kapsam:
- A6-1: Woo içe aktarımda gömülü varsayılan şifre yok — .env yoksa rastgele şifre,
  içe aktarılan müşteri must_change_password ile işaretlenir.
- A6-2: Woo yeniden içe aktarım yerel düzenlemeleri ezmez; "kaynaktan zorla" ancak
  açık force_source_values bayrağıyla.
- A6-3: 409 e-posta çakışması pasif kayıt için aktifleştirme önerisi içerir;
  PUT is_active=true pasif müşteriyi geri açar.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.api.customers as customers_api
from app.api.customers import import_woocommerce_customers, post_customer, put_customer
from app.database import Base
from app.models.enums import RoleEnum
from app.models.user import User
from app.schemas.customer import CustomerCreate, CustomerUpdate, CustomerWooImportRequest
from app.utils.security import decrypt_field, encrypt_field, verify_password

KNOWN_DEFAULT_PASSWORD = "WooImport123!"


def _wc_customer(**overrides):
    payload = {
        "id": 11,
        "email": "ada@example.dk",
        "first_name": "Ada",
        "last_name": "Yilmaz",
        "role": "customer",
        "billing": {
            "phone": "87654321",
            "address_1": "Vesterbro 1",
            "city": "Kobenhavn",
            "postcode": "1620",
            "country": "DK",
        },
    }
    payload.update(overrides)
    return payload


class _StubWooService:
    def __init__(self, customers: list[dict]) -> None:
        self._customers = customers

    async def fetch_customers(self, *, limit: int = 1000) -> list[dict]:
        return self._customers


def _admin() -> User:
    return User(
        email="customers-api-admin@test.local",
        password_hash="x",
        name="Admin",
        role=RoleEnum.ADMIN,
        is_active=True,
    )


async def _make_session() -> tuple[AsyncSession, Any]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return factory(), engine


def run_import(monkeypatch, wc_customers: list[dict], **request_overrides):
    monkeypatch.setattr(customers_api, "WooCommerceService", lambda: _StubWooService(wc_customers))

    async def scenario():
        db, engine = await _make_session()
        try:
            admin = _admin()
            db.add(admin)
            await db.commit()
            return await import_woocommerce_customers(
                payload=CustomerWooImportRequest(**request_overrides),
                db=db,
                _=admin,
            )
        finally:
            await engine.dispose()

    return asyncio.run(scenario())


def test_woo_import_without_env_password_generates_random_and_forces_change(monkeypatch) -> None:
    """A6-1: .env şifresi yokken gömülü WooImport123! KULLANILMAZ, must_change_password set edilir."""
    monkeypatch.setattr(customers_api, "_env_value", lambda key: "")

    async def scenario():
        db, engine = await _make_session()
        try:
            admin = _admin()
            db.add(admin)
            await db.commit()
            monkeypatch.setattr(customers_api, "WooCommerceService", lambda: _StubWooService([_wc_customer()]))
            response = await import_woocommerce_customers(
                payload=CustomerWooImportRequest(), db=db, _=admin
            )
            user = await db.scalar(select(User).where(User.email == "ada@example.dk"))
            return response, user
        finally:
            await engine.dispose()

    response, user = asyncio.run(scenario())
    assert response.created == 1
    assert user is not None
    assert user.must_change_password is True
    assert verify_password(KNOWN_DEFAULT_PASSWORD, user.password_hash) is False


def test_woo_import_uses_env_password_when_defined(monkeypatch) -> None:
    """A6-1: .env'de şifre tanımlıysa o kullanılır; içe aktarılan yine şifre değişimine zorlanır."""
    monkeypatch.setattr(customers_api, "_env_value", lambda key: "S3cureEnvPass!")

    async def scenario():
        db, engine = await _make_session()
        try:
            admin = _admin()
            db.add(admin)
            await db.commit()
            monkeypatch.setattr(customers_api, "WooCommerceService", lambda: _StubWooService([_wc_customer()]))
            await import_woocommerce_customers(payload=CustomerWooImportRequest(), db=db, _=admin)
            return await db.scalar(select(User).where(User.email == "ada@example.dk"))
        finally:
            await engine.dispose()

    user = asyncio.run(scenario())
    assert user is not None
    assert verify_password("S3cureEnvPass!", user.password_hash) is True
    assert user.must_change_password is True


def _seed_local_customer(db: AsyncSession) -> None:
    db.add(
        User(
            email="local@example.dk",
            password_hash="x",
            name="Eski Isim",
            role=RoleEnum.CUSTOMER,
            phone="12345678",
            address_encrypted=encrypt_field("Localvej 3"),
            is_active=False,
            woocommerce_customer_id="11",
        )
    )


def _woo_payload_without_optional_fields() -> list[dict]:
    # Woo'da telefon/adres boş: yeniden içe aktarım bunları NULL'a ÇEKMEMELİ.
    return [
        {
            "id": 11,
            "email": "local@example.dk",
            "first_name": "Ada",
            "last_name": "Yilmaz",
            "role": "customer",
        }
    ]


def test_woo_reimport_preserves_local_edits_and_passive_state(monkeypatch) -> None:
    """A6-2: eksik Woo alanları yerel değeri silmez, pasif müşteri sessizce açılmaz."""
    monkeypatch.setattr(customers_api, "_env_value", lambda key: "S3cureEnvPass!")

    async def scenario():
        db, engine = await _make_session()
        try:
            admin = _admin()
            db.add(admin)
            _seed_local_customer(db)
            await db.commit()
            monkeypatch.setattr(
                customers_api,
                "WooCommerceService",
                lambda: _StubWooService(_woo_payload_without_optional_fields()),
            )
            response = await import_woocommerce_customers(
                payload=CustomerWooImportRequest(), db=db, _=admin
            )
            user = await db.scalar(select(User).where(User.email == "local@example.dk"))
            return response, user
        finally:
            await engine.dispose()

    response, user = asyncio.run(scenario())
    assert response.updated == 1
    assert response.created == 0
    assert user is not None
    # Woo'dan GELEN dolu alan güncellenir...
    assert user.name == "Ada Yilmaz"
    # ...ama eksik Woo alanları yerel değeri EZMEZ ve pasif durum KORUNUR.
    assert user.phone == "12345678"
    assert decrypt_field(user.address_encrypted) == "Localvej 3"
    assert user.is_active is False


def test_woo_reimport_force_source_values_overwrites(monkeypatch) -> None:
    """A6-2: force_source_values=true ile kaynaktan zorla eşitleme yapılır."""
    monkeypatch.setattr(customers_api, "_env_value", lambda key: "S3cureEnvPass!")

    async def scenario():
        db, engine = await _make_session()
        try:
            admin = _admin()
            db.add(admin)
            _seed_local_customer(db)
            await db.commit()
            monkeypatch.setattr(
                customers_api,
                "WooCommerceService",
                lambda: _StubWooService(_woo_payload_without_optional_fields()),
            )
            response = await import_woocommerce_customers(
                payload=CustomerWooImportRequest(force_source_values=True), db=db, _=admin
            )
            user = await db.scalar(select(User).where(User.email == "local@example.dk"))
            return response, user
        finally:
            await engine.dispose()

    response, user = asyncio.run(scenario())
    assert response.updated == 1
    assert user is not None
    assert user.phone is None
    assert user.address_encrypted is None
    assert user.is_active is True


def test_post_customer_email_conflict_suggests_reactivation_for_passive_record() -> None:
    """A6-3: pasif kayıtla aynı e-posta için 409 mesajı aktifleştirme yolunu gösterir."""
    for is_active, expected_fragment in ((False, "aktifleştir"), (True, "Email zaten kayıtlı")):

        async def scenario(is_active=is_active):
            db, engine = await _make_session()
            try:
                admin = _admin()
                db.add(admin)
                db.add(
                    User(
                        email="pasif@example.dk",
                        password_hash="x",
                        name="Pasif Musteri",
                        role=RoleEnum.CUSTOMER,
                        is_active=is_active,
                    )
                )
                await db.commit()
                with pytest.raises(HTTPException) as caught:
                    await post_customer(
                        payload=CustomerCreate(name="Yeni Musteri", email="pasif@example.dk"),
                        db=db,
                        _=admin,
                    )
                return caught.value
            finally:
                await engine.dispose()

        exc = asyncio.run(scenario())
        assert exc.status_code == 409
        assert expected_fragment in str(exc.detail)


def test_put_customer_reactivates_passive_customer() -> None:
    """A6-3: PUT is_active=true pasif müşteriyi geri açar (yeniden aktifleştirme ucu)."""

    async def scenario():
        db, engine = await _make_session()
        try:
            admin = _admin()
            db.add(admin)
            customer = User(
                email="geri-ac@example.dk",
                password_hash="x",
                name="Geri Acilacak",
                role=RoleEnum.CUSTOMER,
                is_active=False,
            )
            db.add_all([admin, customer])
            await db.commit()
            out = await put_customer(customer_id=customer.id, payload=CustomerUpdate(is_active=True), db=db, _=admin)
            reloaded = await db.get(User, customer.id)
            return out, reloaded
        finally:
            await engine.dispose()

    out, reloaded = asyncio.run(scenario())
    assert out.is_active is True
    assert reloaded.is_active is True
