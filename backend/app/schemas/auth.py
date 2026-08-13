from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.models.enums import RoleEnum
from app.schemas.base import AppBaseModel


class LoginRequest(AppBaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class RefreshRequest(AppBaseModel):
    refresh_token: str


class PasswordChangeRequest(AppBaseModel):
    current_password: str = Field(min_length=1)
    # The desktop policy intentionally rejects only blank values. New hashes
    # use bcrypt-sha256, so long Unicode input is not truncated at bcrypt's
    # legacy 72-byte boundary.
    new_password: str = Field(min_length=1)
    new_password_confirmation: str = Field(min_length=1)


class RegisterRequest(AppBaseModel):
    email: EmailStr
    password: str = Field(min_length=1)
    name: str = Field(min_length=2, max_length=200)
    role: RoleEnum = RoleEnum.CUSTOMER
    phone: str | None = None
    address: str | None = None
    city: str | None = Field(default=None, max_length=120)
    cpr_number: str | None = None


class UserOut(AppBaseModel):
    id: UUID
    email: EmailStr
    name: str
    role: RoleEnum
    phone: str | None = None
    address: str | None = None
    city: str | None = None
    cpr_number_masked: str | None = None
    is_active: bool
    must_change_password: bool
    password_changed_at: datetime | None = None
    created_at: datetime


class BootstrapStateOut(AppBaseModel):
    email: EmailStr
    initial_login_pending: bool = False


class TokenResponse(AppBaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
