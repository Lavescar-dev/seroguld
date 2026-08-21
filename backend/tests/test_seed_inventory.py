from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import ProductStatusEnum
from app.models.product import Product
from app.models.reference_sequence import ReferenceSequence
from app.services import seed_inventory
from app.services.product_service import extract_import_source_type
from app.services.sequence_service import PRODUCT_NUMBER_SEQUENCE_KEY

SEED_JSON = Path(__file__).resolve().parents[1] / "seed_data" / "depolama" / "inventory_seed.json"


@pytest.fixture()
def factory(tmp_path, monkeypatch):
    # Point media root at a temp dir so the photo-pool copy is isolated.
    monkeypatch.setenv("SEED_INVENTORY_ENABLED", "true")
    monkeypatch.setattr(seed_inventory.settings, "media_root_dir", str(tmp_path / "media"), raising=False)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return engine, Session


@pytest.mark.asyncio
async def test_seed_loads_products_and_is_idempotent(factory):
    engine, Session = factory
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await seed_inventory.ensure_seed_inventory(session_factory=Session)

    async with Session() as db:
        total = await db.scalar(select(func.count()).select_from(Product))
        assert total and total > 500  # 625 products from the two real files
        # status classification survived the load
        melted = await db.scalar(select(func.count()).select_from(Product).where(Product.status == ProductStatusEnum.MELTED))
        sold = await db.scalar(select(func.count()).select_from(Product).where(Product.status == ProductStatusEnum.SOLD))
        assert melted >= 10 and sold >= 1
        # melted rows carry a melt_reason; provenance marker is present
        a_melt = (await db.execute(select(Product).where(Product.status == ProductStatusEnum.MELTED).limit(1))).scalar_one()
        assert a_melt.melt_reason
        assert extract_import_source_type(a_melt.notes) == "depolama_seed"
        # product numbers are contiguous 0001.. and the sequence advanced past them
        seq = await db.get(ReferenceSequence, PRODUCT_NUMBER_SEQUENCE_KEY)
        assert seq is not None and int(seq.next_value) == total + 1
        # versiyon marker'ı SEED_VERSION olarak yazıldı
        version_row = await db.get(ReferenceSequence, seed_inventory.SEED_VERSION_KEY)
        assert version_row is not None and int(version_row.next_value) == seed_inventory.SEED_VERSION
        # no product is GDPR-locked (historical catalogue)
        locked = await db.scalar(select(func.count()).select_from(Product).where(Product.is_gdpr_locked.is_(True)))
        assert locked == 0
        # reference_number = legacy_code (S-kod) — Woo SKU eşleşmesi için
        s2500 = await db.scalar(select(func.count()).select_from(Product).where(Product.reference_number == "S2500"))
        assert s2500 == 1
        # alış tarihi düzeltmesi: hiçbir seed ürünü BUGÜN değil; bilinmeyenler 2020 sentinel
        from app.utils.helpers import utc_now
        today = utc_now().date()
        today_count = await db.scalar(
            select(func.count()).select_from(Product).where(func.date(Product.purchase_date) == today.isoformat())
        )
        assert today_count == 0
        legacy_count = await db.scalar(
            select(func.count()).select_from(Product).where(func.date(Product.purchase_date) == "2020-01-01")
        )
        assert legacy_count > 100  # 219 null-tarihli ürün sentinel'e düştü

    # Second run must not duplicate (version guard) and must not double the count.
    await seed_inventory.ensure_seed_inventory(session_factory=Session)
    async with Session() as db:
        again = await db.scalar(select(func.count()).select_from(Product))
        assert again == total

    await engine.dispose()


def _existing_product():
    from decimal import Decimal
    from app.models.enums import MetalTypeEnum, ProductTypeEnum
    from app.utils.helpers import utc_now

    return Product(
        product_number="0001", display_name="test takı",
        product_type=ProductTypeEnum.RING, metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("1.00"), pure_gold_grams=Decimal("0.90"), unit_count=1,
        total_weight_grams=Decimal("1.00"), purchase_date=utc_now(), purchase_price_dkk=Decimal("100.00"),
        gdpr_release_date=utc_now(), is_gdpr_locked=False, status=ProductStatusEnum.IN_INVENTORY, photos=[],
    )


@pytest.mark.asyncio
async def test_seed_loads_additively_over_existing_product(factory):
    """Mevcut kurulum (tek 'test takı' ürünü) 0.3.10'a yükselince 625 ürün
    additive eklenmeli; mevcut ürün korunmalı, seed numaraları çakışmamalı."""
    engine, Session = factory
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add(_existing_product())  # product_number 0001
        await db.commit()

    await seed_inventory.ensure_seed_inventory(session_factory=Session)
    async with Session() as db:
        total = await db.scalar(select(func.count()).select_from(Product))
        assert total > 500  # 1 mevcut + ~625 seed
        # mevcut ürün korunur
        assert await db.scalar(select(func.count()).select_from(Product).where(Product.product_number == "0001")) == 1
        # seed numaraları mevcut ürünün ötesinden başlar (çakışma yok)
        assert await db.scalar(select(func.count()).select_from(Product).where(Product.product_number == "0002")) == 1
        # versiyon marker'ı SEED_VERSION
        version_row = await db.get(ReferenceSequence, seed_inventory.SEED_VERSION_KEY)
        assert version_row is not None and int(version_row.next_value) == seed_inventory.SEED_VERSION

    # tekrar çalıştır -> idempotent (aynı sürüm, tekrar seed yok)
    await seed_inventory.ensure_seed_inventory(session_factory=Session)
    async with Session() as db:
        assert await db.scalar(select(func.count()).select_from(Product)) == total
    await engine.dispose()


def _old_seed_product(number: str):
    """0.3.10'da yüklenmiş, notes'ta seed marker'ı olan, BUGÜN tarihli eski ürün."""
    from decimal import Decimal
    from app.models.enums import MetalTypeEnum, ProductTypeEnum
    from app.utils.helpers import utc_now

    return Product(
        product_number=number, display_name="eski seed",
        product_type=ProductTypeEnum.RING, metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("2.00"), pure_gold_grams=Decimal("1.80"), unit_count=1,
        total_weight_grams=Decimal("2.00"), purchase_date=utc_now(), purchase_price_dkk=Decimal("200.00"),
        gdpr_release_date=utc_now(), is_gdpr_locked=False, status=ProductStatusEnum.IN_INVENTORY,
        notes="[SOURCE_TYPE:depolama_seed] [depolama_seed] {}", photos=[],
    )


@pytest.mark.asyncio
async def test_upgrade_reseeds_and_keeps_operator_products(factory):
    """0.3.10→0.3.11: eski seed ürünleri (marker'lı, bugün-tarihli) SİLİNİP
    düzeltilmiş veriyle yenilenir; operatörün oluşturduğu ürün korunur; eski
    boolean marker'a rağmen sürüm<2 olduğu için yeniden-seed tetiklenir."""
    engine, Session = factory
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add(_existing_product())               # operatör ürünü (marker YOK) — korunmalı
        db.add(_old_seed_product("0500"))          # eski seed (marker'lı) — silinmeli
        db.add(_old_seed_product("0501"))
        db.add(ReferenceSequence(key=seed_inventory.SEED_MARKER_KEY, next_value=625))  # eski boolean marker
        await db.commit()

    await seed_inventory.ensure_seed_inventory(session_factory=Session)
    async with Session() as db:
        total = await db.scalar(select(func.count()).select_from(Product))
        assert total > 500  # yeniden seed geldi
        # eski seed ürünleri (display "eski seed") silindi
        assert await db.scalar(select(func.count()).select_from(Product).where(Product.display_name == "eski seed")) == 0
        # operatör ürünü korundu
        assert await db.scalar(select(func.count()).select_from(Product).where(Product.display_name == "test takı")) == 1
        # hiçbiri bugün tarihli değil
        from app.utils.helpers import utc_now
        today_count = await db.scalar(
            select(func.count()).select_from(Product)
            .where(func.date(Product.purchase_date) == utc_now().date().isoformat())
            .where(Product.display_name != "test takı")
        )
        assert today_count == 0
        version_row = await db.get(ReferenceSequence, seed_inventory.SEED_VERSION_KEY)
        assert int(version_row.next_value) == seed_inventory.SEED_VERSION

    # ikinci açılış: sürüm==SEED_VERSION → tekrar seed yok
    await seed_inventory.ensure_seed_inventory(session_factory=Session)
    async with Session() as db:
        assert await db.scalar(select(func.count()).select_from(Product)) == total
    await engine.dispose()


def test_seed_artifact_exists():
    assert SEED_JSON.is_file(), "seed_data/depolama/inventory_seed.json must be committed for bundling"
