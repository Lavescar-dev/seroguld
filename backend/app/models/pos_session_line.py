from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, Uuid, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import MetalTypeEnum, ProductTypeEnum, sqlalchemy_enum


class PosSessionLine(Base):
    __tablename__ = "pos_session_lines"
    __table_args__ = (UniqueConstraint("pos_session_id", "line_no", name="uq_pos_session_lines_session_line_no"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pos_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pos_sessions.id"), nullable=False, index=True
    )
    line_no: Mapped[int] = mapped_column(nullable=False)

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
    purity_percentage: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    rate_dkk: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    margin_percent_internal: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0"))
    line_offer_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    pos_session = relationship("PosSession", lazy="joined")
