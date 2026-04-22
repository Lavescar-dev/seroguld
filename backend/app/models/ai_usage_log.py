from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AIUsageLog(Base):
    __tablename__ = "ai_usage_log"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("products.id"), nullable=True, index=True)
    performed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)

    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="openai")
    model: Mapped[str] = mapped_column(String(120), nullable=False)

    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    input_cost_usd: Mapped[Decimal] = mapped_column(Numeric(14, 8), nullable=False, default=Decimal("0"))
    output_cost_usd: Mapped[Decimal] = mapped_column(Numeric(14, 8), nullable=False, default=Decimal("0"))
    total_cost_usd: Mapped[Decimal] = mapped_column(Numeric(14, 8), nullable=False, default=Decimal("0"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
