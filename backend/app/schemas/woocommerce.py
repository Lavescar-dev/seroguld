from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from app.schemas.base import AppBaseModel
from app.schemas.inventory import InventoryGridRowOut


class WooWorkspaceSummaryOut(AppBaseModel):
    total_products: int = 0
    published_products: int = 0
    draft_products: int = 0
    unpublished_products: int = 0
    photo_pending_products: int = 0


class WooWorkspaceOut(AppBaseModel):
    summary: WooWorkspaceSummaryOut
    rows: list[InventoryGridRowOut] = Field(default_factory=list)


class WooCatalogStatusOut(AppBaseModel):
    configured: bool
    reachable: bool
    remote_published_count: int | None = None
    local_active_count: int = 0
    local_inactive_count: int = 0
    catalog_revision: int = 0
    last_synced_at: datetime | None = None
    checked_at: datetime
    message: str


class WooCatalogItemOut(AppBaseModel):
    id: UUID
    woocommerce_product_id: int
    name: str
    slug: str | None = None
    sku: str | None = None
    permalink: str | None = None
    remote_status: str
    catalog_visibility: str | None = None
    stock_status: str | None = None
    stock_quantity: int | None = None
    price_dkk: Decimal | None = None
    regular_price_dkk: Decimal | None = None
    sale_price_dkk: Decimal | None = None
    weight_raw: str | None = None
    weight_grams: Decimal | None = None
    weight_missing: bool
    manual_review_required: bool
    manual_review_reasons: list[str] = Field(default_factory=list)
    photo_missing: bool
    image_count: int
    images: list[dict] = Field(default_factory=list)
    categories: list[dict] = Field(default_factory=list)
    is_active: bool
    linked_product_id: UUID | None = None
    remote_created_at: datetime | None = None
    remote_modified_at: datetime | None = None
    first_seen_at: datetime
    last_seen_at: datetime
    updated_at: datetime


class WooCatalogListOut(AppBaseModel):
    items: list[WooCatalogItemOut] = Field(default_factory=list)
    page: int
    page_size: int
    total: int
    total_pages: int
    catalog_revision: int


class WooCatalogSyncSummaryOut(AppBaseModel):
    remote_published_count: int
    create_count: int
    update_count: int
    unchanged_count: int
    deactivate_count: int
    weight_missing_count: int
    manual_review_count: int
    photo_missing_count: int


class WooCatalogSyncPreviewOut(AppBaseModel):
    preview_revision: str
    base_revision: int
    expires_at: datetime
    summary: WooCatalogSyncSummaryOut
    warnings: list[str] = Field(default_factory=list)


class WooCatalogSyncIn(AppBaseModel):
    preview_revision: str = Field(min_length=32, max_length=160)


class WooCatalogSyncOut(AppBaseModel):
    status: str = "applied"
    revision: int
    summary: WooCatalogSyncSummaryOut
    synced_at: datetime


class WooCatalogLinkIn(AppBaseModel):
    product_id: UUID
