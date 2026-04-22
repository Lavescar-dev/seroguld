from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DocumentArtifact(Base):
    __tablename__ = "document_artifacts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    artifact_key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False, index=True)
    module_name: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    document_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    business_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    version_kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    is_live: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    template_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
