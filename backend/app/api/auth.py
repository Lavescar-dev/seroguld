from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.config import get_settings
from app.database import get_db
from app.models.enums import RoleEnum
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    PasswordChangeRequest,
    RefreshRequest,
    RegisterRequest,
    BootstrapStateOut,
    TokenResponse,
    UserOut,
)
from app.schemas.customer import CustomerCreate
from app.services.customer_service import create_customer
from app.utils.cpr import normalize_cpr
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
        city=user.city,
        cpr_number_masked=mask_cpr(cpr_plain),
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        password_changed_at=user.password_changed_at,
        created_at=user.created_at,
    )


def _password_policy_error(password: str) -> str | None:
    if not password.strip():
        return "Yeni şifre boş olamaz"
    return None


@router.get("/bootstrap-state", response_model=BootstrapStateOut)
async def bootstrap_state(db: AsyncSession = Depends(get_db)) -> BootstrapStateOut:
    """Return only the safe one-time bootstrap hint for the desktop login."""

    settings = get_settings()
    user = await db.scalar(
        select(User).where(User.email == settings.initial_admin_email, User.role == RoleEnum.ADMIN)
    )
    if user is not None and getattr(user, "role", RoleEnum.ADMIN) != RoleEnum.ADMIN:
        user = None
    has_any_account = user is not None
    if user is None:
        candidate = await db.scalar(
            select(User).order_by(case((User.role == RoleEnum.ADMIN, 0), else_=1), User.created_at.asc())
        )
        has_any_account = candidate is not None
        if candidate is not None and getattr(candidate, "role", RoleEnum.ADMIN) == RoleEnum.ADMIN:
            user = candidate
    return BootstrapStateOut(
        email=user.email if user is not None else settings.initial_admin_email,
        initial_login_pending=bool(user.must_change_password) if user is not None else not has_any_account,
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


@router.post("/change-password", response_model=TokenResponse)
async def change_password(
    payload: PasswordChangeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TokenResponse:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mevcut şifre hatalı")
    if payload.new_password != payload.new_password_confirmation:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yeni şifreler eşleşmiyor")
    policy_error = _password_policy_error(payload.new_password)
    if policy_error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=policy_error)

    current_user.password_hash = get_password_hash(payload.new_password)
    current_user.must_change_password = False
    current_user.password_changed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(current_user)

    return TokenResponse(
        access_token=create_access_token(str(current_user.id), current_user.role.value),
        refresh_token=create_refresh_token(str(current_user.id), current_user.role.value),
        user=_to_user_out(current_user),
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

    # Customer registration must share the normalized CPR hashing, duplicate
    # preflight, and savepoint race handling used by every other create path.
    if payload.role == RoleEnum.CUSTOMER:
        user = await create_customer(
            db,
            CustomerCreate(
                email=payload.email,
                password=payload.password,
                name=payload.name,
                phone=payload.phone,
                address=payload.address,
                city=payload.city,
                cpr_number=payload.cpr_number,
            ),
        )
        await db.commit()
        await db.refresh(user)
        return _to_user_out(user)

    cpr = normalize_cpr(payload.cpr_number) or None
    user = User(
        email=payload.email,
        password_hash=get_password_hash(payload.password),
        name=payload.name,
        role=payload.role,
        phone=payload.phone,
        address_encrypted=encrypt_field(payload.address) if payload.address else None,
        city=(payload.city or "").strip() or None,
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
