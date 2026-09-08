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


class IdentityExtractOut(AppBaseModel):
    document_type: str | None = None
    fields: dict[str, IdentityFieldOut] = Field(default_factory=dict)
    barcode: IdentityBarcodeOut | None = None
    warnings: list[str] = Field(default_factory=list)
    # source: barcode | vlm | merged — hangi katmanların katkı verdiği
    source: str = "vlm"
    model: str | None = None
    usage: "AIUsageOut | None" = None


class AIUsageOut(AppBaseModel):
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    total_cost_usd: str


class IdentityCapabilitiesOut(AppBaseModel):
    """GET /alis/identity/capabilities — frontend motor seçimi bununla yapar."""

    extract_enabled: bool
    model: str | None = None
    barcode_available: bool = False


IdentityExtractOut.model_rebuild()
