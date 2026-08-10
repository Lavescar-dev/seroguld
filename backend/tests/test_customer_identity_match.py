from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.auth import register
from app.database import Base
from app.models.customer_identity import CustomerIdentityDocument
from app.models.enums import IdentityDocTypeEnum, RoleEnum
from app.models.user import User
from app.schemas.auth import RegisterRequest
from app.schemas.customer import CustomerCreate, CustomerUpdate
from app.schemas.pos import PosWorkspaceCustomerOut, PosWorkspaceCustomerUpdate
from app.services import pos_workspace_state
from app.services.customer_service import create_customer, customer_identity_match, update_customer
from app.services.pos_workspace_mutations import _merge_workspace_customer_snapshot


@pytest.mark.asyncio
async def test_customer_identity_match_is_exact_masked_and_conflict_aware() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with Session() as session:
        first = await create_customer(
            session,
            CustomerCreate(
                name="First customer",
                email="first-identity@example.com",
                cpr_number="010190-1234",
                identity_doc_type=IdentityDocTypeEnum.PASSPORT,
                identity_doc_number="PASS-1111",
                identity_doc_country="dk",
                city="Valby",
            ),
        )
        second = await create_customer(
            session,
            CustomerCreate(
                name="Second customer",
                email="second-identity@example.com",
                cpr_number="020290-5678",
                identity_doc_number="PASS-2222",
            ),
        )
        await session.commit()

        match = await customer_identity_match(
            session,
            cpr_number="0101901234",
            identity_doc_number="PASS-2222",
        )
        assert match.status == "conflict"
        assert {item.id for item in match.matches} == {str(first.id), str(second.id)}
        assert {item.matched_by for item in match.matches} == {"cpr", "identity_doc_number"}
        assert all("0101901234" not in item.model_dump_json() for item in match.matches)
        assert all("PASS-2222" not in item.model_dump_json() for item in match.matches)
        assert first.city == "Valby"

        with pytest.raises(HTTPException) as raised:
            await create_customer(
                session,
                CustomerCreate(
                    name="Duplicate customer",
                    email="duplicate-identity@example.com",
                    cpr_number="0101901234",
                    identity_doc_number="PASS-3333",
                ),
            )
        assert raised.value.status_code == 409
        assert "CPR" in str(raised.value.detail)

    await engine.dispose()


@pytest.mark.asyncio
async def test_explicit_customer_city_and_identity_clears_are_persisted() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with Session() as session:
        customer = await create_customer(
            session,
            CustomerCreate(
                name="Clear customer",
                email="clear-identity@example.com",
                city="København",
                identity_doc_type=IdentityDocTypeEnum.PASSPORT,
                identity_doc_number="PASS-4444",
                identity_doc_country="DK",
                identity_photo_refs=["front.jpg"],
            ),
        )
        await update_customer(
            session,
            customer,
            CustomerUpdate(
                city=None,
                identity_doc_type=None,
                identity_doc_number=None,
                identity_doc_country=None,
                identity_photo_refs=None,
            ),
        )
        identity = await session.scalar(
            select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer.id)
        )

        assert customer.city is None
        assert identity is not None
        assert identity.identity_doc_type is None
        assert identity.identity_doc_number_encrypted is None
        assert identity.identity_doc_number_hash is None
        assert identity.identity_doc_country is None
        assert identity.identity_photo_refs == []

    await engine.dispose()


@pytest.mark.asyncio
async def test_register_customer_uses_normalized_cpr_duplicate_guard() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with Session() as session:
        await create_customer(
            session,
            CustomerCreate(
                name="Existing customer",
                email="existing-register@example.com",
                cpr_number="0101901234",
            ),
        )
        await session.commit()

        with pytest.raises(HTTPException) as raised:
            await register(
                RegisterRequest(
                    email="formatted-register@example.com",
                    password="SafePassword123!",
                    name="Formatted duplicate",
                    role=RoleEnum.CUSTOMER,
                    cpr_number="010190-1234",
                ),
                session,
                User(
                    email="admin-register@example.com",
                    password_hash="x",
                    name="Admin",
                    role=RoleEnum.ADMIN,
                ),
            )

        assert raised.value.status_code == 409
        assert "CPR" in str(raised.value.detail)

    await engine.dispose()


@pytest.mark.asyncio
async def test_update_unique_index_race_becomes_friendly_conflict(monkeypatch) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with Session() as session:
        first = await create_customer(
            session,
            CustomerCreate(name="First race", email="first-race@example.com", cpr_number="0101901234"),
        )
        second = await create_customer(
            session,
            CustomerCreate(name="Second race", email="second-race@example.com", cpr_number="0202905678"),
        )
        await session.commit()

        async def skip_preflight(*args, **kwargs) -> None:
            return None

        # Simulate the interval after a concurrent request has passed its own
        # lookup and before this request reaches the database unique index.
        monkeypatch.setattr("app.services.customer_service._ensure_identity_values_available", skip_preflight)
        with pytest.raises(HTTPException) as raised:
            await update_customer(session, second, CustomerUpdate(cpr_number="0101901234"))

        assert raised.value.status_code == 409
        assert "aynı anda" in str(raised.value.detail)
        assert first.cpr_hash is not None

    await engine.dispose()


def test_workspace_customer_snapshot_distinguishes_omitted_city_from_explicit_clear() -> None:
    current = PosWorkspaceCustomerOut(
        customer_id=None,
        name="Snapshot customer",
        address="Testvej 1",
        postal_code="2500",
        city="Valby",
    )

    omitted_city = _merge_workspace_customer_snapshot(
        pos_workspace_state,
        current,
        PosWorkspaceCustomerUpdate(address="Testvej 2"),
    )
    explicit_clear = _merge_workspace_customer_snapshot(
        pos_workspace_state,
        current,
        PosWorkspaceCustomerUpdate(city=None),
    )

    assert omitted_city["address"] == "Testvej 2"
    assert omitted_city["city"] == "Valby"
    assert explicit_clear["city"] is None
