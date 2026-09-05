from __future__ import annotations

import hashlib
import logging
import threading
import time
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
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

logger = logging.getLogger(__name__)

# --- Giriş sertleştirme ---------------------------------------------------
# Masaüstü tek-kullanıcı akışı için bilinçli olarak hafif: slowapi/Redis yok,
# süreç içi sayaç + üstel kilit. IP+e-posta bazlıdır; reset için süreç
# yeniden başlatmak yeterlidir.
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 300.0
_LOGIN_LOCKOUT_SECONDS = 900.0
_login_attempts: dict[str, list[float]] = {}
_LOGIN_ATTEMPTS_LOCK = threading.Lock()

# Olmayan hesapta da bcrypt maliyeti ödenir; yanıt süresi hesap varlığını
# ifşa etmesin. Sabit, geçerli bir bcrypt-sha256 özeti: her aday parola için
# doğrulama tam maliyetini öder ve False döner.
_TIMING_DUMMY_PASSWORD_HASH = (
    "$bcrypt-sha256$v=2,t=2b,r=12$1eP.TH72TvDd9zDpvhAT9e$oqvuXmCxUFmp0SgDWIHAHUvdnWKrAZ2"
)

# --- Refresh token iptali (denylist) --------------------------------------
# JWT'de jti/token_version alanı yok (User şeması değişmeden); şifre değişimi
# sonrası çalınan refresh token'ın 14 güne kadar çalışmaya devam etmesini
# engellemek için süreç içi denylist tutulur. Tek süreçli masaüstü runtime'ı
# için yeterli; restart denylist'i sıfırlar (tokenlar zaten DB'siz doğrulanır).
_REVOKED_REFRESH_TOKENS: dict[str, float] = {}
_REVOKE_LOCK = threading.Lock()


def _login_attempt_key(client_ip: str, email: str) -> str:
    return f"{client_ip}|{email.strip().lower()}"


def _prune_login_attempts(attempts: list[float], now: float) -> list[float]:
    return [ts for ts in attempts if now - ts < _LOGIN_LOCKOUT_SECONDS]


def _has_login_lockout(key: str) -> bool:
    now = time.monotonic()
    with _LOGIN_ATTEMPTS_LOCK:
        attempts = _prune_login_attempts(_login_attempts.get(key, []), now)
        _login_attempts[key] = attempts
        recent = [ts for ts in attempts if now - ts < _LOGIN_WINDOW_SECONDS]
        return len(recent) >= _LOGIN_MAX_ATTEMPTS


def _record_failed_login(key: str) -> None:
    now = time.monotonic()
    with _LOGIN_ATTEMPTS_LOCK:
        attempts = _prune_login_attempts(_login_attempts.get(key, []), now)
        attempts.append(now)
        _login_attempts[key] = attempts


def _clear_failed_logins(key: str) -> None:
    with _LOGIN_ATTEMPTS_LOCK:
        _login_attempts.pop(key, None)


def _refresh_token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _revoke_refresh_token(token: str) -> None:
    settings = get_settings()
    lifetime = settings.jwt_refresh_expire_days * 24 * 3600 + 3600
    now = time.monotonic()
    with _REVOKE_LOCK:
        for fingerprint, expires_at in list(_REVOKED_REFRESH_TOKENS.items()):
            if expires_at <= now:
                _REVOKED_REFRESH_TOKENS.pop(fingerprint, None)
        _REVOKED_REFRESH_TOKENS[_refresh_token_fingerprint(token)] = now + lifetime


def _is_refresh_token_revoked(token: str) -> bool:
    fingerprint = _refresh_token_fingerprint(token)
    now = time.monotonic()
    with _REVOKE_LOCK:
        expires_at = _REVOKED_REFRESH_TOKENS.get(fingerprint)
        if expires_at is None:
            return False
        if expires_at <= now:
            _REVOKED_REFRESH_TOKENS.pop(fingerprint, None)
            return False
        return True


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


_PASSWORD_MIN_LENGTH = 8


def _password_policy_error(password: str) -> str | None:
    if not password.strip():
        return "Yeni şifre boş olamaz"
    # Boş-kontrol politikası tek başına yetersizdi: aynı akış CUSTOMER
    # parolalarını da belirlediğinden minimum uzunluk uygulanır. Yeni hash'ler
    # bcrypt-sha256 kullandığından uzun Unicode girişler yine kırpılmaz.
    if len(password) < _PASSWORD_MIN_LENGTH:
        return f"Yeni şifre en az {_PASSWORD_MIN_LENGTH} karakter olmalı"
    return None


def _mask_email(email: str) -> str:
    """Kimlik doğrulamasız ucun e-posta maskesi: kimlik ifşa edilmesin, ilk
    harf + alan adı ilk kurulum ipucu olarak kalsın."""

    local, _, domain = email.partition("@")
    if not local or not domain:
        return "***"
    return f"{local[:1]}***@{domain}"


@router.get("/bootstrap-state", response_model=BootstrapStateOut)
async def bootstrap_state(db: AsyncSession = Depends(get_db)) -> BootstrapStateOut:
    """Return only the safe one-time bootstrap hint for the desktop login."""

    settings = get_settings()
    # Devre dışı (is_active=False) hesapların e-postası ifşa edilmesin.
    user = await db.scalar(
        select(User).where(
            User.email == settings.initial_admin_email,
            User.role == RoleEnum.ADMIN,
            User.is_active.is_(True),
        )
    )
    if user is not None and getattr(user, "role", RoleEnum.ADMIN) != RoleEnum.ADMIN:
        user = None
    has_any_account = user is not None
    if user is None:
        candidate = await db.scalar(
            select(User)
            .where(User.is_active.is_(True))
            .order_by(case((User.role == RoleEnum.ADMIN, 0), else_=1), User.created_at.asc())
        )
        has_any_account = candidate is not None
        if candidate is not None and getattr(candidate, "role", RoleEnum.ADMIN) == RoleEnum.ADMIN:
            user = candidate
    # Desktop kurulumunda login ekranı tam e-postayı gösterebilir; sunucu
    # (production/development) dağıtımında uç auth'suz olduğundan maskeleme zorunlu.
    email = user.email if user is not None else settings.initial_admin_email
    if settings.env.strip().lower() != "desktop":
        email = _mask_email(email)
    return BootstrapStateOut(
        email=email,
        initial_login_pending=bool(user.must_change_password) if user is not None else not has_any_account,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    client_ip = request.client.host if request.client else "unknown"
    attempt_key = _login_attempt_key(client_ip, payload.email)
    if _has_login_lockout(attempt_key):
        logger.warning("Login kilidi aktif (çok fazla başarısız deneme): ip=%s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Çok fazla başarısız deneme; kısa süre sonra tekrar deneyin.",
        )

    user = await db.scalar(select(User).where(User.email == payload.email, User.is_active.is_(True)))
    if user is None:
        # short-circuit yok: olmayan hesap da aynı bcrypt maliyetini öder.
        verify_password(payload.password, _TIMING_DUMMY_PASSWORD_HASH)
    if user is None or not verify_password(payload.password, user.password_hash):
        _record_failed_login(attempt_key)
        logger.warning("Başarısız giriş denemesi: email=%s ip=%s", payload.email, client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email veya şifre hatalı")

    _clear_failed_logins(attempt_key)
    access_token = create_access_token(str(user.id), user.role.value)
    refresh_token = create_refresh_token(str(user.id), user.role.value)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=_to_user_out(user),
    )


@router.post("/logout")
async def logout(payload: RefreshRequest) -> dict[str, str]:
    """Refresh token'ı sunucu tarafında denylist'e alır.

    Oturumu kapatmak (ya da çalınan refresh token'ı etkisizleştirmek) için
    token'ın kendisini taşıyan istemci yeterli — uç kasıtlı olarak ekstra
    yetki istemez. Access token kısa ömürlüdür; reddedilen refresh artık
    yeni access token üretemez.
    """

    _revoke_refresh_token(payload.refresh_token)
    return {"status": "logged_out"}


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        claims = decode_refresh_token(payload.refresh_token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token geçersiz") from exc

    if _is_refresh_token_revoked(payload.refresh_token):
        # /api/auth/logout ile iptal edilmiş (ör. şifre değişimi sonrası çalınan) token.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token geçersiz")

    user_id = claims.get("sub")
    try:
        user_uuid = UUID(str(user_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token geçersiz") from exc

    user = await db.scalar(select(User).where(User.id == user_uuid, User.is_active.is_(True)))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kullanıcı bulunamadı")

    # Şifre değişimi, değişimden ÖNCE verilmiş refresh token'ları geçersiz kılar:
    # User şemasına token_version eklemeden iat <-> password_changed_at
    # karşılaştırması aynı garantiyi verir. iat'sız (bu sürüm öncesi) token'lar
    # da reddedilir; ilgili kullanıcı bir kez yeniden giriş yapar.
    password_changed_at = user.password_changed_at
    if password_changed_at is not None:
        if password_changed_at.tzinfo is None:
            # SQLite round-tripi tz bilgisini atar; değer zaten UTC duvar saatidir.
            password_changed_at = password_changed_at.replace(tzinfo=timezone.utc)
        issued_at = claims.get("iat")
        if not isinstance(issued_at, (int, float)) or issued_at < int(password_changed_at.timestamp()):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token geçersiz")

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
