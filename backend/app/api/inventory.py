from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Iterable
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_admin
from app.config import ROOT_ENV_FILE, get_settings
from app.database import get_db
from app.models.enums import MetalTypeEnum, ProductStatusEnum
from app.models.product import Product
from app.schemas.inventory import (
    InventoryGridRowOut,
    InventoryMarketPricesOut,
    InventoryMarketPricesUpdate,
    InventoryWorkspaceOut,
    InventoryWorkspaceSummaryOut,
)
from app.schemas.product import ProductCreate, ProductOut, ProductUpdate
from app.services.pos_value_helpers import display_metal_type, display_product_type
from app.services.market_rate_profile import get_effective_market_rate_profile_cached
from app.services.product_service import (
    ACTIVE_STATUSES,
    create_product,
    get_product_or_404,
    infer_inventory_categories,
    soft_delete_product,
    update_product,
    visible_product_clause,
)
from app.utils.env_file import upsert_env_values
from app.utils.helpers import quantize_2, to_decimal

router = APIRouter()


def _get_market_prices(market_profile: dict[str, object] | None = None) -> InventoryMarketPricesOut:
    """Etkin profil (manuel + canlı overlay) üzerinden güncel metal fiyatları.

    Env skalerleri bayat kalırdı: canlı Pt/Pd overlay'i ve WP priser'den
    çekilen değerler env'e ayrıca yazılmadığında görünmezdi.
    """
    profile = market_profile if market_profile is not None else get_effective_market_rate_profile_cached()
    return InventoryMarketPricesOut(
        gold=quantize_2(str(profile.get("gold_24k_dkk") or "0")),
        silver=quantize_2(str(profile.get("silver_dkk") or "0")),
        platinum=quantize_2(str(profile.get("platinum_dkk") or "0")),
        palladium=quantize_2(str(profile.get("palladium_dkk") or "0")),
    )


def _product_rate(product: Product, prices: InventoryMarketPricesOut) -> Decimal:
    if product.metal_type == MetalTypeEnum.SILVER:
        return quantize_2(prices.silver)
    if product.metal_type == MetalTypeEnum.PLATINUM:
        return quantize_2(prices.platinum)
    if product.metal_type == MetalTypeEnum.PALLADIUM:
        return quantize_2(prices.palladium)
    return quantize_2(prices.gold)


def _woo_missing_fields(product: Product) -> list[str]:
    """Woo otomatik fiyatı için eksik alanlar; tamamlanınca fiyat görünür."""
    missing: list[str] = []
    if product.metal_type is None:
        missing.append("metal")
    if product.weight_grams is None or to_decimal(product.weight_grams) <= 0:
        missing.append("gram")
    if product.purity_percentage is None or to_decimal(product.purity_percentage) <= 0:
        missing.append("saflık")
    if getattr(product, "woo_markup_rate", None) is None:
        missing.append("markup")
    return missing


def _woo_satis_fiyati(product: Product, prices: InventoryMarketPricesOut) -> Decimal | None:
    """spot × gram × saflık × (1 + markup) — WP eklentisiyle aynı formül."""
    if _woo_missing_fields(product):
        return None
    purity = to_decimal(product.purity_percentage or 0) / Decimal("100")
    markup = to_decimal(getattr(product, "woo_markup_rate") or 0)
    return quantize_2(_product_rate(product, prices) * to_decimal(product.weight_grams) * purity * (Decimal("1") + markup))


def _primary_photo_url(product: Product) -> str | None:
    photos = list(product.photos or [])
    if not photos:
        return None
    primary = next((item for item in photos if isinstance(item, dict) and item.get("is_primary") and item.get("url")), None)
    if primary:
        return str(primary.get("url"))
    first = next((item for item in photos if isinstance(item, dict) and item.get("url")), None)
    return str(first.get("url")) if first else None


def _photo_count(product: Product) -> int:
    return len(list(product.photos or []))


def _infer_inventory_category(product: Product) -> tuple[str, str | None]:
    if product.inventory_category:
        return product.inventory_category, product.inventory_subcategory
    # Tek kaynak: product_service.infer_inventory_categories (0035 backfill +
    # create/update yazımıyla aynı türetme).
    return infer_inventory_categories(product.metal_type, product.product_type)


def _saflik_label(product: Product) -> str:
    if product.purity_karat and product.purity_percentage is not None:
        return f"{product.purity_karat} / {quantize_2(product.purity_percentage)}%"
    if product.purity_percentage is not None:
        return f"{(to_decimal(product.purity_percentage) * Decimal('10')).quantize(Decimal('1'))}‰"
    if product.purity_karat:
        return product.purity_karat
    return "-"


def _inventory_row(product: Product, prices: InventoryMarketPricesOut, linked_ids: set | None = None) -> InventoryGridRowOut:
    main_category, subcategory = _infer_inventory_category(product)
    unit_count = int(product.unit_count or 1)
    birim_gram = quantize_2(to_decimal(product.weight_grams))
    toplam_gram = quantize_2(
        to_decimal(product.total_weight_grams) if product.total_weight_grams is not None else birim_gram * Decimal(unit_count)
    )
    has_metal = (
        quantize_2(to_decimal(product.pure_gold_grams))
        if product.pure_gold_grams is not None
        else quantize_2(toplam_gram * (to_decimal(product.purity_percentage or 0) / Decimal("100")))
        if product.purity_percentage is not None
        else None
    )
    spot_deger = quantize_2((has_metal or Decimal("0.00")) * _product_rate(product, prices))
    return InventoryGridRowOut(
        id=product.id,
        product_number=product.product_number,
        reference_number=product.reference_number,
        main_category=main_category,
        subcategory=subcategory,
        product_type=product.product_type.value,
        metal_type=product.metal_type.value,
        status=product.status.value,
        # Optimistic concurrency: satırın updated_at'ı düzenleme yolunda
        # expected_updated_at olarak geri gider (detay prefetch'i olmadan).
        updated_at=(product.updated_at.isoformat() if product.updated_at else None),
        operation_destination=product.operation_destination,
        operation_classification=product.operation_classification,
        lager_dato=product.purchase_date.date().isoformat(),
        urun=product.display_name or f"{display_product_type(product.product_type)} · {display_metal_type(product.metal_type)}",
        saflik_label=_saflik_label(product),
        purity_percentage=(quantize_2(product.purity_percentage) if product.purity_percentage is not None else None),
        birim_gram=birim_gram,
        adet=unit_count,
        toplam_gram=toplam_gram,
        has_metal_grams=has_metal,
        alis_fiyati_dkk=quantize_2(product.purchase_price_dkk),
        spot_degeri_dkk=spot_deger,
        shop_fiyati_dkk=(quantize_2(product.shop_price_dkk) if product.shop_price_dkk is not None else None),
        shop_sync_status=product.shop_sync_status,
        woo_satis_fiyati_dkk=_woo_satis_fiyati(product, prices),
        woo_eksik_alanlar=_woo_missing_fields(product),
        is_published_to_site=bool(product.is_published_to_site),
        is_woo_linked=(product.id in linked_ids) if linked_ids else False,
        length_cm=product.length_cm,
        width_mm=(quantize_2(product.width_mm) if product.width_mm is not None else None),
        thickness_mm=(quantize_2(product.thickness_mm) if product.thickness_mm is not None else None),
        diameter_mm=(quantize_2(product.diameter_mm) if product.diameter_mm is not None else None),
        producer=product.producer,
        storage_location=product.storage_location,
        needs_cleaning=bool(product.needs_cleaning),
        is_gdpr_locked=bool(product.is_gdpr_locked),
        primary_photo=_primary_photo_url(product),
        photo_count=_photo_count(product),
        has_ai_description=bool((product.ai_description or "").strip()),
        ai_description_approved=bool(product.ai_description_approved),
        notes=product.notes,
    )


def _summary(rows: Iterable[InventoryGridRowOut]) -> InventoryWorkspaceSummaryOut:
    total_items = 0
    total_purchase_value = Decimal("0.00")
    total_spot_value = Decimal("0.00")
    total_pure_metal = Decimal("0.00")
    total_fine_silver = Decimal("0.00")
    total_gold_related = Decimal("0.00")

    for row in rows:
        total_items += 1
        total_purchase_value += to_decimal(row.alis_fiyati_dkk)
        total_spot_value += to_decimal(row.spot_degeri_dkk)
        pure = to_decimal(row.has_metal_grams or 0)
        total_pure_metal += pure
        if row.metal_type == MetalTypeEnum.SILVER.value:
            total_fine_silver += pure
        else:
            total_gold_related += pure

    return InventoryWorkspaceSummaryOut(
        total_items=total_items,
        total_purchase_value_dkk=quantize_2(total_purchase_value),
        total_spot_value_dkk=quantize_2(total_spot_value),
        total_pure_metal_grams=quantize_2(total_pure_metal),
        total_fine_silver_grams=quantize_2(total_fine_silver),
        total_gold_related_grams=quantize_2(total_gold_related),
    )


def _normalize_text_filter(value: object) -> str | None:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return None


def _normalize_bool_filter(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _normalize_decimal_filter(value: object) -> Decimal | None:
    if value is None or isinstance(value, Decimal):
        return value
    return None


def _escape_like(value: str) -> str:
    """LIKE jokerlerini (yüzde ve alt çizgi) literal yap; aksi halde '%100'
    araması her '100...' satırını eşleşirdi."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _day_bound(value: object, *, end: bool) -> datetime | None:
    """YYYY-MM-DD (veya datetime) → tz-aware datetime sınırı.

    purchase_date kolonu DateTime(timezone=True): string bind (Postgres'te
    'timestamp >= text' hatası) yerine gerçek datetime karşılaştır.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        day = value
    elif isinstance(value, str):
        try:
            day = date.fromisoformat(value.strip())
        except ValueError:
            return None
    else:
        return None
    return datetime.combine(day, time.max if end else time.min, tzinfo=timezone.utc)


@router.get("/market-prices", response_model=InventoryMarketPricesOut)
async def get_inventory_market_prices(_: object = Depends(require_admin)) -> InventoryMarketPricesOut:
    return _get_market_prices()


@router.put("/market-prices", response_model=InventoryMarketPricesOut)
async def put_inventory_market_prices(
    payload: InventoryMarketPricesUpdate,
    _: object = Depends(require_admin),
) -> InventoryMarketPricesOut:
    upsert_env_values(
        ROOT_ENV_FILE,
        {
            "INVENTORY_MARKET_GOLD_DKK": str(quantize_2(payload.gold)),
            "INVENTORY_MARKET_SILVER_DKK": str(quantize_2(payload.silver)),
            "INVENTORY_MARKET_PLATINUM_DKK": str(quantize_2(payload.platinum)),
            "INVENTORY_MARKET_PALLADIUM_DKK": str(quantize_2(payload.palladium)),
        },
    )
    get_settings.cache_clear()
    return _get_market_prices()


@router.get("/workspace", response_model=InventoryWorkspaceOut)
async def get_inventory_workspace(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None, pattern=r"^(kulce|sikke|taki|gumus|platin_pd)$"),
    status: str | None = Query(
        default=None, pattern=r"^(purchased|in_inventory|for_sale|sold|melted|undecided)$"
    ),
    subcategory: str | None = Query(default=None, max_length=30),
    location: str | None = Query(default=None, max_length=100),
    needs_cleaning: bool | None = Query(default=None),
    gdpr_locked: bool | None = Query(default=None),
    date_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    weight_min: Decimal | None = Query(default=None, ge=0),
    weight_max: Decimal | None = Query(default=None, ge=0),
    price_min: Decimal | None = Query(default=None, ge=0),
    price_max: Decimal | None = Query(default=None, ge=0),
    limit: int | None = Query(default=None, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> InventoryWorkspaceOut:
    q = _normalize_text_filter(q)
    category = _normalize_text_filter(category)
    status = _normalize_text_filter(status)
    subcategory = _normalize_text_filter(subcategory)
    location = _normalize_text_filter(location)
    date_from = _normalize_text_filter(date_from)
    date_to = _normalize_text_filter(date_to)
    needs_cleaning = _normalize_bool_filter(needs_cleaning)
    gdpr_locked = _normalize_bool_filter(gdpr_locked)
    weight_min = _normalize_decimal_filter(weight_min)
    weight_max = _normalize_decimal_filter(weight_max)
    price_min = _normalize_decimal_filter(price_min)
    price_max = _normalize_decimal_filter(price_max)
    # limit=None → TÜM eşleşen satırlar (varsayılan 500 sessizce kesiyordu;
    # KPI'lar ve depolama.xlsx projeksiyonu eksik kalıyordu). limit yalnızca
    # çağıran açıkça sayfalama istiyorsa satır penceresi olarak uygulanır.
    safe_limit = limit if isinstance(limit, int) and limit > 0 else None
    safe_offset = offset if isinstance(offset, int) and offset > 0 else 0

    prices = _get_market_prices()
    # Varsayılan liste yalnız aktif stok gösterir; operatör açıkça bir durum
    # seçerse (satılmış/eritilmiş dahil) o duruma göre filtreler.
    if status:
        status_clause = Product.status == ProductStatusEnum(status)
    else:
        status_clause = Product.status.in_(tuple(ACTIVE_STATUSES))
    stmt = (
        select(Product)
        .where(status_clause, visible_product_clause())
        .options(selectinload(Product.seller_customer), selectinload(Product.buyer_customer))
        .order_by(Product.purchase_date.desc(), Product.product_number.desc())
    )
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        stmt = stmt.where(
            or_(
                Product.product_number.ilike(pattern, escape="\\"),
                Product.reference_number.ilike(pattern, escape="\\"),
                Product.display_name.ilike(pattern, escape="\\"),
                Product.producer.ilike(pattern, escape="\\"),
                Product.notes.ilike(pattern, escape="\\"),
                Product.storage_location.ilike(pattern, escape="\\"),
            )
        )
    if category:
        stmt = stmt.where(Product.inventory_category == category)
    if subcategory:
        stmt = stmt.where(Product.inventory_subcategory == subcategory)
    if location:
        stmt = stmt.where(Product.storage_location.ilike(f"%{_escape_like(location.strip())}%", escape="\\"))
    if needs_cleaning is not None:
        stmt = stmt.where(Product.needs_cleaning == needs_cleaning)
    if gdpr_locked is not None:
        stmt = stmt.where(Product.is_gdpr_locked == gdpr_locked)
    date_from_bound = _day_bound(date_from, end=False)
    date_to_bound = _day_bound(date_to, end=True)
    if date_from_bound is not None:
        stmt = stmt.where(Product.purchase_date >= date_from_bound)
    if date_to_bound is not None:
        stmt = stmt.where(Product.purchase_date <= date_to_bound)
    if weight_min is not None:
        stmt = stmt.where(Product.weight_grams >= weight_min)
    if weight_max is not None:
        stmt = stmt.where(Product.weight_grams <= weight_max)
    if price_min is not None:
        stmt = stmt.where(Product.purchase_price_dkk >= price_min)
    if price_max is not None:
        stmt = stmt.where(Product.purchase_price_dkk <= price_max)

    # Tam filtrelenmiş küme çekilir: summary ve total_rows HER ZAMAN bütün
    # veriyi yansıtır; limit/offset yalnız dönen satır penceresini böler.
    products_all = list((await db.scalars(stmt)).unique().all())
    total_rows = len(products_all)
    # Eşleşen ürünlerden hangileri bir Woo katalog kaydına bağlı?
    linked_ids: set = set()
    if products_all:
        from app.models.woocommerce_catalog import WooCommerceCatalogItem

        product_ids = [p.id for p in products_all]
        linked_ids = {
            pid for (pid,) in (await db.execute(
                select(WooCommerceCatalogItem.linked_product_id).where(
                    WooCommerceCatalogItem.linked_product_id.in_(product_ids)
                )
            )).all()
        }
    all_rows = [_inventory_row(item, prices, linked_ids) for item in products_all]
    rows = (
        all_rows[safe_offset : safe_offset + safe_limit]
        if safe_limit is not None
        else all_rows[safe_offset:]
    )
    return InventoryWorkspaceOut(
        market_prices=prices,
        summary=_summary(all_rows),
        rows=rows,
        total_rows=total_rows,
    )


@router.patch("/products/{product_id}", response_model=ProductOut)
async def patch_inventory_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    return await update_product(db, product, payload, admin.id)


@router.post("/products", response_model=ProductOut)
async def post_inventory_product(
    payload: ProductCreate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    return await create_product(db, payload, admin.id)


@router.delete("/products/{product_id}", status_code=204, response_class=Response)
async def delete_inventory_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> Response:
    product = await get_product_or_404(db, product_id)
    await soft_delete_product(db, product, admin.id)
    return Response(status_code=204)
