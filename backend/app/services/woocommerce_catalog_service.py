from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from math import ceil
import secrets
import time
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import String, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import Product
from app.models.woocommerce_catalog import WooCommerceCatalogItem, WooCommerceCatalogState
from app.schemas.woocommerce import (
    WooCatalogItemDetailOut,
    WooCatalogItemOut,
    WooCatalogListOut,
    WooCatalogSyncOut,
    WooCatalogSyncPreviewOut,
    WooCatalogSyncSummaryOut,
)
from app.services.product_service import visible_product_clause
from app.services.woocommerce import WooCommerceService
from app.services.woocommerce_import_helpers import (
    extract_weight_grams,
    infer_metal_type_details,
    infer_product_type_details,
    parse_wc_datetime,
)


CATALOG_KEY = "default"
REMOTE_PAGE_SIZE = 100
MAX_REMOTE_PAGES = 1000
PREVIEW_TTL_SECONDS = 900.0
MAX_CACHED_PREVIEWS = 8


@dataclass(frozen=True)
class RemoteCatalogSnapshot:
    items: dict[int, dict]
    digest: str
    warnings: list[str]


@dataclass(frozen=True)
class CachedCatalogPreview:
    owner_user_id: str
    base_revision: int
    snapshot: RemoteCatalogSnapshot
    summary: WooCatalogSyncSummaryOut
    expires_at: float


_preview_cache: OrderedDict[str, CachedCatalogPreview] = OrderedDict()


def _monotonic() -> float:
    return time.monotonic()


def _purge_expired_previews(now: float | None = None) -> None:
    current = _monotonic() if now is None else now
    expired = [token for token, item in _preview_cache.items() if item.expires_at <= current]
    for token in expired:
        _preview_cache.pop(token, None)


def _cache_preview(
    *,
    owner_user_id: UUID | str,
    base_revision: int,
    snapshot: RemoteCatalogSnapshot,
    summary: WooCatalogSyncSummaryOut,
) -> str:
    now = _monotonic()
    _purge_expired_previews(now)
    token = secrets.token_hex(32)
    _preview_cache[token] = CachedCatalogPreview(
        owner_user_id=str(owner_user_id),
        base_revision=int(base_revision),
        snapshot=snapshot,
        summary=summary,
        expires_at=now + PREVIEW_TTL_SECONDS,
    )
    while len(_preview_cache) > MAX_CACHED_PREVIEWS:
        _preview_cache.popitem(last=False)
    return token


def _peek_preview(*, token: str, owner_user_id: UUID | str) -> CachedCatalogPreview:
    """Önizlemeyi doğrular ama TÜKETMEZ; token yalnız başarılı apply sonunda düşer.

    Böylece revizyon çakışması gibi başarısız apply denemeleri operatörün
    önizlemesini yok etmez (kullanıcı aynı token ile durumu görebilir)."""
    _purge_expired_previews()
    cached = _preview_cache.get(token)
    if cached is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "woocommerce_catalog_preview_expired",
                "message": "WooCommerce katalog önizlemesinin süresi doldu. Yeni bir önizleme oluşturun.",
            },
        )
    if cached.owner_user_id != str(owner_user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "woocommerce_catalog_preview_owner_mismatch",
                "message": "WooCommerce katalog önizlemesi başka bir kullanıcıya ait.",
            },
        )
    return cached


def clear_preview_cache_for_tests() -> None:
    _preview_cache.clear()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    candidate = str(value).strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    if not candidate:
        return None
    try:
        return Decimal(candidate).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def _integer(value: object) -> int | None:
    try:
        return int(value) if value is not None and str(value).strip() else None
    except (TypeError, ValueError):
        return None


def _json_list(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _catalog_images(value: object) -> list[dict]:
    return [
        {
            key: item[key]
            for key in ("id", "src", "name", "alt")
            if key in item and item[key] is not None
        }
        for item in _json_list(value)
    ]


def _catalog_categories(value: object) -> list[dict]:
    return [
        {
            key: item[key]
            for key in ("id", "name", "slug")
            if key in item and item[key] is not None
        }
        for item in _json_list(value)
    ]


def _stable_json_value(value: object) -> object:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _stable_product_digest(normalized: dict) -> str:
    stable = {
        key: value
        for key, value in normalized.items()
        if key not in {"source_payload_json", "source_payload_sha256"} and not key.startswith("_")
    }
    return hashlib.sha256(
        json.dumps(
            stable,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=_stable_json_value,
        ).encode("utf-8")
    ).hexdigest()


def normalize_remote_product(payload: dict) -> dict:
    try:
        remote_id = int(payload.get("id") or 0)
    except (TypeError, ValueError):
        remote_id = 0
    if remote_id <= 0:
        raise ValueError("WooCommerce product id is missing or invalid")

    product_type, _, type_reasons = infer_product_type_details(payload)
    metal_type, metal_reasons = infer_metal_type_details(payload)
    weight_grams = extract_weight_grams(payload)
    review_reasons = list(dict.fromkeys([*type_reasons, *metal_reasons]))
    if weight_grams is None:
        review_reasons.append("weight_missing")

    images = _catalog_images(payload.get("images"))
    categories = _catalog_categories(payload.get("categories"))
    canonical_payload = json.loads(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str))
    normalized = {
        "woocommerce_product_id": remote_id,
        "name": str(payload.get("name") or f"WooCommerce #{remote_id}").strip()[:255],
        "slug": str(payload.get("slug") or "").strip()[:255] or None,
        "sku": str(payload.get("sku") or "").strip()[:120] or None,
        "permalink": str(payload.get("permalink") or "").strip() or None,
        "remote_status": "publish",
        "catalog_visibility": str(payload.get("catalog_visibility") or "").strip()[:30] or None,
        "stock_status": str(payload.get("stock_status") or "").strip()[:30] or None,
        "stock_quantity": _integer(payload.get("stock_quantity")),
        "price_dkk": _decimal(payload.get("price")),
        "regular_price_dkk": _decimal(payload.get("regular_price")),
        "sale_price_dkk": _decimal(payload.get("sale_price")),
        "weight_raw": str(payload.get("weight") or "").strip()[:80] or None,
        "weight_grams": weight_grams,
        "weight_missing": weight_grams is None,
        "manual_review_required": bool(review_reasons),
        "manual_review_reasons": review_reasons,
        "photo_missing": not images,
        "image_count": len(images),
        "images_json": images,
        "categories_json": categories,
        "source_payload_json": canonical_payload,
        "source_payload_sha256": "",
        "remote_created_at": parse_wc_datetime(payload.get("date_created_gmt"))
        or parse_wc_datetime(payload.get("date_created")),
        "remote_modified_at": parse_wc_datetime(payload.get("date_modified_gmt"))
        or parse_wc_datetime(payload.get("date_modified")),
        # The inferred values are intentionally not copied into Product. They
        # remain evidence for the manual-review flag in this catalog only.
        "_inferred_product_type": product_type.value,
        "_inferred_metal_type": metal_type.value,
    }
    normalized["source_payload_sha256"] = _stable_product_digest(normalized)
    return normalized


def _persistable_fields(normalized: dict) -> dict:
    return {key: value for key, value in normalized.items() if not key.startswith("_")}


def _snapshot_digest(items: dict[int, dict]) -> str:
    material = [
        {"id": remote_id, "digest": item["source_payload_sha256"]}
        for remote_id, item in sorted(items.items())
    ]
    return hashlib.sha256(
        json.dumps(material, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


async def fetch_remote_catalog(service: WooCommerceService | None = None) -> RemoteCatalogSnapshot:
    client = service or WooCommerceService()
    items: dict[int, dict] = {}
    warnings: list[str] = []
    for page in range(1, MAX_REMOTE_PAGES + 1):
        rows = await client.fetch_published_products_page(page=page, per_page=REMOTE_PAGE_SIZE)
        for raw in rows:
            try:
                normalized = normalize_remote_product(raw)
            except ValueError as exc:
                warnings.append(str(exc))
                continue
            remote_id = int(normalized["woocommerce_product_id"])
            if remote_id in items:
                warnings.append(f"WooCommerce #{remote_id} birden fazla kez döndü; son kayıt kullanıldı.")
            items[remote_id] = normalized
        if len(rows) < REMOTE_PAGE_SIZE:
            break
    else:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="WooCommerce katalog sayfalaması güvenlik sınırını aştı.",
        )
    return RemoteCatalogSnapshot(items=items, digest=_snapshot_digest(items), warnings=warnings)


async def _get_state(db: AsyncSession, *, create: bool = True) -> WooCommerceCatalogState:
    state_row = await db.get(WooCommerceCatalogState, CATALOG_KEY)
    if state_row is None:
        state_row = WooCommerceCatalogState(catalog_key=CATALOG_KEY, revision=0, remote_published_count=0)
        if create:
            db.add(state_row)
            await db.flush()
    return state_row


async def get_catalog_counts(db: AsyncSession) -> tuple[int, int]:
    active = int(
        await db.scalar(select(func.count(WooCommerceCatalogItem.id)).where(WooCommerceCatalogItem.is_active.is_(True)))
        or 0
    )
    inactive = int(
        await db.scalar(select(func.count(WooCommerceCatalogItem.id)).where(WooCommerceCatalogItem.is_active.is_(False)))
        or 0
    )
    return active, inactive


async def get_catalog_state(db: AsyncSession) -> WooCommerceCatalogState:
    return await _get_state(db, create=False)


async def _build_summary(db: AsyncSession, snapshot: RemoteCatalogSnapshot) -> WooCatalogSyncSummaryOut:
    local_rows = (await db.scalars(select(WooCommerceCatalogItem))).all()
    local_by_remote_id = {int(row.woocommerce_product_id): row for row in local_rows}
    create_count = 0
    update_count = 0
    unchanged_count = 0
    for remote_id, remote in snapshot.items.items():
        local = local_by_remote_id.get(remote_id)
        if local is None:
            create_count += 1
        elif not local.is_active or local.source_payload_sha256 != remote["source_payload_sha256"]:
            update_count += 1
        else:
            unchanged_count += 1
    deactivate_count = sum(
        1 for remote_id, local in local_by_remote_id.items() if local.is_active and remote_id not in snapshot.items
    )
    return WooCatalogSyncSummaryOut(
        remote_published_count=len(snapshot.items),
        create_count=create_count,
        update_count=update_count,
        unchanged_count=unchanged_count,
        deactivate_count=deactivate_count,
        weight_missing_count=sum(1 for item in snapshot.items.values() if item["weight_missing"]),
        manual_review_count=sum(1 for item in snapshot.items.values() if item["manual_review_required"]),
        photo_missing_count=sum(1 for item in snapshot.items.values() if item["photo_missing"]),
    )


async def preview_catalog_sync(
    db: AsyncSession,
    *,
    owner_user_id: UUID | str,
    service: WooCommerceService | None = None,
) -> WooCatalogSyncPreviewOut:
    state_row = await _get_state(db, create=False)
    snapshot = await fetch_remote_catalog(service)
    summary = await _build_summary(db, snapshot)
    token = _cache_preview(
        owner_user_id=owner_user_id,
        base_revision=int(state_row.revision),
        snapshot=snapshot,
        summary=summary,
    )
    return WooCatalogSyncPreviewOut(
        preview_revision=token,
        base_revision=int(state_row.revision),
        expires_at=_now() + timedelta(seconds=PREVIEW_TTL_SECONDS),
        summary=summary,
        warnings=snapshot.warnings,
    )


async def apply_catalog_sync(
    db: AsyncSession,
    *,
    preview_revision: str,
    owner_user_id: UUID | str,
) -> WooCatalogSyncOut:
    cached = _peek_preview(token=preview_revision, owner_user_id=owner_user_id)
    state_row = await _get_state(db)
    base_revision = int(state_row.revision)
    if cached.base_revision != base_revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "woocommerce_catalog_revision_conflict",
                "message": "WooCommerce kataloğu veya yerel katalog önizlemeden sonra değişti.",
                "current_revision": base_revision,
            },
        )
    snapshot = cached.snapshot

    claimed = await db.execute(
        update(WooCommerceCatalogState)
        .where(
            WooCommerceCatalogState.catalog_key == CATALOG_KEY,
            WooCommerceCatalogState.revision == base_revision,
        )
        .values(revision=base_revision + 1, updated_at=_now())
    )
    if claimed.rowcount != 1:
        await db.rollback()
        current = await db.get(WooCommerceCatalogState, CATALOG_KEY)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "woocommerce_catalog_revision_conflict",
                "message": "WooCommerce kataloğu başka bir işlem tarafından güncellendi.",
                "current_revision": int(current.revision) if current else base_revision,
            },
        )

    summary = cached.summary
    local_rows = (await db.scalars(select(WooCommerceCatalogItem))).all()
    local_by_remote_id = {int(row.woocommerce_product_id): row for row in local_rows}
    seen_at = _now()
    for remote_id, remote in snapshot.items.items():
        fields = _persistable_fields(remote)
        local = local_by_remote_id.get(remote_id)
        if local is None:
            db.add(
                WooCommerceCatalogItem(
                    **fields,
                    is_active=True,
                    first_seen_at=seen_at,
                    last_seen_at=seen_at,
                )
            )
            continue
        for key, value in fields.items():
            setattr(local, key, value)
        local.is_active = True
        local.last_seen_at = seen_at

    for remote_id, local in local_by_remote_id.items():
        if local.is_active and remote_id not in snapshot.items:
            local.is_active = False

    state_row.remote_published_count = len(snapshot.items)
    state_row.last_synced_at = seen_at
    await db.commit()
    # Yalnız başarılı apply token'ı tüketir; yukarıdaki 409 yolları önizlemeyi korur.
    _preview_cache.pop(preview_revision, None)
    return WooCatalogSyncOut(
        revision=base_revision + 1,
        summary=summary,
        synced_at=seen_at,
    )


def catalog_item_out(row: WooCommerceCatalogItem) -> WooCatalogItemOut:
    return WooCatalogItemOut(
        id=row.id,
        woocommerce_product_id=row.woocommerce_product_id,
        name=row.name,
        slug=row.slug,
        sku=row.sku,
        permalink=row.permalink,
        remote_status=row.remote_status,
        catalog_visibility=row.catalog_visibility,
        stock_status=row.stock_status,
        stock_quantity=row.stock_quantity,
        price_dkk=row.price_dkk,
        regular_price_dkk=row.regular_price_dkk,
        sale_price_dkk=row.sale_price_dkk,
        weight_raw=row.weight_raw,
        weight_grams=row.weight_grams,
        weight_missing=row.weight_missing,
        manual_review_required=row.manual_review_required,
        manual_review_reasons=[str(item) for item in (row.manual_review_reasons or [])],
        photo_missing=row.photo_missing,
        image_count=row.image_count,
        images=[item for item in (row.images_json or []) if isinstance(item, dict)],
        categories=[item for item in (row.categories_json or []) if isinstance(item, dict)],
        is_active=row.is_active,
        linked_product_id=row.linked_product_id,
        remote_created_at=row.remote_created_at,
        remote_modified_at=row.remote_modified_at,
        first_seen_at=row.first_seen_at,
        last_seen_at=row.last_seen_at,
        updated_at=row.updated_at,
    )


async def list_catalog(
    db: AsyncSession,
    *,
    page: int,
    page_size: int,
    q: str | None,
    active: bool | None,
    linked: bool | None,
    manual_review_required: bool | None,
    photo_missing: bool | None,
) -> WooCatalogListOut:
    clauses = []
    if q and q.strip():
        needle = f"%{q.strip().lower()}%"
        clauses.append(
            or_(
                func.lower(WooCommerceCatalogItem.name).like(needle),
                func.lower(func.coalesce(WooCommerceCatalogItem.sku, "")).like(needle),
                func.cast(WooCommerceCatalogItem.woocommerce_product_id, String).like(needle),
            )
        )
    if active is not None:
        clauses.append(WooCommerceCatalogItem.is_active.is_(active))
    if linked is not None:
        clauses.append(
            WooCommerceCatalogItem.linked_product_id.is_not(None)
            if linked
            else WooCommerceCatalogItem.linked_product_id.is_(None)
        )
    if manual_review_required is not None:
        clauses.append(WooCommerceCatalogItem.manual_review_required.is_(manual_review_required))
    if photo_missing is not None:
        clauses.append(WooCommerceCatalogItem.photo_missing.is_(photo_missing))

    total = int(await db.scalar(select(func.count(WooCommerceCatalogItem.id)).where(*clauses)) or 0)
    rows = (
        await db.scalars(
            select(WooCommerceCatalogItem)
            .where(*clauses)
            .order_by(WooCommerceCatalogItem.is_active.desc(), WooCommerceCatalogItem.name, WooCommerceCatalogItem.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    state_row = await _get_state(db, create=False)
    return WooCatalogListOut(
        items=[catalog_item_out(row) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
        total_pages=max(1, ceil(total / page_size)),
        catalog_revision=int(state_row.revision),
    )


async def link_catalog_item(
    db: AsyncSession,
    *,
    catalog_item_id: UUID,
    product_id: UUID,
) -> WooCatalogItemOut:
    item = await db.get(WooCommerceCatalogItem, catalog_item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WooCommerce katalog ürünü bulunamadı.")
    product = await db.scalar(select(Product).where(Product.id == product_id, visible_product_clause()))
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Depolama ürünü bulunamadı.")
    duplicate = await db.scalar(
        select(WooCommerceCatalogItem).where(
            WooCommerceCatalogItem.linked_product_id == product_id,
            WooCommerceCatalogItem.id != catalog_item_id,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "woocommerce_catalog_product_already_linked",
                "message": "Depolama ürünü başka bir WooCommerce katalog kaydına bağlı.",
                "catalog_item_id": str(duplicate.id),
            },
        )
    item.linked_product_id = product_id
    await _bump_revision(db)
    await db.commit()
    await db.refresh(item)
    return catalog_item_out(item)


async def auto_link_by_sku(db: AsyncSession) -> dict[str, int]:
    """WooCommerce katalog SKU'sunu depolama ürününün reference_number'ıyla
    (S2500 gibi depo kodu) eşleyip toplu bağlar. Yalnız bağlı OLMAYAN katalog
    satırları + bağlı OLMAYAN ürünler eşlenir; zaten bağlı olan atlanır.
    Döndürür: {linked, skipped_no_match, already_linked}."""
    unlinked_items = list(
        (await db.scalars(
            select(WooCommerceCatalogItem).where(
                WooCommerceCatalogItem.linked_product_id.is_(None),
                WooCommerceCatalogItem.sku.isnot(None),
            )
        )).all()
    )
    # reference_number -> product_id (görünür ürünler)
    ref_rows = (await db.execute(
        select(Product.reference_number, Product.id).where(
            Product.reference_number.isnot(None), visible_product_clause()
        )
    )).all()
    ref_to_product: dict[str, UUID] = {}
    for ref, pid in ref_rows:
        ref_to_product.setdefault(str(ref).strip(), pid)
    # Zaten bir katalog satırına bağlı ürünler (çift bağlamayı önle)
    already_linked_products = {
        pid for (pid,) in (await db.execute(
            select(WooCommerceCatalogItem.linked_product_id).where(
                WooCommerceCatalogItem.linked_product_id.isnot(None)
            )
        )).all()
    }

    linked = 0
    skipped_no_match = 0
    already = 0
    for item in unlinked_items:
        sku = str(item.sku).strip() if item.sku else ""
        product_id = ref_to_product.get(sku)
        if product_id is None:
            skipped_no_match += 1
            continue
        if product_id in already_linked_products:
            already += 1
            continue
        item.linked_product_id = product_id
        already_linked_products.add(product_id)
        linked += 1

    if linked:
        await _bump_revision(db)
        await db.commit()
    else:
        await db.rollback()
    return {"linked": linked, "skipped_no_match": skipped_no_match, "already_linked": already}


async def unlink_catalog_item(db: AsyncSession, *, catalog_item_id: UUID) -> WooCatalogItemOut:
    item = await db.get(WooCommerceCatalogItem, catalog_item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WooCommerce katalog ürünü bulunamadı.")
    if item.linked_product_id is not None:
        item.linked_product_id = None
        await _bump_revision(db)
        await db.commit()
        await db.refresh(item)
    return catalog_item_out(item)


async def _bump_revision(db: AsyncSession) -> int:
    state_row = await _get_state(db)
    state_row.revision = int(state_row.revision) + 1
    return int(state_row.revision)


def _payload_meta_value(payload: dict, keys: tuple[str, ...]) -> str | None:
    entries = payload.get("meta_data")
    if not isinstance(entries, list):
        return None
    for key in keys:
        for entry in entries:
            if isinstance(entry, dict) and entry.get("key") == key:
                value = str(entry.get("value") or "").strip()
                if value:
                    return value
    return None


async def get_catalog_item_detail(db: AsyncSession, *, catalog_item_id: UUID) -> WooCatalogItemDetailOut:
    """Katalog satırının SEO/açıklama detayı — kayıtlı source_payload'dan, ağ erişimsiz."""
    item = await db.get(WooCommerceCatalogItem, catalog_item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WooCommerce katalog ürünü bulunamadı.")
    payload = item.source_payload_json if isinstance(item.source_payload_json, dict) else {}
    base = catalog_item_out(item)
    return WooCatalogItemDetailOut(
        **base.model_dump(),
        description_html=str(payload.get("description") or "") or None,
        short_description_html=str(payload.get("short_description") or "") or None,
        seo_title=_payload_meta_value(payload, ("_yoast_wpseo_title", "rank_math_title")),
        meta_description=_payload_meta_value(
            payload, ("_yoast_wpseo_metadesc", "rank_math_description", "crm_meta_description")
        ),
    )


async def unpublish_catalog_item(
    db: AsyncSession, *, catalog_item_id: UUID, skip_remote: bool = False
) -> WooCatalogItemOut:
    """Katalog kaydını sitede taslağa çeker ve yerel durumu günceller.

    Bağlı kayıtlarda uzak çağrı + history ürün-unpublish akışında yapılır;
    o yol skip_remote=True ile yalnız katalog satırını günceller.
    """
    item = await db.get(WooCommerceCatalogItem, catalog_item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WooCommerce katalog ürünü bulunamadı.")
    if not skip_remote:
        service = WooCommerceService()
        await service.unpublish_product(item.woocommerce_product_id)
    item.remote_status = "draft"
    item.is_active = False
    await _bump_revision(db)
    await db.commit()
    await db.refresh(item)
    return catalog_item_out(item)
