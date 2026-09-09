"""Kimlik çıkarma servisi — üç katman: barkod (her zaman) + yerel OCR + VLM.

0.3.39 yeniden yazım: VLM kapısı artık ZİNCİRİN BAŞINDA DEĞİLDİR. Sıra:

1. görüntü tek çözüm (data URL → bayt, bellek içi, diske yazılmaz)
2. Tier 0 barkod HER ZAMAN (kapı bayrağından bağımsız — checksum'lı CPR)
3. yerel katman: identity_local_ocr_enabled + RapidOCR kuruluysa
   (ön-işleme → ROI parse → doğrulama; tamamen offline)
4. Tier 2 VLM yalnız identity_extract_enabled + anahtar varsa (kod aynı,
   default KAPALI; maliyet sayacı yalnız bu katman koşarsa yazılır)
5. birleşim önceliği ALAN BAŞINA barkod > VLM > yerel

VLM koşmadıysa usage=None olur → uç maliyet satırı (AIUsageLog) YAZMAZ.
Yerel motor kurulu değilse zincir yine de barkod döner; frontend Windows
OCR fallback'ine geçer (D6) — 0.3.38'deki "bayrak kapalı → 503" hatası
böylece kapanır.

Güvenlik/GDPR: görüntü çıkarımdan hemen sonra atılır, diske YAZILMAZ,
log'a görüntü verisi girmez. base_url boşsa openai_base_url devralınır —
AB-residency projesi aynı URL ile çalışır, Çin ucuna kimlik verisi ASLA
gönderilmez (docs/IDENTITY_VLM_DPIA_NOTE_TR.md).
"""
from __future__ import annotations

import asyncio
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
    IdentityEngineOut,
    IdentityExtractOut,
    IdentityFieldOut,
)
from app.services.ai_service import build_ai_usage_summary
from app.services.identity_barcode_service import (
    IdentityBarcodeHit,
    decode_identity_barcode,
)
from app.services.identity_local_ocr_service import LocalOcrOutcome, run_local_ocr
from app.services.identity_local_parse import (
    LocalField,
    birth_date_consistent_with_cpr,
    local_fields_to_identity_fields,
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


def _barcode_available() -> bool:
    """zxing-cpp import probu — artık hardcode True DEĞİL (dürüst yetenek)."""
    from importlib.util import find_spec

    return find_spec("zxingcpp") is not None and find_spec("PIL") is not None


def _vlm_api_key(settings) -> str:
    """VLM katmanının anahtarı: identity'ye özel anahtar ÖNCE, global sonra.

    Azure kurulumunda (0.3.39 sonrası) kimlik görüntüsünü yalnız identity
    anahtarının ucu görür — genel sohbet anahtarı (GLM/Çin ucu) kimlik
    verisini ASLA görmez.
    """
    return settings.identity_extract_api_key.strip() or settings.openai_api_key.strip()


async def identity_capabilities() -> dict[str, Any]:
    """GET /alis/identity/capabilities gövdesi — yalnız bool/etiket, PII yok.

    Async: ilk çağrıda motor kurulumu (~0,7 sn) thread havuzunda koşar —
    olay döngüsü kilitlenmez.

    ``local_engine`` bir UYGUNLUK göstergesidir (motor kurulabiliyor mu),
    bayraktan BAĞIMSIZTIR (ilk çağrıda motor kurulur, ~yarım saniye; sonra
    önbellek). Frontend bu alana bakarak extract isteğini atar — böylece
    bayrak kapalıyken de barkod katmanı (CPR otoritesi) çağrılmış olur;
    0.3.38'in "barkod VLM bayrağına perçinli" tuzağına dönülmez. Yerel OCR'ın
    kendisi yalnız ``identity_local_ocr_enabled`` ile koşar.
    ``extract_enabled``/``vlm_enabled`` aynı şeyin iki adıdır — frontend
    sözleşmesi eski adı pinlediği için ikisi de gönderilir.
    """
    settings = get_settings()
    model = (settings.identity_extract_model or "").strip() or settings.openai_model
    vlm_enabled = bool(settings.identity_extract_enabled and _vlm_api_key(settings))

    # D1: motor kurulumu başarısızsa False — zarif düşüş sinyali. İlk çağrı
    # motoru KURAR (~0,7 sn) — olay döngüsünü kilitlememek için thread'de.
    from app.services.identity_local_ocr_service import engine_available

    local_engine = await asyncio.to_thread(engine_available)

    return {
        "extract_enabled": vlm_enabled,
        "vlm_enabled": vlm_enabled,
        "model": model if settings.identity_extract_enabled else None,
        "barcode_available": _barcode_available(),
        "local_engine": local_engine,
        # local_enabled: BAYRAĞIN kendisi — frontend "hangi katman gerçekte
        # koşuyor" kararlarını (ör. da-DK kurulum yönlendirmesi) bundan verir;
        # local_engine yalnız "motor kurulu mu" der.
        "local_enabled": bool(settings.identity_local_ocr_enabled),
        "local_model": settings.identity_local_ocr_model_label if local_engine else None,
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
    """Üç katmanı çalıştırır; görüntü bellek içi işlenir, ASLA diske yazılmaz.

    Bayrak kapalıyken 503 YOK: barkod + yerel zincir her zaman çalışır,
    VLM yalnız bayrak+anahtar varken katılır (D3). VLM koşmadıysa usage
    None kalır → uç maliyet satırı yazmaz.
    """
    settings = get_settings()
    threshold = float(settings.identity_extract_confidence_threshold)
    warnings: list[str] = []

    # ---- Görüntü TEK çözüm (baytlar hem barkoda hem yerel katmana gider)
    image_bytes = _decode_image_bytes(image_data_url, settings.identity_extract_max_image_bytes)

    # ---- Tier 0: barkod HER ZAMAN (VLM kapısı önünde değil)
    barcode_hit: IdentityBarcodeHit | None = None
    try:
        barcode_hit = decode_identity_barcode(image_bytes)
    except Exception as exc:
        logger.warning("Kimlik barkod katmanı atlandı: %s", type(exc).__name__)

    # ---- Yerel katman (bayrak + kurulu motor; tamamen offline)
    # CPU-ağır zincir (~1 sn) olay döngüsünü KİTLEMEMELİ: başka istekler
    # (satış, arama) aynı süreçte yaşar — thread havuzuna devredilir.
    local: LocalOcrOutcome | None = None
    local_fields: dict[str, LocalField] = {}
    engine_out = IdentityEngineOut(name="none")
    ocr_text = ""
    if settings.identity_local_ocr_enabled:
        local = await asyncio.to_thread(
            run_local_ocr, image_bytes, side=side, threshold=threshold
        )
        if local.engine_used:
            local_fields = local.parse.fields if local.parse else {}
            ocr_text = local.ocr_text
            engine_out = IdentityEngineOut(
                name=local.engine_name,
                latency_ms=round(local.latency_ms, 1),
                warped=local.warped,
                quad_detected=local.quad_detected,
                roi_fields=list(local.roi_fields),
            )
            warnings.extend(local.warnings)
        else:
            logger.info("Yerel OCR katmanı koşmadı — barkod/Windows fallback devrede.")

    # ---- Tier 2: VLM strict JSON (kod aynı; yalnız bayrak + anahtar)
    # VLM İSTEĞE BAĞLI katmandır: sağlayıcı hatsı barkod/yerel sonuçları
    # ASLA çöpe attırmaz (0.3.39 sözleşmesi) — hata uyarıya düşer, zincir
    # elindekiyle döner. usage yalnız sağlıklı yanıtta yazılır.
    vlm_fields: dict[str, IdentityFieldOut] = {}
    doc_type: str | None = None
    usage_summary = None
    if settings.identity_extract_enabled and _vlm_api_key(settings):
        model = (settings.identity_extract_model or "").strip() or settings.openai_model
        base_url = (settings.identity_extract_base_url or "").strip().rstrip("/") or settings.openai_base_url.rstrip("/")
        try:
            data = await _call_vlm(
                image_data_url=image_data_url,
                side=side,
                model=model,
                base_url=base_url,
                timeout=max(5.0, float(settings.identity_extract_timeout_seconds)),
            )
            usage_summary = build_ai_usage_summary(data, fallback_model=model)
            parsed = _parse_vlm_content(data)
        except HTTPException as exc:
            warnings.append(f"vlm_failed:{exc.status_code}")
            logger.warning("Kimlik VLM katmanı başarısız — barkod/yerel sonuçla devam: %s", exc.detail)
        except Exception as exc:  # noqa: BLE001 — isteğe bağlı katman zinciri düşürmesin
            warnings.append("vlm_failed:error")
            logger.warning("Kimlik VLM katmanı beklenmedik hata — barkod/yerel sonuçla devam: %s", type(exc).__name__)
        else:
            raw_doc_type = parsed.get("document_type")
            doc_type = str(raw_doc_type) if raw_doc_type else None
            raw_fields = parsed.get("fields") if isinstance(parsed.get("fields"), dict) else {}

            cpr_guess = ""
            cpr_entry = raw_fields.get("cpr_number")
            if isinstance(cpr_entry, dict) and isinstance(cpr_entry.get("value"), str):
                cpr_guess = repair_numeric_confusables(cpr_entry["value"])
            vlm_fields = _build_fields_from_vlm(
                raw_fields,
                threshold=threshold,
                cpr_for_consistency=cpr_guess or None,
            )

    # ---- Birleşim: alan başına barkod > VLM > yerel
    fields = _merge_tiers(
        local_fields=local_fields,
        vlm_fields=vlm_fields,
        barcode_hit=barcode_hit,
        threshold=threshold,
        warnings=warnings,
    )

    if barcode_hit is not None and not barcode_hit.verified:
        warnings.append("Barkod CPR okundu ama kontrol karakteri doğrulanamadı.")
    if barcode_hit is None and (fields or vlm_fields):
        warnings.append("Barkod okunamadı — CPR yalnız görüntüden okundu, kontrol edin.")

    source = _source_label(local_used=bool(local is not None and local.engine_used), vlm_used=usage_summary is not None, barcode_hit=barcode_hit)

    return IdentityExtractOut(
        document_type=doc_type or (local.document_type if local else None),
        fields=fields,
        barcode=IdentityBarcodeOut(cpr=barcode_hit.cpr, verified=barcode_hit.verified) if barcode_hit else None,
        warnings=warnings,
        source=source,
        model=usage_summary.model if usage_summary else None,
        usage=(
            AIUsageOut(
                model=usage_summary.model,
                prompt_tokens=usage_summary.prompt_tokens,
                completion_tokens=usage_summary.completion_tokens,
                total_tokens=usage_summary.total_tokens,
                total_cost_usd=str(usage_summary.total_cost_usd),
            )
            if usage_summary
            else None
        ),
        engine=engine_out,
        ocr_text=ocr_text or None,
    )


def _source_label(*, local_used: bool, vlm_used: bool, barcode_hit: IdentityBarcodeHit | None) -> str:
    """``source``: local | local+barcode | barcode | vlm | merged | none.

    vlm/merged anlamları korunur (VLM koştu); yerel katman için yeni
    etiketler eklenir. Hiçbir katman veri üretmediyse ``none``.
    """
    if vlm_used:
        return "merged" if barcode_hit else "vlm"
    if local_used:
        return "local+barcode" if barcode_hit else "local"
    if barcode_hit:
        return "barcode"
    return "none"


def _merge_tiers(
    *,
    local_fields: dict[str, LocalField],
    vlm_fields: dict[str, IdentityFieldOut],
    barcode_hit: IdentityBarcodeHit | None,
    threshold: float,
    warnings: list[str],
) -> dict[str, IdentityFieldOut]:
    """Katman birleşimi: öncelik barkod > VLM > yerel (alan başına).

    Yerel alanlar şemaya çevrilir, VLM alanları varsa aynı alanı ezer,
    barkod CPR son kelimedir. 4d↔barkod çelişkisi alanı needs_review'e
    düşürür ve uyarı üretir (plan WP2).
    """
    merged: dict[str, IdentityFieldOut] = local_fields_to_identity_fields(local_fields, threshold=threshold)
    for name, field in vlm_fields.items():
        if field.value:
            merged[name] = field
    if not merged and not barcode_hit:
        return merged

    printed_cpr = local_fields.get("cpr_number")
    if barcode_hit is not None:
        merged = _merge_barcode_cpr(merged, barcode_hit, threshold=threshold)
        # 4d (basılı CPR) ↔ barkod çapraz kontrol: uyuşmazlık OCR sinyalidir.
        # Yalnız TAM 10 haneli okuma karşılaştırılır — 9 haneli kırpık okuma
        # her zaman "uyuşmaz" çıkar ve haksız inceleyin düşürürdü.
        if (
            printed_cpr
            and printed_cpr.value
            and re.fullmatch(r"\d{10}", printed_cpr.value)
            and printed_cpr.value != barcode_hit.cpr
        ):
            cpr_field = merged.get("cpr_number")
            if cpr_field is not None:
                merged["cpr_number"] = cpr_field.model_copy(update={"review": REVIEW_NEEDS_REVIEW})
            warnings.append("Baskılı CPR (4d) barkod CPR ile uyuşmuyor — kontrol edin.")

    # Doğum tarihi HER ZAMAN birleşik CPR'a göre yeniden değerlendirilir.
    final_cpr = (merged.get("cpr_number").value if merged.get("cpr_number") else None) or (barcode_hit.cpr if barcode_hit else None)
    birth = merged.get("birth_date")
    if birth and birth.value:
        consistent = birth_date_consistent_with_cpr(final_cpr, birth.value)
        conf_ok = birth.confidence is not None and float(birth.confidence) >= threshold
        merged["birth_date"] = birth.model_copy(
            update={"review": REVIEW_VALIDATED if (conf_ok and consistent) else REVIEW_NEEDS_REVIEW}
        )
    return merged


async def _call_vlm(
    *,
    image_data_url: str,
    side: str,
    model: str,
    base_url: str,
    timeout: float,
) -> dict[str, Any]:
    """Tek VLM chat-completions çağrısı (bayrak+anahtar varken)."""
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
        return await _post_chat(
            url=f"{base_url}/chat/completions",
            api_key=_vlm_api_key(get_settings()),
            payload=payload,
            timeout=timeout,
        )
    except IdentityExtractError:
        raise
    except Exception as exc:
        raise IdentityExtractError(f"Kimlik çıkarma servisine bağlanılamadı: {exc}") from exc


def _parse_vlm_content(data: dict[str, Any]) -> dict[str, Any]:
    """VLM cevabını strict JSON'a çevirir (hata → 502, davranış korunur)."""
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
    return parsed if isinstance(parsed, dict) else {}


def _loads_json(content: str) -> dict[str, Any]:
    import json

    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text).rstrip("`").strip()
    return json.loads(text)
