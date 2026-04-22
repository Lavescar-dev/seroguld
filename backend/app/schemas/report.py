from __future__ import annotations

from datetime import datetime

from app.schemas.base import AppBaseModel


class ReportSummaryOut(AppBaseModel):
    period_start: datetime
    period_end: datetime
    purchased_count: int
    sold_count: int
    melted_count: int
    total_purchase_value_dkk: str
    total_sale_value_dkk: str
    total_profit_dkk: str
