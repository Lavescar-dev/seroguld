from __future__ import annotations

import asyncio
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosDocumentTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductStatusEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.product import Product
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.services.pos_service import _ensure_pos_transaction
from app.utils.helpers import utc_now


def test_ensure_pos_transaction_creates_single_row_and_line():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(
                email="clerk@test.local",
                password_hash="x",
                name="Clerk",
                role=RoleEnum.ADMIN,
            )
            customer = User(
                email="customer@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            now = utc_now()
            pos_session = PosSession(
                session_code="B501EBC0",
                display_token="display-token-123",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                product_type=ProductTypeEnum.BRACELET,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("24.50"),
                purity_karat="18K",
                purity_percentage=Decimal("75.00"),
                live_rate_dkk=Decimal("615.50"),
                rate_source=PosRateSourceEnum.LIVE,
                margin_percent_internal=Decimal("8.00"),
                final_offer_dkk=Decimal("10411.00"),
                status=PosSessionStatusEnum.CONFIRMED,
                confirmed_at=now,
                visible_snapshot={},
            )
            session.add(pos_session)
            await session.flush()

            product = Product(
                product_number="0048",
                reference_number="9680",
                product_type=ProductTypeEnum.BRACELET,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("24.50"),
                purity_karat="18K",
                purity_percentage=Decimal("75.00"),
                pure_gold_grams=Decimal("18.38"),
                purchase_date=now,
                purchase_price_dkk=Decimal("10411.00"),
                gold_rate_at_purchase=Decimal("615.50"),
                commission=Decimal("8.00"),
                seller_customer_id=customer.id,
                gdpr_release_date=now + timedelta(days=14),
                is_gdpr_locked=True,
                status=ProductStatusEnum.PURCHASED,
            )
            session.add(product)
            await session.flush()

            document = PosDocument(
                pos_session_id=pos_session.id,
                document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
                issued_at=now,
                supply_at=now,
                currency_code="DKK",
                gross_amount_dkk=Decimal("10411.00"),
                net_amount_dkk=Decimal("10411.00"),
                vat_rate_percent=Decimal("0"),
                vat_amount_dkk=Decimal("0"),
                customer_name=customer.name,
            )
            session.add(document)
            await session.flush()

            tx1, created1 = await _ensure_pos_transaction(
                session,
                pos_session=pos_session,
                product=product,
                pos_document=document,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                amount_dkk=Decimal("10411.00"),
                notes="test",
            )
            tx2, created2 = await _ensure_pos_transaction(
                session,
                pos_session=pos_session,
                product=product,
                pos_document=document,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                amount_dkk=Decimal("10411.00"),
                notes="test",
            )
            await session.commit()

            all_tx = list((await session.scalars(select(Transaction))).all())
            all_lines = list((await session.scalars(select(TransactionLine))).all())
            assert created1 is True
            assert created2 is False
            assert tx1.id == tx2.id
            assert len(all_tx) == 1
            assert len(all_lines) == 1
            assert all_lines[0].product_number == "0048"
            assert all_lines[0].line_total_dkk == Decimal("10411.00")

        await engine.dispose()

    asyncio.run(run())


def test_ensure_pos_transaction_uses_pos_session_lines_when_present():
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(
                email="clerk-lines@test.local",
                password_hash="x",
                name="Clerk",
                role=RoleEnum.ADMIN,
            )
            customer = User(
                email="customer-lines@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            now = utc_now()
            pos_session = PosSession(
                session_code="C801A1B2",
                display_token="display-token-lines",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                product_type=ProductTypeEnum.BRACELET,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("30.00"),
                purity_karat="22K",
                purity_percentage=Decimal("91.60"),
                live_rate_dkk=Decimal("700.00"),
                rate_source=PosRateSourceEnum.LIVE,
                margin_percent_internal=Decimal("8.00"),
                final_offer_dkk=Decimal("3000.00"),
                status=PosSessionStatusEnum.CONFIRMED,
                confirmed_at=now,
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
                        rate_dkk=Decimal("700.00"),
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
                        rate_dkk=Decimal("700.00"),
                        margin_percent_internal=Decimal("8.00"),
                        line_offer_dkk=Decimal("1800.00"),
                    ),
                ]
            )
            await session.flush()

            product = Product(
                product_number="0049",
                reference_number="9681",
                product_type=ProductTypeEnum.BRACELET,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("30.00"),
                purity_karat="22K",
                purity_percentage=Decimal("91.60"),
                pure_gold_grams=Decimal("27.48"),
                purchase_date=now,
                purchase_price_dkk=Decimal("3000.00"),
                gold_rate_at_purchase=Decimal("700.00"),
                commission=Decimal("8.00"),
                seller_customer_id=customer.id,
                gdpr_release_date=now + timedelta(days=14),
                is_gdpr_locked=True,
                status=ProductStatusEnum.PURCHASED,
            )
            session.add(product)
            await session.flush()

            document = PosDocument(
                pos_session_id=pos_session.id,
                document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
                issued_at=now,
                supply_at=now,
                currency_code="DKK",
                gross_amount_dkk=Decimal("3000.00"),
                net_amount_dkk=Decimal("3000.00"),
                vat_rate_percent=Decimal("0"),
                vat_amount_dkk=Decimal("0"),
                customer_name=customer.name,
            )
            session.add(document)
            await session.flush()

            _, created = await _ensure_pos_transaction(
                session,
                pos_session=pos_session,
                product=product,
                pos_document=document,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                amount_dkk=Decimal("3000.00"),
                notes="line-test",
            )
            await session.commit()

            lines = list((await session.scalars(select(TransactionLine).order_by(TransactionLine.line_no))).all())
            assert created is True
            assert len(lines) == 2
            assert lines[0].line_no == 1
            assert lines[1].line_no == 2
            # Transaction yazımında yalnızca küçük yuvarlama farkları dengelenir.
            assert lines[0].line_total_dkk == Decimal("1000.00")
            assert lines[1].line_total_dkk == Decimal("1800.00")
            assert (lines[0].line_total_dkk + lines[1].line_total_dkk) == Decimal("2800.00")
            # Multi-line mode does not force every line to same product id.
            assert lines[0].product_id is None
            assert lines[1].product_id is None

        await engine.dispose()

    asyncio.run(run())
