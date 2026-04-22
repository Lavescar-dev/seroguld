from __future__ import annotations

import asyncio
from datetime import timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductStatusEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_session import PosSession
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.user import User
from app.schemas.pos import PosConfirmRequest
from app.services.pos_service import confirm_session
from app.utils.helpers import utc_now


def test_confirm_session_sell_inventory_requires_override_approval_and_reason():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(
                email="clerk-sale-override@test.local",
                password_hash="x",
                name="Clerk",
                role=RoleEnum.ADMIN,
            )
            customer = User(
                email="buyer-sale-override@test.local",
                password_hash="x",
                name="Buyer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            now = utc_now()
            sale_product = Product(
                product_number="0201",
                reference_number="9901",
                product_type=ProductTypeEnum.BRACELET,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("10.00"),
                purity_karat="18K",
                purity_percentage=Decimal("75.00"),
                pure_gold_grams=Decimal("7.50"),
                purchase_date=now - timedelta(days=30),
                purchase_price_dkk=Decimal("5000.00"),
                gold_rate_at_purchase=Decimal("600.00"),
                commission=Decimal("8.00"),
                seller_customer_id=customer.id,
                gdpr_release_date=now - timedelta(days=15),
                is_gdpr_locked=False,
                status=ProductStatusEnum.FOR_SALE,
            )
            session.add(sale_product)
            await session.flush()

            draft_session = PosSession(
                session_code="SALEOVR1",
                display_token="display-sale-override-1",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.SELL_TO_CUSTOMER,
                product_type=ProductTypeEnum.BRACELET,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("10.00"),
                purity_karat="18K",
                purity_percentage=Decimal("75.00"),
                live_rate_dkk=Decimal("600.00"),
                rate_source=PosRateSourceEnum.LIVE,
                margin_percent_internal=Decimal("8.00"),
                final_offer_dkk=Decimal("6000.00"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(draft_session)
            await session.commit()

            raised_without_approval = None
            try:
                await confirm_session(
                    session,
                    pos_session=draft_session,
                    payload=PosConfirmRequest(
                        sale_product_id=sale_product.id,
                        sale_price_dkk=Decimal("6500.00"),
                    ),
                    clerk_user=clerk,
                )
            except HTTPException as exc:
                raised_without_approval = exc

            assert raised_without_approval is not None
            assert raised_without_approval.status_code == 422
            assert "override" in str(raised_without_approval.detail).lower()

            raised_without_reason = None
            try:
                await confirm_session(
                    session,
                    pos_session=draft_session,
                    payload=PosConfirmRequest(
                        sale_product_id=sale_product.id,
                        sale_price_dkk=Decimal("6500.00"),
                        sale_override_approved=True,
                        sale_override_reason="",
                    ),
                    clerk_user=clerk,
                )
            except HTTPException as exc:
                raised_without_reason = exc

            assert raised_without_reason is not None
            assert raised_without_reason.status_code == 422
            assert "denetim notu" in str(raised_without_reason.detail).lower()

            refreshed = await session.get(Product, sale_product.id)
            assert refreshed is not None
            assert refreshed.status == ProductStatusEnum.FOR_SALE

        await engine.dispose()

    asyncio.run(run())


def test_confirm_session_sell_inventory_allows_override_with_explicit_approval():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(
                email="clerk-sale-override-ok@test.local",
                password_hash="x",
                name="Clerk",
                role=RoleEnum.ADMIN,
            )
            customer = User(
                email="buyer-sale-override-ok@test.local",
                password_hash="x",
                name="Buyer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            now = utc_now()
            sale_product = Product(
                product_number="0202",
                reference_number="9902",
                product_type=ProductTypeEnum.CHAIN,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("12.00"),
                purity_karat="22K",
                purity_percentage=Decimal("91.60"),
                pure_gold_grams=Decimal("10.99"),
                purchase_date=now - timedelta(days=30),
                purchase_price_dkk=Decimal("7000.00"),
                gold_rate_at_purchase=Decimal("700.00"),
                commission=Decimal("8.00"),
                seller_customer_id=customer.id,
                gdpr_release_date=now - timedelta(days=15),
                is_gdpr_locked=False,
                status=ProductStatusEnum.FOR_SALE,
            )
            session.add(sale_product)
            await session.flush()

            draft_session = PosSession(
                session_code="SALEOVR2",
                display_token="display-sale-override-2",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.SELL_TO_CUSTOMER,
                product_type=ProductTypeEnum.CHAIN,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("12.00"),
                purity_karat="22K",
                purity_percentage=Decimal("91.60"),
                live_rate_dkk=Decimal("700.00"),
                rate_source=PosRateSourceEnum.LIVE,
                margin_percent_internal=Decimal("10.00"),
                final_offer_dkk=Decimal("8500.00"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
            )
            session.add(draft_session)
            await session.commit()

            response = await confirm_session(
                session,
                pos_session=draft_session,
                payload=PosConfirmRequest(
                    sale_product_id=sale_product.id,
                    sale_price_dkk=Decimal("8700.00"),
                    sale_override_approved=True,
                    sale_override_reason="Tezgah pazarlığı: müşteri sabit fiyat yerine premium model seçti.",
                    notes="Satış override test kaydı",
                ),
                clerk_user=clerk,
            )

            sold_product = await session.get(Product, sale_product.id)
            assert sold_product is not None
            assert sold_product.status == ProductStatusEnum.SOLD
            assert sold_product.sale_price_dkk == Decimal("8700.00")
            assert response.product_id == sale_product.id

            history_rows = list(
                (
                    await session.scalars(
                        select(ProductHistory)
                        .where(ProductHistory.product_id == sale_product.id, ProductHistory.action == "pos_sale_confirmed")
                        .order_by(ProductHistory.created_at.desc())
                    )
                ).all()
            )
            assert history_rows
            sale_override = (history_rows[0].new_value or {}).get("sale_override", {})
            assert sale_override.get("approved") is True
            assert sale_override.get("price_overridden") is True
            assert sale_override.get("margin_overridden") is True
            assert "pazarlığı" in str(sale_override.get("reason", ""))

        await engine.dispose()

    asyncio.run(run())
