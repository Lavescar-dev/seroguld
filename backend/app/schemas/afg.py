from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import AppBaseModel


AfgDestination = Literal["inventory", "undecided", "melt"]
AfgClassification = Literal["standard", "jewelry_cleaning", "white_gold", "separate_storage"]


class AfgWorkspaceLineOut(AppBaseModel):
    id: UUID
    transaction_id: UUID
    document_sequence_no: int
    document_number: str
    session_id: UUID
    session_code: str
    line_no: int
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None
    issued_at: datetime
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
    operation_destination: str | None = None
    operation_classification: str | None = None
    is_gdpr_locked: bool = False
    product_notes: str | None = None
    created_at: datetime


class AfgWorkspaceDocumentOut(AppBaseModel):
    sequence_no: int
    document_number: str
    session_id: UUID
    document_kind: str
    document_title: str
    status: str
    trade_side: str
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None
    customer_address: str | None = None
    issued_at: datetime
    confirmed_at: datetime | None = None
    gross_amount_dkk: Decimal
    net_amount_dkk: Decimal
    total_weight_grams: Decimal = Decimal("0.00")
    total_pure_gold_grams: Decimal = Decimal("0.00")
    line_count: int = 0
    operation_state: str
    has_locked_products: bool = False
    lines: list[AfgWorkspaceLineOut] = Field(default_factory=list)


class AfgWorkspaceSummaryOut(AppBaseModel):
    total_documents: int = 0
    awaiting_documents: int = 0
    inventory_documents: int = 0
    undecided_documents: int = 0
    melted_documents: int = 0
    total_amount_dkk: Decimal = Decimal("0.00")
    total_pure_gold_grams: Decimal = Decimal("0.00")


class AfgWorkspaceOut(AppBaseModel):
    summary: AfgWorkspaceSummaryOut
    gold_documents: list[AfgWorkspaceDocumentOut] = Field(default_factory=list)
    silver_documents: list[AfgWorkspaceDocumentOut] = Field(default_factory=list)


MetalBucket = Literal["gold", "silver"]


class AfgLogBucketSummaryOut(AppBaseModel):
    total_documents: int = 0
    total_lines: int = 0
    awaiting_lines: int = 0
    routed_lines: int = 0
    split_line_count: int = 0
    melt_line_count: int = 0
    melt_lot_count: int = 0
    total_weight_grams: Decimal = Decimal("0.00")
    total_pure_gold_grams: Decimal = Decimal("0.00")
    total_amount_dkk: Decimal = Decimal("0.00")


class AfgLogSplitGroupOut(AppBaseModel):
    key: AfgClassification
    label: str
    line_count: int = 0
    total_weight_grams: Decimal = Decimal("0.00")
    total_pure_gold_grams: Decimal = Decimal("0.00")
    total_amount_dkk: Decimal = Decimal("0.00")
    document_numbers: list[str] = Field(default_factory=list)


class AfgMeltQueueOut(AppBaseModel):
    line_count: int = 0
    total_weight_grams: Decimal = Decimal("0.00")
    total_pure_gold_grams: Decimal = Decimal("0.00")
    total_amount_dkk: Decimal = Decimal("0.00")
    earliest_purchase_date: date | None = None
    latest_purchase_date: date | None = None
    document_numbers: list[str] = Field(default_factory=list)


class AfgMeltLotOut(AppBaseModel):
    id: UUID
    metal_bucket: MetalBucket
    sent_date: date
    purchased_from_date: date | None = None
    before_weight_grams: Decimal = Decimal("0.00")
    before_amount_dkk: Decimal = Decimal("0.00")
    before_pure_gold_grams: Decimal = Decimal("0.00")
    after_pure_gold_grams: Decimal = Decimal("0.00")
    insurance_dkk: Decimal = Decimal("0.00")
    shipping_dkk: Decimal = Decimal("0.00")
    refining_dkk: Decimal = Decimal("0.00")
    sale_date: date | None = None
    quote_eur: Decimal | None = None
    exchange_rate_dkk: Decimal = Decimal("7.45")
    payout_total_dkk: Decimal | None = None
    notes: str | None = None
    cost_total_dkk: Decimal = Decimal("0.00")
    estimated_sale_value_dkk: Decimal | None = None
    net_after_costs_dkk: Decimal | None = None
    bridge_difference_dkk: Decimal | None = None
    advance_per_gram_dkk: Decimal | None = None
    # Yeni lifecycle alanları
    status: str = "draft"
    finalized_at: datetime | None = None
    finalized_by_user_id: UUID | None = None
    # Bu lot'a bağlı transaction line sayısı (UI'da rozet için)
    line_count: int = 0
    created_at: datetime
    updated_at: datetime


class AfgMeltLotHistoryOut(AppBaseModel):
    id: UUID
    lot_id: UUID
    action: str
    old_value: dict | None = None
    new_value: dict | None = None
    performed_by: UUID | None = None
    performed_by_email: str | None = None
    notes: str | None = None
    created_at: datetime


class AfgMeltLotLineOut(AppBaseModel):
    """Bu lot içindeki transaction line özetidir — drawer'da listelenir."""

    line_id: UUID
    document_sequence_no: int
    document_number: str
    line_no: int
    weight_grams: Decimal | None = None
    pure_gold_grams: Decimal | None = None
    line_total_dkk: Decimal | None = None
    customer_name: str | None = None
    product_number: str | None = None
    reference_number: str | None = None


class AfgLogBucketOut(AppBaseModel):
    metal_bucket: MetalBucket
    summary: AfgLogBucketSummaryOut
    documents: list[AfgWorkspaceDocumentOut] = Field(default_factory=list)
    split_groups: list[AfgLogSplitGroupOut] = Field(default_factory=list)
    melt_queue: AfgMeltQueueOut = Field(default_factory=AfgMeltQueueOut)
    melt_lots: list[AfgMeltLotOut] = Field(default_factory=list)


class AfgLogWorkspaceOut(AppBaseModel):
    summary: AfgWorkspaceSummaryOut
    gold: AfgLogBucketOut
    silver: AfgLogBucketOut


class AfgRouteRequest(AppBaseModel):
    line_ids: list[UUID] = Field(min_length=1)
    destination: AfgDestination
    classification: AfgClassification = "standard"
    note: str | None = Field(default=None, max_length=500)
    inventory_category: str | None = Field(default=None, max_length=30)
    inventory_subcategory: str | None = Field(default=None, max_length=30)
    storage_location: str | None = Field(default=None, max_length=100)
    producer: str | None = Field(default=None, max_length=120)


class AfgRouteResponse(AppBaseModel):
    processed_line_ids: list[UUID] = Field(default_factory=list)
    product_ids: list[UUID] = Field(default_factory=list)
    statuses: dict[str, int] = Field(default_factory=dict)


class AfgRouteDecision(AppBaseModel):
    line_id: UUID
    destination: AfgDestination
    classification: AfgClassification = "standard"
    note: str | None = Field(default=None, max_length=500)


class AfgRouteBatchApplyRequest(AppBaseModel):
    line_decisions: list[AfgRouteDecision] = Field(min_length=1)


class AfgRouteBatchPartialFailure(AppBaseModel):
    line_id: UUID
    error: str


class AfgRouteBatchApplyResponse(AppBaseModel):
    workspace: AfgLogWorkspaceOut
    succeeded: int = 0
    failed: int = 0
    failures: list[AfgRouteBatchPartialFailure] = Field(default_factory=list)


class AfgMeltLotCreateRequest(AppBaseModel):
    metal_bucket: MetalBucket
    sent_date: date | None = None
    purchased_from_date: date | None = None
    notes: str | None = Field(default=None, max_length=1000)


class AfgMeltLotUpdateRequest(AppBaseModel):
    sent_date: date | None = None
    purchased_from_date: date | None = None
    after_pure_gold_grams: Decimal | None = None
    insurance_dkk: Decimal | None = None
    shipping_dkk: Decimal | None = None
    refining_dkk: Decimal | None = None
    sale_date: date | None = None
    quote_eur: Decimal | None = None
    exchange_rate_dkk: Decimal | None = None
    payout_total_dkk: Decimal | None = None
    notes: str | None = Field(default=None, max_length=1000)
    # Optimistic concurrency
    expected_updated_at: datetime | None = None
