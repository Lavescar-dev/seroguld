from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.customers import get_customer_workspace
from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductStatusEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_session import PosSession
from app.models.product import Product
from app.models.user import User


@pytest.mark.asyncio
async def test_customer_workspace_separates_metals_and_includes_knife_calculator() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    now = datetime(2026, 8, 13, 8, 0, tzinfo=timezone.utc)

    async with Session() as db:
        admin = User(
            email="customer-workspace-admin@example.com",
            password_hash="unused",
            name="Admin",
            role=RoleEnum.ADMIN,
            is_active=True,
        )
        customer = User(
            email="customer-workspace@example.com",
            password_hash="unused",
            name="Customer",
            role=RoleEnum.CUSTOMER,
            is_active=True,
        )
        db.add_all([admin, customer])
        await db.flush()

        metal_weights = (
            ("0001", MetalTypeEnum.YELLOW_GOLD, Decimal("10")),
            ("0002", MetalTypeEnum.SILVER, Decimal("20")),
            ("0003", MetalTypeEnum.PLATINUM, Decimal("30")),
            ("0004", MetalTypeEnum.PALLADIUM, Decimal("40")),
        )
        for number, metal, weight in metal_weights:
            db.add(
                Product(
                    product_number=number,
                    display_name=f"Product {number}",
                    product_type=ProductTypeEnum.JEWELRY,
                    metal_type=metal,
                    weight_grams=weight,
                    purity_percentage=Decimal("99"),
                    pure_gold_grams=weight,
                    unit_count=1,
                    total_weight_grams=weight,
                    purchase_date=now,
                    purchase_price_dkk=Decimal("100"),
                    commission=Decimal("0"),
                    seller_customer_id=customer.id,
                    gdpr_release_date=now + timedelta(days=14),
                    is_gdpr_locked=True,
                    status=ProductStatusEnum.PURCHASED,
                )
            )

        db.add(
            PosSession(
                session_code="KNIFE-SUMMARY",
                display_token="knife-summary-token",
                clerk_user_id=admin.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                status=PosSessionStatusEnum.CONFIRMED,
                visible_snapshot={},
                notes=json.dumps(
                    {
                        "kind": "purchase_workspace_v1",
                        "calculators": {
                            "gold_rows": [
                                {
                                    "row_key": "calc_gold:1",
                                    "unit_weight": "4",
                                    "count": "3",
                                    "target_row_key": "gold:8",
                                }
                            ],
                            "silver_rows": [],
                        },
                    }
                ),
            )
        )
        await db.commit()

        workspace = await get_customer_workspace(customer_id=customer.id, db=db, _=admin)

        assert workspace.total_gold_grams == "10.00"
        assert workspace.total_silver_grams == "20.00"
        assert workspace.total_platinum_grams == "30.00"
        assert workspace.total_palladium_grams == "40.00"
        assert Decimal(workspace.knife_count) == Decimal("3")
        assert Decimal(workspace.knife_total_weight_grams) == Decimal("12")

    await engine.dispose()
