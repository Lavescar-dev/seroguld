from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, JSON, Numeric, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductTypeEnum,
    sqlalchemy_enum,
)


class PosSession(Base):
    __tablename__ = "pos_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    display_token: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)

    clerk_user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    trade_side: Mapped[PosTradeSideEnum] = mapped_column(
        sqlalchemy_enum(PosTradeSideEnum, name="pos_trade_side_enum"),
        nullable=False,
        default=PosTradeSideEnum.BUY_FROM_CUSTOMER,
    )
    product_type: Mapped[ProductTypeEnum | None] = mapped_column(
        sqlalchemy_enum(ProductTypeEnum, name="product_type_enum"),
        nullable=True,
    )
    metal_type: Mapped[MetalTypeEnum | None] = mapped_column(
        sqlalchemy_enum(MetalTypeEnum, name="metal_type_enum"),
        nullable=True,
    )
    weight_grams: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    purity_karat: Mapped[str | None] = mapped_column(String(10), nullable=True)
    purity_percentage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)

    live_rate_dkk: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    manual_rate_dkk: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    rate_source: Mapped[PosRateSourceEnum] = mapped_column(
        sqlalchemy_enum(PosRateSourceEnum, name="pos_rate_source_enum"),
        nullable=False,
        default=PosRateSourceEnum.LIVE,
    )
    margin_percent_internal: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0"))
    final_offer_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)

    visible_snapshot: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[PosSessionStatusEnum] = mapped_column(
        sqlalchemy_enum(PosSessionStatusEnum, name="pos_session_status_enum"),
        nullable=False,
        default=PosSessionStatusEnum.DRAFT,
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    clerk_user = relationship("User", foreign_keys=[clerk_user_id], back_populates="pos_sessions_as_clerk")
    customer = relationship("User", foreign_keys=[customer_id], back_populates="pos_sessions_as_customer")
