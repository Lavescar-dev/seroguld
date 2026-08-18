from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.bootstrap import product_summary_counts
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.user import User


def _product(number: str, status: ProductStatusEnum, now: datetime, **overrides) -> Product:
    fields = dict(
        product_number=number,
        display_name=f"Product {number}",
        product_type=ProductTypeEnum.JEWELRY,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("10"),
        purity_percentage=Decimal("99"),
        pure_gold_grams=Decimal("10"),
        unit_count=1,
        total_weight_grams=Decimal("10"),
        purchase_date=now,
        purchase_price_dkk=Decimal("100"),
        commission=Decimal("0"),
        gdpr_release_date=now + timedelta(days=14),
        is_gdpr_locked=False,
        status=status,
    )
    fields.update(overrides)
    return Product(**fields)


@pytest.mark.asyncio
async def test_navigation_inventory_count_matches_depolama_list_dataset() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    now = datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc)
    month_start = now.replace(day=1)

    async with Session() as db:
        customer = User(
            email="bootstrap-count-customer@example.com",
            password_hash="unused",
            name="Customer",
            role=RoleEnum.CUSTOMER,
            is_active=True,
        )
        db.add(customer)
        await db.flush()

        db.add_all(
            [
                _product("0001", ProductStatusEnum.PURCHASED, now, seller_customer_id=customer.id),
                _product("0002", ProductStatusEnum.IN_INVENTORY, now, seller_customer_id=customer.id),
                _product("0003", ProductStatusEnum.FOR_SALE, now, seller_customer_id=customer.id),
                _product("0004", ProductStatusEnum.UNDECIDED, now, seller_customer_id=customer.id),
                _product("0005", ProductStatusEnum.SOLD, now, seller_customer_id=customer.id, sale_date=now),
                _product("0006", ProductStatusEnum.MELTED, now, seller_customer_id=customer.id, melt_date=now),
                _product(
                    "0007",
                    ProductStatusEnum.IN_INVENTORY,
                    now,
                    seller_customer_id=customer.id,
                    deleted_at=now,
                ),
            ]
        )
        await db.commit()

    async with Session() as db:
        counts = await product_summary_counts(db, month_start)
        total_products, _, _, _, _, _, active_inventory = counts

        # Silinen kayıt hiçbir sayıma girmez
        assert int(total_products) == 6
        # Menü sayacı: depolama listesinin gösterdiği aktif küme (SOLD/MELTED hariç)
        assert int(active_inventory) == 4

    await engine.dispose()
