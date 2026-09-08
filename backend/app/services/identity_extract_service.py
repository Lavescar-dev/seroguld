"""Kimlik VLM çıkarma servisi (R1-B Tier 2) — bayraklı, strict JSON.

Akış: görüntü (data URL, bellek içi) → Tier 0 barkod (garantili CPR) →
Tier 2 vision-LLM strict json_schema → Tier 1 doğrulama → birleşik
IdentityExtractOut. Barkod CPR'ı VLM CPR'INI EZER (checksum'lı kaynak).

Güvenlik/GDPR: görüntü çıkarımdan hemen sonra atılır, diske YAZILMAZ,
log'a görüntü verisi girmez. Uç yalnız identity_extract_enabled=True ve
anahtar tanımlıyken VLM'e bağlanır; base_url boşsa openai_base_url
devralınır — AB-residency projesi aynı URL ile çalışır, Çin ucuna kimlik
verisi ASLA gönderilmez (docs/IDENTITY_VLM_DPIA_NOTE_TR.md).
"""
from __future__ import annotations

import base64
import logging
import re
from typing import Any

import httpx
from fastapi import HTTPException, status

from app.config import get_settings
from app.schemas.identity import (
    AIUsageOut,
    IdentityBarcodeOut,
    IdentityExtractOut,
    IdentityFieldOut,
)
from app.services.ai_service import build_ai_usage_summary
from app.services.identity_barcode_service import (
    IdentityBarcodeHit,
    decode_identity_barcode,
    parse_sundhedskort_barcode,
)
from app.utils.identity_validate import (
    REVIEW_NEEDS_REVIEW,
    REVIEW_VALIDATED,
    birthdate_cpr_consistent,
    dk_licence_number_ok,
    repair_numeric_confusables,
    review_for,
    validate_dk_cpr_soft,
    validate_tckn,
)

logger = logging.getLogger(__name__)

# VLM'e sorulan alanlar — şema IdentityExtractOut.fields sözlüğüyle birebir.
_IDENTITY_FIELDS = [
    "document_type",
    "full_name",
    "cpr_number",
    "birth_date",
    "doc_number",
    "country",
    "address",
    "postal_code",
    "city",
    "expiry_date",
]

_CONFIDENCE_KEYS = {
    "document_type": "document_type",
    "full_name": "full_name",
    "cpr_number": "cpr_number",
    "birth_date": "birth_date",
    "doc_number": "doc_number",
    "country": "country",
    "address": "address",
    "postal_code": "postal_code",
    "city": "city",
    "expiry_date": "expiry_date",
}


class IdentityExtractUnavailable(HTTPException):
    def __init__(self, detail: str = "Kimlik çıkarma servisi kapalı.") -> None:
        super().__init__(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


class IdentityExtractError(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)


def identity_capabilities() -> dict[str, Any]:
    settings = get_settings()
    model = (settings.identity_extract_model or "").strip() or settings.openai_model
    return {
        "extract_enabled": bool(
            settings.identity_extract_enabled and settings.openai_api_key.strip()
        ),
        "model": model if settings.identity_extract_enabled else None,
        "barcode_available": True,
    }


def _strict_response_format() -> dict[str, Any]:
    """OpenAI structured outputs: strict json_schema — serbest metin YOK."""
    properties: dict[str, Any] = {}
    for field in _IDENTITY_FIELDS:
        properties[field] = {
            "type": "object",
            "properties": {
                "value": {"type": ["string", "null"]},
                "confidence": {"type": ["number", "null"]},
            },
            "required": ["value", "confidence"],
            "additionalProperties": False,
        }
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "identity_fields",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "document_type": {
                        "type": ["string", "null"],
                        "enum": [
                            "sundhedskort",
                            "passport",
                            "driver_license",
                            "id_card",
                            "residence_permit",
                            "other",
                            None,
                        ],
                    },
                    "fields": {
                        "type": "object",
                        "properties": properties,
                        "required": _IDENTITY_FIELDS,
                        "additionalProperties": False,
                    },
                },
                "required": ["document_type", "fields"],
                "additionalProperties": False,
            },
        },
    }


def _system_prompt() -> str:
    return (
        "You read Nordic/Turkish identity documents (sundhedskort, passport, "
        "driver license, ID card) from a photo and return ONLY the JSON "
        "matching the schema. Read values EXACTLY as printed — never guess "
        "or normalize. Danish CPR is 10 digits (DDMMYYNNNN); a Turkish TCKN "
        "is 11 digits. Use null for fields not visible on this side. "
        "confidence is 0.0-1.0 for how clearly each value is printed."
    )


async def _post_chat(
    *, url: str, api_key: str, payload: dict[str, Any], timeout: float
) -> dict[str, Any]:
    """Tek chat-completions çağrısı — testler monkeypatch eder.

    Seam: birim testleri gerçek ağa çıkmadan tüm hata yollarını sürer.
    """
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=headers)
    if response.status_code >= 400:
        # Ham hata yukarı taşınır — sessiz yutma yok (proxy strict format
        # reddi gibi durumlar teşhis edilebilir olmalı).
        raise IdentityExtractError(
            f"Kimlik çıkarma servisi hata döndü ({response.status_code}): {response.text[:300]}"
        )
    return response.json()


def _decode_image_bytes(image_data_url: str, max_bytes: int) -> bytes:
    prefix = "base64,"
    idx = image_data_url.find(prefix)
    if idx < 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="image_data_url base64 payloadı taşımıyor.")
    raw_b64 = image_data_url[idx + len(prefix):]
    try:
        raw = base64.b64decode(raw_b64, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Görüntü base64 çözülemedi.") from exc
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Görüntü {(len(raw) / (1024 * 1024)):.1f} MB — üst sınır {(max_bytes / (1024 * 1024)):.0f} MB.",
        )
    return raw


def _validate_field(field: str, value: str) -> tuple[str, bool]:
    """Tier 1: alana özgü onarım + checksum. (onarılmuş değer, checksum_ok)"""
    cleaned = value.strip()
    if field in ("cpr_number",):
        digits = repair_numeric_confusables(cleaned)
        ok, _reason = validate_dk_cpr_soft(digits)
        if not ok:
            tckn_ok, _tckn_reason = validate_tckn(digits)
            if tckn_ok:
                return digits, True
        return digits, ok
    if field == "postal_code":
        digits = repair_numeric_confusables(cleaned)
        return digits, bool(re.fullmatch(r"\d{4}", digits))
    if field == "birth_date":
        return cleaned, bool(re.match(r"^\d{2}[-./]\d{2}[-./]\d{2,4}$|^\d{4}-\d{2}-\d{2}$", cleaned))
    if field == "expiry_date":
        return cleaned, bool(re.match(r"^\d{2}[-./]\d{2}[-./]\d{2,4}$|^\d{4}-\d{2}-\d{2}$", cleaned))
    if field == "doc_number":
        # Kørekort/pas: harf+rakam karışımı; yalnız biçim taraması.
        return cleaned.strip().upper(), bool(re.fullmatch(r"[A-Z0-9]{6,15}", cleaned.strip().upper())) or dk_licence_number_ok(cleaned)
    return cleaned, True


def _build_fields_from_vlm(
    payload_fields: dict[str, Any],
    *,
    threshold: float,
    cpr_for_consistency: str | None,
) -> dict[str, IdentityFieldOut]:
    out: dict[str, IdentityFieldOut] = {}
    for field in _IDENTITY_FIELDS:
        entry = payload_fields.get(field)
        raw_value = entry.get("value") if isinstance(entry, dict) else None
        confidence = entry.get("confidence") if isinstance(entry, dict) else None
        if not isinstance(raw_value, str) or not raw_value.strip():
            continue
        # Güven verilmediyse (null) ihtiyatlı taraf: needs_review.
        try:
            threshold_ok = confidence is not None and float(confidence) >= threshold
        except (TypeError, ValueError):
            threshold_ok = False
        repaired, checksum_ok = _validate_field(field, raw_value)
        if field == "birth_date" and checksum_ok:
            # VLM CPR'ı henüz barkodla düzeltilmemiş olabilir; barkod varsa
            # birleşme adımı son CPR'a göre yeniden değerlendirir.
            checksum_ok = birthdate_cpr_consistent(cpr_for_consistency, repaired)
        out[field] = IdentityFieldOut(
            value=repaired,
            review=(
                REVIEW_VALIDATED
                if threshold_ok and checksum_ok
                else REVIEW_NEEDS_REVIEW
            ),
            confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
        )
    return out


def _merge_barcode_cpr(
    fields: dict[str, IdentityFieldOut],
    barcode_hit: IdentityBarcodeHit,
    *,
    threshold: float,
) -> dict[str, IdentityFieldOut]:
    """Barkod CPR'ı VLM değerini ezer; verified ise validated, değilse
    review'a düşer (operatör onaylamadan yazma yoluna girmemeli)."""
    fields["cpr_number"] = IdentityFieldOut(
        value=barcode_hit.cpr,
        review=REVIEW_VALIDATED if barcode_hit.verified else REVIEW_NEEDS_REVIEW,
        confidence=1.0 if barcode_hit.verified else None,
    )
    # Doğum tarihi ARTIK barkod CPR'ına göre yeniden değerlendirilir — VLM
    # CPR'ı yanlış okuduysa birleşme öncesi haksız review düşüşü geri alınır.
    birth = fields.get("birth_date")
    if birth and birth.value:
        conf_ok = birth.confidence is not None and float(birth.confidence) >= threshold
        consistent = birthdate_cpr_consistent(barcode_hit.cpr, birth.value)
        fields["birth_date"] = birth.model_copy(
            update={"review": REVIEW_VALIDATED if (conf_ok and consistent) else REVIEW_NEEDS_REVIEW}
        )
    return fields


async def extract_identity(
    *,
    image_data_url: str,
    side: str = "front",
) -> IdentityExtractOut:
    """Üç katmanı çalıştırır; görüntü bellek içi işlenir, ASLA diske yazılmaz."""
    settings = get_settings()
    if not settings.identity_extract_enabled:
        raise IdentityExtractUnavailable("Kimlik VLM çıkarma kapalı (identity_extract_enabled=False).")
    api_key = settings.openai_api_key.strip()
    if not api_key:
        raise IdentityExtractUnavailable("OPENAI_API_KEY tanımlı değil — kimlik çıkarma kullanılamaz.")

    model = (settings.identity_extract_model or "").strip() or settings.openai_model
    base_url = (settings.identity_extract_base_url or "").strip().rstrip("/") or settings.openai_base_url.rstrip("/")
    threshold = float(settings.identity_extract_confidence_threshold)

    # ---- Tier 0: barkod (görüntü baytları bellek içinde; diske yazılmaz)
    warnings: list[str] = []
    barcode_raw = ""
    barcode_hit = None
    try:
        image_bytes = _decode_image_bytes(image_data_url, settings.identity_extract_max_image_bytes)
        barcode_hit = decode_identity_barcode(image_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Kimlik barkod katmanı atlandı: %s", type(exc).__name__)
        barcode_hit = parse_sundhedskort_barcode("")

    # ---- Tier 2: VLM strict JSON
    payload: dict[str, Any] = {
        "model": model,
        "response_format": _strict_response_format(),
        "messages": [
            {"role": "system", "content": _system_prompt()},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Document side: {side}. Extract the printed fields."},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
    }
    try:
        data = await _post_chat(
            url=f"{base_url}/chat/completions",
            api_key=api_key,
            payload=payload,
            timeout=max(5.0, float(settings.identity_extract_timeout_seconds)),
        )
    except IdentityExtractError:
        raise
    except Exception as exc:
        raise IdentityExtractError(f"Kimlik çıkarma servisine bağlanılamadı: {exc}") from exc

    choices = data.get("choices") or []
    if not choices:
        raise IdentityExtractError("Kimlik çıkarma cevabı boş döndü.")
    content = ((choices[0].get("message") or {}).get("content") or "").strip()
    if not content:
        raise IdentityExtractError("Kimlik çıkarma içeriği üretilemedi.")
    try:
        parsed = _loads_json(content)
    except Exception as exc:
        raise IdentityExtractError("Kimlik çıkarma cevabı JSON şemasına uymuyor.") from exc

    usage_summary = build_ai_usage_summary(data, fallback_model=model)

    doc_type = parsed.get("document_type")
    vlm_fields = parsed.get("fields") if isinstance(parsed.get("fields"), dict) else {}

    cpr_guess = ""
    cpr_entry = vlm_fields.get("cpr_number")
    if isinstance(cpr_entry, dict) and isinstance(cpr_entry.get("value"), str):
        cpr_guess = repair_numeric_confusables(cpr_entry["value"])

    fields = _build_fields_from_vlm(
        vlm_fields,
        threshold=threshold,
        cpr_for_consistency=cpr_guess or None,
    )

    source = "vlm"
    if barcode_hit is not None:
        barcode_raw = barcode_hit.cpr
        fields = _merge_barcode_cpr(fields, barcode_hit, threshold=threshold)
        source = "merged"
        if not barcode_hit.verified:
            warnings.append("Barkod CPR okundu ama kontrol karakteri doğrulanamadı.")
    else:
        warnings.append("Barkod okunamadı — CPR yalnız görüntüden okundu, kontrol edin.")

    return IdentityExtractOut(
        document_type=str(doc_type) if doc_type else None,
        fields=fields,
        barcode=IdentityBarcodeOut(cpr=barcode_raw, verified=barcode_hit.verified) if barcode_hit else None,
        warnings=warnings,
        source=source,
        model=usage_summary.model,
        usage=AIUsageOut(
            model=usage_summary.model,
            prompt_tokens=usage_summary.prompt_tokens,
            completion_tokens=usage_summary.completion_tokens,
            total_tokens=usage_summary.total_tokens,
            total_cost_usd=str(usage_summary.total_cost_usd),
        ),
    )


def _loads_json(content: str) -> dict[str, Any]:
    import json

    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text).rstrip("`").strip()
    return json.loads(text)
