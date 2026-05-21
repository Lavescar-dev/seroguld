from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AfgMeltLot(Base):
    __tablename__ = "afg_melt_lots"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    metal_bucket: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    sent_date: Mapped[date] = mapped_column(Date, nullable=False)
    purchased_from_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    before_weight_grams: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"), server_default="0")
    before_amount_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0")
    before_pure_gold_grams: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"), server_default="0")
    after_pure_gold_grams: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=Decimal("0"), server_default="0")

    insurance_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0")
    shipping_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0")
    refining_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0")

    sale_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    quote_eur: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    exchange_rate_dkk: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=Decimal("7.45"), server_default="7.45")

    payout_total_dkk: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Lifecycle: draft (editable) | finalized (kilitli, yıl sonu)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft", server_default="draft", index=True
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finalized_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
