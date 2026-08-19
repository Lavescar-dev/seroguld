from decimal import Decimal
import asyncio

import pytest
from fastapi import HTTPException

from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.schemas.product import ProductCreate
from app.services.product_service import (
    _allowed_status_transition,
    extract_import_source_type,
    extract_manual_review_reasons,
    has_manual_review_flag,
    _resolve_seller,
    calculate_offer_price,
    calculate_pure_gold_grams,
)


def test_calculate_pure_gold_grams():
    result = calculate_pure_gold_grams(Decimal("10.00"), Decimal("75.00"))
    assert result == Decimal("7.50")


def test_calculate_offer_price():
    result = calculate_offer_price(
        pure_gold_grams=Decimal("7.50"),
        gold_rate_dkk_per_gram=Decimal("520.00"),
        commission_rate=Decimal("0.10"),
    )
    assert result == Decimal("3510.00")


def test_status_transition_rules():
    assert _allowed_status_transition(ProductStatusEnum.IN_INVENTORY, ProductStatusEnum.FOR_SALE)
    assert _allowed_status_transition(ProductStatusEnum.FOR_SALE, ProductStatusEnum.SOLD)
    assert not _allowed_status_transition(ProductStatusEnum.SOLD, ProductStatusEnum.IN_INVENTORY)


def test_resolve_seller_invalid_email_returns_422():
    payload = ProductCreate(
        product_type=ProductTypeEnum.RING,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("10"),
        purity_karat="18K",
        purity_percentage=Decimal("75"),
        purchase_price_dkk=Decimal("1000"),
        commission=Decimal("8"),
        seller_new={
            "name": "Demo Seller",
            "email": "invalid-email",
        },
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(_resolve_seller(None, payload))

    assert exc.value.status_code == 422


def test_manual_review_note_parsing():
    notes = "[SOURCE_TYPE:coin] [MANUAL_REVIEW:type_unknown,metal_unknown] Woo import · Test"
    assert has_manual_review_flag(notes)
    assert extract_manual_review_reasons(notes) == ["type_unknown", "metal_unknown"]
    assert extract_import_source_type(notes) == "coin"


def test_infer_inventory_categories_single_source():
    from app.services.product_service import infer_inventory_categories

    assert infer_inventory_categories(MetalTypeEnum.YELLOW_GOLD, ProductTypeEnum.RING) == ("taki", None)
    assert infer_inventory_categories(MetalTypeEnum.YELLOW_GOLD, ProductTypeEnum.BAR) == ("kulce", None)
    assert infer_inventory_categories(MetalTypeEnum.SILVER, ProductTypeEnum.RING) == ("gumus", "smykker")
    assert infer_inventory_categories(MetalTypeEnum.SILVER, ProductTypeEnum.BAR) == ("gumus", "barrer")
    assert infer_inventory_categories(MetalTypeEnum.PLATINUM, ProductTypeEnum.RING) == ("platin_pd", "platin")
    assert infer_inventory_categories(MetalTypeEnum.PALLADIUM, ProductTypeEnum.RING) == ("platin_pd", "palladyum")


def test_create_and_update_keep_inventory_category_column_authoritative():
    """Liste filtresi ham kolona bakar (api/inventory.py:277) — kolon her
    kayıtta dolu kalmalı; elle atanan kategori tip değişiminde ezilmemeli."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.database import Base
    from app.models.enums import RoleEnum
    from app.models.user import User
    from app.schemas.product import ProductUpdate
    from app.services.product_service import create_product, get_product_or_404, update_product

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

        async with Session() as db:
            admin = User(
                email="rules-admin@example.com",
                password_hash="unused",
                name="Admin",
                role=RoleEnum.ADMIN,
                is_active=True,
            )
            db.add(admin)
            await db.flush()

            def payload(**overrides):
                base = dict(
                    product_type=ProductTypeEnum.RING,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("10"),
                    purchase_price_dkk=Decimal("1000"),
                    commission=Decimal("8"),
                )
                base.update(overrides)
                return ProductCreate(**base)

            created = await create_product(db, payload(), admin.id)
            product = await get_product_or_404(db, created.id)
            assert product.inventory_category == "taki"
            assert product.inventory_subcategory is None

            silver = await create_product(db, payload(metal_type=MetalTypeEnum.SILVER), admin.id)
            silver_row = await get_product_or_404(db, silver.id)
            assert (silver_row.inventory_category, silver_row.inventory_subcategory) == ("gumus", "smykker")

            manual = await create_product(db, payload(inventory_category="sikke"), admin.id)
            manual_row = await get_product_or_404(db, manual.id)
            assert manual_row.inventory_category == "sikke"

            # Türetilmiş kategori tip değişiminde tazelenir.
            await update_product(db, product, ProductUpdate(metal_type=MetalTypeEnum.PLATINUM), admin.id)
            assert (product.inventory_category, product.inventory_subcategory) == ("platin_pd", "platin")

            # Elle atanan kategori tip değişiminde korunur.
            await update_product(db, manual_row, ProductUpdate(metal_type=MetalTypeEnum.SILVER), admin.id)
            assert manual_row.inventory_category == "sikke"

            # Tip değişmeyen güncellemede kategoriye dokunulmaz.
            await update_product(db, silver_row, ProductUpdate(notes="ok"), admin.id)
            assert (silver_row.inventory_category, silver_row.inventory_subcategory) == ("gumus", "smykker")

        await engine.dispose()

    asyncio.run(run())
