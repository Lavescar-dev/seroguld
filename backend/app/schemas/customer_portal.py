from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.schemas.base import AppBaseModel, PaginatedResponse


class CustomerPortalTransactionOut(AppBaseModel):
    product_id: UUID
    product_number: str
    reference_number: str | None
    side: str  # sold_to_shop | bought_from_shop
    product_type: ProductTypeEnum
    metal_type: MetalTypeEnum
    weight_grams: str
    purity_karat: str | None
    purity_percentage: str | None
    amount_dkk: str
    status: ProductStatusEnum
    transaction_at: datetime


class CustomerPortalSummaryOut(AppBaseModel):
    customer_id: UUID
    customer_name: str
    customer_email: str
    customer_phone: str | None
    total_transactions: int
    sold_to_shop_count: int
    bought_from_shop_count: int
    sold_to_shop_value_dkk: str
    bought_from_shop_value_dkk: str
    active_site_listings_count: int
    current_rates_dkk_per_gram: dict[str, str]
    recent_transactions: list[CustomerPortalTransactionOut]


class CustomerPortalProductOut(AppBaseModel):
    id: UUID
    product_number: str
    reference_number: str | None
    side: str  # sold_to_shop | bought_from_shop
    product_type: ProductTypeEnum
    metal_type: MetalTypeEnum
    weight_grams: str
    purity_karat: str | None
    purity_percentage: str | None
    status: ProductStatusEnum
    amount_dkk: str
    transaction_at: datetime
    is_published_to_site: bool


class CustomerPortalProductListOut(PaginatedResponse[CustomerPortalProductOut]):
    pass
