from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.inventory import get_inventory_workspace
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.user import User
from app.models.woocommerce_catalog import WooCommerceCatalogItem
from app.services.woocommerce_catalog_service import auto_link_by_sku
from app.utils.helpers import utc_now


def _admin() -> User:
    return User(email="woo-admin@example.com", password_hash="x", name="Admin", role=RoleEnum.ADMIN, is_active=True)


def _product(number: str, ref: str | None) -> Product:
    return Product(
        product_number=number, reference_number=ref, display_name=f"Ürün {number}",
        product_type=ProductTypeEnum.RING, metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("2.00"), pure_gold_grams=Decimal("1.80"), unit_count=1,
        total_weight_grams=Decimal("2.00"), purchase_date=utc_now(), purchase_price_dkk=Decimal("500.00"),
        gdpr_release_date=utc_now(), is_gdpr_locked=False, status=ProductStatusEnum.IN_INVENTORY,
        inventory_category="taki", photos=[],
    )


def _catalog_item(wc_id: int, sku: str | None) -> WooCommerceCatalogItem:
    return WooCommerceCatalogItem(
        woocommerce_product_id=wc_id, name=f"Woo {wc_id}", sku=sku, source_payload_sha256="x" * 64,
    )


async def _fresh():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.mark.asyncio
async def test_auto_link_by_sku_and_workspace_flag():
    engine, Session = await _fresh()
    async with Session() as db:
        admin = _admin()
        db.add(admin)
        db.add(_product("0001", "S2500"))   # eşleşecek
        db.add(_product("0002", "S2501"))   # eşleşecek
        db.add(_product("0003", None))       # ref yok -> eşleşmez
        db.add(_catalog_item(101, "S2500"))
        db.add(_catalog_item(102, "S2501"))
        db.add(_catalog_item(103, "YOK-SKU"))  # eşleşmez
        await db.commit()

        result = await auto_link_by_sku(db)
        assert result["linked"] == 2
        assert result["skipped_no_match"] == 1  # YOK-SKU

        # ikinci kez: hepsi zaten bağlı -> yeni bağlama yok
        again = await auto_link_by_sku(db)
        assert again["linked"] == 0

        # inventory workspace: bağlı ürünlerde is_woo_linked True
        ws = await get_inventory_workspace(db=db, _=admin)
        by_ref = {r.reference_number: r.is_woo_linked for r in ws.rows}
        assert by_ref.get("S2500") is True
        assert by_ref.get("S2501") is True
        assert by_ref.get(None) in (False, None)  # ref'siz ürün bağlı değil
    await engine.dispose()
