from __future__ import annotations

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
from app.services.product_service import (
    ACTIVE_STATUSES,
    create_product,
    get_product_or_404,
    soft_delete_product,
    update_product,
    visible_product_clause,
)
from app.utils.env_file import upsert_env_values
from app.utils.helpers import quantize_2, to_decimal

router = APIRouter()


def _get_market_prices() -> InventoryMarketPricesOut:
    settings = get_settings()
    return InventoryMarketPricesOut(
        gold=quantize_2(settings.inventory_market_gold_dkk),
        silver=quantize_2(settings.inventory_market_silver_dkk),
        platinum=quantize_2(settings.inventory_market_platinum_dkk),
        palladium=quantize_2(settings.inventory_market_palladium_dkk),
    )


def _product_rate(product: Product, prices: InventoryMarketPricesOut) -> Decimal:
    if product.metal_type == MetalTypeEnum.SILVER:
        return quantize_2(prices.silver)
    if product.metal_type == MetalTypeEnum.PLATINUM:
        return quantize_2(prices.platinum)
    if product.metal_type == MetalTypeEnum.PALLADIUM:
        return quantize_2(prices.palladium)
    return quantize_2(prices.gold)


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

    if product.metal_type == MetalTypeEnum.SILVER:
        sub = "barrer" if product.product_type.value == "bar" else "smykker"
        return "gumus", sub
    if product.metal_type in {MetalTypeEnum.PLATINUM, MetalTypeEnum.PALLADIUM}:
        return "platin_pd", ("palladyum" if product.metal_type == MetalTypeEnum.PALLADIUM else "platin")
    if product.product_type.value == "bar":
        return "kulce", None
    return "taki", None


def _saflik_label(product: Product) -> str:
    if product.purity_karat and product.purity_percentage is not None:
        return f"{product.purity_karat} / {quantize_2(product.purity_percentage)}%"
    if product.purity_percentage is not None:
        return f"{(to_decimal(product.purity_percentage) * Decimal('10')).quantize(Decimal('1'))}‰"
    if product.purity_karat:
        return product.purity_karat
    return "-"


def _inventory_row(product: Product, prices: InventoryMarketPricesOut) -> InventoryGridRowOut:
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
        length_cm=product.length_cm,
        width_mm=(quantize_2(product.width_mm) if product.width_mm is not None else None),
        thickness_mm=(quantize_2(product.thickness_mm) if product.thickness_mm is not None else None),
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
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> InventoryWorkspaceOut:
    prices = _get_market_prices()
    stmt = (
        select(Product)
        .where(Product.status.in_(tuple(ACTIVE_STATUSES)), visible_product_clause())
        .options(selectinload(Product.seller_customer), selectinload(Product.buyer_customer))
        .order_by(Product.purchase_date.desc(), Product.product_number.desc())
    )
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Product.product_number.ilike(pattern),
                Product.reference_number.ilike(pattern),
                Product.display_name.ilike(pattern),
                Product.producer.ilike(pattern),
            )
        )
    products = list((await db.scalars(stmt)).unique().all())
    rows = [_inventory_row(item, prices) for item in products]
    return InventoryWorkspaceOut(
        market_prices=prices,
        summary=_summary(rows),
        rows=rows,
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
