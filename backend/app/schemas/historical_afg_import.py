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


class HistoricalAfgImportPreviewOut(AppBaseModel):
    items: list[HistoricalAfgImportPreviewItemOut] = Field(default_factory=list)
    ready_count: int = 0
    blocked_count: int = 0
    already_imported_count: int = 0
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
