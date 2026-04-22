from __future__ import annotations

import asyncio
from datetime import timedelta
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.models.product import Product
from app.models.reference_sequence import ReferenceSequence
from app.services.sequence_service import (
    consume_product_number,
    consume_reference_number,
    preview_product_number,
    preview_reference_number,
)
from app.utils.helpers import utc_now


def test_product_number_sequence_starts_from_0001():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            preview = await preview_product_number(session)
            first = await consume_product_number(session)
            second = await consume_product_number(session)
            assert preview == "0001"
            assert first == "0001"
            assert second == "0002"

        await engine.dispose()

    asyncio.run(run())


def test_product_number_sequence_resumes_from_existing_products():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            now = utc_now()
            session.add(
                Product(
                    product_number="0048",
                    reference_number="9680",
                    product_type=ProductTypeEnum.BRACELET,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("10.00"),
                    purity_karat="18K",
                    purity_percentage=Decimal("75.00"),
                    pure_gold_grams=Decimal("7.50"),
                    purchase_date=now,
                    purchase_price_dkk=Decimal("1000.00"),
                    gold_rate_at_purchase=Decimal("500.00"),
                    commission=Decimal("8.00"),
                    gdpr_release_date=now + timedelta(days=14),
                    is_gdpr_locked=True,
                    status=ProductStatusEnum.PURCHASED,
                )
            )
            await session.flush()

            next_number = await consume_product_number(session)
            assert next_number == "0049"

        await engine.dispose()

    asyncio.run(run())


def test_reference_sequence_migrates_from_legacy_key():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            session.add(ReferenceSequence(key="product_reference", next_value=9683))
            await session.flush()

            preview = await preview_reference_number(session, start=9600, window=5000)
            consumed = await consume_reference_number(session, start=9600, window=5000)
            migrated = await session.get(ReferenceSequence, "reference_number")

            assert preview == "9683"
            assert consumed == "9683"
            assert migrated is not None
            assert migrated.next_value == 9684

        await engine.dispose()

    asyncio.run(run())
