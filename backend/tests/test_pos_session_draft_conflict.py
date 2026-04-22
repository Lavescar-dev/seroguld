from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import PosRateSourceEnum, PosSessionStatusEnum, PosTradeSideEnum, RoleEnum
from app.models.pos_session import PosSession
from app.models.user import User
from app.schemas.pos import PosSessionCreate
from app.services.pos_service import create_pos_session


def test_create_pos_session_blocks_when_open_draft_exists_for_same_customer_and_side():
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="clerk-draft@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            customer = User(
                email="customer-draft@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            session.add(
                PosSession(
                    session_code="EXIST001",
                    display_token="display-existing-001",
                    clerk_user_id=clerk.id,
                    customer_id=customer.id,
                    trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                    margin_percent_internal=Decimal("8.00"),
                    rate_source=PosRateSourceEnum.LIVE,
                    status=PosSessionStatusEnum.DRAFT,
                    visible_snapshot={},
                )
            )
            await session.commit()

            with pytest.raises(HTTPException) as exc:
                await create_pos_session(
                    session,
                    PosSessionCreate(
                        customer_id=customer.id,
                        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                    ),
                    clerk,
                )

            assert exc.value.status_code == 409
            assert "açık bir taslak" in str(exc.value.detail).lower()

        await engine.dispose()

    asyncio.run(scenario())


def test_create_pos_session_allows_force_new_when_open_draft_exists():
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="clerk-force@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            customer = User(
                email="customer-force@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            existing = PosSession(
                session_code="EXIST002",
                display_token="display-existing-002",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("8.00"),
                rate_source=PosRateSourceEnum.LIVE,
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(existing)
            await session.commit()

            created = await create_pos_session(
                session,
                PosSessionCreate(
                    customer_id=customer.id,
                    trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                    force_new_session=True,
                ),
                clerk,
            )

            assert created.session_code != existing.session_code
            draft_rows = list(
                (
                    await session.scalars(
                        select(PosSession).where(
                            PosSession.customer_id == customer.id,
                            PosSession.clerk_user_id == clerk.id,
                            PosSession.status == PosSessionStatusEnum.DRAFT,
                        )
                    )
                ).all()
            )
            assert len(draft_rows) == 2

        await engine.dispose()

    asyncio.run(scenario())

