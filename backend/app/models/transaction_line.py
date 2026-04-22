from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TransactionLine(Base):
    __tablename__ = "transaction_lines"
    __table_args__ = (UniqueConstraint("transaction_id", "line_no", name="uq_transaction_lines_tx_line_no"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("transactions.id"), nullable=False, index=True)
    line_no: Mapped[int] = mapped_column(nullable=False, default=1)

    product_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id"), nullable=True, index=True)
    product_number: Mapped[str | None] = mapped_column(String(4), nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(10), nullable=True)

    product_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    metal_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    weight_grams: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    purity_karat: Mapped[str | None] = mapped_column(String(10), nullable=True)
    purity_percentage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    pure_gold_grams: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    rate_dkk: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    margin_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("0"), server_default="0")
    line_total_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    transaction = relationship("Transaction", back_populates="lines")

