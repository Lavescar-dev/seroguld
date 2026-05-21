from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PosDocumentAudit(Base):
    """Operatör hareketleri için audit trail.

    Edit/Delete/Cancel/Finalize gibi state-değiştiren PosDocument işlemleri
    bu tabloya yazılır. Forensic / GDPR / regulatory iz için kalıcıdır.
    """

    __tablename__ = "pos_document_audit"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sequence_no: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    pos_session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pos_sessions.id"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    """Eylem türü: 'finalize' | 'edit' | 'delete' | 'cancel' | 'uniconta_retry'."""

    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    actor_email: Mapped[str | None] = mapped_column(String(200), nullable=True)

    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
