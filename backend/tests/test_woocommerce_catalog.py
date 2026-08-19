from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal

import pytest
import httpx
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.models.product import Product
from app.models.woocommerce_catalog import WooCommerceCatalogItem, WooCommerceCatalogState
from app.services.woocommerce_catalog_service import (
    apply_catalog_sync,
    clear_preview_cache_for_tests,
    fetch_remote_catalog,
    link_catalog_item,
    list_catalog,
    normalize_remote_product,
    preview_catalog_sync,
    unlink_catalog_item,
)
from app.services.woocommerce import WooCommerceService
import app.services.woocommerce_catalog_service as catalog_service


def _remote_product(
    remote_id: int,
    *,
    name: str | None = None,
    weight: str = "12.5",
    images: list[dict] | None = None,
    status: str = "publish",
) -> dict:
    return {
        "id": remote_id,
        "name": name or f"14 karat guldring {remote_id}",
        "slug": f"product-{remote_id}",
        "sku": f"SKU-{remote_id}",
        "permalink": f"https://shop.test/product-{remote_id}",
        "status": status,
        "catalog_visibility": "visible",
        "stock_status": "instock",
        "stock_quantity": 1,
        "price": "1000.00",
        "regular_price": "1000.00",
        "sale_price": "",
        "weight": weight,
        "images": [{"id": remote_id, "src": f"https://shop.test/{remote_id}.jpg"}]
        if images is None
        else images,
        "categories": [{"id": 1, "name": "Smykker", "slug": "smykker"}],
        "attributes": [],
        "description": "",
        "short_description": "",
        "date_created_gmt": "2026-08-01T10:00:00",
        "date_modified_gmt": "2026-08-10T10:00:00",
    }


class FakeWooService:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.calls: list[tuple[int, int]] = []

    async def fetch_published_products_page(self, *, page: int, per_page: int = 100) -> list[dict]:
        self.calls.append((page, per_page))
        start = (page - 1) * per_page
        return self.rows[start : start + per_page]


def _session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    return engine, async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def test_catalog_normalization_surfaces_weight_manual_and_photo_flags() -> None:
    raw_missing = _remote_product(10, name="Mystery collectible", weight="", images=[])
    raw_missing["categories"] = [{"id": 99, "name": "Special", "slug": "special"}]
    missing = normalize_remote_product(raw_missing)
    assert missing["weight_missing"] is True
    assert missing["photo_missing"] is True
    assert missing["image_count"] == 0
    assert missing["manual_review_required"] is True
    assert set(missing["manual_review_reasons"]) >= {"type_unknown", "metal_unknown", "weight_missing"}

    complete = normalize_remote_product(_remote_product(11))
    assert complete["weight_grams"] == Decimal("12.5")
    assert complete["weight_missing"] is False
    assert complete["photo_missing"] is False


def test_catalog_digest_ignores_volatile_remote_related_ids() -> None:
    first = _remote_product(20)
    first["related_ids"] = [1, 2, 3]
    second = {**first, "related_ids": [99, 100]}

    normalized_first = normalize_remote_product(first)
    normalized_second = normalize_remote_product(second)

    assert normalized_first["source_payload_json"]["related_ids"] != normalized_second["source_payload_json"]["related_ids"]
    assert normalized_first["source_payload_sha256"] == normalized_second["source_payload_sha256"]


def test_remote_catalog_fetches_every_page_without_100_product_truncation() -> None:
    async def run() -> None:
        client = FakeWooService([_remote_product(index) for index in range(1, 206)])
        snapshot = await fetch_remote_catalog(client)  # type: ignore[arg-type]
        assert len(snapshot.items) == 205
        assert client.calls == [(1, 100), (2, 100), (3, 100)]

    asyncio.run(run())


def test_published_count_uses_one_row_header_request() -> None:
    async def run() -> None:
        service = WooCommerceService()
        captured: dict = {}

        async def fake_response(method, path, *, json_payload=None, params=None):
            captured.update({"method": method, "path": path, "params": params})
            return httpx.Response(200, headers={"X-WP-Total": "466"}, json=[{"id": 1}])

        service._wc_response = fake_response  # type: ignore[method-assign]
        assert await service.fetch_published_product_count() == 466
        assert captured == {
            "method": "GET",
            "path": "/products",
            "params": {"status": "publish", "per_page": 1, "page": 1, "orderby": "id", "order": "asc"},
        }

    asyncio.run(run())


def test_preview_apply_is_revisioned_idempotent_and_deactivates_missing_remote_rows() -> None:
    async def run() -> None:
        clear_preview_cache_for_tests()
        engine, Session = _session_factory()
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        first_remote = FakeWooService([_remote_product(1), _remote_product(2, images=[])])
        async with Session() as db:
            preview = await preview_catalog_sync(db, owner_user_id="admin-1", service=first_remote)  # type: ignore[arg-type]
            assert preview.base_revision == 0
            assert preview.summary.create_count == 2
            assert preview.summary.photo_missing_count == 1
            assert await db.scalar(select(func.count(WooCommerceCatalogItem.id))) == 0

            applied = await apply_catalog_sync(
                db,
                preview_revision=preview.preview_revision,
                owner_user_id="admin-1",
            )
            assert first_remote.calls == [(1, 100)]
            assert applied.revision == 1
            assert applied.summary.create_count == 2
            assert await db.scalar(select(func.count(WooCommerceCatalogItem.id))) == 2
            assert await db.scalar(
                select(func.count(WooCommerceCatalogItem.id)).where(WooCommerceCatalogItem.photo_missing.is_(True))
            ) == 1

            repeated_preview = await preview_catalog_sync(
                db,
                owner_user_id="admin-1",
                service=FakeWooService([_remote_product(1), _remote_product(2, images=[])]),  # type: ignore[arg-type]
            )
            assert repeated_preview.summary.unchanged_count == 2
            assert repeated_preview.summary.create_count == 0
            repeated = await apply_catalog_sync(
                db,
                preview_revision=repeated_preview.preview_revision,
                owner_user_id="admin-1",
            )
            assert repeated.revision == 2
            assert repeated.summary.unchanged_count == 2

            removal_preview = await preview_catalog_sync(
                db,
                owner_user_id="admin-1",
                service=FakeWooService([_remote_product(1)]),  # type: ignore[arg-type]
            )
            assert removal_preview.summary.deactivate_count == 1
            removal = await apply_catalog_sync(
                db,
                preview_revision=removal_preview.preview_revision,
                owner_user_id="admin-1",
            )
            assert removal.revision == 3
            assert await db.scalar(select(func.count(WooCommerceCatalogItem.id))) == 2
            assert await db.scalar(
                select(func.count(WooCommerceCatalogItem.id)).where(WooCommerceCatalogItem.is_active.is_(False))
            ) == 1

            active_page = await list_catalog(
                db,
                page=1,
                page_size=50,
                q=None,
                active=True,
                linked=None,
                manual_review_required=None,
                photo_missing=None,
            )
            assert active_page.total == 1
            assert active_page.items[0].woocommerce_product_id == 1
            all_page = await list_catalog(
                db,
                page=1,
                page_size=50,
                q=None,
                active=None,
                linked=None,
                manual_review_required=None,
                photo_missing=None,
            )
            assert all_page.total == 2

        await engine.dispose()

    asyncio.run(run())


def test_confirm_rejects_stale_preview_revision() -> None:
    async def run() -> None:
        clear_preview_cache_for_tests()
        engine, Session = _session_factory()
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        rows = [_remote_product(1)]
        async with Session() as db:
            preview = await preview_catalog_sync(
                db,
                owner_user_id="admin-1",
                service=FakeWooService(rows),  # type: ignore[arg-type]
            )
            db.add(WooCommerceCatalogState(catalog_key="default", revision=1, remote_published_count=0))
            await db.commit()
            with pytest.raises(HTTPException) as exc_info:
                await apply_catalog_sync(
                    db,
                    preview_revision=preview.preview_revision,
                    owner_user_id="admin-1",
                )
            assert exc_info.value.status_code == 409
            assert exc_info.value.detail["code"] == "woocommerce_catalog_revision_conflict"
        await engine.dispose()

    asyncio.run(run())


def test_preview_token_is_user_bound_single_use_and_expires(monkeypatch) -> None:
    async def run() -> None:
        clear_preview_cache_for_tests()
        clock = [100.0]
        monkeypatch.setattr(catalog_service, "_monotonic", lambda: clock[0])
        engine, Session = _session_factory()
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with Session() as db:
            owner_preview = await preview_catalog_sync(
                db,
                owner_user_id="admin-1",
                service=FakeWooService([_remote_product(1)]),  # type: ignore[arg-type]
            )
            with pytest.raises(HTTPException) as owner_error:
                await apply_catalog_sync(
                    db,
                    preview_revision=owner_preview.preview_revision,
                    owner_user_id="admin-2",
                )
            assert owner_error.value.status_code == 403
            assert owner_error.value.detail["code"] == "woocommerce_catalog_preview_owner_mismatch"

            applied = await apply_catalog_sync(
                db,
                preview_revision=owner_preview.preview_revision,
                owner_user_id="admin-1",
            )
            assert applied.revision == 1
            with pytest.raises(HTTPException) as reused_error:
                await apply_catalog_sync(
                    db,
                    preview_revision=owner_preview.preview_revision,
                    owner_user_id="admin-1",
                )
            assert reused_error.value.detail["code"] == "woocommerce_catalog_preview_expired"

            expiring_preview = await preview_catalog_sync(
                db,
                owner_user_id="admin-1",
                service=FakeWooService([_remote_product(1)]),  # type: ignore[arg-type]
            )
            clock[0] += catalog_service.PREVIEW_TTL_SECONDS + 1.0
            with pytest.raises(HTTPException) as expired_error:
                await apply_catalog_sync(
                    db,
                    preview_revision=expiring_preview.preview_revision,
                    owner_user_id="admin-1",
                )
            assert expired_error.value.status_code == 409
            assert expired_error.value.detail["code"] == "woocommerce_catalog_preview_expired"
        await engine.dispose()

    asyncio.run(run())


def test_preview_cache_is_bounded_to_eight_entries() -> None:
    async def run() -> None:
        clear_preview_cache_for_tests()
        engine, Session = _session_factory()
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with Session() as db:
            tokens = []
            for _ in range(9):
                preview = await preview_catalog_sync(
                    db,
                    owner_user_id="admin-1",
                    service=FakeWooService([_remote_product(1)]),  # type: ignore[arg-type]
                )
                tokens.append(preview.preview_revision)
            assert len(catalog_service._preview_cache) == 8
            assert tokens[0] not in catalog_service._preview_cache
            assert tokens[-1] in catalog_service._preview_cache
        await engine.dispose()

    asyncio.run(run())


def test_catalog_link_is_explicit_unique_and_does_not_copy_into_product() -> None:
    async def run() -> None:
        clear_preview_cache_for_tests()
        engine, Session = _session_factory()
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        now = datetime.now(timezone.utc)
        async with Session() as db:
            product = Product(
                product_number="0001",
                product_type=ProductTypeEnum.RING,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("12.50"),
                purchase_date=now,
                purchase_price_dkk=Decimal("500.00"),
                commission=Decimal("0.00"),
                gdpr_release_date=now,
                is_gdpr_locked=False,
                status=ProductStatusEnum.FOR_SALE,
                photos=[],
            )
            db.add(product)
            await db.flush()
            preview = await preview_catalog_sync(
                db,
                owner_user_id="admin-1",
                service=FakeWooService([_remote_product(1), _remote_product(2)]),  # type: ignore[arg-type]
            )
            await apply_catalog_sync(
                db,
                preview_revision=preview.preview_revision,
                owner_user_id="admin-1",
            )
            items = (await db.scalars(select(WooCommerceCatalogItem).order_by(WooCommerceCatalogItem.woocommerce_product_id))).all()
            linked = await link_catalog_item(db, catalog_item_id=items[0].id, product_id=product.id)
            assert linked.linked_product_id == product.id
            await db.refresh(product)
            assert product.woocommerce_product_id is None

            with pytest.raises(HTTPException) as exc_info:
                await link_catalog_item(db, catalog_item_id=items[1].id, product_id=product.id)
            assert exc_info.value.status_code == 409

            unlinked = await unlink_catalog_item(db, catalog_item_id=items[0].id)
            assert unlinked.linked_product_id is None
            state_row = await db.get(WooCommerceCatalogState, "default")
            assert state_row is not None
            assert state_row.revision == 3
        await engine.dispose()

    asyncio.run(run())
