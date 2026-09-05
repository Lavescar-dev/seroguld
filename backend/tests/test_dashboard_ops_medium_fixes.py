"""M3 medium fixleri: /api/dashboard/ops sayaçlarının SQL-agregasyon sürümü.

Önceki sürüm tüm görünür ürünleri photos JSON + ai_description dahil belleğe
alıp Python döngüsünde sayıyordu; sayaçların kendisi davranış değiştirmemeli.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.dashboard import operations
from app.database import Base
from app.models.enums import ProductStatusEnum
from app.models.product import Product
from app.utils.helpers import utc_now


def _product(number: str, status: ProductStatusEnum, **kwargs) -> Product:
    base = dict(
        product_number=number,
        product_type="bracelet",
        metal_type="silver",
        weight_grams=Decimal("10"),
        purchase_date=utc_now() - timedelta(days=3),
        gdpr_release_date=utc_now() - timedelta(days=1),
        purchase_price_dkk=Decimal("100"),
        status=status,
    )
    base.update(kwargs)
    return Product(**base)


def test_ops_counters_match_previous_python_loop_semantics():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            session.add_all(
                [
                    # Aktif + foto + yayınlanmış → kapsama ve ready_for_sale
                    _product(
                        "0200",
                        ProductStatusEnum.FOR_SALE,
                        photos=[{"url": "https://example.test/1.jpg"}],
                        ai_description="Smykke",
                        ai_description_approved=True,
                        is_published_to_site=True,
                        is_gdpr_locked=False,
                    ),
                    # Satışta fotosuz + AI açıklamasız → iki urgent sayaç
                    _product("0201", ProductStatusEnum.FOR_SALE, is_gdpr_locked=False),
                    # AI açıklaması var ama onaysız
                    _product(
                        "0202",
                        ProductStatusEnum.FOR_SALE,
                        photos=[{"url": "https://example.test/2.jpg"}],
                        ai_description="Ring",
                        is_gdpr_locked=False,
                    ),
                    # Onaylı ama yayınlanmamış
                    _product(
                        "0203",
                        ProductStatusEnum.FOR_SALE,
                        photos=[{"url": "https://example.test/3.jpg"}],
                        ai_description="Øre",
                        ai_description_approved=True,
                        is_gdpr_locked=False,
                    ),
                    # Bayat GDPR kilidi (süresi geçmiş PURCHASED)
                    _product("0204", ProductStatusEnum.PURCHASED, is_gdpr_locked=True),
                    # Envanterde ama GDPR kilitli → ready_for_sale değil
                    _product("0205", ProductStatusEnum.IN_INVENTORY, is_gdpr_locked=True),
                    # Aktif değil: temizlik kuyruğu aktiflerde sayılır
                    _product("0206", ProductStatusEnum.SOLD, needs_cleaning=True),
                ]
            )
            await session.commit()

            result = await operations(db=session, _=None)

            assert result.active_products == 6  # SOLD hariç
            assert result.products_with_photo == 3
            assert result.products_without_photo == 3
            assert result.for_sale_without_photo == 1
            assert result.pending_ai_description == 1
            assert result.pending_ai_approval == 1
            assert result.pending_publish == 1
            assert result.stale_gdpr_lock == 1  # 0204
            assert result.ready_for_sale == 4  # 0200-0203 (kilitsiz FOR_SALE)
            assert result.needs_cleaning_queue == 0  # 0206 aktif değil
            assert result.urgent_action_count == 5
            assert result.avg_active_age_days != "0"

        await engine.dispose()

    asyncio.run(run())


def test_ops_stale_gdpr_lock_requires_past_release_date():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            session.add_all(
                [
                    _product(
                        "0300",
                        ProductStatusEnum.PURCHASED,
                        is_gdpr_locked=True,
                        gdpr_release_date=datetime.now(timezone.utc) + timedelta(days=30),
                    ),
                    _product(
                        "0301",
                        ProductStatusEnum.PURCHASED,
                        is_gdpr_locked=True,
                        gdpr_release_date=datetime.now(timezone.utc) - timedelta(days=1),
                    ),
                ]
            )
            await session.commit()

            result = await operations(db=session, _=None)
            assert result.stale_gdpr_lock == 1  # yalnız süresi geçmiş

        await engine.dispose()

    asyncio.run(run())
