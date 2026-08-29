from __future__ import annotations

from uuid import UUID

import time

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.antifraud import (
    AntiFraudOverrideIn,
    get_order_detail as get_legacy_antifraud_order_detail,
    get_recent_orders as get_legacy_antifraud_recent_orders,
    post_order_override as post_legacy_antifraud_override,
)
from app.api.deps import require_admin
from app.api.inventory import get_inventory_workspace as get_legacy_inventory_workspace
from app.api.products import (
    ai_describe as legacy_ai_describe,
    approve_product_manual_review as legacy_approve_product_manual_review,
    delete_photo as legacy_delete_photo,
    get_product_history as legacy_get_product_history,
    get_product_sync_log as legacy_get_product_sync_log,
    get_product_woocommerce_raw as legacy_get_product_woocommerce_raw,
    publish as legacy_publish_product,
    sync_product_sale_status as legacy_sync_product_sale_status,
    unpublish as legacy_unpublish_product,
    update_ai_describe as legacy_update_ai_describe,
    upload_photos as legacy_upload_photos,
)
from app.api.v2 import _build_woocommerce_workspace
from app.database import get_db
from app.models.user import User
from app.schemas.antifraud import AntiFraudOrderOut, AntiFraudOrdersResponse
from app.schemas.product import (
    ProductAIDescriptionUpdate,
    ProductHistoryOut,
    ProductOut,
    ProductPublishRequest,
    ProductPublishResponse,
    WooSyncLogOut,
)
from app.schemas.woocommerce import (
    WooCatalogItemDetailOut,
    WooCatalogItemOut,
    WooCatalogContentUpdateIn,
    WooCatalogLinkIn,
    WooCatalogListOut,
    WooCatalogStatusOut,
    WooCatalogSyncIn,
    WooCatalogSyncOut,
    WooCatalogSyncPreviewOut,
    WooCategoriesOut,
    WooCategoryOut,
    WooWorkspaceOut,
)
from app.config import get_settings
from app.models.woocommerce_catalog import WooCommerceCatalogItem
from app.services.woocommerce import WooCommerceService
from app.services.woocommerce_catalog_service import (
    apply_catalog_sync,
    auto_link_by_sku,
    get_catalog_counts,
    get_catalog_item_detail,
    get_catalog_state,
    link_catalog_item,
    list_catalog,
    preview_catalog_sync,
    unlink_catalog_item,
    unpublish_catalog_item,
    update_catalog_item_content,
)
from app.utils.helpers import utc_now
from app.services.product_service import get_product_or_404, to_product_out

router = APIRouter()

# Kategori listesi kısa süre cache'lenir — picker her açılışta WP'yi yormasın.
_CATEGORY_CACHE_TTL_SECONDS = 120.0
_category_cache: dict = {"flat": None, "fetched_at": None, "expires_at": 0.0}


def _flatten_category_tree(raw: list[dict]) -> list[WooCategoryOut]:
    """Ağacı ebeveyn-önce, kardeşler alfabetik sırayla düz listeye açar (depth'li)."""
    by_parent: dict[int, list[dict]] = {}
    for item in raw:
        try:
            parent = int(item.get("parent") or 0)
        except (TypeError, ValueError):
            parent = 0
        by_parent.setdefault(parent, []).append(item)

    out: list[WooCategoryOut] = []

    def walk(parent: int, depth: int) -> None:
        for item in sorted(by_parent.get(parent, []), key=lambda entry: str(entry.get("name") or "").lower()):
            try:
                item_id = int(item["id"])
            except (KeyError, TypeError, ValueError):
                continue
            out.append(
                WooCategoryOut(
                    id=item_id,
                    name=str(item.get("name") or ""),
                    slug=str(item.get("slug") or "") or None,
                    parent=parent,
                    count=int(item.get("count") or 0),
                    depth=depth,
                )
            )
            walk(item_id, depth + 1)

    walk(0, 0)
    # Ebeveyni listede olmayan (yetim) kategoriler kaybolmasın — kökte listelenir.
    seen = {entry.id for entry in out}
    for item in raw:
        try:
            item_id = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        if item_id not in seen:
            out.append(
                WooCategoryOut(
                    id=item_id,
                    name=str(item.get("name") or ""),
                    slug=str(item.get("slug") or "") or None,
                    parent=0,
                    count=int(item.get("count") or 0),
                    depth=0,
                )
            )
    return out


@router.get("/woocommerce/categories", response_model=WooCategoriesOut)
async def get_woocommerce_categories_v2(
    refresh: bool = Query(default=False),
    admin: User = Depends(require_admin),
) -> WooCategoriesOut:
    now = time.monotonic()
    if not refresh and _category_cache["flat"] is not None and now < _category_cache["expires_at"]:
        return WooCategoriesOut(items=_category_cache["flat"], fetched_at=_category_cache["fetched_at"], cached=True)

    service = WooCommerceService()
    raw = await service.list_categories()
    flat = _flatten_category_tree(raw)
    fetched_at = utc_now()
    _category_cache.update({"flat": flat, "fetched_at": fetched_at, "expires_at": now + _CATEGORY_CACHE_TTL_SECONDS})
    return WooCategoriesOut(items=flat, fetched_at=fetched_at, cached=False)


@router.get("/woocommerce/status", response_model=WooCatalogStatusOut)
async def get_woocommerce_status_v2(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> WooCatalogStatusOut:
    settings = get_settings()
    configured = bool(
        settings.woocommerce_base_url.strip()
        and settings.woocommerce_consumer_key.strip()
        and settings.woocommerce_consumer_secret.strip()
    )
    state_row = await get_catalog_state(db)
    local_active, local_inactive = await get_catalog_counts(db)
    checked_at = utc_now()
    if not configured:
        return WooCatalogStatusOut(
            configured=False,
            reachable=False,
            remote_published_count=None,
            local_active_count=local_active,
            local_inactive_count=local_inactive,
            catalog_revision=int(state_row.revision),
            last_synced_at=state_row.last_synced_at,
            checked_at=checked_at,
            message="WooCommerce bağlantı ayarları eksik.",
        )
    try:
        remote_published_count = await WooCommerceService().fetch_published_product_count()
    except Exception:
        return WooCatalogStatusOut(
            configured=True,
            reachable=False,
            remote_published_count=None,
            local_active_count=local_active,
            local_inactive_count=local_inactive,
            catalog_revision=int(state_row.revision),
            last_synced_at=state_row.last_synced_at,
            checked_at=checked_at,
            message="WooCommerce bağlantısı kurulamadı.",
        )
    return WooCatalogStatusOut(
        configured=True,
        reachable=True,
        remote_published_count=remote_published_count,
        local_active_count=local_active,
        local_inactive_count=local_inactive,
        catalog_revision=int(state_row.revision),
        last_synced_at=state_row.last_synced_at,
        checked_at=checked_at,
        message="WooCommerce bağlantısı sağlıklı.",
    )


@router.get("/woocommerce/catalog", response_model=WooCatalogListOut)
async def get_woocommerce_catalog_v2(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    q: str | None = Query(default=None, max_length=160),
    active: bool | None = Query(default=True),
    linked: bool | None = Query(default=None),
    manual_review_required: bool | None = Query(default=None),
    photo_missing: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> WooCatalogListOut:
    return await list_catalog(
        db,
        page=page,
        page_size=page_size,
        q=q,
        active=active,
        linked=linked,
        manual_review_required=manual_review_required,
        photo_missing=photo_missing,
    )


@router.post("/woocommerce/catalog/sync/preview", response_model=WooCatalogSyncPreviewOut)
async def post_woocommerce_catalog_sync_preview_v2(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WooCatalogSyncPreviewOut:
    return await preview_catalog_sync(db, owner_user_id=admin.id)


@router.post("/woocommerce/catalog/sync", response_model=WooCatalogSyncOut)
async def post_woocommerce_catalog_sync_v2(
    payload: WooCatalogSyncIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WooCatalogSyncOut:
    return await apply_catalog_sync(
        db,
        preview_revision=payload.preview_revision,
        owner_user_id=admin.id,
    )


@router.get("/woocommerce/catalog/{catalog_item_id}", response_model=WooCatalogItemDetailOut)
async def get_woocommerce_catalog_item_v2(
    catalog_item_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WooCatalogItemDetailOut:
    return await get_catalog_item_detail(db, catalog_item_id=catalog_item_id)


@router.post("/woocommerce/catalog/{catalog_item_id}/unpublish", response_model=WooCatalogItemOut)
async def post_woocommerce_catalog_unpublish_v2(
    catalog_item_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> WooCatalogItemOut:
    item = await db.get(WooCommerceCatalogItem, catalog_item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WooCommerce katalog ürünü bulunamadı.")
    if item.linked_product_id is not None:
        # Bağlı kayıt: uzak çağrı + history/sync log ürün akışında; sonra yalnız
        # katalog satırı güncellenir.
        await legacy_unpublish_product(product_id=item.linked_product_id, db=db, admin=admin)
        return await unpublish_catalog_item(db, catalog_item_id=catalog_item_id, skip_remote=True)
    return await unpublish_catalog_item(db, catalog_item_id=catalog_item_id)


@router.patch("/woocommerce/catalog/{catalog_item_id}/content", response_model=WooCatalogItemDetailOut)
async def patch_woocommerce_catalog_content_v2(
    catalog_item_id: UUID,
    payload: WooCatalogContentUpdateIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> WooCatalogItemDetailOut:
    """R1-16: katalog cekmecesinden ad/aciklama/SEO duzenleme — Woo'ya yazar."""
    return await update_catalog_item_content(
        db,
        catalog_item_id=catalog_item_id,
        name=payload.name,
        short_description_html=payload.short_description_html,
        description_html=payload.description_html,
        seo_title=payload.seo_title,
        meta_description=payload.meta_description,
    )


@router.post("/woocommerce/catalog/{catalog_item_id}/link", response_model=WooCatalogItemOut)
async def post_woocommerce_catalog_link_v2(
    catalog_item_id: UUID,
    payload: WooCatalogLinkIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> WooCatalogItemOut:
    return await link_catalog_item(db, catalog_item_id=catalog_item_id, product_id=payload.product_id)


@router.delete("/woocommerce/catalog/{catalog_item_id}/link", response_model=WooCatalogItemOut)
async def delete_woocommerce_catalog_link_v2(
    catalog_item_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> WooCatalogItemOut:
    return await unlink_catalog_item(db, catalog_item_id=catalog_item_id)


@router.post("/woocommerce/catalog/auto-link-by-sku")
async def post_woocommerce_catalog_auto_link_v2(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, int]:
    """Woo katalog SKU'sunu depo kodu (reference_number) ile toplu eşler."""
    return await auto_link_by_sku(db)


@router.get("/woocommerce/workspace", response_model=WooWorkspaceOut)
async def get_woocommerce_workspace_v2(
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> WooWorkspaceOut:
    inventory_workspace = await get_legacy_inventory_workspace(q=q, db=db, _=_)
    return _build_woocommerce_workspace(inventory_workspace)


@router.get("/woocommerce/products/{product_id}", response_model=ProductOut)
async def get_woocommerce_product_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    return to_product_out(product)


@router.get("/woocommerce/products/{product_id}/history", response_model=list[ProductHistoryOut])
async def get_woocommerce_product_history_v2(
    product_id: UUID,
    limit: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[ProductHistoryOut]:
    return await legacy_get_product_history(product_id=product_id, limit=limit, db=db, _=admin)


@router.get("/woocommerce/products/{product_id}/sync-log", response_model=list[WooSyncLogOut])
async def get_woocommerce_product_sync_log_v2(
    product_id: UUID,
    limit: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[WooSyncLogOut]:
    return await legacy_get_product_sync_log(product_id=product_id, limit=limit, db=db, _=admin)


@router.get("/woocommerce/products/{product_id}/raw")
async def get_woocommerce_product_raw_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    return await legacy_get_product_woocommerce_raw(product_id=product_id, db=db, _=admin)


@router.post("/woocommerce/products/{product_id}/manual-review/approve", response_model=ProductOut)
async def post_woocommerce_manual_review_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    return await legacy_approve_product_manual_review(product_id=product_id, db=db, admin=admin)


@router.post("/woocommerce/products/{product_id}/ai", response_model=ProductOut)
async def post_woocommerce_ai_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    return await legacy_ai_describe(product_id=product_id, db=db, admin=admin)


@router.put("/woocommerce/products/{product_id}/ai", response_model=ProductOut)
async def put_woocommerce_ai_v2(
    product_id: UUID,
    payload: ProductAIDescriptionUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    return await legacy_update_ai_describe(product_id=product_id, payload=payload, db=db, admin=admin)


@router.post("/woocommerce/products/{product_id}/publish", response_model=ProductPublishResponse)
async def post_woocommerce_publish_v2(
    product_id: UUID,
    payload: ProductPublishRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductPublishResponse:
    return await legacy_publish_product(product_id=product_id, payload=payload, db=db, admin=admin)


@router.post("/woocommerce/products/{product_id}/unpublish", response_model=ProductOut)
async def post_woocommerce_unpublish_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    return await legacy_unpublish_product(product_id=product_id, db=db, admin=admin)


@router.post("/woocommerce/products/{product_id}/sync")
async def post_woocommerce_sync_v2(
    product_id: UUID,
    days: int = Query(default=30, ge=1, le=365),
    per_page: int = Query(default=100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    return await legacy_sync_product_sale_status(product_id=product_id, days=days, per_page=per_page, db=db, admin=admin)


@router.post("/woocommerce/products/{product_id}/photos", response_model=ProductOut)
async def post_woocommerce_photos_v2(
    product_id: UUID,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    return await legacy_upload_photos(product_id=product_id, files=files, db=db, admin=admin)


@router.delete("/woocommerce/products/{product_id}/photos/{photo_id}", response_model=ProductOut)
async def delete_woocommerce_photo_v2(
    product_id: UUID,
    photo_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    return await legacy_delete_photo(product_id=product_id, photo_id=photo_id, db=db, admin=admin)


@router.get("/opmc/orders", response_model=AntiFraudOrdersResponse)
async def get_opmc_orders_v2(
    days: int = Query(default=30, ge=1, le=365),
    per_page: int = Query(default=25, ge=1, le=100),
    include_notes: bool = Query(default=False),
    notes_per_order: int = Query(default=5, ge=1, le=20),
    detail_mode: bool = Query(default=True),
    admin: User = Depends(require_admin),
) -> AntiFraudOrdersResponse:
    return await get_legacy_antifraud_recent_orders(
        days=days,
        per_page=per_page,
        include_notes=include_notes,
        notes_per_order=notes_per_order,
        detail_mode=detail_mode,
        _=admin,
    )


@router.get("/opmc/orders/{order_id}", response_model=AntiFraudOrderOut)
async def get_opmc_order_detail_v2(
    order_id: int,
    include_notes: bool = Query(default=True),
    notes_per_order: int = Query(default=10, ge=1, le=20),
    admin: User = Depends(require_admin),
) -> AntiFraudOrderOut:
    return await get_legacy_antifraud_order_detail(
        order_id=order_id,
        include_notes=include_notes,
        notes_per_order=notes_per_order,
        _=admin,
    )


@router.post("/opmc/orders/{order_id}/override", response_model=AntiFraudOrderOut)
async def post_opmc_order_override_v2(
    order_id: int,
    payload: AntiFraudOverrideIn,
    admin: User = Depends(require_admin),
) -> AntiFraudOrderOut:
    """Frontend'in çağırdığı v2 yolu — legacy /api/antifraud override'ını sarar.

    Bu uç eksikken OPMC detayındaki onay/red butonları 404 alıyordu.
    """
    return await post_legacy_antifraud_override(order_id=order_id, payload=payload, admin=admin)
