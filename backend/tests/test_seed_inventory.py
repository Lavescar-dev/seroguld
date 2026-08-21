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
        marker = await db.get(ReferenceSequence, seed_inventory.SEED_MARKER_KEY)
        assert marker is not None
        # no product is GDPR-locked (historical catalogue)
        locked = await db.scalar(select(func.count()).select_from(Product).where(Product.is_gdpr_locked.is_(True)))
        assert locked == 0

    # Second run must not duplicate (marker guard).
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
        # marker artık gerçekten-seed'lendi (>0)
        marker = await db.get(ReferenceSequence, seed_inventory.SEED_MARKER_KEY)
        assert marker is not None and int(marker.next_value) > 0

    # tekrar çalıştır -> idempotent
    await seed_inventory.ensure_seed_inventory(session_factory=Session)
    async with Session() as db:
        assert await db.scalar(select(func.count()).select_from(Product)) == total
    await engine.dispose()


@pytest.mark.asyncio
async def test_poisoned_marker_reseeds(factory):
    """Eski sürümün yazdığı zehirli marker (next_value=0) bir sonraki açılışta
    seed'i tetiklemeli (kullanıcının yaşadığı durum)."""
    engine, Session = factory
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add(_existing_product())
        db.add(ReferenceSequence(key=seed_inventory.SEED_MARKER_KEY, next_value=0))  # zehirli
        await db.commit()

    await seed_inventory.ensure_seed_inventory(session_factory=Session)
    async with Session() as db:
        total = await db.scalar(select(func.count()).select_from(Product))
        assert total > 500  # zehirli marker'a rağmen seed geldi
        marker = await db.get(ReferenceSequence, seed_inventory.SEED_MARKER_KEY)
        assert int(marker.next_value) > 0  # artık düzeltildi
    await engine.dispose()


def test_seed_artifact_exists():
    assert SEED_JSON.is_file(), "seed_data/depolama/inventory_seed.json must be committed for bundling"
