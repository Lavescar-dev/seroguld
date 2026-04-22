from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RefreshRequest, RegisterRequest, TokenResponse, UserOut
from app.utils.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    decrypt_field,
    encrypt_field,
    get_password_hash,
    hash_cpr,
    mask_cpr,
    verify_password,
)

router = APIRouter()


def _to_user_out(user: User) -> UserOut:
    cpr_plain = decrypt_field(user.cpr_number_encrypted)
    address_plain = decrypt_field(user.address_encrypted)
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        phone=user.phone,
        address=address_plain,
        cpr_number_masked=mask_cpr(cpr_plain),
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = await db.scalar(select(User).where(User.email == payload.email, User.is_active.is_(True)))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email veya şifre hatalı")

    access_token = create_access_token(str(user.id), user.role.value)
    refresh_token = create_refresh_token(str(user.id), user.role.value)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=_to_user_out(user),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        claims = decode_refresh_token(payload.refresh_token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token geçersiz") from exc

    user_id = claims.get("sub")
    try:
        user_uuid = UUID(str(user_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token geçersiz") from exc

    user = await db.scalar(select(User).where(User.id == user_uuid, User.is_active.is_(True)))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kullanıcı bulunamadı")

    access_token = create_access_token(str(user.id), user.role.value)
    refresh_token_value = create_refresh_token(str(user.id), user.role.value)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token_value,
        user=_to_user_out(user),
    )


@router.post("/register", response_model=UserOut)
async def register(
    payload: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> UserOut:
    existing = await db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email zaten kayıtlı")

    cpr = payload.cpr_number.strip() if payload.cpr_number else None
    user = User(
        email=payload.email,
        password_hash=get_password_hash(payload.password),
        name=payload.name,
        role=payload.role,
        phone=payload.phone,
        address_encrypted=encrypt_field(payload.address) if payload.address else None,
        cpr_number_encrypted=encrypt_field(cpr) if cpr else None,
        cpr_hash=hash_cpr(cpr),
        cpr_last4=("".join(ch for ch in cpr if ch.isdigit())[-4:] if cpr else None),
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _to_user_out(user)


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return _to_user_out(current_user)
