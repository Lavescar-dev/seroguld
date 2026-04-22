from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.models.enums import RoleEnum
from app.schemas.base import AppBaseModel


class LoginRequest(AppBaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class RefreshRequest(AppBaseModel):
    refresh_token: str


class RegisterRequest(AppBaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=2, max_length=200)
    role: RoleEnum = RoleEnum.CUSTOMER
    phone: str | None = None
    address: str | None = None
    cpr_number: str | None = None


class UserOut(AppBaseModel):
    id: UUID
    email: EmailStr
    name: str
    role: RoleEnum
    phone: str | None = None
    address: str | None = None
    cpr_number_masked: str | None = None
    is_active: bool
    created_at: datetime


class TokenResponse(AppBaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut
