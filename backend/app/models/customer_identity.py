from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import IdentityDocTypeEnum, sqlalchemy_enum


class CustomerIdentityDocument(Base):
    __tablename__ = "customer_identity_documents"
    __table_args__ = (
        Index(
            "uq_customer_identity_documents_doc_hash",
            "identity_doc_number_hash",
            unique=True,
            sqlite_where=text("identity_doc_number_hash IS NOT NULL"),
            postgresql_where=text("identity_doc_number_hash IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    identity_doc_type: Mapped[IdentityDocTypeEnum | None] = mapped_column(
        sqlalchemy_enum(IdentityDocTypeEnum, name="identity_doc_type_enum"),
        nullable=True,
    )
    identity_doc_number_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    identity_doc_number_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    identity_doc_country: Mapped[str | None] = mapped_column(String(8), nullable=True)
    identity_photo_refs: Mapped[list] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user = relationship("User", back_populates="identity_document")
