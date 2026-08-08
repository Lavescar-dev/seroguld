from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, JSON, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


COPY_TASK_PENDING = "pending"
COPY_TASK_RUNNING = "running"
COPY_TASK_DELETED = "deleted"
COPY_TASK_PSEUDONYMIZED = "pseudonymized"
COPY_TASK_LEGALLY_RETAINED = "legally_retained"
COPY_TASK_MANUAL_ACTION_REQUIRED = "manual_action_required"
COPY_TASK_FAILED = "failed"

COPY_TASK_TERMINAL_STATES = frozenset(
    {
        COPY_TASK_DELETED,
        COPY_TASK_PSEUDONYMIZED,
        COPY_TASK_LEGALLY_RETAINED,
        COPY_TASK_MANUAL_ACTION_REQUIRED,
        COPY_TASK_FAILED,
    }
)
COPY_TASK_COMPLETION_STATES = frozenset(
    {COPY_TASK_DELETED, COPY_TASK_PSEUDONYMIZED, COPY_TASK_LEGALLY_RETAINED}
)
COPY_TASK_STATES = frozenset({COPY_TASK_PENDING, COPY_TASK_RUNNING, *COPY_TASK_TERMINAL_STATES})


class GdprCopyTask(Base):
    __tablename__ = "gdpr_copy_tasks"
    __table_args__ = (
        UniqueConstraint("request_id", "task_key", name="uq_gdpr_copy_tasks_request_task"),
        CheckConstraint(
            "status IN ('pending', 'running', 'deleted', 'pseudonymized', 'legally_retained', 'manual_action_required', 'failed')",
            name="ck_gdpr_copy_tasks_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("gdpr_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_key: Mapped[str] = mapped_column(String(80), nullable=False)
    system_name: Mapped[str] = mapped_column(String(120), nullable=False)
    copy_scope: Mapped[str] = mapped_column(String(200), nullable=False)
    applicable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    status: Mapped[str] = mapped_column(String(40), nullable=False, default=COPY_TASK_PENDING, server_default=COPY_TASK_PENDING, index=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=dict)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
