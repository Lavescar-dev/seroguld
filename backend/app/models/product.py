from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum, sqlalchemy_enum


class Product(Base):
    __tablename__ = "products"
    # reference_number kısmi unique (NULL'lar hariç) — 0037 migration ile eşleşir.
    __table_args__ = (
        Index(
            "uq_products_reference_number",
            "reference_number",
            unique=True,
            sqlite_where=text("reference_number IS NOT NULL"),
            postgresql_where=text("reference_number IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_number: Mapped[str] = mapped_column(String(4), unique=True, nullable=False, index=True)
    reference_number: Mapped[str | None] = mapped_column(String(10), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    product_type: Mapped[ProductTypeEnum] = mapped_column(
        sqlalchemy_enum(ProductTypeEnum, name="product_type_enum"),
        nullable=False,
    )
    metal_type: Mapped[MetalTypeEnum] = mapped_column(
        sqlalchemy_enum(MetalTypeEnum, name="metal_type_enum"),
        nullable=False,
    )
    weight_grams: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    purity_karat: Mapped[str | None] = mapped_column(String(10), nullable=True)
    purity_percentage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    pure_gold_grams: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    unit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    total_weight_grams: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    purchase_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    purchase_price_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    gold_rate_at_purchase: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    commission: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)

    seller_customer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)

    gdpr_release_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_gdpr_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    status: Mapped[ProductStatusEnum] = mapped_column(
        sqlalchemy_enum(ProductStatusEnum, name="product_status_enum"),
        nullable=False,
        default=ProductStatusEnum.PURCHASED,
    )

    sale_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sale_price_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    buyer_customer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    profit_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    melt_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    melt_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)

    ai_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_description_approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    woocommerce_product_id: Mapped[int | None] = mapped_column(nullable=True)
    # Yayın kategorisi override'ı (WC kategori ID listesi); boşsa Settings haritası kullanılır.
    woocommerce_category_ids: Mapped[list | None] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=True
    )
    # Yayın profili override'ı (jewelry/bar/coin/platinum); boşsa üründen türetilir.
    woocommerce_publish_profile: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Sikke üretim yılı (Årstal attribute'u); operatör girer / AI önerir.
    production_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_published_to_site: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    photos: Mapped[list] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=list)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    needs_cleaning: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    shop_price_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    shop_sync_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Woo otomatik metal fiyatı (WP "Live Gold Price" meta sözleşmesi):
    # markup ondalık fraksiyon (0.37 = %37); NULL = settings default'u.
    woo_markup_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 5), nullable=True)
    woo_min_price_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    length_cm: Mapped[str | None] = mapped_column(String(30), nullable=True)
    width_mm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    thickness_mm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    diameter_mm: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    producer: Mapped[str | None] = mapped_column(String(120), nullable=True)
    inventory_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    inventory_subcategory: Mapped[str | None] = mapped_column(String(30), nullable=True)
    operation_destination: Mapped[str | None] = mapped_column(String(30), nullable=True)
    operation_classification: Mapped[str | None] = mapped_column(String(40), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    seller_customer = relationship("User", foreign_keys=[seller_customer_id], back_populates="purchased_products")
    buyer_customer = relationship("User", foreign_keys=[buyer_customer_id], back_populates="bought_products")
    history = relationship("ProductHistory", back_populates="product", cascade="all,delete-orphan")
