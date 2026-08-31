from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import PosSessionStatusEnum, PosTradeSideEnum, RoleEnum
from app.models.pos_session import PosSession
from app.models.user import User
from app.schemas.pos import PosWorkspaceCustomerDetachRequest
from app.services import pos_service
from app.services.pos_service import _serialize_workspace_note_payload, _workspace_note_defaults
from app.services.pos_workspace_mutations import detach_purchase_workspace_customer


def _customer_snapshot_notes() -> str:
    notes = _workspace_note_defaults()
    notes["workspace_customer"] = {
        "customer_id": None,
        "name": "Test Customer",
        "email": None,
        "phone": "12345678",
        "address": "Testvej 1",
        "postal_code": "1000",
        "city": "Kobenhavn",
        "cpr_number": "1234567890",
        "identity_doc_type": None,
        "identity_doc_number": "ID1000614",
        "identity_doc_country": None,
    }
    notes["draft_customer"] = dict(notes["workspace_customer"])
    notes["workspace_customer_city"] = "Kobenhavn"
    return _serialize_workspace_note_payload(notes)


def _run(fn) -> None:
    asyncio.run(fn())


async def _make_session(session_factory: async_sessionmaker, *, status: PosSessionStatusEnum, notes: str | None, with_customer: bool = False):
    async with session_factory() as session:
        clerk = User(email="detach-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
        session.add(clerk)
        await session.flush()
        customer = User(email="detach-customer@test.local", password_hash="x", name="Detach Customer", role=RoleEnum.CUSTOMER) if with_customer else None
        if customer is not None:
            session.add(customer)
            await session.flush()
        pos_session = PosSession(
            session_code="DETACHTEST",
            display_token="display-detach-test",
            clerk_user_id=clerk.id,
            customer_id=customer.id if customer is not None else None,
            trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
            status=status,
            visible_snapshot={},
            notes=notes,
        )
        session.add(pos_session)
        await session.commit()
        return pos_session.id


def test_detach_unhooks_customer_and_clears_note_snapshots() -> None:
    """Detach is a full unhook: master link, snapshot key and draft shadow go."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        pos_session_id = await _make_session(session_factory, status=PosSessionStatusEnum.DRAFT, notes=_customer_snapshot_notes(), with_customer=True)

        async with session_factory() as session:
            pos_session = await session.get(PosSession, pos_session_id)
            result = await detach_purchase_workspace_customer(
                session,
                pos_session=pos_session,
                payload=PosWorkspaceCustomerDetachRequest(base_revision=1),
                emit=False,
            )

            assert result.customer.customer_id is None

            fresh = await session.get(PosSession, pos_session_id)
            assert fresh.customer_id is None
            parsed = pos_service._parse_workspace_note_payload(fresh.notes)
            # The serializer drops the presence-aware snapshot key entirely;
            # the parser normalizes it back to None.
            assert parsed.get("workspace_customer") is None
            assert all(value in (None, "") for value in parsed["draft_customer"].values())
            assert parsed["workspace_customer_city"] is None
            assert int(parsed["workspace_revision"]) == 2

        await engine.dispose()

    _run(run)


def test_detach_requires_draft_session() -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        pos_session_id = await _make_session(session_factory, status=PosSessionStatusEnum.CONFIRMED, notes=_customer_snapshot_notes(), with_customer=True)

        async with session_factory() as session:
            pos_session = await session.get(PosSession, pos_session_id)
            with pytest.raises(HTTPException) as exc:
                await detach_purchase_workspace_customer(
                    session,
                    pos_session=pos_session,
                    payload=PosWorkspaceCustomerDetachRequest(),
                    emit=False,
                )

            assert exc.value.status_code == 400

        await engine.dispose()

    _run(run)


def test_detach_without_customer_is_422() -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        pos_session_id = await _make_session(session_factory, status=PosSessionStatusEnum.DRAFT, notes=None)

        async with session_factory() as session:
            pos_session = await session.get(PosSession, pos_session_id)
            with pytest.raises(HTTPException) as exc:
                await detach_purchase_workspace_customer(
                    session,
                    pos_session=pos_session,
                    payload=PosWorkspaceCustomerDetachRequest(),
                    emit=False,
                )

            assert exc.value.status_code == 422

        await engine.dispose()

    _run(run)


def test_detach_claims_revision_and_conflicts_on_stale_base() -> None:
    """A losing detach (stale base_revision) must return 409, not unhook."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        pos_session_id = await _make_session(session_factory, status=PosSessionStatusEnum.DRAFT, notes=_customer_snapshot_notes(), with_customer=True)

        async with session_factory() as session:
            # Another surface wins the revision first: stored revision 2.
            winning_notes = _workspace_note_defaults()
            winning_notes["workspace_revision"] = 2
            await session.execute(
                sa_update(PosSession)
                .where(PosSession.id == pos_session_id)
                .values(notes=_serialize_workspace_note_payload(winning_notes))
                .execution_options(synchronize_session=False)
            )
            await session.commit()

        async with session_factory() as session:
            pos_session = await session.get(PosSession, pos_session_id)
            with pytest.raises(HTTPException) as exc:
                await detach_purchase_workspace_customer(
                    session,
                    pos_session=pos_session,
                    payload=PosWorkspaceCustomerDetachRequest(base_revision=1),
                    emit=False,
                )

            assert exc.value.status_code == 409
            assert exc.value.detail["code"] == "workspace_revision_conflict"

        await engine.dispose()

    _run(run)
