from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from pydantic import Field

from app.schemas.base import AppBaseModel


class InventoryMarketPricesOut(AppBaseModel):
    gold: Decimal
    silver: Decimal
    platinum: Decimal
    palladium: Decimal


class InventoryMarketPricesUpdate(AppBaseModel):
    gold: Decimal = Field(ge=0)
    silver: Decimal = Field(ge=0)
    platinum: Decimal = Field(ge=0)
    palladium: Decimal = Field(ge=0)


class InventoryWorkspaceSummaryOut(AppBaseModel):
    total_items: int = 0
    total_purchase_value_dkk: Decimal = Decimal("0.00")
    total_spot_value_dkk: Decimal = Decimal("0.00")
    total_pure_metal_grams: Decimal = Decimal("0.00")
    total_fine_silver_grams: Decimal = Decimal("0.00")
    total_gold_related_grams: Decimal = Decimal("0.00")


class InventoryGridRowOut(AppBaseModel):
    id: UUID
    product_number: str
    reference_number: str | None = None
    main_category: str
    subcategory: str | None = None
    product_type: str
    metal_type: str
    status: str
    operation_destination: str | None = None
    operation_classification: str | None = None
    lager_dato: str
    urun: str
    saflik_label: str
    purity_percentage: Decimal | None = None
    birim_gram: Decimal
    adet: int = 1
    toplam_gram: Decimal
    has_metal_grams: Decimal | None = None
    alis_fiyati_dkk: Decimal
    spot_degeri_dkk: Decimal
    shop_fiyati_dkk: Decimal | None = None
    shop_sync_status: str | None = None
    is_published_to_site: bool = False
    # Woo katalog kaydına bağlı mı (linked_product_id == bu ürün)
    is_woo_linked: bool = False
    length_cm: str | None = None
    width_mm: Decimal | None = None
    thickness_mm: Decimal | None = None
    diameter_mm: Decimal | None = None
    producer: str | None = None
    storage_location: str | None = None
    needs_cleaning: bool = False
    is_gdpr_locked: bool = False
    primary_photo: str | None = None
    photo_count: int = 0
    has_ai_description: bool = False
    ai_description_approved: bool = False
    notes: str | None = None


class InventoryWorkspaceOut(AppBaseModel):
    market_prices: InventoryMarketPricesOut
    summary: InventoryWorkspaceSummaryOut
    rows: list[InventoryGridRowOut] = Field(default_factory=list)
