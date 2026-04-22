from __future__ import annotations

from datetime import datetime

from app.schemas.base import AppBaseModel


class DashboardSummaryOut(AppBaseModel):
    total_products: int
    locked_products: int
    free_products: int
    for_sale_products: int
    sold_this_month: int
    melted_this_month: int


class StockValueOut(AppBaseModel):
    total_stock_value_dkk: str
    today_change_dkk: str


class CalendarItem(AppBaseModel):
    product_id: str
    product_number: str
    product_type: str
    metal_type: str
    gdpr_release_date: datetime
    days_remaining: int


class DashboardCalendarOut(AppBaseModel):
    items: list[CalendarItem]


class DashboardProfitOut(AppBaseModel):
    monthly_profit_dkk: str
    top_category: str | None
    top_category_profit_dkk: str
    melted_ratio_percent: str


class DashboardAICostOut(AppBaseModel):
    total_requests: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_tokens: int
    total_cost_usd: str
    average_cost_per_request_usd: str
    this_month_cost_usd: str
    last_call_at: datetime | None


class DashboardOpsOut(AppBaseModel):
    active_products: int
    products_with_photo: int
    products_without_photo: int
    photo_coverage_percent: str
    for_sale_without_photo: int
    needs_cleaning_queue: int
    pending_ai_description: int
    pending_ai_approval: int
    pending_publish: int
    stale_gdpr_lock: int
    ready_for_sale: int
    avg_active_age_days: str
    urgent_action_count: int


class DashboardStockFlowPointOut(AppBaseModel):
    day: str
    stock_value_dkk: str
    purchases_dkk: str
    removals_dkk: str
    net_change_dkk: str


class DashboardStatusDistributionItemOut(AppBaseModel):
    key: str
    label: str
    count: int


class DashboardMetalDistributionItemOut(AppBaseModel):
    key: str
    label: str
    count: int


class DashboardMonthlyProfitPointOut(AppBaseModel):
    month: str
    profit_dkk: str
    sold_count: int


class DashboardChartsOut(AppBaseModel):
    stock_flow_30d: list[DashboardStockFlowPointOut]
    status_distribution: list[DashboardStatusDistributionItemOut]
    active_metal_distribution: list[DashboardMetalDistributionItemOut]
    monthly_profit_12m: list[DashboardMonthlyProfitPointOut]


class DashboardIntegrationsOut(AppBaseModel):
    openai_configured: bool
    woocommerce_configured: bool
    wordpress_media_configured: bool
    webhook_secret_set: bool
    total_published_products: int
    sync_success_24h: int
    sync_failed_24h: int
    last_sync_at: datetime | None
    backup_latest_at: datetime | None
    backup_recent_ok: bool
    backup_age_minutes: int | None
    offsite_enabled: bool
    offsite_last_sync_at: datetime | None
    offsite_recent_ok: bool | None
    offsite_age_minutes: int | None
    restore_drill_last_at: datetime | None
    restore_drill_recent_ok: bool
    restore_drill_age_hours: int | None
