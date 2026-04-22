from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CustomerActivityEvent(Base):
    __tablename__ = "customer_activity_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    pos_session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pos_sessions.id"), nullable=True, index=True
    )
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="pos_session")

    address_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    phone_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    cpr_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    identity_doc_number_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
