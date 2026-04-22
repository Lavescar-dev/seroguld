from __future__ import annotations

import asyncio
from typing import Any

from fastapi import HTTPException, status

from app.schemas.antifraud import AntiFraudOrdersResponse, AntiFraudOrderOut, AntiFraudSummaryOut
from app.services.antifraud_helpers import (
    _build_human_meta_fields,
    _build_risk_reasons,
    _extract_ai_explanations,
    _extract_cities,
    _extract_countries,
    _extract_customer_name,
    _extract_failed_rules,
    _extract_manual_review,
    _extract_named_score,
    _extract_risk_meta,
    _extract_score_from_value,
    _extract_whitelist_action_human,
    _filter_note_text,
    _is_truthy,
    _parse_wc_datetime,
    _resolve_risk_level,
    _resolve_risk_score,
    _to_decimal,
    _to_int,
    _translate_known_note_tr,
)
from app.services.woocommerce import WooCommerceService
from app.utils.helpers import utc_now


async def _fetch_recent_orders_with_retry(
    service: WooCommerceService,
    *,
    days: int,
    per_page: int,
) -> list[dict[str, Any]]:
    try:
        return await service.fetch_recent_orders(
            days=days,
            per_page=per_page,
            statuses="processing,completed,on-hold,pending,failed,cancelled,refunded",
        )
    except Exception:
        await asyncio.sleep(0.35)
        try:
            return await service.fetch_recent_orders(
                days=days,
                per_page=per_page,
                statuses="processing,completed,on-hold,pending,failed,cancelled,refunded",
            )
        except HTTPException as retry_exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Woo sipariş verisi alınamadı. Lütfen birkaç saniye sonra tekrar deneyin. "
                    f"Ayrıntı: {retry_exc.detail}"
                ),
            ) from retry_exc
        except Exception as retry_exc:  # pragma: no cover - defensive fallback
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Woo sipariş verisi alınamadı. Lütfen tekrar deneyin. ({retry_exc})",
            ) from retry_exc


async def _build_order_item(
    service: WooCommerceService,
    *,
    order: dict[str, Any],
    include_notes: bool,
    notes_per_order: int,
    detail_mode: bool = True,
) -> AntiFraudOrderOut:
    risk_meta = _extract_risk_meta(order)
    risk_score = _resolve_risk_score(risk_meta)
    risk_level = _resolve_risk_level(risk_score)
    requires_manual_review = _extract_manual_review(risk_level, risk_meta)

    notes: list[str] = []
    if detail_mode and include_notes:
        order_id = _to_int(order.get("id")) or 0
        if order_id > 0:
            try:
                raw_notes = await service.fetch_order_notes(order_id=order_id, per_page=notes_per_order)
            except Exception:
                raw_notes = []
            for note in raw_notes:
                if not isinstance(note, dict):
                    continue
                text = _filter_note_text(note.get("note"))
                if text:
                    notes.append(text)

    notes_human = [_translate_known_note_tr(note) for note in notes] if detail_mode else []
    ai_explanations_human = _extract_ai_explanations(risk_meta) if detail_mode else []

    billing = order.get("billing") if isinstance(order.get("billing"), dict) else {}
    billing_email = str((billing.get("email") if isinstance(billing, dict) else "") or "").strip() or None
    billing_country, shipping_country = _extract_countries(order)
    billing_city, shipping_city = _extract_cities(order)
    ai_risk_score = _extract_named_score(risk_meta, "_ai_risk_score")
    opmc_risk_score = _extract_named_score(risk_meta, "wc_af_score")
    risk_reasons = _build_risk_reasons(
        risk_meta=risk_meta,
        risk_level=risk_level,
        risk_score=risk_score,
        notes=notes_human,
        billing_country=billing_country,
        shipping_country=shipping_country,
    )
    risk_meta_human = _build_human_meta_fields(risk_meta, ai_explanations_human) if detail_mode else []
    whitelist_action_human = _extract_whitelist_action_human(risk_meta) if detail_mode else None

    return AntiFraudOrderOut(
        order_id=_to_int(order.get("id")) or 0,
        order_number=str(order.get("number") or order.get("id") or ""),
        status=str(order.get("status") or ""),
        total=_to_decimal(order.get("total")),
        currency=str(order.get("currency") or "").strip() or None,
        date_created=_parse_wc_datetime(order.get("date_created_gmt")) or _parse_wc_datetime(order.get("date_created")),
        payment_method=str(order.get("payment_method_title") or order.get("payment_method") or "").strip() or None,
        customer_name=_extract_customer_name(order),
        customer_email=billing_email,
        ip_address=str(order.get("customer_ip_address") or "").strip() or None,
        billing_country=billing_country,
        billing_city=billing_city,
        shipping_country=shipping_country,
        shipping_city=shipping_city,
        risk_score=risk_score,
        ai_risk_score=ai_risk_score,
        opmc_risk_score=opmc_risk_score,
        risk_level=risk_level,
        requires_manual_review=requires_manual_review,
        risk_meta=(risk_meta if detail_mode else []),
        risk_reasons=risk_reasons,
        notes=(notes if detail_mode else []),
        notes_human=notes_human,
        ai_explanations_human=ai_explanations_human,
        risk_meta_human=risk_meta_human,
        whitelist_action_human=whitelist_action_human,
    )


async def list_recent_orders_antifraud(
    *,
    days: int,
    per_page: int,
    include_notes: bool,
    notes_per_order: int,
    detail_mode: bool,
) -> AntiFraudOrdersResponse:
    service = WooCommerceService()
    orders = await _fetch_recent_orders_with_retry(service, days=days, per_page=per_page)

    items: list[AntiFraudOrderOut] = []
    high = medium = low = unknown = manual = 0

    for order in orders:
        if not isinstance(order, dict):
            continue
        item = await _build_order_item(
            service,
            order=order,
            include_notes=include_notes,
            notes_per_order=notes_per_order,
            detail_mode=detail_mode,
        )
        items.append(item)

        if item.risk_level == "high":
            high += 1
        elif item.risk_level == "medium":
            medium += 1
        elif item.risk_level == "low":
            low += 1
        else:
            unknown += 1
        if item.requires_manual_review:
            manual += 1

    summary = AntiFraudSummaryOut(
        total_orders=len(items),
        high_risk_count=high,
        medium_risk_count=medium,
        low_risk_count=low,
        unknown_risk_count=unknown,
        manual_review_count=manual,
    )

    return AntiFraudOrdersResponse(
        source="WooCommerce + OPMC meta/not",
        generated_at=utc_now(),
        summary=summary,
        items=items,
    )


async def get_antifraud_order_detail(
    *,
    order_id: int,
    include_notes: bool,
    notes_per_order: int,
) -> AntiFraudOrderOut:
    service = WooCommerceService()
    try:
        order = await service.fetch_order(order_id=order_id)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sipariş bulunamadı.") from exc
        raise

    return await _build_order_item(
        service,
        order=order,
        include_notes=include_notes,
        notes_per_order=notes_per_order,
        detail_mode=True,
    )
