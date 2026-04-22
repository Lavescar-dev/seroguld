from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.enums import RoleEnum, sqlalchemy_enum


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[RoleEnum] = mapped_column(
        sqlalchemy_enum(RoleEnum, name="role_enum"),
        nullable=False,
        default=RoleEnum.ADMIN,
    )
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    address_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    cpr_number_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    cpr_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    cpr_last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    gdpr_status: Mapped[str] = mapped_column(String(30), nullable=False, default="active", server_default="active")
    gdpr_pseudonymized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    marketing_opt_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_gdpr_request_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    woocommerce_customer_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    purchased_products = relationship("Product", foreign_keys="Product.seller_customer_id", back_populates="seller_customer")
    bought_products = relationship("Product", foreign_keys="Product.buyer_customer_id", back_populates="buyer_customer")
    identity_document = relationship(
        "CustomerIdentityDocument",
        back_populates="user",
        uselist=False,
        cascade="all,delete-orphan",
    )
    pos_sessions_as_customer = relationship(
        "PosSession",
        foreign_keys="PosSession.customer_id",
        back_populates="customer",
    )
    pos_sessions_as_clerk = relationship(
        "PosSession",
        foreign_keys="PosSession.clerk_user_id",
        back_populates="clerk_user",
    )
