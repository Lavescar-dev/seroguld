from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pos_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pos_sessions.id"), nullable=False, unique=True, index=True
    )
    pos_document_sequence_no: Mapped[int | None] = mapped_column(
        ForeignKey("pos_documents.sequence_no"),
        nullable=True,
        index=True,
    )
    trade_side: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="confirmed", server_default="confirmed")

    customer_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    clerk_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)

    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, default="DKK", server_default="DKK")
    gross_amount_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    net_amount_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    vat_rate_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0"), server_default="0")
    vat_amount_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0")

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    lines = relationship("TransactionLine", back_populates="transaction", cascade="all,delete-orphan")

