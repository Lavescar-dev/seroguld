from __future__ import annotations

import asyncio
import json
from decimal import Decimal

from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.user import User
from app.schemas.pos import PosRealtimePreview
from app.services.pos_service import build_realtime_display_snapshot, display_snapshot


def test_display_snapshot_includes_lines():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="display-admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            customer = User(email="display-customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="DSP12345",
                display_token="display-token-lines",
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
            await session.flush()

            session.add_all(
                [
                    PosSessionLine(
                        pos_session_id=pos_session.id,
                        line_no=1,
                        product_type=ProductTypeEnum.BRACELET,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("24.50"),
                        purity_karat="18K",
                        purity_percentage=Decimal("75.00"),
                        rate_dkk=Decimal("615.50"),
                        margin_percent_internal=Decimal("8.00"),
                        line_offer_dkk=Decimal("10405.03"),
                    ),
                    PosSessionLine(
                        pos_session_id=pos_session.id,
                        line_no=2,
                        product_type=ProductTypeEnum.RING,
                        metal_type=MetalTypeEnum.WHITE_GOLD,
                        weight_grams=Decimal("8.20"),
                        purity_karat="14K",
                        purity_percentage=Decimal("58.50"),
                        rate_dkk=Decimal("615.50"),
                        margin_percent_internal=Decimal("10.00"),
                        line_offer_dkk=Decimal("2657.30"),
                    ),
                ]
            )
            await session.commit()

            snapshot = await display_snapshot(session, pos_session)
            assert snapshot.line_count == 2
            assert snapshot.lines_total_dkk == Decimal("13062.33")
            assert len(snapshot.lines) == 2
            assert snapshot.lines[0].line_no == 1
            assert snapshot.lines[1].line_no == 2
            assert snapshot.final_offer_dkk == Decimal("13062.33")

        await engine.dispose()

    asyncio.run(run())


def test_realtime_display_snapshot_keeps_lines_and_totals():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="preview-admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            customer = User(email="preview-customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="DSP54321",
                display_token="display-token-preview",
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
            await session.flush()

            session.add(
                PosSessionLine(
                    pos_session_id=pos_session.id,
                    line_no=1,
                    product_type=ProductTypeEnum.CHAIN,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("12.00"),
                    purity_karat="18K",
                    purity_percentage=Decimal("75.00"),
                    rate_dkk=Decimal("615.50"),
                    margin_percent_internal=Decimal("8.00"),
                    line_offer_dkk=Decimal("5096.34"),
                )
            )
            await session.commit()

            preview = PosRealtimePreview(
                product_type=ProductTypeEnum.RING,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("1.00"),
                purity_karat="22K",
                purity_percentage=Decimal("91.60"),
                margin_percent_internal=Decimal("8.00"),
                live_rate_dkk=Decimal("615.50"),
            )
            snapshot = await build_realtime_display_snapshot(session, pos_session, preview)
            assert snapshot.line_count == 1
            assert snapshot.lines_total_dkk == Decimal("5096.34")
            # Alışta satır toplamı müşteri ekranındaki nihai tutarı belirler.
            assert snapshot.final_offer_dkk == Decimal("5096.34")
            assert len(snapshot.lines) == 1

        await engine.dispose()

    asyncio.run(run())


def test_realtime_display_snapshot_uses_preview_lines_when_sent():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="preview-inline-admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            customer = User(email="preview-inline-customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="DSP76543",
                display_token="display-token-preview-inline",
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

            preview = PosRealtimePreview(
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                live_rate_dkk=Decimal("615.50"),
                preview_lines=[
                    {
                        "product_type": ProductTypeEnum.BRACELET,
                        "metal_type": MetalTypeEnum.YELLOW_GOLD,
                        "weight_grams": Decimal("10.00"),
                        "purity_karat": "18K",
                        "purity_percentage": Decimal("75.00"),
                        "rate_dkk": Decimal("615.50"),
                        "margin_percent_internal": Decimal("8.00"),
                        "line_offer_dkk": Decimal("4246.95"),
                    },
                    {
                        "product_type": ProductTypeEnum.RING,
                        "metal_type": MetalTypeEnum.WHITE_GOLD,
                        "weight_grams": Decimal("5.00"),
                        "purity_karat": "14K",
                        "purity_percentage": Decimal("58.50"),
                        "rate_dkk": Decimal("615.50"),
                        "margin_percent_internal": Decimal("8.00"),
                        "line_offer_dkk": Decimal("1656.31"),
                    },
                ],
            )
            snapshot = await build_realtime_display_snapshot(session, pos_session, preview)
            assert snapshot.line_count == 2
            assert len(snapshot.lines) == 2
            assert snapshot.lines_total_dkk == Decimal("5903.26")
            assert snapshot.final_offer_dkk == Decimal("5903.26")

        await engine.dispose()

    asyncio.run(run())


def test_public_display_snapshot_never_serializes_raw_identity_values():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="privacy-admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            session.add(clerk)
            await session.flush()

            pos_session = PosSession(
                session_code="DSPPRIV1",
                display_token="display-token-privacy",
                clerk_user_id=clerk.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("8.00"),
                rate_source=PosRateSourceEnum.LIVE,
                live_rate_dkk=Decimal("615.50"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(pos_session)
            await session.commit()

            raw_cpr = "0101901234"
            raw_identity = "PASSPORT-SECRET-42"
            preview = PosRealtimePreview(
                customer_name="Privacy Customer",
                customer_cpr=raw_cpr,
                customer_identity_doc_number=raw_identity,
            )
            snapshot = await build_realtime_display_snapshot(session, pos_session, preview)
            encoded = json.dumps(jsonable_encoder(snapshot))

            assert snapshot.customer_cpr is None
            assert snapshot.customer_identity_doc_number is None
            assert snapshot.customer_cpr_masked
            assert snapshot.customer_identity_doc_number_masked
            assert raw_cpr not in encoded
            assert raw_identity not in encoded

        await engine.dispose()

    asyncio.run(run())
