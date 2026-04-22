from __future__ import annotations

from app.schemas.auth import UserOut
from app.schemas.base import AppBaseModel
from app.schemas.dashboard import DashboardIntegrationsOut, DashboardOpsOut, DashboardSummaryOut, StockValueOut
from app.schemas.pos import PosMetalRatesOut


class BootstrapAppInfoOut(AppBaseModel):
    app_name: str
    app_url: str
    seller_name: str
    seller_city: str
    seller_country: str
    currency_code: str


class BootstrapNavigationOut(AppBaseModel):
    total_documents: int
    pending_documents: int
    total_inventory: int
    total_customers: int
    locked_products: int
    pending_ai: int


class DesktopBootstrapOut(AppBaseModel):
    user: UserOut
    app: BootstrapAppInfoOut
    navigation: BootstrapNavigationOut
    summary: DashboardSummaryOut
    stock_value: StockValueOut
    ops: DashboardOpsOut
    integrations: DashboardIntegrationsOut
    market_rates: PosMetalRatesOut
