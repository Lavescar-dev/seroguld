from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GdprRequest(Base):
    __tablename__ = "gdpr_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reference_number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    request_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        default="submitted",
        server_default="submitted",
        index=True,
    )
    channel: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="public_page",
        server_default="public_page",
    )
    subject_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    subject_email: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    subject_phone: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_customer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )
    public_tracking_token: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    public_tracking_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_meta: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
