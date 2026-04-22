from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.config import get_settings
from app.database import get_db
from app.models.enums import ProductStatusEnum
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.user import User
from app.models.woocommerce_log import WooCommerceSyncLog
from app.services.woocommerce import WooCommerceService
from app.utils.helpers import quantize_2, utc_now

router = APIRouter()

SALE_ORDER_STATUSES = {"processing", "completed"}


def _verify_wc_signature(raw_body: bytes, provided_signature: str | None, secret: str | None) -> bool:
    if not secret:
        return True
    if not provided_signature:
        return False
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).digest()
    expected_signature = base64.b64encode(digest).decode("utf-8")
    return hmac.compare_digest(provided_signature.strip(), expected_signature)


def _parse_wc_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return quantize_2(Decimal(text))
    except (InvalidOperation, ValueError):
        return None


def _extract_order_sale_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    order_status = str(payload.get("status") or "").strip().lower()
    if order_status not in SALE_ORDER_STATUSES:
        return []

    sale_date = (
        _parse_wc_datetime(payload.get("date_paid"))
        or _parse_wc_datetime(payload.get("date_completed"))
        or _parse_wc_datetime(payload.get("date_created"))
        or utc_now()
    )

    line_items = payload.get("line_items")
    if not isinstance(line_items, list):
        return []

    normalized_items: list[dict[str, Any]] = []
    for item in line_items:
        if not isinstance(item, dict):
            continue

        product_id = item.get("product_id")
        try:
            wc_product_id = int(product_id)
        except (TypeError, ValueError):
            continue

        sale_price = (
            _parse_decimal(item.get("total"))
            or _parse_decimal(item.get("price"))
            or _parse_decimal(item.get("subtotal"))
        )
        normalized_items.append(
            {
                "wc_product_id": wc_product_id,
                "line_item_id": item.get("id"),
                "sale_price_dkk": sale_price,
                "sale_date": sale_date,
            }
        )

    return normalized_items


async def _apply_sale_items(
    *,
    db: AsyncSession,
    sale_items: list[dict[str, Any]],
    payload: dict[str, Any],
    topic: str | None,
    delivery_id: str | None,
    order_id: Any,
    notes: str,
) -> tuple[int, int]:
    processed = 0
    ignored = 0

    for sale_item in sale_items:
        wc_product_id = sale_item["wc_product_id"]
        product = await db.scalar(select(Product).where(Product.woocommerce_product_id == wc_product_id))

        if not product:
            ignored += 1
            continue

        request_payload = {
            "topic": topic,
            "delivery_id": delivery_id,
            "order_id": order_id,
            "line_item_id": sale_item.get("line_item_id"),
            "wc_product_id": wc_product_id,
        }

        if product.status == ProductStatusEnum.SOLD:
            db.add(
                WooCommerceSyncLog(
                    product_id=product.id,
                    action="sold_on_site",
                    wc_product_id=wc_product_id,
                    request_payload=jsonable_encoder(request_payload),
                    response_payload=None,
                    status="success",
                    error_message="already_sold",
                )
            )
            ignored += 1
            continue

        old_snapshot = {
            "status": product.status,
            "sale_date": product.sale_date,
            "sale_price_dkk": product.sale_price_dkk,
            "profit_dkk": product.profit_dkk,
            "is_published_to_site": product.is_published_to_site,
        }

        product.status = ProductStatusEnum.SOLD
        product.sale_date = sale_item.get("sale_date") or utc_now()
        if sale_item.get("sale_price_dkk") is not None:
            product.sale_price_dkk = sale_item["sale_price_dkk"]
        product.profit_dkk = (
            quantize_2(product.sale_price_dkk - product.purchase_price_dkk)
            if product.sale_price_dkk is not None
            else None
        )
        product.is_published_to_site = False
        product.published_at = None

        db.add(
            ProductHistory(
                product_id=product.id,
                action="sold",
                performed_by=None,
                old_value=jsonable_encoder(old_snapshot),
                new_value=jsonable_encoder(
                    {
                        "status": product.status,
                        "sale_date": product.sale_date,
                        "sale_price_dkk": product.sale_price_dkk,
                        "profit_dkk": product.profit_dkk,
                        "is_published_to_site": product.is_published_to_site,
                    }
                ),
                notes=notes,
            )
        )
        db.add(
            WooCommerceSyncLog(
                product_id=product.id,
                action="sold_on_site",
                wc_product_id=wc_product_id,
                request_payload=jsonable_encoder(request_payload),
                response_payload=jsonable_encoder(payload),
                status="success",
                error_message=None,
            )
        )

        processed += 1

    return processed, ignored


@router.post("/woocommerce")
async def woocommerce_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()

    raw_body = await request.body()
    if not raw_body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook payload boş")

    signature_header = request.headers.get("x-wc-webhook-signature")
    if not _verify_wc_signature(raw_body, signature_header, settings.woocommerce_webhook_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Webhook imzası geçersiz")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Geçersiz JSON payload") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook payload formatı geçersiz")

    topic = request.headers.get("x-wc-webhook-topic")
    delivery_id = request.headers.get("x-wc-webhook-delivery-id")
    order_id = payload.get("id")

    sale_items = _extract_order_sale_items(payload)
    if not sale_items:
        return {
            "received": True,
            "topic": topic,
            "order_id": order_id,
            "processed": 0,
            "ignored": 0,
            "reason": "satışa uygun line item bulunamadı",
        }

    processed, ignored = await _apply_sale_items(
        db=db,
        sale_items=sale_items,
        payload=payload,
        topic=topic,
        delivery_id=delivery_id,
        order_id=order_id,
        notes="WooCommerce webhook ile satış işlendi",
    )

    await db.commit()

    return {
        "received": True,
        "topic": topic,
        "order_id": order_id,
        "processed": processed,
        "ignored": ignored,
    }


@router.post("/woocommerce/sync-recent")
async def woocommerce_sync_recent(
    days: int = 7,
    per_page: int = 50,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    svc = WooCommerceService()
    orders = await svc.fetch_recent_orders(days=max(1, min(days, 90)), per_page=max(1, min(per_page, 100)))

    total_orders = 0
    total_items = 0
    processed_total = 0
    ignored_total = 0

    for order in orders:
        if not isinstance(order, dict):
            continue
        total_orders += 1
        sale_items = _extract_order_sale_items(order)
        if not sale_items:
            continue
        total_items += len(sale_items)

        processed, ignored = await _apply_sale_items(
            db=db,
            sale_items=sale_items,
            payload=order,
            topic="manual_sync",
            delivery_id=None,
            order_id=order.get("id"),
            notes="WooCommerce manuel senkron ile satış işlendi",
        )
        processed_total += processed
        ignored_total += ignored

    await db.commit()

    return {
        "ok": True,
        "orders_scanned": total_orders,
        "line_items_scanned": total_items,
        "processed": processed_total,
        "ignored": ignored_total,
    }
