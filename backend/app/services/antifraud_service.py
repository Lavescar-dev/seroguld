from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status

from app.schemas.antifraud import (
    AntiFraudCustomerHistoryOut,
    AntiFraudOrdersResponse,
    AntiFraudOrderOut,
    AntiFraudSummaryOut,
)
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
    _has_manual_override,
    _is_blacklisted,
    _is_truthy,
    _is_whitelisted,
    _parse_wc_datetime,
    _resolve_effective_risk,
    _resolve_risk_level,
    _resolve_risk_score,
    _to_decimal,
    _to_int,
    _translate_known_note_tr,
)
from app.services.woocommerce import WooCommerceService
from app.utils.helpers import utc_now


# O11 — In-memory cache (5 dakika TTL). Process-singleton.
_ORDERS_CACHE_TTL = timedelta(minutes=5)
_orders_cache: dict[str, tuple[list[dict[str, Any]], datetime]] = {}


def _orders_cache_key(days: int, per_page: int) -> str:
    return f"d={days};p={per_page}"


def _orders_cache_get(key: str) -> list[dict[str, Any]] | None:
    entry = _orders_cache.get(key)
    if entry is None:
        return None
    rows, expires_at = entry
    if datetime.now(timezone.utc) >= expires_at:
        _orders_cache.pop(key, None)
        return None
    return rows


def _orders_cache_set(key: str, rows: list[dict[str, Any]]) -> None:
    _orders_cache[key] = (rows, datetime.now(timezone.utc) + _ORDERS_CACHE_TTL)


def _orders_cache_invalidate() -> None:
    """Manuel override sonrası UI'nın taze veri görmesi için."""
    _orders_cache.clear()


_RETRY_MAX_ATTEMPTS = 3
_RETRY_BASE_DELAY = 0.4


async def _fetch_recent_orders_with_retry(
    service: WooCommerceService,
    *,
    days: int,
    per_page: int,
    use_cache: bool = True,
) -> list[dict[str, Any]]:
    """O11 cache + O12 exponential backoff retry."""
    cache_key = _orders_cache_key(days, per_page)
    if use_cache:
        cached = _orders_cache_get(cache_key)
        if cached is not None:
            return cached

    last_exc: Exception | None = None
    for attempt in range(_RETRY_MAX_ATTEMPTS):
        try:
            rows = await service.fetch_recent_orders(
                days=days,
                per_page=per_page,
                statuses="processing,completed,on-hold,pending,failed,cancelled,refunded",
            )
            _orders_cache_set(cache_key, rows)
            return rows
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < _RETRY_MAX_ATTEMPTS - 1:
                delay = _RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 0.2)
                await asyncio.sleep(delay)
                continue

    if isinstance(last_exc, HTTPException):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Woo sipariş verisi alınamadı. Lütfen birkaç saniye sonra tekrar deneyin. "
                f"Ayrıntı: {last_exc.detail}"
            ),
        ) from last_exc
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Woo sipariş verisi alınamadı. ({last_exc})",
    )


# O6 — Customer history pre-empt: ham orders üzerinden in-place hesaplama
def _compute_customer_history(
    order: dict[str, Any],
    all_orders: list[dict[str, Any]],
) -> AntiFraudCustomerHistoryOut:
    """Bu order'ın müşterisinin geçmiş istatistiklerini çıkarır.

    Eşleştirme önce `customer_id` (Woo registered user), sonra billing email.
    """
    customer_id = _to_int(order.get("customer_id")) or 0
    billing = order.get("billing") or {}
    email = str(billing.get("email") or "").strip().lower() if isinstance(billing, dict) else ""
    matched_by: str | None = None
    matches: list[dict[str, Any]] = []

    if customer_id > 0:
        for candidate in all_orders:
            cid = _to_int(candidate.get("customer_id")) or 0
            if cid > 0 and cid == customer_id and candidate.get("id") != order.get("id"):
                matches.append(candidate)
        if matches:
            matched_by = "customer_id"

    if not matches and email:
        for candidate in all_orders:
            cb = candidate.get("billing") or {}
            cb_email = str((cb.get("email") if isinstance(cb, dict) else "") or "").strip().lower()
            if cb_email == email and candidate.get("id") != order.get("id"):
                matches.append(candidate)
        if matches:
            matched_by = "email"

    total = len(matches)
    successful = sum(1 for m in matches if str(m.get("status") or "").lower() in {"completed", "processing"})
    cancelled = sum(1 for m in matches if str(m.get("status") or "").lower() in {"cancelled", "refunded"})
    failed = sum(1 for m in matches if str(m.get("status") or "").lower() == "failed")

    dates = [
        _parse_wc_datetime(m.get("date_created_gmt")) or _parse_wc_datetime(m.get("date_created"))
        for m in matches
    ]
    dates = [d for d in dates if d is not None]
    first_at = min(dates) if dates else None
    last_at = max(dates) if dates else None

    # known_safe: 3+ başarılı ve son siparişi son 365 gün içinde
    known_safe = False
    if successful >= 3 and last_at is not None:
        delta = datetime.now(timezone.utc) - last_at
        if delta.days <= 365:
            known_safe = True

    return AntiFraudCustomerHistoryOut(
        customer_id=customer_id or None,
        total_orders=total,
        successful_orders=successful,
        cancelled_orders=cancelled,
        failed_orders=failed,
        first_order_at=first_at,
        last_order_at=last_at,
        known_safe=known_safe,
        matched_by=matched_by,
    )


async def _build_order_item(
    service: WooCommerceService,
    *,
    order: dict[str, Any],
    include_notes: bool,
    notes_per_order: int,
    detail_mode: bool = True,
    all_orders: list[dict[str, Any]] | None = None,
) -> AntiFraudOrderOut:
    risk_meta = _extract_risk_meta(order)
    raw_risk_score = _resolve_risk_score(risk_meta)

    # O6 — Müşteri geçmişi (varsa)
    history: AntiFraudCustomerHistoryOut | None = None
    if all_orders:
        history = _compute_customer_history(order, all_orders)
    history_dict = (
        {
            "known_safe": history.known_safe if history else False,
            "successful_orders": history.successful_orders if history else 0,
        }
        if history
        else None
    )

    # O3+O5+O7+O9 — Effective level resolver (whitelist/blacklist/override/history zinciri)
    effective_level, effective_score, override_reasons = _resolve_effective_risk(
        score=raw_risk_score,
        risk_meta=risk_meta,
        customer_history=history_dict,
    )

    # Skor kaynağı tespiti (O8)
    score_source: str | None
    if _has_manual_override(risk_meta)[0]:
        score_source = "manual_override"
    elif _is_blacklisted(risk_meta):
        score_source = "blacklist"
    elif _is_whitelisted(risk_meta):
        score_source = "whitelist"
    elif history and history.known_safe and raw_risk_score is not None and raw_risk_score >= 35:
        score_source = "known_customer"
    elif raw_risk_score is None:
        score_source = "unknown"
    else:
        # OPMC önce; AI sonra
        has_opmc = any(item.key.lower() == "wc_af_score" for item in risk_meta)
        has_ai = any(item.key.lower() == "_ai_risk_score" for item in risk_meta)
        score_source = "opmc" if has_opmc else ("ai" if has_ai else "other")

    requires_manual_review = _extract_manual_review(effective_level, risk_meta)

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
        risk_level=effective_level,
        risk_score=effective_score,
        notes=notes_human,
        billing_country=billing_country,
        shipping_country=shipping_country,
    )
    risk_meta_human = _build_human_meta_fields(risk_meta, ai_explanations_human) if detail_mode else []
    whitelist_action_human = _extract_whitelist_action_human(risk_meta) if detail_mode else None

    has_manual = _has_manual_override(risk_meta)[0]
    is_white = _is_whitelisted(risk_meta)
    is_black = _is_blacklisted(risk_meta)

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
        customer_id=(_to_int(order.get("customer_id")) or 0) or None,
        ip_address=str(order.get("customer_ip_address") or "").strip() or None,
        billing_country=billing_country,
        billing_city=billing_city,
        shipping_country=shipping_country,
        shipping_city=shipping_city,
        risk_score=effective_score,
        ai_risk_score=ai_risk_score,
        opmc_risk_score=opmc_risk_score,
        risk_score_source=score_source,
        raw_risk_score=raw_risk_score,
        risk_level=effective_level,
        requires_manual_review=requires_manual_review,
        risk_meta=(risk_meta if detail_mode else []),
        risk_reasons=risk_reasons,
        notes=(notes if detail_mode else []),
        notes_human=notes_human,
        ai_explanations_human=ai_explanations_human,
        risk_meta_human=risk_meta_human,
        whitelist_action_human=whitelist_action_human,
        override_reasons=override_reasons,
        is_whitelisted=is_white,
        is_blacklisted=is_black,
        has_manual_override=has_manual,
        customer_history=history,
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
            all_orders=orders,
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

    # O6 — Customer history için son 365 gün penceresi
    try:
        history_orders = await _fetch_recent_orders_with_retry(
            service, days=365, per_page=100, use_cache=True
        )
    except Exception:
        history_orders = []

    return await _build_order_item(
        service,
        order=order,
        include_notes=include_notes,
        notes_per_order=notes_per_order,
        detail_mode=True,
        all_orders=history_orders,
    )


# O9 — Manuel override + audit (Woo order meta_data'sına yazılır)
async def set_antifraud_manual_override(
    *,
    order_id: int,
    level: str,
    reason: str | None,
    actor_email: str | None,
) -> AntiFraudOrderOut:
    """Operatör false-positive flag'ler veya manuel risk seviyesi atar.

    Woo'da `_wc_af_manual_override` meta key'ine JSON yazıyoruz:
      {"level": "low", "by": "user@example", "at": "ISO ts", "reason": "..."}
    """
    if level not in {"low", "medium", "high"}:
        raise HTTPException(status_code=400, detail="Geçersiz seviye (low|medium|high)")
    service = WooCommerceService()
    try:
        order = await service.fetch_order(order_id=order_id)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(status_code=404, detail="Sipariş bulunamadı.") from exc
        raise
    override_payload = {
        "level": level,
        "by": actor_email or "system",
        "at": utc_now().isoformat(),
        "reason": (reason or "")[:500] or None,
    }
    try:
        await service.update_order_meta(
            order_id=order_id,
            meta_key="_wc_af_manual_override",
            value=override_payload,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Woo meta yazılamadı: {exc}") from exc

    _orders_cache_invalidate()  # UI taze veri görsün
    # Order'ı yeniden fetch et + build et
    refreshed = await service.fetch_order(order_id=order_id)
    return await _build_order_item(
        service,
        order=refreshed,
        include_notes=True,
        notes_per_order=10,
        detail_mode=True,
    )
