from __future__ import annotations

from datetime import datetime
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
    ip_address: str | None = None
    billing_country: str | None = None
    billing_city: str | None = None
    shipping_country: str | None = None
    shipping_city: str | None = None
    risk_score: int | None = None
    ai_risk_score: int | None = None
    opmc_risk_score: int | None = None
    risk_level: str
    requires_manual_review: bool
    risk_meta: list[AntiFraudRiskMetaOut]
    risk_reasons: list[AntiFraudRiskReasonOut]
    notes: list[str]
    notes_human: list[str]
    ai_explanations_human: list[str]
    risk_meta_human: list[AntiFraudHumanFieldOut]
    whitelist_action_human: str | None = None


class AntiFraudSummaryOut(AppBaseModel):
    total_orders: int
    high_risk_count: int
    medium_risk_count: int
    low_risk_count: int
    unknown_risk_count: int
    manual_review_count: int


class AntiFraudOrdersResponse(AppBaseModel):
    source: str
    generated_at: datetime
    summary: AntiFraudSummaryOut
    items: list[AntiFraudOrderOut]
