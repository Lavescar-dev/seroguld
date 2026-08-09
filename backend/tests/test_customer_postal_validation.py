from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import RoleEnum
from app.models.user import User
from app.schemas.customer import CustomerUpdate
from app.services.customer_service import _normalize_postal_code
from app.services.customer_service import update_customer


def test_customer_postal_code_is_blank_or_exactly_four_digits() -> None:
    assert _normalize_postal_code(None) is None
    assert _normalize_postal_code("  ") is None
    assert _normalize_postal_code(" 2500 ") == "2500"

    for value in ("1", "250", "25000", "25A0"):
        with pytest.raises(HTTPException) as raised:
            _normalize_postal_code(value)
        assert raised.value.status_code == 422


@pytest.mark.asyncio
async def test_existing_customer_update_persists_valid_postal_code_and_rejects_partial_values() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        customer = User(
            email="postal-existing@test.local",
            password_hash="x",
            name="Existing customer",
            role=RoleEnum.CUSTOMER,
        )
        session.add(customer)
        await session.flush()

        await update_customer(session, customer, CustomerUpdate(postal_code=" 2500 "))
        assert customer.postal_code == "2500"

        with pytest.raises(HTTPException) as raised:
            await update_customer(session, customer, CustomerUpdate(postal_code="250"))
        assert raised.value.status_code == 422

    await engine.dispose()
