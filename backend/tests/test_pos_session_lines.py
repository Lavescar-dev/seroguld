from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import PosRateSourceEnum, PosSessionStatusEnum, PosTradeSideEnum, RoleEnum
from app.models.pos_session import PosSession
from app.models.user import User
from app.schemas.pos import PosSessionLineBulkCreate, PosSessionLineCreate, PosSessionLineUpdate
from app.services.pos_service import (
    create_pos_session_lines_bulk,
    create_pos_session_line,
    delete_pos_session_line,
    list_pos_session_lines,
    update_pos_session_line,
)


def test_pos_session_line_crud():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            customer = User(email="customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="AABBCCDD",
                display_token="display-token",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("8.00"),
                rate_source=PosRateSourceEnum.LIVE,
                live_rate_dkk=Decimal("615.50"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(pos_session)
            await session.commit()

            created = await create_pos_session_line(
                session,
                pos_session=pos_session,
                payload=PosSessionLineCreate(
                    product_type="bracelet",
                    metal_type="yellow_gold",
                    weight_grams=Decimal("24.50"),
                    purity_karat="18K",
                    purity_percentage=Decimal("75.00"),
                    notes="ilk satir",
                ),
            )
            assert created.line_no == 1
            assert created.line_offer_dkk is not None
            await session.refresh(pos_session)
            assert pos_session.final_offer_dkk == created.line_offer_dkk
            assert pos_session.product_type.value == "bracelet"
            assert pos_session.metal_type.value == "yellow_gold"

            updated = await update_pos_session_line(
                session,
                pos_session=pos_session,
                line_id=created.id,
                payload=PosSessionLineUpdate(margin_percent_internal=Decimal("10.00")),
            )
            assert updated.margin_percent_internal == Decimal("10.00")
            await session.refresh(pos_session)
            assert pos_session.final_offer_dkk == updated.line_offer_dkk

            listed = await list_pos_session_lines(session, pos_session=pos_session)
            assert len(listed) == 1
            assert listed[0].id == created.id

            await delete_pos_session_line(session, pos_session=pos_session, line_id=created.id)
            listed_after_delete = await list_pos_session_lines(session, pos_session=pos_session)
            assert listed_after_delete == []
            await session.refresh(pos_session)
            assert pos_session.final_offer_dkk is None
            assert pos_session.product_type is None
            assert pos_session.metal_type is None

        await engine.dispose()

    asyncio.run(run())


def test_pos_session_line_bulk_create():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="admin-bulk@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            customer = User(email="customer-bulk@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="BULKTEST",
                display_token="display-token-bulk",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("8.00"),
                rate_source=PosRateSourceEnum.LIVE,
                live_rate_dkk=Decimal("615.50"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(pos_session)
            await session.commit()

            created = await create_pos_session_lines_bulk(
                session,
                pos_session=pos_session,
                payload=PosSessionLineBulkCreate(
                    items=[
                        PosSessionLineCreate(
                            product_type="bracelet",
                            metal_type="yellow_gold",
                            weight_grams=Decimal("24.50"),
                            purity_karat="18K",
                            purity_percentage=Decimal("75.00"),
                        ),
                        PosSessionLineCreate(
                            product_type="ring",
                            metal_type="white_gold",
                            weight_grams=Decimal("8.20"),
                            purity_karat="14K",
                            purity_percentage=Decimal("58.50"),
                            margin_percent_internal=Decimal("10.00"),
                        ),
                    ]
                ),
            )

            assert len(created) == 2
            assert created[0].line_no == 1
            assert created[1].line_no == 2
            assert created[0].line_offer_dkk is not None
            assert created[1].line_offer_dkk is not None
            await session.refresh(pos_session)
            assert pos_session.final_offer_dkk == Decimal("14457.33")
            assert pos_session.product_type.value == "bracelet"
            assert pos_session.metal_type.value == "yellow_gold"

            listed = await list_pos_session_lines(session, pos_session=pos_session)
            assert len(listed) == 2

            with pytest.raises(ValueError):
                PosSessionLineBulkCreate(
                    items=[
                        PosSessionLineCreate(
                            product_type="bracelet",
                            metal_type="yellow_gold",
                            weight_grams=Decimal("1.00"),
                            purity_karat="14K",
                            purity_percentage=Decimal("58.50"),
                        )
                    ]
                    * 51
                )

        await engine.dispose()

    asyncio.run(run())
