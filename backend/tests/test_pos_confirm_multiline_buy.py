from __future__ import annotations

import asyncio
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
from app.models.pos_session_line import PosSessionLine
from app.models.pos_session_product_link import PosSessionProductLink
from app.models.product import Product
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.pos import PosConfirmRequest
from app.services.pos_service import confirm_session


def test_confirm_session_buy_multiline_creates_multiple_products():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(
                email="clerk-multi@test.local",
                password_hash="x",
                name="Clerk",
                role=RoleEnum.ADMIN,
            )
            customer = User(
                email="customer-multi@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="MUL7AB12",
                display_token="display-token-multiline-buy",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                live_rate_dkk=Decimal("600.00"),
                rate_source=PosRateSourceEnum.LIVE,
                margin_percent_internal=Decimal("8.00"),
                final_offer_dkk=Decimal("3000.00"),
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
                        product_type=ProductTypeEnum.RING,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("10.00"),
                        purity_karat="18K",
                        purity_percentage=Decimal("75.00"),
                        rate_dkk=Decimal("600.00"),
                        margin_percent_internal=Decimal("8.00"),
                        line_offer_dkk=Decimal("1000.00"),
                    ),
                    PosSessionLine(
                        pos_session_id=pos_session.id,
                        line_no=2,
                        product_type=ProductTypeEnum.CHAIN,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("20.00"),
                        purity_karat="22K",
                        purity_percentage=Decimal("91.60"),
                        rate_dkk=Decimal("600.00"),
                        margin_percent_internal=Decimal("8.00"),
                        line_offer_dkk=Decimal("1800.00"),
                    ),
                ]
            )
            await session.commit()

            response = await confirm_session(
                session,
                pos_session=pos_session,
                payload=PosConfirmRequest(
                    reference_number="9700",
                    notes="Çoklu kalem test",
                    storage_location="MAIN-A1",
                    needs_cleaning=True,
                    allow_line_total_adjustment=True,
                ),
                clerk_user=clerk,
            )

            products = list((await session.scalars(select(Product).order_by(Product.product_number.asc()))).all())
            links = list((await session.scalars(select(PosSessionProductLink))).all())
            tx_lines = list((await session.scalars(select(TransactionLine).order_by(TransactionLine.line_no.asc()))).all())

            assert len(response.product_numbers) == 2
            assert len(response.product_ids) == 2
            assert len(products) == 2
            assert all(product.status == ProductStatusEnum.PURCHASED for product in products)
            assert {product.reference_number for product in products} == {"9700", "9701"}
            assert all(product.seller_customer_id == customer.id for product in products)

            # Link tablosunda birincil ürün tutulur (oturum->detay fallback için).
            assert len(links) == 1
            assert links[0].product_id == response.product_id

            # Transaction line-item kayıtları her kaleme ayrı oluşur.
            assert len(tx_lines) == 2
            assert tx_lines[0].product_id is not None
            assert tx_lines[1].product_id is not None
            assert tx_lines[0].line_total_dkk == Decimal("1000.00")
            # Son kalem, toplamı oturum toplamına eşitlemek için normalize edilir.
            assert tx_lines[1].line_total_dkk == Decimal("2000.00")

        await engine.dispose()

    asyncio.run(run())


def test_confirm_session_buy_multiline_requires_explicit_adjustment_approval():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(
                email="clerk-multi-approval@test.local",
                password_hash="x",
                name="Clerk",
                role=RoleEnum.ADMIN,
            )
            customer = User(
                email="customer-multi-approval@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="MUL7APP1",
                display_token="display-token-multiline-approval",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                live_rate_dkk=Decimal("600.00"),
                rate_source=PosRateSourceEnum.LIVE,
                margin_percent_internal=Decimal("8.00"),
                # Kalem toplamı 2800 iken oturum toplamı 3000 -> açık onay gerektirir.
                final_offer_dkk=Decimal("3000.00"),
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
                        product_type=ProductTypeEnum.RING,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("10.00"),
                        purity_karat="18K",
                        purity_percentage=Decimal("75.00"),
                        rate_dkk=Decimal("600.00"),
                        margin_percent_internal=Decimal("8.00"),
                        line_offer_dkk=Decimal("1000.00"),
                    ),
                    PosSessionLine(
                        pos_session_id=pos_session.id,
                        line_no=2,
                        product_type=ProductTypeEnum.CHAIN,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("20.00"),
                        purity_karat="22K",
                        purity_percentage=Decimal("91.60"),
                        rate_dkk=Decimal("600.00"),
                        margin_percent_internal=Decimal("8.00"),
                        line_offer_dkk=Decimal("1800.00"),
                    ),
                ]
            )
            await session.commit()

            raised = None
            try:
                await confirm_session(
                    session,
                    pos_session=pos_session,
                    payload=PosConfirmRequest(
                        reference_number="9800",
                        notes="Onay zorunluluğu testi",
                        storage_location="MAIN-A1",
                        needs_cleaning=True,
                        allow_line_total_adjustment=False,
                    ),
                    clerk_user=clerk,
                )
            except HTTPException as exc:
                raised = exc

            assert raised is not None
            assert raised.status_code == 422
            assert "açık onay" in str(raised.detail)

            products = list((await session.scalars(select(Product))).all())
            assert len(products) == 0

        await engine.dispose()

    asyncio.run(run())


def test_confirm_session_buy_multiline_works_without_session_rate_when_line_rates_present():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(
                email="clerk-multi-no-rate@test.local",
                password_hash="x",
                name="Clerk",
                role=RoleEnum.ADMIN,
            )
            customer = User(
                email="customer-multi-no-rate@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="MUL7NOR8",
                display_token="display-token-multiline-no-rate",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                rate_source=PosRateSourceEnum.LIVE,
                margin_percent_internal=Decimal("8.00"),
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
                        product_type=ProductTypeEnum.RING,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("10.00"),
                        purity_karat="18K",
                        purity_percentage=Decimal("75.00"),
                        rate_dkk=Decimal("600.00"),
                        margin_percent_internal=Decimal("8.00"),
                        line_offer_dkk=Decimal("4140.00"),
                    ),
                    PosSessionLine(
                        pos_session_id=pos_session.id,
                        line_no=2,
                        product_type=ProductTypeEnum.CHAIN,
                        metal_type=MetalTypeEnum.SILVER,
                        weight_grams=Decimal("100.00"),
                        purity_karat="925",
                        purity_percentage=Decimal("92.50"),
                        rate_dkk=Decimal("8.00"),
                        margin_percent_internal=Decimal("8.00"),
                        line_offer_dkk=Decimal("680.80"),
                    ),
                ]
            )
            await session.commit()

            response = await confirm_session(
                session,
                pos_session=pos_session,
                payload=PosConfirmRequest(
                    reference_number="9900",
                    notes="Rate-less session multiline",
                    storage_location="MAIN-A1",
                    needs_cleaning=False,
                    allow_line_total_adjustment=False,
                ),
                clerk_user=clerk,
            )

            assert len(response.product_ids) == 2
            refreshed = await session.get(PosSession, pos_session.id)
            assert refreshed is not None
            assert refreshed.status == PosSessionStatusEnum.CONFIRMED
            assert refreshed.final_offer_dkk == Decimal("4820.80")

        await engine.dispose()

    asyncio.run(run())
