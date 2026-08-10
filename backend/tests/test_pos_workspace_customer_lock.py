from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.api.v2 import _as_utc_datetime
from app.models.enums import PosSessionStatusEnum, PosTradeSideEnum, RoleEnum
from app.models.pos_session import PosSession
from app.models.user import User
from app.services import pos_service
from app.services.pos_service import _sync_buy_session_summary_from_lines
from app.services.pos_workspace_mutations import _claim_workspace_revision, _lock_workspace_session


def test_workspace_lock_eager_loads_customer_for_async_snapshot_rendering() -> None:
    """The mutation lock must not leave ``customer`` as an async lazy load.

    Customer/row mutations render ``visible_snapshot`` immediately after the
    lock.  A lazy relationship there raises MissingGreenlet in AsyncSession.
    """

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with session_factory() as session:
            clerk = User(email="lock-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            customer = User(
                email="lock-customer@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()
            pos_session = PosSession(
                session_code="LOCKTEST",
                display_token="display-lock-test",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(pos_session)
            await session.commit()

            locked = await _lock_workspace_session(session, pos_session)

            assert locked.customer is not None
            assert locked.customer.id == customer.id
            assert locked.clerk_user is not None
            assert locked.clerk_user.id == clerk.id

            # A line-clear mutation flushes server-maintained timestamps
            # before rebuilding the display snapshot.  This must remain safe
            # in the same AsyncSession as the eager relationship lock.
            locked.notes = '{"workspace_revision": 2}'
            await session.flush()
            await _sync_buy_session_summary_from_lines(session, pos_session=locked)

        await engine.dispose()

    asyncio.run(run())


def test_customer_purchase_summary_datetime_normalization_handles_sqlite() -> None:
    naive = datetime(2026, 8, 10, 12, 0, 0)
    aware = datetime(2026, 8, 10, 12, 0, 0, tzinfo=timezone.utc)

    assert _as_utc_datetime(naive) == aware
    assert _as_utc_datetime(aware) == aware


def test_workspace_revision_claim_refreshes_timestamp_after_customer_autoflush() -> None:
    """Customer selection must render a snapshot after its revision CAS.

    Assigning ``customer_id`` is autoflushed by the CAS UPDATE. SQLite then
    expires the server-maintained ``updated_at`` value, which used to make the
    immediate display snapshot raise MissingGreenlet.
    """

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with session_factory() as session:
            clerk = User(email="claim-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            customer = User(email="claim-customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()
            pos_session = PosSession(
                session_code="CLAIMTEST",
                display_token="display-claim-test",
                clerk_user_id=clerk.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(pos_session)
            await session.commit()

            locked = await _lock_workspace_session(session, pos_session)
            locked.customer_id = customer.id
            locked.customer = customer
            await _claim_workspace_revision(session, pos_service, locked, base_revision=1)

            snapshot = pos_service._to_display_out(locked)
            assert snapshot.customer_name == "Customer"
            assert snapshot.workspace_revision == 2
            assert snapshot.updated_at is not None

        await engine.dispose()

    asyncio.run(run())


def test_workspace_revision_conflict_reloads_after_rollback_without_lazy_io() -> None:
    """A losing autosave must return 409, never MissingGreenlet/500.

    The failed CAS rolls back the AsyncSession and expires the stale ORM
    object. The conflict handler therefore has to retain the session id before
    rollback instead of reading an expired primary key afterward.
    """

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with session_factory() as session:
            clerk = User(email="conflict-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            session.add(clerk)
            await session.flush()
            pos_session = PosSession(
                session_code="CONFLICT",
                display_token="display-conflict-test",
                clerk_user_id=clerk.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(pos_session)
            await session.commit()

            stale = await _lock_workspace_session(session, pos_session)
            winning_notes = pos_service._workspace_note_defaults()
            winning_notes["workspace_revision"] = 2
            await session.execute(
                update(PosSession)
                .where(PosSession.id == stale.id)
                .values(notes=pos_service._serialize_workspace_note_payload(winning_notes))
                .execution_options(synchronize_session=False)
            )
            await session.commit()

            with pytest.raises(HTTPException) as exc:
                await _claim_workspace_revision(session, pos_service, stale, base_revision=1)

            assert exc.value.status_code == 409
            assert exc.value.detail["code"] == "workspace_revision_conflict"
            assert exc.value.detail["current_revision"] == 2

        await engine.dispose()

    asyncio.run(run())
