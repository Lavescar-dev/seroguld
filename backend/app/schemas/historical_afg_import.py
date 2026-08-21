from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import Field

from app.schemas.base import AppBaseModel


class HistoricalAfgImportPreviewItemOut(AppBaseModel):
    source_hash: str
    file_name: str
    status: str
    legacy_document_number: str | None = None
    issued_at: datetime | None = None
    customer_name: str | None = None
    customer_action: str = "blocked"
    # Yeni müşteri dedup anahtarı (create_customer aksiyonunda dolu); apply'da
    # seçili anahtarlar bu değerle eşlenir.
    customer_key: str | None = None
    line_count: int = 0
    total_weight_grams: Decimal = Decimal("0.00")
    total_amount_dkk: Decimal = Decimal("0.00")
    # Hangi parser'ın çalıştığı ve belgedeki tamamlanmış tutar kırılımı —
    # operatör uygulamadan önce net/KDV/brütü doğrulayabilir.
    template_profile: str = "current"
    source_net_amount_dkk: Decimal | None = None
    source_vat_amount_dkk: Decimal | None = None
    source_gross_amount_dkk: Decimal | None = None
    birth_date_text: str | None = None
    is_company: bool = False
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class HistoricalAfgImportNewCustomerOut(AppBaseModel):
    """Preview'da oluşturulacak YENİ müşteri (dedup); operatör checkbox ile seçer."""

    key: str
    name: str | None = None
    cpr_masked: str | None = None
    phone: str | None = None
    afg_count: int = 0


class HistoricalAfgImportPreviewOut(AppBaseModel):
    items: list[HistoricalAfgImportPreviewItemOut] = Field(default_factory=list)
    ready_count: int = 0
    blocked_count: int = 0
    already_imported_count: int = 0
    # "50 AFG'de N yeni müşteri" — operatör hangilerini ekleyeceğini seçer.
    new_customers: list[HistoricalAfgImportNewCustomerOut] = Field(default_factory=list)
    external_effects: str = "disabled"


class HistoricalAfgImportApplyItemOut(AppBaseModel):
    source_hash: str
    file_name: str
    status: str
    legacy_document_number: str | None = None
    sequence_no: int | None = None
    message: str | None = None
    archive_path: str | None = None
    errors: list[str] = Field(default_factory=list)


class HistoricalAfgImportApplyOut(AppBaseModel):
    items: list[HistoricalAfgImportApplyItemOut] = Field(default_factory=list)
    imported_count: int = 0
    skipped_count: int = 0
    failed_count: int = 0
    external_effects: str = "disabled"
