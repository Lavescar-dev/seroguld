from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from math import ceil

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_customer
from app.database import get_db
from app.models.enums import ProductStatusEnum
from app.models.product import Product
from app.models.user import User
from app.schemas.customer_portal import (
    CustomerPortalProductListOut,
    CustomerPortalProductOut,
    CustomerPortalSummaryOut,
    CustomerPortalTransactionOut,
)
from app.services.gold_price import GoldPriceService
from app.services.product_service import visible_product_clause
from app.utils.helpers import to_decimal

router = APIRouter()


def _as_str(value: Decimal | str | int | float | None) -> str:
    return str(to_decimal(value).quantize(Decimal("0.01")))


def _map_transaction_item(product: Product, side: str) -> CustomerPortalTransactionOut:
    if side == "sold_to_shop":
        amount = product.purchase_price_dkk
        at = product.purchase_date
    else:
        amount = product.sale_price_dkk or Decimal("0")
        at = product.sale_date or product.updated_at

    return CustomerPortalTransactionOut(
        product_id=product.id,
        product_number=product.product_number,
        reference_number=product.reference_number,
        side=side,
        product_type=product.product_type,
        metal_type=product.metal_type,
        weight_grams=_as_str(product.weight_grams),
        purity_karat=product.purity_karat,
        purity_percentage=_as_str(product.purity_percentage) if product.purity_percentage is not None else None,
        amount_dkk=_as_str(amount),
        status=product.status,
        transaction_at=at,
    )


def _map_product_item(product: Product, side: str) -> CustomerPortalProductOut:
    tx = _map_transaction_item(product, side)
    return CustomerPortalProductOut(
        id=product.id,
        product_number=product.product_number,
        reference_number=product.reference_number,
        side=side,
        product_type=product.product_type,
        metal_type=product.metal_type,
        weight_grams=tx.weight_grams,
        purity_karat=tx.purity_karat,
        purity_percentage=tx.purity_percentage,
        status=product.status,
        amount_dkk=tx.amount_dkk,
        transaction_at=tx.transaction_at,
        is_published_to_site=bool(product.is_published_to_site),
    )


@router.get("/me/summary", response_model=CustomerPortalSummaryOut)
async def me_summary(
    db: AsyncSession = Depends(get_db),
    current_customer: User = Depends(require_customer),
) -> CustomerPortalSummaryOut:
    sold_to_shop_count = await db.scalar(
        select(func.count(Product.id)).where(Product.seller_customer_id == current_customer.id, visible_product_clause())
    )
    sold_to_shop_value = await db.scalar(
        select(func.coalesce(func.sum(Product.purchase_price_dkk), Decimal("0"))).where(
            Product.seller_customer_id == current_customer.id,
            visible_product_clause(),
        )
    )
    bought_from_shop_count = await db.scalar(
        select(func.count(Product.id)).where(Product.buyer_customer_id == current_customer.id, visible_product_clause())
    )
    bought_from_shop_value = await db.scalar(
        select(func.coalesce(func.sum(Product.sale_price_dkk), Decimal("0"))).where(
            Product.buyer_customer_id == current_customer.id,
            visible_product_clause(),
        )
    )
    active_site_listings_count = await db.scalar(
        select(func.count(Product.id)).where(
            Product.buyer_customer_id == current_customer.id,
            Product.is_published_to_site.is_(True),
            visible_product_clause(),
        )
    )

    product_rows = await db.scalars(
        select(Product)
        .where(or_(Product.seller_customer_id == current_customer.id, Product.buyer_customer_id == current_customer.id), visible_product_clause())
        .order_by(Product.updated_at.desc())
        .limit(120)
    )

    timeline: list[CustomerPortalTransactionOut] = []
    for item in product_rows.all():
        if item.seller_customer_id == current_customer.id:
            timeline.append(_map_transaction_item(item, "sold_to_shop"))
        if item.buyer_customer_id == current_customer.id:
            timeline.append(_map_transaction_item(item, "bought_from_shop"))

    timeline.sort(key=lambda x: x.transaction_at or datetime.min, reverse=True)
    recent = timeline[:20]

    rates = await GoldPriceService().get_rates()
    rates_map = {metal: _as_str(price) for metal, price in rates.items()}

    return CustomerPortalSummaryOut(
        customer_id=current_customer.id,
        customer_name=current_customer.name,
        customer_email=current_customer.email,
        customer_phone=current_customer.phone,
        total_transactions=int((sold_to_shop_count or 0) + (bought_from_shop_count or 0)),
        sold_to_shop_count=int(sold_to_shop_count or 0),
        bought_from_shop_count=int(bought_from_shop_count or 0),
        sold_to_shop_value_dkk=_as_str(sold_to_shop_value),
        bought_from_shop_value_dkk=_as_str(bought_from_shop_value),
        active_site_listings_count=int(active_site_listings_count or 0),
        current_rates_dkk_per_gram=rates_map,
        recent_transactions=recent,
    )


@router.get("/me/products", response_model=CustomerPortalProductListOut)
async def me_products(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    side: str = Query(default="all", pattern="^(all|sold_to_shop|bought_from_shop)$"),
    status: ProductStatusEnum | None = Query(default=None),
    search: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_customer: User = Depends(require_customer),
) -> CustomerPortalProductListOut:
    filters = []
    if side == "sold_to_shop":
        filters.append(Product.seller_customer_id == current_customer.id)
    elif side == "bought_from_shop":
        filters.append(Product.buyer_customer_id == current_customer.id)
    else:
        filters.append(
            or_(Product.seller_customer_id == current_customer.id, Product.buyer_customer_id == current_customer.id)
        )

    if status:
        filters.append(Product.status == status)

    if search and search.strip():
        pattern = f"%{search.strip()}%"
        filters.append(or_(Product.product_number.ilike(pattern), Product.reference_number.ilike(pattern)))

    query = select(Product).where(and_(*filters), visible_product_clause())
    total = await db.scalar(select(func.count()).select_from(query.subquery()))

    rows = await db.scalars(
        query.order_by(Product.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )

    items: list[CustomerPortalProductOut] = []
    for product in rows.all():
        if side == "sold_to_shop":
            items.append(_map_product_item(product, "sold_to_shop"))
            continue
        if side == "bought_from_shop":
            items.append(_map_product_item(product, "bought_from_shop"))
            continue

        resolved_side = "sold_to_shop" if product.seller_customer_id == current_customer.id else "bought_from_shop"
        items.append(_map_product_item(product, resolved_side))

    total_int = int(total or 0)
    return CustomerPortalProductListOut(
        items=items,
        page=page,
        page_size=page_size,
        total=total_int,
        total_pages=max(1, ceil(total_int / page_size)),
    )
