from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MarketRateConfirmation(Base):
    __tablename__ = "market_rate_confirmations"
    __table_args__ = (
        UniqueConstraint("business_date", name="uq_market_rate_confirmations_business_date"),
        CheckConstraint(
            "confirmation_mode IN ('saved', 'unchanged')",
            name="ck_market_rate_confirmations_mode",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    business_timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, default="Europe/Copenhagen", server_default="Europe/Copenhagen"
    )
    confirmation_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    gold_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    silver_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    platinum_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    palladium_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    confirmed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
