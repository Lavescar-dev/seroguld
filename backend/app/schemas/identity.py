"""Kimlik OCR uç şemaları (R1-B üç katman).

Tek JSON sözleşmesi: barkod (Tier 0) + VLM (Tier 2) alanları aynı
IdentityExtractOut içinde taşınır; review alanı operatör ekranını yönetir.
CPR tam 10 hane taşınır — 6'ya kırpmak YASAKTIR (R1-CPR yazma yolu hane
sayısına göre karar verir).
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from app.schemas.base import AppBaseModel

IdentitySide = Literal["front", "back"]


class IdentityExtractRequest(AppBaseModel):
    """data URL gömülü kimlik görüntüsü (görüntü asla diske yazılmaz)."""

    image_data_url: str = Field(min_length=32)
    side: IdentitySide = "front"

    @field_validator("image_data_url")
    @classmethod
    def _validate_data_url(cls, value: str) -> str:
        if not value.startswith("data:image/"):
            raise ValueError("image_data_url bir data:image/ adresi olmalı.")
        return value


class IdentityBarcodeOut(AppBaseModel):
    cpr: str
    verified: bool


class IdentityFieldOut(AppBaseModel):
    value: str | None = None
    review: Literal["validated", "needs_review"] = "needs_review"
    confidence: float | None = None


class IdentityEngineOut(AppBaseModel):
    """Yerel katmanın teşhis üst verisi (0.3.39) — PII taşımaz.

    name: local (RapidOCR koştu) | none. roi_fields: değer üreten ROI
    anahtarları (ör. ["1","2","3","4d","5"]) — benchmark/teşhis için.
    """

    name: str = "none"
    latency_ms: float | None = None
    warped: bool = False
    quad_detected: bool = False
    roi_fields: list[str] = Field(default_factory=list)


class IdentityExtractOut(AppBaseModel):
    document_type: str | None = None
    fields: dict[str, IdentityFieldOut] = Field(default_factory=dict)
    barcode: IdentityBarcodeOut | None = None
    warnings: list[str] = Field(default_factory=list)
    # source: barcode | local | local+barcode | vlm | merged | none —
    # hangi katmanların katkı verdiği (vlm/merged anlamları korunur).
    source: str = "vlm"
    model: str | None = None
    usage: "AIUsageOut | None" = None
    # 0.3.39 ekleri: yerel motor üst verisi + tam-kart metin (ROI alan
    # getiremezse frontend regex zinciri BU metin üzerinde koşar).
    engine: "IdentityEngineOut | None" = None
    ocr_text: str | None = None


class AIUsageOut(AppBaseModel):
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    total_cost_usd: str


class IdentityCapabilitiesOut(AppBaseModel):
    """GET /alis/identity/capabilities — frontend motor seçimi bununla yapar.

    0.3.39 ekleri: ``vlm_enabled`` (extract_enabled ile aynı — açık ad),
    ``local_engine`` (motor KURULU mu — bayraktan bağımsız uygunluk),
    ``local_enabled`` (bayrağın kendisi — hangi katmanın gerçekte koştuğu),
    ``local_model`` (insan-okur motor etiketi). Mevcut alan adları DİP
    SABİT: frontend sözleşme testi pinler.
    """

    extract_enabled: bool
    model: str | None = None
    barcode_available: bool = False
    vlm_enabled: bool = False
    local_engine: bool = False
    local_enabled: bool = False
    local_model: str | None = None


IdentityExtractOut.model_rebuild()
IdentityEngineOut.model_rebuild()
