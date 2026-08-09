from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.schemas.base import AppBaseModel, PaginatedResponse


class PhotoItem(AppBaseModel):
    id: str | None = None
    url: str
    filename: str | None = None
    is_primary: bool = False
    uploaded_at: datetime | None = None
    avif_url: str | None = None
    original_url: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None


class SellerInlineCreate(AppBaseModel):
    name: str = Field(min_length=2, max_length=200)
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    cpr_number: str | None = None


class ProductCreate(AppBaseModel):
    reference_number: str | None = Field(default=None, max_length=10)
    display_name: str | None = Field(default=None, max_length=255)
    product_type: ProductTypeEnum
    metal_type: MetalTypeEnum
    weight_grams: Decimal = Field(gt=0)
    purity_karat: str | None = Field(default=None, max_length=10)
    purity_percentage: Decimal | None = Field(default=None, ge=0, le=100)
    unit_count: int = Field(default=1, ge=1, le=9999)
    total_weight_grams: Decimal | None = Field(default=None, gt=0)
    purchase_date: datetime | None = None
    purchase_price_dkk: Decimal = Field(gt=0)
    gold_rate_at_purchase: Decimal | None = Field(default=None, ge=0)
    commission: Decimal = Field(default=Decimal("0"), ge=0)

    seller_customer_id: UUID | None = None
    seller_new: SellerInlineCreate | None = None

    notes: str | None = None
    storage_location: str | None = Field(default=None, max_length=100)
    needs_cleaning: bool = False
    shop_price_dkk: Decimal | None = Field(default=None, ge=0)
    shop_sync_status: str | None = Field(default=None, max_length=30)
    length_cm: str | None = Field(default=None, max_length=30)
    width_mm: Decimal | None = Field(default=None, ge=0)
    thickness_mm: Decimal | None = Field(default=None, ge=0)
    producer: str | None = Field(default=None, max_length=120)
    inventory_category: str | None = Field(default=None, max_length=30)
    inventory_subcategory: str | None = Field(default=None, max_length=30)
    operation_destination: str | None = Field(default=None, max_length=30)
    operation_classification: str | None = Field(default=None, max_length=40)
    photos: list[PhotoItem] = Field(default_factory=list)


class ProductUpdate(AppBaseModel):
    reference_number: str | None = Field(default=None, max_length=10)
    display_name: str | None = Field(default=None, max_length=255)
    product_type: ProductTypeEnum | None = None
    metal_type: MetalTypeEnum | None = None
    purchase_date: datetime | None = None
    weight_grams: Decimal | None = Field(default=None, gt=0)
    purity_karat: str | None = Field(default=None, max_length=10)
    purity_percentage: Decimal | None = Field(default=None, ge=0, le=100)
    unit_count: int | None = Field(default=None, ge=1, le=9999)
    total_weight_grams: Decimal | None = Field(default=None, gt=0)
    purchase_price_dkk: Decimal | None = Field(default=None, gt=0)
    gold_rate_at_purchase: Decimal | None = Field(default=None, ge=0)
    commission: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None
    clear_notes: bool = False
    storage_location: str | None = Field(default=None, max_length=100)
    needs_cleaning: bool | None = None
    shop_price_dkk: Decimal | None = Field(default=None, ge=0)
    shop_sync_status: str | None = Field(default=None, max_length=30)
    length_cm: str | None = Field(default=None, max_length=30)
    width_mm: Decimal | None = Field(default=None, ge=0)
    thickness_mm: Decimal | None = Field(default=None, ge=0)
    producer: str | None = Field(default=None, max_length=120)
    inventory_category: str | None = Field(default=None, max_length=30)
    inventory_subcategory: str | None = Field(default=None, max_length=30)
    operation_destination: str | None = Field(default=None, max_length=30)
    operation_classification: str | None = Field(default=None, max_length=40)
    ai_description: str | None = None
    ai_description_approved: bool | None = None
    # Optimistic concurrency — caller'ın gördüğü son updated_at; sunucudaki ile
    # eşleşmezse 409 döner. None ise check yapılmaz (geriye uyumlu).
    expected_updated_at: datetime | None = None


class ProductStatusUpdate(AppBaseModel):
    status: ProductStatusEnum
    sale_price_dkk: Decimal | None = Field(default=None, gt=0)
    buyer_customer_id: UUID | None = None
    melt_reason: str | None = Field(default=None, max_length=200)
    expected_updated_at: datetime | None = None


class ProductAIDescriptionUpdate(AppBaseModel):
    ai_description: str = Field(min_length=10)
    ai_description_approved: bool = False


class ProductPublishRequest(AppBaseModel):
    regular_price_dkk: Decimal = Field(gt=0)
    name: str | None = Field(default=None, max_length=255)


class ProductWooImportRequest(AppBaseModel):
    limit: int = Field(default=100, ge=1, le=100)
    replace_mock_seed: bool = False


class ProductWooImportResponse(AppBaseModel):
    fetched: int
    created: int
    updated: int
    skipped: int
    deleted_mock_seed: int
    imported_product_ids: list[str]
    errors: list[str]


class ProductOut(AppBaseModel):
    id: UUID
    product_number: str
    reference_number: str | None
    display_name: str | None = None
    product_type: ProductTypeEnum
    metal_type: MetalTypeEnum
    weight_grams: Decimal
    purity_karat: str | None
    purity_percentage: Decimal | None
    pure_gold_grams: Decimal | None
    unit_count: int = 1
    total_weight_grams: Decimal | None = None
    purchase_date: datetime
    purchase_price_dkk: Decimal
    gold_rate_at_purchase: Decimal | None
    commission: Decimal
    seller_customer_id: UUID | None
    seller_name: str | None = None
    gdpr_release_date: datetime
    is_gdpr_locked: bool
    status: ProductStatusEnum
    sale_date: datetime | None
    sale_price_dkk: Decimal | None
    buyer_customer_id: UUID | None
    buyer_name: str | None = None
    profit_dkk: Decimal | None
    melt_date: datetime | None
    melt_reason: str | None
    ai_description: str | None
    ai_description_approved: bool
    woocommerce_product_id: int | None
    is_published_to_site: bool
    published_at: datetime | None
    photos: list[PhotoItem]
    notes: str | None
    storage_location: str | None
    needs_cleaning: bool
    shop_price_dkk: Decimal | None = None
    shop_sync_status: str | None = None
    length_cm: str | None = None
    width_mm: Decimal | None = None
    thickness_mm: Decimal | None = None
    producer: str | None = None
    inventory_category: str | None = None
    inventory_subcategory: str | None = None
    operation_destination: str | None = None
    operation_classification: str | None = None
    manual_review_required: bool = False
    manual_review_reasons: list[str] = Field(default_factory=list)
    import_source_type: str | None = None
    created_at: datetime
    updated_at: datetime


class ProductHistoryEntryOut(AppBaseModel):
    id: UUID
    product_id: UUID
    action: str
    old_value: dict | None = None
    new_value: dict | None = None
    performed_by: UUID | None = None
    performed_by_email: str | None = None
    notes: str | None = None
    created_at: datetime


class ProductSourceAfgOut(AppBaseModel):
    pos_session_id: UUID
    sequence_no: int | None = None
    document_number: str | None = None
    issued_at: datetime | None = None
    customer_id: UUID | None = None
    customer_name: str | None = None
    # Detaylı AFG iz (M5): hangi satırdan + ağırlık + tutar
    line_no: int | None = None
    line_weight_grams: str | None = None
    line_pure_gold_grams: str | None = None
    line_total_dkk: str | None = None
    rate_dkk: str | None = None
    transaction_id: UUID | None = None


class ProductListResponse(PaginatedResponse[ProductOut]):
    pass


class ProductPublishResponse(AppBaseModel):
    wc_product_id: int
    wc_permalink: str | None = None
    product: ProductOut


class ProductHistoryOut(AppBaseModel):
    id: UUID
    action: str
    old_value: dict | None
    new_value: dict | None
    notes: str | None
    created_at: datetime


class WooSyncLogOut(AppBaseModel):
    id: UUID
    action: str
    wc_product_id: int | None
    request_payload: dict | None
    response_payload: dict | None
    status: str
    error_message: str | None
    created_at: datetime
