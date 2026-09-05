from __future__ import annotations

import asyncio
from datetime import timedelta
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.models.product import Product
from app.services.sequence_service import infer_reference_number_seed
from app.utils.helpers import utc_now


def _product(product_number: str, reference_number: str | None) -> Product:
    now = utc_now()
    return Product(
        product_number=product_number,
        reference_number=reference_number,
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


def test_reference_seed_takes_max_within_window_and_ignores_noise():
    """SQL tarafı seed: pencere içi en büyük sayısal referans + 1. Alphanumeric
    (elle girilmiş) ve pencere dışı referanslar eski Python semantiğiyle aynı
    şekilde yok sayılır — bu sefer tüm tabloyu çekmeden."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            session.add_all(
                [
                    _product("0001", "9680"),
                    _product("0002", "9690"),
                    # alphanumeric: cast'e girmeden elenmeli (Postgres hata fırlatırdı)
                    _product("0003", "ABC123"),
                    # boş / kısmi sayısal gürültü
                    _product("0004", ""),
                    _product("0005", "97x5"),
                    # pencere dışı: start=9600, window=100 -> [9600, 9700]
                    _product("0006", "15"),
                    _product("0007", "15000"),
                    _product("0009", "9725"),
                    # pencerenin alt sınırının hemen altı
                    _product("0008", "9599"),
                ]
            )
            await session.flush()

            seed = await infer_reference_number_seed(session, start=9600, window=100)
            assert seed == 9691

        await engine.dispose()

    asyncio.run(run())


def test_reference_seed_falls_back_to_start_when_window_empty():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            session.add_all([_product("0001", "15"), _product("0002", "99999")])
            await session.flush()

            seed = await infer_reference_number_seed(session, start=9600, window=100)
            assert seed == 9600

        await engine.dispose()

    asyncio.run(run())


def test_reference_seed_respects_window_bounds_inclusive():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            # 9700 üst sınırdadır (<=), 9701 dışarıda kalır.
            session.add_all([_product("0001", "9700"), _product("0002", "9701")])
            await session.flush()

            seed = await infer_reference_number_seed(session, start=9600, window=100)
            assert seed == 9701

        await engine.dispose()

    asyncio.run(run())


def test_reference_seed_on_empty_table_returns_start():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            seed = await infer_reference_number_seed(session, start=9600, window=5000)
            assert seed == 9600

        await engine.dispose()

    asyncio.run(run())
