from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import PosDocumentTypeEnum, sqlalchemy_enum

if TYPE_CHECKING:
    from app.models.pos_session import PosSession


class PosDocument(Base):
    __tablename__ = "pos_documents"

    sequence_no: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    pos_session_id: Mapped[UUID] = mapped_column(
        ForeignKey("pos_sessions.id"),
        nullable=False,
        unique=True,
        index=True,
    )
    document_type: Mapped[PosDocumentTypeEnum] = mapped_column(
        sqlalchemy_enum(PosDocumentTypeEnum, name="pos_document_type_enum"),
        nullable=False,
    )
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    supply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    currency_code: Mapped[str] = mapped_column(String(3), nullable=False, default="DKK", server_default="DKK")
    gross_amount_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    net_amount_dkk: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    vat_rate_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    vat_amount_dkk: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )

    customer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    customer_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    customer_address: Mapped[str | None] = mapped_column(Text, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    pos_session: Mapped["PosSession"] = relationship("PosSession", lazy="joined")
