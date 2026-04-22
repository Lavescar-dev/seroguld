from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import re
from typing import Any

from fastapi import HTTPException, status
from app.schemas.antifraud import (
    AntiFraudHumanFieldOut,
    AntiFraudOrdersResponse,
    AntiFraudOrderOut,
    AntiFraudRiskMetaOut,
    AntiFraudRiskReasonOut,
    AntiFraudSummaryOut,
)
from app.services.woocommerce import WooCommerceService
from app.utils.helpers import utc_now

_RISK_META_KEYWORDS = ("fraud", "risk", "opmc", "anti", "wc_af", "whitelist", "_ai_")
_RISK_NOTE_KEYWORDS = ("fraud", "risk", "anti-fraud", "antifraud", "whitelist", "manual review")
_RISK_LEVEL_LABELS_TR = {
    "high": "Yüksek",
    "medium": "Orta",
    "low": "Düşük",
    "unknown": "Belirsiz",
}
_FAILED_RULE_LABELS_TR: dict[str, str] = {
    "free_email": "E-posta ücretsiz sağlayıcıda (risk sinyali).",
    "high_amount": "Sipariş tutarı tanımlı limitin üzerinde.",
    "billing_phone_matches_billing_country": "Fatura telefon numarası ülke ile uyuşmuyor.",
    "shipping_phone_matches_shipping_country": "Teslimat telefon numarası ülke ile uyuşmuyor.",
    "billing_shipping_country_mismatch": "Fatura ülkesi ve teslimat ülkesi farklı.",
    "billing_shipping_name_mismatch": "Fatura adı ve teslimat adı farklı.",
    "billing_shipping_address_mismatch": "Fatura adresi ve teslimat adresi farklı.",
    "ip_country_mismatch": "IP ülkesi ile sipariş ülkesi uyuşmuyor.",
}
_META_LABELS_TR: dict[str, str] = {
    "_wc_af_waiting": "Manuel İnceleme Kuyruğu",
    "wc_af_score": "OPMC Risk Skoru",
    "_ai_risk_score": "AI Risk Skoru",
    "_ai_explanations": "AI Açıklamaları",
    "whitelist_action": "Beyaz Liste Eylemi",
    "_wc_af_recommended_status": "OPMC Önerilen Durum",
    "wc_af_failed_rules": "Tetiklenen OPMC Kuralları",
    "_wc_af_ip_multiple_data": "IP Sinyali",
}
_WHITELIST_ACTIONS_TR: dict[str, str] = {
    "user_payment_method_whitelisted": "Ödeme yöntemi beyaz listede.",
    "user_ip_whitelisted": "IP adresi beyaz listede.",
    "user_email_whitelisted": "E-posta beyaz listede.",
}


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    clean = text.replace(",", ".")
    try:
        return Decimal(clean)
    except InvalidOperation:
        return None


def _parse_wc_datetime(raw: Any) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    candidate = raw.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _strip_code_fence(text: str) -> str:
    match = re.match(r"^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$", text.strip())
    if match:
        return match.group(1).strip()
    return text.strip()


def _extract_score_from_value(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(float(value)))
    if isinstance(value, dict):
        for key in ("risk_score", "score", "wc_af_score"):
            if key in value:
                nested = _extract_score_from_value(value.get(key))
                if nested is not None:
                    return nested
        for nested_value in value.values():
            nested = _extract_score_from_value(nested_value)
            if nested is not None:
                return nested
        return None
    if isinstance(value, list):
        for item in value:
            nested = _extract_score_from_value(item)
            if nested is not None:
                return nested
        return None

    text = _strip_code_fence(str(value))
    if not text:
        return None

    try:
        loaded = json.loads(text)
        nested = _extract_score_from_value(loaded)
        if nested is not None:
            return nested
    except Exception:
        pass

    match = re.search(r"(-?\d+(?:[.,]\d+)?)", text)
    if not match:
        return None
    try:
        return int(round(float(match.group(1).replace(",", "."))))
    except ValueError:
        return None


def _is_truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "on", "y"}


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _extract_risk_meta(order: dict[str, Any]) -> list[AntiFraudRiskMetaOut]:
    result: list[AntiFraudRiskMetaOut] = []
    for item in order.get("meta_data") or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if not key:
            continue
        lower = key.lower()
        if not any(token in lower for token in _RISK_META_KEYWORDS):
            continue
        result.append(
            AntiFraudRiskMetaOut(
                key=key,
                value=item.get("value"),
            )
        )
    return result


def _resolve_risk_score(risk_meta: list[AntiFraudRiskMetaOut]) -> int | None:
    candidates: list[tuple[int, int]] = []
    for item in risk_meta:
        lower = item.key.lower()
        score = _extract_score_from_value(item.value)
        if score is None:
            continue
        if lower == "_ai_risk_score":
            priority = 100
        elif lower == "wc_af_score":
            priority = 90
        elif "risk_score" in lower:
            priority = 85
        elif "score" in lower:
            priority = 80
        else:
            priority = 60
        candidates.append((priority, score))
    if not candidates:
        return None
    candidates.sort(key=lambda entry: entry[0], reverse=True)
    return candidates[0][1]


def _resolve_risk_level(score: int | None) -> str:
    if score is None:
        return "unknown"
    if score >= 70:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def _extract_customer_name(order: dict[str, Any]) -> str | None:
    billing = order.get("billing") if isinstance(order.get("billing"), dict) else {}
    shipping = order.get("shipping") if isinstance(order.get("shipping"), dict) else {}
    first = str((billing.get("first_name") if isinstance(billing, dict) else "") or "").strip()
    last = str((billing.get("last_name") if isinstance(billing, dict) else "") or "").strip()
    if not (first or last):
        first = str((shipping.get("first_name") if isinstance(shipping, dict) else "") or "").strip()
        last = str((shipping.get("last_name") if isinstance(shipping, dict) else "") or "").strip()
    name = " ".join(part for part in [first, last] if part).strip()
    return name or None


def _extract_countries(order: dict[str, Any]) -> tuple[str | None, str | None]:
    billing = order.get("billing") if isinstance(order.get("billing"), dict) else {}
    shipping = order.get("shipping") if isinstance(order.get("shipping"), dict) else {}
    billing_country = str((billing.get("country") if isinstance(billing, dict) else "") or "").strip() or None
    shipping_country = str((shipping.get("country") if isinstance(shipping, dict) else "") or "").strip() or None
    return billing_country, shipping_country


def _extract_cities(order: dict[str, Any]) -> tuple[str | None, str | None]:
    billing = order.get("billing") if isinstance(order.get("billing"), dict) else {}
    shipping = order.get("shipping") if isinstance(order.get("shipping"), dict) else {}
    billing_city = str((billing.get("city") if isinstance(billing, dict) else "") or "").strip() or None
    shipping_city = str((shipping.get("city") if isinstance(shipping, dict) else "") or "").strip() or None
    return billing_city, shipping_city


def _extract_named_score(
    risk_meta: list[AntiFraudRiskMetaOut],
    *keys: str,
) -> int | None:
    wanted = {key.strip().lower() for key in keys if key.strip()}
    if not wanted:
        return None
    for item in risk_meta:
        if item.key.lower().strip() not in wanted:
            continue
        score = _extract_score_from_value(item.value)
        if score is not None:
            return score
    return None


def _extract_whitelist_action_human(risk_meta: list[AntiFraudRiskMetaOut]) -> str | None:
    for item in risk_meta:
        if item.key.lower().strip() != "whitelist_action":
            continue
        action = str(item.value or "").strip()
        if not action:
            return None
        return _WHITELIST_ACTIONS_TR.get(action, action)
    return None


def _extract_manual_review(risk_level: str, risk_meta: list[AntiFraudRiskMetaOut]) -> bool:
    if risk_level == "high":
        return True
    for item in risk_meta:
        lower = item.key.lower()
        if lower in {"_wc_af_waiting", "manual_review", "requires_manual_review"} and _is_truthy(item.value):
            return True
    return False


def _filter_note_text(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    text = re.sub(r"\s+", " ", text)
    lower = text.lower()
    if not any(token in lower for token in _RISK_NOTE_KEYWORDS):
        return None
    return text


def _safe_json_loads(value: Any) -> Any:
    if not isinstance(value, str):
        return None
    text = _strip_code_fence(value)
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def _compact_text(value: Any, *, max_len: int = 240) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= max_len:
        return text
    return f"{text[: max_len - 3]}..."


def _friendly_meta_label(key: str) -> str:
    normalized = key.strip().lower()
    return _META_LABELS_TR.get(normalized, key)


def _translate_known_note_tr(note: str) -> str:
    text = re.sub(r"\s+", " ", str(note or "")).strip()
    lower = text.lower()
    if lower.startswith("order fraud checks skipped due to whitelisted payment method:"):
        method = text.split(":", 1)[1].strip() if ":" in text else "-"
        return f"Ödeme yöntemi beyaz listede olduğu için dolandırıcılık kontrolleri atlandı: {method}"
    return text


def _translate_ai_sentence_tr(sentence: str) -> str:
    text = re.sub(r"\s+", " ", sentence.strip())
    replacements = {
        "Consistent names and addresses:": "İsim ve adres tutarlılığı:",
        "The shipping and billing addresses match": "Teslimat ve fatura adresleri eşleşiyor",
        "indicating that the customer is likely the legitimate owner of the payment method.": "bu da müşterinin ödeme yönteminin gerçek sahibi olma olasılığını artırıyor.",
        "Local payment method:": "Yerel ödeme yöntemi:",
        "The use of MobilePay is common in Denmark": "MobilePay'in Danimarka'da yaygın kullanılması",
        "and aligns with the customers location,": "ve müşteri lokasyonuyla uyumlu olması",
        "which reduces risk.": "risk seviyesini düşürüyor.",
        "Moderate order value:": "Sipariş tutarı değerlendirmesi:",
        "The order amount, although significant, is not excessively high, which may indicate a genuine purchase.": "Sipariş tutarı dikkat çekse de aşırı yüksek değil; bu da işlemin gerçek olabileceğine işaret eder.",
        "IP address scrutiny:": "IP adresi değerlendirmesi:",
        "The IP address appears to originate from Denmark, which aligns with the shipping address,": "IP adresi Danimarka kaynaklı görünüyor ve teslimat adresiyle uyumlu,",
        "further supporting legitimacy.": "işlemin meşru olma ihtimalini destekliyor.",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    if any(ch.isalpha() for ch in text):
        text = text.replace("customer", "müşteri")
        text = text.replace("order", "sipariş")
        text = text.replace("risk", "risk")
    return text


def _extract_ai_explanations(risk_meta: list[AntiFraudRiskMetaOut]) -> list[str]:
    lines: list[str] = []
    for item in risk_meta:
        if item.key.lower().strip() != "_ai_explanations":
            continue
        candidates: list[Any]
        if isinstance(item.value, list):
            candidates = item.value
        else:
            candidates = [item.value]

        for candidate in candidates:
            raw = re.sub(r"\\n", "\n", str(candidate or ""))
            raw = _strip_code_fence(raw)
            section_match = re.search(r"explanation\s*:\s*\[(.*?)\]", raw, flags=re.IGNORECASE | re.DOTALL)
            section = section_match.group(1) if section_match else raw
            parts = [chunk.strip(" \n\t,") for chunk in re.split(r",\s*\n", section) if chunk.strip()]
            if not parts and section.strip():
                parts = [section.strip()]
            for part in parts:
                translated = _translate_ai_sentence_tr(part)
                if translated:
                    lines.append(translated)

    dedup: list[str] = []
    seen: set[str] = set()
    for line in lines:
        normalized = line.lower().strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        dedup.append(line)
    return dedup[:8]


def _friendly_meta_value(
    *,
    key: str,
    value: Any,
    ai_explanations_human: list[str],
) -> str:
    normalized = key.strip().lower()
    if normalized == "_wc_af_waiting":
        return "Evet (manuel inceleme bekliyor)" if _is_truthy(value) else "Hayır"
    if normalized in {"wc_af_score", "_ai_risk_score"}:
        score = _extract_score_from_value(value)
        return str(score) if score is not None else _compact_text(value, max_len=80)
    if normalized == "whitelist_action":
        action = str(value or "").strip()
        return _WHITELIST_ACTIONS_TR.get(action, action or "-")
    if normalized == "_wc_af_recommended_status":
        status_raw = str(value or "").strip().lower()
        status_map = {
            "processing": "İşleniyor",
            "completed": "Tamamlandı",
            "on-hold": "Beklemede",
            "pending": "Ödeme Bekliyor",
            "failed": "Başarısız",
            "cancelled": "İptal",
            "refunded": "İade",
        }
        return status_map.get(status_raw, status_raw or "-")
    if normalized == "wc_af_failed_rules":
        rules = _extract_failed_rules([AntiFraudRiskMetaOut(key=key, value=value)])
        if not rules:
            return "Kural bilgisi yok"
        translated = [_friendly_failed_rule_reason(rule_id, rule_label) for rule_id, rule_label in rules]
        return "; ".join(translated[:5])
    if normalized == "_ai_explanations":
        if ai_explanations_human:
            return f"{len(ai_explanations_human)} adet AI açıklaması"
        return "AI açıklaması yok"
    return _compact_text(value)


def _build_human_meta_fields(
    risk_meta: list[AntiFraudRiskMetaOut],
    ai_explanations_human: list[str],
) -> list[AntiFraudHumanFieldOut]:
    rows: list[AntiFraudHumanFieldOut] = []
    for item in risk_meta:
        rows.append(
            AntiFraudHumanFieldOut(
                key=item.key,
                label=_friendly_meta_label(item.key),
                value=_friendly_meta_value(
                    key=item.key,
                    value=item.value,
                    ai_explanations_human=ai_explanations_human,
                ),
            )
        )
    return rows


def _extract_failed_rules(risk_meta: list[AntiFraudRiskMetaOut]) -> list[tuple[str, str]]:
    extracted: list[tuple[str, str]] = []
    for item in risk_meta:
        if item.key.lower() != "wc_af_failed_rules":
            continue
        raw = item.value
        candidates: list[Any] = []
        if isinstance(raw, list):
            candidates = raw
        elif isinstance(raw, dict):
            candidates = [raw]
        elif isinstance(raw, str):
            parsed = _safe_json_loads(raw)
            if isinstance(parsed, list):
                candidates = parsed
            elif parsed is not None:
                candidates = [parsed]
            else:
                candidates = [raw]

        for candidate in candidates:
            payload = candidate
            if isinstance(payload, str):
                parsed = _safe_json_loads(payload)
                payload = parsed if isinstance(parsed, dict) else payload

            if isinstance(payload, dict):
                rule_id = str(payload.get("id") or "").strip()
                rule_label = str(payload.get("label") or "").strip()
            else:
                rule_id = ""
                rule_label = str(payload or "").strip()

            if not (rule_id or rule_label):
                continue
            extracted.append((rule_id, rule_label))

    return extracted


def _friendly_failed_rule_reason(rule_id: str, rule_label: str) -> str:
    normalized_id = rule_id.strip().lower()
    if normalized_id in _FAILED_RULE_LABELS_TR:
        return _FAILED_RULE_LABELS_TR[normalized_id]
    if rule_label.strip():
        return rule_label.strip()
    if normalized_id:
        return f"Kural tetiklendi: {normalized_id}"
    return "Kural tetiklendi."


def _append_reason(
    reasons: list[AntiFraudRiskReasonOut],
    *,
    seen_codes: set[str],
    code: str,
    reason: str,
) -> None:
    normalized_code = code.strip().lower()
    text = reason.strip()
    if not normalized_code or not text:
        return
    if normalized_code in seen_codes:
        return
    seen_codes.add(normalized_code)
    reasons.append(AntiFraudRiskReasonOut(code=normalized_code, reason=text))


def _build_risk_reasons(
    *,
    risk_meta: list[AntiFraudRiskMetaOut],
    risk_level: str,
    risk_score: int | None,
    notes: list[str],
    billing_country: str | None,
    shipping_country: str | None,
) -> list[AntiFraudRiskReasonOut]:
    reasons: list[AntiFraudRiskReasonOut] = []
    seen_codes: set[str] = set()

    if risk_score is not None:
        _append_reason(
            reasons,
            seen_codes=seen_codes,
            code="risk_score",
            reason=f"Toplam risk skoru: {risk_score}",
        )
    _append_reason(
        reasons,
        seen_codes=seen_codes,
        code=f"risk_level_{risk_level}",
        reason=f"Risk seviyesi: {_RISK_LEVEL_LABELS_TR.get(risk_level, risk_level)}",
    )

    for meta in risk_meta:
        key = meta.key.lower().strip()
        if key == "_wc_af_waiting" and _is_truthy(meta.value):
            _append_reason(
                reasons,
                seen_codes=seen_codes,
                code="manual_queue",
                reason="OPMC siparişi manuel inceleme kuyruğuna almış.",
            )
        elif key == "whitelist_action" and str(meta.value or "").strip():
            action = str(meta.value or "").strip()
            _append_reason(
                reasons,
                seen_codes=seen_codes,
                code="whitelist_action",
                reason=f"Beyaz liste eylemi: {_WHITELIST_ACTIONS_TR.get(action, action)}",
            )
        elif key == "_wc_af_recommended_status" and str(meta.value or "").strip():
            _append_reason(
                reasons,
                seen_codes=seen_codes,
                code="recommended_status",
                reason=f"OPMC önerilen durum: {str(meta.value).strip()}",
            )

    for idx, (rule_id, rule_label) in enumerate(_extract_failed_rules(risk_meta), start=1):
        reason = _friendly_failed_rule_reason(rule_id, rule_label)
        code = f"failed_rule_{rule_id or idx}"
        _append_reason(reasons, seen_codes=seen_codes, code=code, reason=reason)

    if (
        billing_country
        and shipping_country
        and billing_country.strip().upper() != shipping_country.strip().upper()
    ):
        _append_reason(
            reasons,
            seen_codes=seen_codes,
            code="country_mismatch",
            reason=f"Fatura ülkesi ({billing_country}) ve teslimat ülkesi ({shipping_country}) farklı.",
        )

    for idx, note in enumerate(notes[:3], start=1):
        _append_reason(
            reasons,
            seen_codes=seen_codes,
            code=f"risk_note_{idx}",
            reason=f"Risk notu: {note}",
        )

    if not reasons:
        _append_reason(
            reasons,
            seen_codes=seen_codes,
            code="no_explicit_reason",
            reason="Risk nedeni meta veride açık değil; detay için ham meta alanlarını kontrol edin.",
        )

    return reasons
