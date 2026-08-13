from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


JsonColumn = JSON().with_variant(JSONB, "postgresql")


class WooCommerceCatalogState(Base):
    __tablename__ = "woocommerce_catalog_state"

    catalog_key: Mapped[str] = mapped_column(String(40), primary_key=True, default="default")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    remote_published_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class WooCommerceCatalogItem(Base):
    __tablename__ = "woocommerce_catalog_items"
    __table_args__ = (
        UniqueConstraint("woocommerce_product_id", name="uq_woocommerce_catalog_items_remote_product"),
        UniqueConstraint("linked_product_id", name="uq_woocommerce_catalog_items_linked_product"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    woocommerce_product_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sku: Mapped[str | None] = mapped_column(String(120), nullable=True)
    permalink: Mapped[str | None] = mapped_column(Text, nullable=True)
    remote_status: Mapped[str] = mapped_column(String(30), nullable=False, default="publish", server_default="publish")
    catalog_visibility: Mapped[str | None] = mapped_column(String(30), nullable=True)
    stock_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    stock_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    regular_price_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    sale_price_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    weight_raw: Mapped[str | None] = mapped_column(String(80), nullable=True)
    weight_grams: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    weight_missing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    manual_review_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    manual_review_reasons: Mapped[list] = mapped_column(JsonColumn, nullable=False, default=list)
    photo_missing: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false", index=True)
    image_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    images_json: Mapped[list] = mapped_column(JsonColumn, nullable=False, default=list)
    categories_json: Mapped[list] = mapped_column(JsonColumn, nullable=False, default=list)
    source_payload_json: Mapped[dict] = mapped_column(JsonColumn, nullable=False, default=dict)
    source_payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    remote_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remote_modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)
    linked_product_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
