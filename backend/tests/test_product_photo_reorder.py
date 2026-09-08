"""R1-36 foto siralama uc testleri (legacy + v2 sarmalayici).

Kapsam:
- sort_order = liste sirasi; is_primary yalniz ilk fotograf.
- Bahsedilmeyen fotograflar mevcut goreli sirayla sona eklenir.
- Bilinmeyen/yabanci id'ler sessizce yok sayilir (500 yok).
- ProductHistory 'photo_reordered' kaydi dusulur.
- v2 ucu legacy ile birebir ayni sonucu doner; bos liste 422.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.products import reorder_product_photos

# v2 <-> v2_woocommerce döngüsel import'u üretimde app.main sırası çözer;
# testlerde önce v2 içe alınır (test_woocommerce_categories deseni).
import app.api.v2  # noqa: F401
from app.api.v2_woocommerce import put_woocommerce_photo_order_v2
from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, RoleEnum
from app.models.product import Product
from app.models.user import User
from app.schemas.product import ProductPhotoReorderRequest


def _admin() -> User:
    return User(
        email="reorder-admin@test.local",
        password_hash="x",
        name="Admin",
        role=RoleEnum.ADMIN,
        is_active=True,
    )


def _product(photo_ids: list[str]) -> Product:
    """3 fotografli minimal urun; is_primary bayragi karisik birakilir ki
    siralamanin bayraklari duzeltmesi gozlemlenebilsin."""
    return Product(
        product_number="0001",
        product_type=ProductTypeEnum.NECKLACE,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("10.00"),
        purchase_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        purchase_price_dkk=Decimal("1000"),
        gdpr_release_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        status=ProductStatusEnum.IN_INVENTORY,
        photos=[
            {"id": pid, "filename": f"{pid}.jpg", "url": f"/media/{pid}.avif", "is_primary": idx == 0}
            for idx, pid in enumerate(photo_ids)
        ],
    )


async def _make_session() -> tuple[AsyncSession, Any]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return factory(), engine


async def _seed_product(db: AsyncSession, photo_ids: list[str]) -> tuple[Product, User]:
    admin = _admin()
    db.add(admin)
    product = _product(photo_ids)
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product, admin


def _run(scenario):
    return asyncio.run(scenario())


def test_reorder_writes_sort_order_and_primary_flag() -> None:
    async def scenario():
        db, engine = await _make_session()
        try:
            product, admin = await _seed_product(db, ["a", "b", "c"])
            out = await reorder_product_photos(
                product_id=product.id, payload={"photo_ids": ["c", "a"]}, db=db, admin=admin
            )
            # sort_order PhotoItem semasinda dusurulur; kalici yazim DB'den dogrulanir.
            row = await db.get(Product, product.id)
            persisted = [(p["id"], p["sort_order"], p["is_primary"]) for p in row.photos]
            return out, persisted
        finally:
            await engine.dispose()

    out, persisted = _run(scenario)
    assert [p.id for p in out.photos] == ["c", "a", "b"]
    assert [p.is_primary for p in out.photos] == [True, False, False]
    assert persisted == [("c", 0, True), ("a", 1, False), ("b", 2, False)]


def test_reorder_appends_unmentioned_photos_in_relative_order() -> None:
    async def scenario():
        db, engine = await _make_session()
        try:
            product, admin = await _seed_product(db, ["a", "b", "c", "d"])
            out = await reorder_product_photos(
                product_id=product.id, payload={"photo_ids": ["d"]}, db=db, admin=admin
            )
            return [p.id for p in out.photos]
        finally:
            await engine.dispose()

    assert _run(scenario) == ["d", "a", "b", "c"]


def test_reorder_ignores_unknown_and_foreign_ids() -> None:
    async def scenario():
        db, engine = await _make_session()
        try:
            product, admin = await _seed_product(db, ["a", "b", "c"])
            out = await reorder_product_photos(
                product_id=product.id, payload={"photo_ids": ["zzz", "b", "nope"]}, db=db, admin=admin
            )
            return [p.id for p in out.photos]
        finally:
            await engine.dispose()

    # Bilinmeyenler dusurulur; kalan sirayla c ve a sona eklenir.
    assert _run(scenario) == ["b", "a", "c"]


def test_reorder_writes_product_history() -> None:
    from app.models.product_history import ProductHistory

    async def scenario():
        db, engine = await _make_session()
        try:
            product, admin = await _seed_product(db, ["a", "b"])
            await reorder_product_photos(
                product_id=product.id, payload={"photo_ids": ["b", "a"]}, db=db, admin=admin
            )
            rows = (
                (await db.execute(select(ProductHistory).where(ProductHistory.product_id == product.id)))
                .scalars()
                .all()
            )
            return [(row.action, (row.new_value or {}).get("order")) for row in rows]
        finally:
            await engine.dispose()

    actions = _run(scenario)
    assert ("photo_reordered", ["b", "a"]) in actions


def test_v2_wrapper_matches_legacy_result() -> None:
    async def scenario():
        db, engine = await _make_session()
        try:
            product, admin = await _seed_product(db, ["a", "b", "c"])
            out_v2 = await put_woocommerce_photo_order_v2(
                product_id=product.id,
                payload=ProductPhotoReorderRequest(photo_ids=["b", "c"]),
                db=db,
                admin=admin,
            )
            return [p.id for p in out_v2.photos], [p.is_primary for p in out_v2.photos]
        finally:
            await engine.dispose()

    ids, primaries = _run(scenario)
    assert ids == ["b", "c", "a"]
    assert primaries == [True, False, False]


def test_reorder_request_rejects_empty_list() -> None:
    with pytest.raises(ValidationError):
        ProductPhotoReorderRequest(photo_ids=[])
    with pytest.raises(ValidationError):
        ProductPhotoReorderRequest(photo_ids=["a", 5])
