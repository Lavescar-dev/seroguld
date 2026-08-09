from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field, model_validator

from app.models.enums import (
    IdentityDocTypeEnum,
    MetalTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductTypeEnum,
)
from app.schemas.base import AppBaseModel


class PosCustomerInline(AppBaseModel):
    name: str = Field(min_length=2, max_length=200)
    email: str | None = None
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = None
    postal_code: str | None = Field(default=None, max_length=20)
    city: str | None = Field(default=None, max_length=120)
    cpr_number: str | None = Field(default=None, max_length=20)
    identity_doc_type: IdentityDocTypeEnum | None = None
    identity_doc_number: str | None = Field(default=None, max_length=50)
    identity_doc_country: str | None = Field(default="DK", max_length=8)
    identity_photo_refs: list[str] = Field(default_factory=list)


class PosSessionCreate(AppBaseModel):
    customer_id: UUID | None = None
    customer_new: PosCustomerInline | None = None
    trade_side: PosTradeSideEnum = PosTradeSideEnum.BUY_FROM_CUSTOMER
    force_new_session: bool = False


class PosQuoteUpdate(AppBaseModel):
    product_type: ProductTypeEnum | None = None
    metal_type: MetalTypeEnum | None = None
    weight_grams: Decimal | None = Field(default=None, gt=0)
    purity_karat: str | None = Field(default=None, max_length=10)
    purity_percentage: Decimal | None = Field(default=None, ge=0, le=100)
    margin_percent_internal: Decimal | None = Field(default=None, ge=0, le=100)


class PosSessionLineCreate(AppBaseModel):
    product_type: ProductTypeEnum
    metal_type: MetalTypeEnum
    weight_grams: Decimal = Field(gt=0)
    purity_karat: str | None = Field(default=None, max_length=10)
    purity_percentage: Decimal = Field(ge=0, le=100)
    rate_dkk: Decimal | None = Field(default=None, gt=0)
    margin_percent_internal: Decimal | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class PosSessionLineBulkCreate(AppBaseModel):
    items: list[PosSessionLineCreate] = Field(min_length=1, max_length=50)


class PosSessionLineUpdate(AppBaseModel):
    product_type: ProductTypeEnum | None = None
    metal_type: MetalTypeEnum | None = None
    weight_grams: Decimal | None = Field(default=None, gt=0)
    purity_karat: str | None = Field(default=None, max_length=10)
    purity_percentage: Decimal | None = Field(default=None, ge=0, le=100)
    rate_dkk: Decimal | None = Field(default=None, gt=0)
    margin_percent_internal: Decimal | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class PosSessionLineOut(AppBaseModel):
    id: UUID
    pos_session_id: UUID
    line_no: int
    product_type: ProductTypeEnum
    metal_type: MetalTypeEnum
    weight_grams: Decimal
    purity_karat: str | None
    purity_percentage: Decimal
    rate_dkk: Decimal | None
    margin_percent_internal: Decimal
    line_offer_dkk: Decimal | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class PosRealtimePreview(AppBaseModel):
    trade_side: PosTradeSideEnum | None = None
    product_type: ProductTypeEnum | None = None
    metal_type: MetalTypeEnum | None = None
    customer_name: str | None = Field(default=None, max_length=200)
    customer_phone: str | None = Field(default=None, max_length=40)
    customer_email: str | None = Field(default=None, max_length=255)
    customer_address: str | None = Field(default=None, max_length=255)
    customer_postal_code: str | None = Field(default=None, max_length=20)
    customer_city: str | None = Field(default=None, max_length=120)
    customer_cpr: str | None = Field(default=None, max_length=20)
    customer_identity_doc_number: str | None = Field(default=None, max_length=50)
    preview_sequence: int | None = Field(default=None, ge=1)
    weight_grams: Decimal | None = Field(default=None, ge=0)
    purity_karat: str | None = Field(default=None, max_length=10)
    purity_percentage: Decimal | None = Field(default=None, ge=0, le=100)
    margin_percent_internal: Decimal | None = Field(default=None, ge=0, le=100)
    rate_source: PosRateSourceEnum | None = None
    live_rate_dkk: Decimal | None = Field(default=None, ge=0)
    manual_rate_dkk: Decimal | None = Field(default=None, ge=0)
    preview_gold_rows: list["PosWorkspaceGoldRowOut"] | None = None
    preview_silver_rows: list["PosWorkspaceSilverRowOut"] | None = None
    preview_lines: list["PosRealtimePreviewLine"] | None = None


class PosManualRateUpdate(AppBaseModel):
    manual_rate_dkk: Decimal = Field(gt=0)


class PosConfirmRequest(AppBaseModel):
    reference_number: str | None = Field(default=None, max_length=10)
    notes: str | None = None
    storage_location: str | None = Field(default=None, max_length=100)
    needs_cleaning: bool = False
    allow_line_total_adjustment: bool = False
    sale_override_approved: bool = False
    sale_override_reason: str | None = Field(default=None, max_length=500)
    sale_product_id: UUID | None = None
    sale_price_dkk: Decimal | None = Field(default=None, gt=0)
    manual_purchase_cost_dkk: Decimal | None = Field(default=None, gt=0)


class PosSessionOutClerk(AppBaseModel):
    id: UUID
    session_code: str
    display_token: str
    customer_id: UUID | None
    customer_name: str | None = None
    trade_side: PosTradeSideEnum
    product_type: str | None
    metal_type: str | None
    weight_grams: Decimal | None
    purity_karat: str | None
    purity_percentage: Decimal | None
    live_rate_dkk: Decimal | None
    manual_rate_dkk: Decimal | None
    active_rate_dkk: Decimal | None
    rate_source: PosRateSourceEnum
    margin_percent_internal: Decimal
    final_offer_dkk: Decimal | None
    status: PosSessionStatusEnum
    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime | None


class PosSessionDisplayOut(AppBaseModel):
    session_code: str
    status: PosSessionStatusEnum
    trade_side: PosTradeSideEnum
    customer_name: str | None
    customer_phone: str | None = None
    customer_email: str | None = None
    customer_address: str | None = None
    customer_postal_code: str | None = None
    customer_city: str | None = None
    customer_cpr: str | None = None
    customer_cpr_masked: str | None = None
    customer_identity_doc_number: str | None = None
    customer_identity_doc_number_masked: str | None = None
    preview_sequence: int | None = None
    product_type: str | None
    metal_type: str | None
    weight_grams: Decimal | None
    purity_karat: str | None
    purity_percentage: Decimal | None
    rate_dkk: Decimal | None
    final_offer_dkk: Decimal | None
    line_count: int = 0
    lines_total_dkk: Decimal | None = None
    total_weight_grams: Decimal | None = None
    total_pure_gold_grams: Decimal | None = None
    document_kind: str | None = None
    document_number: str | None = None
    gold_rows: list["PosWorkspaceGoldRowOut"] = Field(default_factory=list)
    silver_rows: list["PosWorkspaceSilverRowOut"] = Field(default_factory=list)
    lines: list["PosDisplayLineOut"] = Field(default_factory=list)
    updated_at: datetime


class PosDisplayPreviewOut(AppBaseModel):
    display_token: str | None = None
    snapshot: PosSessionDisplayOut | None = None


class PosConfirmResponse(AppBaseModel):
    session: PosSessionOutClerk
    product_id: UUID
    product_number: str
    product_ids: list[UUID] = Field(default_factory=list)
    product_numbers: list[str] = Field(default_factory=list)


class PosMetalRatesOut(AppBaseModel):
    yellow_gold: str
    white_gold: str
    silver: str
    platinum: str
    palladium: str


class PosDisplayLineOut(AppBaseModel):
    line_no: int
    product_type: ProductTypeEnum
    metal_type: MetalTypeEnum
    weight_grams: Decimal
    purity_karat: str | None
    purity_percentage: Decimal
    type_label: str | None = None
    lodighed: str | None = None
    rate_dkk: Decimal | None
    unit_price_dkk: Decimal | None = None
    line_offer_dkk: Decimal | None
    notes: str | None


class PosRealtimePreviewLine(AppBaseModel):
    product_type: ProductTypeEnum
    metal_type: MetalTypeEnum
    weight_grams: Decimal = Field(gt=0)
    purity_karat: str | None = Field(default=None, max_length=10)
    purity_percentage: Decimal = Field(ge=0, le=100)
    rate_dkk: Decimal | None = Field(default=None, gt=0)
    margin_percent_internal: Decimal | None = Field(default=None, ge=0, le=100)
    line_offer_dkk: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class PosTransactionLineOut(AppBaseModel):
    id: UUID
    line_no: int
    product_id: UUID | None
    product_number: str | None
    reference_number: str | None
    product_type: str | None
    metal_type: str | None
    weight_grams: Decimal | None
    purity_karat: str | None
    purity_percentage: Decimal | None
    pure_gold_grams: Decimal | None
    rate_dkk: Decimal | None
    margin_percent: Decimal
    line_total_dkk: Decimal
    created_at: datetime


class PosTransactionOut(AppBaseModel):
    id: UUID
    pos_session_id: UUID
    pos_document_sequence_no: int | None
    trade_side: str
    status: str
    customer_id: UUID | None
    clerk_user_id: UUID | None
    currency_code: str
    gross_amount_dkk: Decimal
    net_amount_dkk: Decimal
    vat_rate_percent: Decimal
    vat_amount_dkk: Decimal
    notes: str | None
    created_at: datetime
    confirmed_at: datetime | None
    lines: list[PosTransactionLineOut]


class PosWorkspaceBankInfo(AppBaseModel):
    reg_number: str | None = Field(default=None, max_length=20)
    account_number: str | None = Field(default=None, max_length=40)


class PosWorkspaceRateMatrixEntry(AppBaseModel):
    row_key: str = Field(min_length=1, max_length=30)
    label: str = Field(min_length=1, max_length=60)
    lodighed: str = Field(min_length=1, max_length=20)
    eur_per_gram: Decimal = Field(default=Decimal("0"), ge=0)
    dkk_per_gram: Decimal = Field(default=Decimal("0"), ge=0)
    karat: Decimal | None = Field(default=None, ge=0)
    type_code: str | None = Field(default=None, max_length=10)


class PosWorkspaceMarketRates(AppBaseModel):
    eur_dkk_fx: Decimal = Field(default=Decimal("7.45"), gt=0)
    gold_rates_eur: dict[str, Decimal] = Field(default_factory=dict)
    silver_rates_eur: dict[str, Decimal] = Field(default_factory=dict)
    gold_24k_dkk: Decimal = Field(ge=0)
    silver_dkk: Decimal = Field(ge=0)
    gold_matrix: list[PosWorkspaceRateMatrixEntry] = Field(default_factory=list)
    silver_matrix: list[PosWorkspaceRateMatrixEntry] = Field(default_factory=list)


class PosWorkspaceCustomerOut(AppBaseModel):
    customer_id: UUID | None
    name: str
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    postal_code: str | None = None
    city: str | None = None
    cpr_number: str | None = None
    identity_doc_type: IdentityDocTypeEnum | None = None
    identity_doc_number: str | None = None
    identity_doc_country: str | None = None


class PosWorkspaceCustomerUpdate(AppBaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = None
    postal_code: str | None = Field(default=None, max_length=20)
    city: str | None = Field(default=None, max_length=120)
    cpr_number: str | None = Field(default=None, max_length=20)
    identity_doc_type: IdentityDocTypeEnum | None = None
    identity_doc_number: str | None = Field(default=None, max_length=50)
    identity_doc_country: str | None = Field(default=None, max_length=8)


class PosWorkspaceCustomerSelectRequest(AppBaseModel):
    customer_id: UUID | None = None
    customer_new: PosCustomerInline | None = None

    @model_validator(mode="after")
    def validate_customer_selection(self) -> "PosWorkspaceCustomerSelectRequest":
        if self.customer_id is None and self.customer_new is None:
            raise ValueError("customer_id veya customer_new zorunlu")
        return self


class PosPostalLookupOut(AppBaseModel):
    postal_code: str
    found: bool = False
    available: bool = True
    postal_district: str | None = None
    municipality_name: str | None = None
    region_name: str | None = None
    status: str = "FOUND"
    source: str | None = None
    provenance: str | None = None
    version: str | None = None
    fetched_at: str | None = None
    from_cache: bool = False
    offline: bool = False
    error_code: str | None = None


class PosWorkspaceGoldRowInput(AppBaseModel):
    karat: Decimal = Field(ge=0)
    gram: Decimal = Field(default=Decimal("0"), ge=0)
    avance_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100)


class PosWorkspaceSilverRowInput(AppBaseModel):
    type_code: str = Field(min_length=1, max_length=10)
    gram: Decimal = Field(default=Decimal("0"), ge=0)
    avance_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100)


class PosWorkspaceGoldRowOut(AppBaseModel):
    row_key: str
    line_id: UUID | None = None
    line_no: int | None = None
    karat: Decimal
    label: str
    lodighed: str
    purity_percentage: Decimal
    gram: Decimal
    avance_percent: Decimal
    rate_dkk: Decimal
    unit_price_dkk: Decimal
    line_total_dkk: Decimal


class PosWorkspaceSilverRowOut(AppBaseModel):
    row_key: str
    line_id: UUID | None = None
    line_no: int | None = None
    type_code: str
    label: str
    lodighed: str
    purity_percentage: Decimal
    gram: Decimal
    avance_percent: Decimal
    rate_dkk: Decimal
    unit_price_dkk: Decimal
    line_total_dkk: Decimal


class PosWorkspaceSummaryOut(AppBaseModel):
    active_line_count: int = 0
    total_weight_grams: Decimal = Decimal("0.00")
    total_pure_gold_grams: Decimal = Decimal("0.00")
    gold_weight_grams: Decimal = Decimal("0.00")
    silver_weight_grams: Decimal = Decimal("0.00")
    total_amount_dkk: Decimal = Decimal("0.00")


class PosWorkspaceNumberingOut(AppBaseModel):
    product_number_next: str = ""
    reference_number_next: str = ""
    afregnings_number_next: str = ""
    invoice_number_next: str = ""


class PosWorkspaceNumberingUpdate(AppBaseModel):
    afregnings_number_next: str | None = Field(default=None, max_length=50)
    invoice_number_next: str | None = Field(default=None, max_length=50)


class PosWorkspaceInvoiceGoldRowInput(AppBaseModel):
    row_key: str = Field(min_length=1, max_length=30)
    code: str | None = Field(default=None, max_length=10)
    fineness: str | None = Field(default=None, max_length=20)
    gram: Decimal = Field(default=Decimal("0"), ge=0)


class PosWorkspaceInvoiceGoldRowOut(AppBaseModel):
    row_key: str
    code: str | None = None
    label: str | None = None
    fineness: str | None = None
    lodighed: str | None = None
    gram: Decimal = Decimal("0.00")
    unit_price_dkk: Decimal = Decimal("0.00")
    line_total_dkk: Decimal = Decimal("0.00")


class PosWorkspaceInvoiceGoldSheetUpdate(AppBaseModel):
    rows: list[PosWorkspaceInvoiceGoldRowInput] = Field(default_factory=list)
    footer_lines: list[str] = Field(default_factory=list, max_length=3)


class PosWorkspaceInvoiceGoldSheetOut(AppBaseModel):
    rows: list[PosWorkspaceInvoiceGoldRowOut] = Field(default_factory=list)
    footer_lines: list[str] = Field(default_factory=list)
    total_grams: Decimal = Decimal("0.00")
    total_amount_dkk: Decimal = Decimal("0.00")


class PosWorkspaceInvoiceMiscRowInput(AppBaseModel):
    row_key: str = Field(min_length=1, max_length=30)
    text: str | None = Field(default=None, max_length=250)
    quantity: Decimal | None = Field(default=None, ge=0)
    unit_price_dkk: Decimal = Field(default=Decimal("0"), ge=0)


class PosWorkspaceInvoiceMiscRowOut(AppBaseModel):
    row_key: str
    text: str | None = None
    quantity: Decimal | None = None
    unit_price_dkk: Decimal = Decimal("0.00")
    line_total_dkk: Decimal = Decimal("0.00")


class PosWorkspaceInvoiceMiscSheetUpdate(AppBaseModel):
    rows: list[PosWorkspaceInvoiceMiscRowInput] = Field(default_factory=list)


class PosWorkspaceInvoiceMiscSheetOut(AppBaseModel):
    rows: list[PosWorkspaceInvoiceMiscRowOut] = Field(default_factory=list)
    total_amount_dkk: Decimal = Decimal("0.00")


class PosWorkspaceCalculatorRowInput(AppBaseModel):
    row_key: str = Field(min_length=1, max_length=30)
    unit_weight: Decimal = Field(default=Decimal("0"), ge=0)
    count: Decimal = Field(default=Decimal("0"), ge=0)
    target_row_key: str | None = Field(default=None, max_length=30)


class PosWorkspaceCalculatorRowOut(AppBaseModel):
    row_key: str
    unit_weight: Decimal = Decimal("0.00")
    count: Decimal = Decimal("0.00")
    total_weight: Decimal = Decimal("0.00")
    target_row_key: str | None = None


class PosWorkspaceCalculatorsUpdate(AppBaseModel):
    gold_rows: list[PosWorkspaceCalculatorRowInput] = Field(default_factory=list)
    silver_rows: list[PosWorkspaceCalculatorRowInput] = Field(default_factory=list)


class PosWorkspaceCalculatorsOut(AppBaseModel):
    gold_rows: list[PosWorkspaceCalculatorRowOut] = Field(default_factory=list)
    silver_rows: list[PosWorkspaceCalculatorRowOut] = Field(default_factory=list)


class PosWorkspaceSectionsUpdate(AppBaseModel):
    gold_rows: list[PosWorkspaceGoldRowInput] = Field(default_factory=list)
    silver_rows: list[PosWorkspaceSilverRowInput] = Field(default_factory=list)
    bank_info: PosWorkspaceBankInfo | None = None
    market_rates: PosWorkspaceMarketRates | None = None
    afg_note: str | None = Field(default=None, max_length=1000)
    calculators: PosWorkspaceCalculatorsUpdate | None = None
    payment_method: str | None = Field(default=None, pattern="^(bank|cash)$")
    numbering: PosWorkspaceNumberingUpdate | None = None
    invoice_gold_mode: str | None = Field(default=None, pattern="^(auto|manual)$")
    invoice_gold: PosWorkspaceInvoiceGoldSheetUpdate | None = None
    invoice_misc_mode: str | None = Field(default=None, pattern="^(auto|manual)$")
    invoice_misc: PosWorkspaceInvoiceMiscSheetUpdate | None = None


class PosWorkspaceOpenRequest(AppBaseModel):
    customer_id: UUID | None = None
    customer_new: PosCustomerInline | None = None
    bank_info: PosWorkspaceBankInfo | None = None
    payment_method: str | None = Field(default=None, pattern="^(bank|cash)$")
    force_new_session: bool = False


class PosWorkspaceFinalizeRequest(AppBaseModel):
    notes: str | None = Field(default=None, max_length=1000)
    bank_info: PosWorkspaceBankInfo | None = None
    payment_method: str | None = Field(default=None, pattern="^(bank|cash)$")


class PosWorkspaceFinalizeResponse(AppBaseModel):
    session: PosSessionOutClerk
    document_sequence_no: int
    document_number: str
    transaction_id: UUID
    line_count: int
    uniconta_sync_status: str | None = None  # 'synced' | 'failed' | 'skipped' | None
    uniconta_invoice_number: str | None = None
    uniconta_sync_error: str | None = None


class PosWorkspaceOut(AppBaseModel):
    session: PosSessionOutClerk
    customer: PosWorkspaceCustomerOut
    bank_info: PosWorkspaceBankInfo
    payment_method: str = Field(default="bank", pattern="^(bank|cash)$")
    market_rates: PosWorkspaceMarketRates
    afg_note: str | None = None
    calculators: PosWorkspaceCalculatorsOut = Field(default_factory=PosWorkspaceCalculatorsOut)
    numbering_preview: PosWorkspaceNumberingOut
    invoice_gold_mode: str = Field(default="auto", pattern="^(auto|manual)$")
    gold_rows: list[PosWorkspaceGoldRowOut] = Field(default_factory=list)
    silver_rows: list[PosWorkspaceSilverRowOut] = Field(default_factory=list)
    invoice_gold: PosWorkspaceInvoiceGoldSheetOut = Field(default_factory=PosWorkspaceInvoiceGoldSheetOut)
    invoice_misc_mode: str = Field(default="auto", pattern="^(auto|manual)$")
    invoice_misc: PosWorkspaceInvoiceMiscSheetOut = Field(default_factory=PosWorkspaceInvoiceMiscSheetOut)
    quick_mode_editable: bool = True
    summary: PosWorkspaceSummaryOut


class PosSavedPurchasePreviewRowOut(AppBaseModel):
    line_no: int
    type_label: str
    weight_grams: Decimal
    purity_label: str | None = None
    line_total_dkk: Decimal


class PosSavedPurchaseListItemOut(AppBaseModel):
    sequence_no: int
    session_id: UUID
    session_code: str
    document_number: str
    issued_at: datetime
    customer_id: UUID | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None
    customer_address: str | None = None
    customer_postal_code: str | None = None
    customer_city: str | None = None
    customer_cpr: str | None = None
    customer_cpr_masked: str | None = None
    customer_identity_doc_number: str | None = None
    gross_amount_dkk: Decimal
    total_weight_grams: Decimal | None = None
    line_count: int = 0
    payment_method: str | None = Field(default=None, pattern="^(bank|cash)$")
    gold_preview_items: list[PosSavedPurchasePreviewRowOut] = Field(default_factory=list)
    silver_preview_items: list[PosSavedPurchasePreviewRowOut] = Field(default_factory=list)
    can_edit: bool = False
    can_delete: bool = False
    uniconta_sync_status: str | None = None  # 'synced' | 'failed' | 'skipped' | None
    uniconta_invoice_number: str | None = None
    uniconta_sync_error: str | None = None


class PosDocumentListItemOut(AppBaseModel):
    sequence_no: int
    session_id: UUID
    session_code: str
    trade_side: str
    status: str
    document_type: str
    document_kind: str
    document_title: str
    document_number: str
    customer_name: str | None
    customer_phone: str | None
    customer_email: str | None
    currency_code: str
    gross_amount_dkk: Decimal
    net_amount_dkk: Decimal
    vat_amount_dkk: Decimal
    line_count: int = 0
    total_weight_grams: Decimal | None = None
    total_pure_gold_grams: Decimal | None = None
    product_ids: list[UUID] = Field(default_factory=list)
    product_numbers: list[str] = Field(default_factory=list)
    product_status_counts: dict[str, int] = Field(default_factory=dict)
    operation_state: str
    has_locked_products: bool = False
    issued_at: datetime
    confirmed_at: datetime | None = None


class PosDocumentDetailLineOut(AppBaseModel):
    id: UUID
    line_no: int
    product_id: UUID | None = None
    product_number: str | None = None
    reference_number: str | None = None
    product_type: str | None = None
    metal_type: str | None = None
    weight_grams: Decimal | None = None
    purity_karat: str | None = None
    purity_percentage: Decimal | None = None
    pure_gold_grams: Decimal | None = None
    rate_dkk: Decimal | None = None
    margin_percent: Decimal
    line_total_dkk: Decimal
    product_status: str | None = None
    is_gdpr_locked: bool = False
    product_notes: str | None = None
    created_at: datetime


class PosDocumentDetailOut(AppBaseModel):
    sequence_no: int
    session_id: UUID
    session_code: str
    trade_side: str
    status: str
    document_type: str
    document_kind: str
    document_title: str
    document_number: str
    customer_name: str | None
    customer_phone: str | None
    customer_email: str | None
    customer_address: str | None
    customer_postal_code: str | None = None
    customer_city: str | None = None
    customer_cpr: str | None = None
    customer_cpr_masked: str | None = None
    customer_identity_doc_number: str | None = None
    customer_identity_doc_number_masked: str | None = None
    bank_reg_number: str | None = None
    bank_account_number: str | None = None
    currency_code: str
    gross_amount_dkk: Decimal
    net_amount_dkk: Decimal
    vat_amount_dkk: Decimal
    line_count: int = 0
    total_weight_grams: Decimal | None = None
    total_pure_gold_grams: Decimal | None = None
    product_ids: list[UUID] = Field(default_factory=list)
    product_numbers: list[str] = Field(default_factory=list)
    product_status_counts: dict[str, int] = Field(default_factory=dict)
    operation_state: str
    has_locked_products: bool = False
    notes: str | None = None
    payment_method: str | None = Field(default=None, pattern="^(bank|cash)$")
    market_rates: PosWorkspaceMarketRates = Field(default_factory=PosWorkspaceMarketRates)
    numbering_preview: PosWorkspaceNumberingOut = Field(default_factory=PosWorkspaceNumberingOut)
    invoice_gold: PosWorkspaceInvoiceGoldSheetOut = Field(default_factory=PosWorkspaceInvoiceGoldSheetOut)
    invoice_misc: PosWorkspaceInvoiceMiscSheetOut = Field(default_factory=PosWorkspaceInvoiceMiscSheetOut)
    can_edit: bool = False
    can_delete: bool = False
    issued_at: datetime
    confirmed_at: datetime | None = None
    lines: list[PosDocumentDetailLineOut] = Field(default_factory=list)
