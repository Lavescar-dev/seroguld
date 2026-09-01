from __future__ import annotations

from datetime import datetime

from pydantic import Field
from decimal import Decimal
from typing import Any

from app.schemas.base import AppBaseModel


class AntiFraudRiskMetaOut(AppBaseModel):
    key: str
    value: Any


class AntiFraudRiskReasonOut(AppBaseModel):
    code: str
    reason: str


class AntiFraudHumanFieldOut(AppBaseModel):
    key: str
    label: str
    value: str


class AntiFraudCustomerHistoryOut(AppBaseModel):
    customer_id: int | None = None
    total_orders: int = 0
    successful_orders: int = 0
    cancelled_orders: int = 0
    failed_orders: int = 0
    first_order_at: datetime | None = None
    last_order_at: datetime | None = None
    known_safe: bool = False  # 3+ başarılı sipariş + son 90gün içinde
    matched_by: str | None = None  # "customer_id" | "email"


class AntiFraudOrderOut(AppBaseModel):
    order_id: int
    order_number: str
    status: str
    total: Decimal | None = None
    currency: str | None = None
    date_created: datetime | None = None
    payment_method: str | None = None
    customer_name: str | None = None
    customer_email: str | None = None
    customer_id: int | None = None
    ip_address: str | None = None
    billing_country: str | None = None
    billing_city: str | None = None
    shipping_country: str | None = None
    shipping_city: str | None = None
    risk_score: int | None = None
    ai_risk_score: int | None = None
    opmc_source_score: int | None = None
    opmc_risk_score: int | None = None
    opmc_trust_score: int | None = None
    opmc_score_mode: str = "trust"
    failed_rule_points_total: int | None = None
    score_consistency: str = "not_checkable"
    # O8 — Skor kaynağı UI badge'i için
    risk_score_source: str | None = None
    assessment_status: str = "assessed"
    raw_risk_score: int | None = None  # override öncesi orijinal skor
    risk_level: str
    requires_manual_review: bool
    review_queue_status: str = "none"
    review_reason_codes: list[str] = Field(default_factory=list)
    risk_meta: list[AntiFraudRiskMetaOut]
    risk_reasons: list[AntiFraudRiskReasonOut]
    notes: list[str]
    notes_human: list[str]
    ai_explanations_human: list[str]
    risk_meta_human: list[AntiFraudHumanFieldOut]
    whitelist_action_human: str | None = None
    # O5/O7/O9 yeni alanlar
    override_reasons: list[str] = Field(default_factory=list)
    is_whitelisted: bool = False
    is_blacklisted: bool = False
    has_manual_override: bool = False
    # O10 — Müşteri geçmişi mini panel
    customer_history: AntiFraudCustomerHistoryOut | None = None


class AntiFraudSummaryOut(AppBaseModel):
    total_orders: int
    high_risk_count: int
    medium_risk_count: int
    low_risk_count: int
    unknown_risk_count: int
    manual_review_count: int
    active_review_count: int = 0
    historical_review_count: int = 0
    skipped_whitelist_count: int = 0
    not_scored_count: int = 0
    ai_alert_count: int = 0


class AntiFraudOrdersResponse(AppBaseModel):
    source: str
    generated_at: datetime
    summary: AntiFraudSummaryOut
    items: list[AntiFraudOrderOut]
