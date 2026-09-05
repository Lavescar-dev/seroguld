"""M2 auth sertleştirme bulguları: login rate-limit/timing, refresh iptali,
bootstrap-state bilgi sızıntısı ve bootstrap rol kapısı."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import auth as auth_module
from app.api.bootstrap import get_bootstrap, router as bootstrap_router
from app.api.deps import require_admin
from app.config import Settings, get_settings
from app.database import Base
from app.models.enums import RoleEnum
from app.models.user import User
from app.schemas.auth import LoginRequest, RefreshRequest
from app.utils.security import create_refresh_token, get_password_hash, verify_password


class FakeRequest:
    """login'in yalnız request.client.host alanını okur; TestClient'a gerek yok."""

    client = None


class StaticSession:
    def __init__(self, user) -> None:
        self._user = user

    async def scalar(self, _statement):
        return self._user


def _call_login(email: str, password: str, user) -> HTTPException | None:
    try:
        asyncio.run(
            auth_module.login(
                LoginRequest(email=email, password=password),
                FakeRequest(),  # type: ignore[arg-type]
                StaticSession(user),  # type: ignore[arg-type]
            )
        )
    except HTTPException as exc:  # noqa: PERF203
        return exc
    return None


@pytest.fixture(autouse=True)
def _reset_login_state():
    auth_module._login_attempts.clear()
    auth_module._REVOKED_REFRESH_TOKENS.clear()
    yield
    auth_module._login_attempts.clear()
    auth_module._REVOKED_REFRESH_TOKENS.clear()


def _admin_user(email: str = "owner@seroguld.dk") -> User:
    # Kalıcılık yok: UserOut şeması id/created_at istediği için açık ver.
    return User(
        id=uuid.uuid4(),
        email=email,
        name="Owner",
        role=RoleEnum.ADMIN,
        password_hash=get_password_hash("correct-horse-battery"),
        is_active=True,
        must_change_password=False,
        created_at=datetime.now(timezone.utc),
    )


def test_login_unknown_account_returns_401_without_raising_on_dummy_verify() -> None:
    # Olmayan hesap: dummy-hash verify sessizce False döner, 401 gelir ve
    # yanıt süresi gerçek hesapla karşılaştırılabilir (timing sızıntısı kapalı).
    exc = _call_login("ghost@example.com", "whatever-secret", user=None)
    assert exc is not None
    assert exc.status_code == 401
    assert exc.detail == "Email veya şifre hatalı"
    # dummy hash gerçek bir bcrypt-sha256 özetidir: yanlış parola False döner
    assert verify_password("whatever-secret", auth_module._TIMING_DUMMY_PASSWORD_HASH) is False


def test_login_locks_after_repeated_failures() -> None:
    for _ in range(auth_module._LOGIN_MAX_ATTEMPTS):
        exc = _call_login("locked@example.com", "wrong-password", user=None)
        assert exc is not None and exc.status_code == 401

    exc = _call_login("locked@example.com", "wrong-password", user=None)
    assert exc is not None and exc.status_code == 429

    key = auth_module._login_attempt_key("unknown", "locked@example.com")
    assert auth_module._has_login_lockout(key)


def test_successful_login_clears_failure_counter() -> None:
    user = _admin_user("clean@example.com")

    for _ in range(auth_module._LOGIN_MAX_ATTEMPTS - 1):
        exc = _call_login("clean@example.com", "wrong-password", user=None)
        assert exc is not None and exc.status_code == 401

    response = asyncio.run(
        auth_module.login(
            LoginRequest(email="clean@example.com", password="correct-horse-battery"),
            FakeRequest(),  # type: ignore[arg-type]
            StaticSession(user),  # type: ignore[arg-type]
        )
    )
    assert response.access_token
    assert response.user.email == "clean@example.com"
    key = auth_module._login_attempt_key("unknown", "clean@example.com")
    assert auth_module._login_attempts.get(key) in (None, [])
    assert auth_module._has_login_lockout(key) is False


def test_logout_revokes_refresh_token_for_refresh_flow() -> None:
    token = create_refresh_token("00000000-0000-0000-0000-000000000000", "admin")

    asyncio.run(auth_module.logout(RefreshRequest(refresh_token=token)))
    assert auth_module._is_refresh_token_revoked(token)

    user = _admin_user("revoked@example.com")
    with pytest.raises(HTTPException) as captured:
        asyncio.run(
            auth_module.refresh_token(
                RefreshRequest(refresh_token=token),
                StaticSession(user),  # type: ignore[arg-type]
            )
        )
    assert captured.value.status_code == 401

    # İptal edilmemiş token aynı akıştan sorunsuz geçer.
    fresh = create_refresh_token(str(user.id), user.role.value)
    response = asyncio.run(
        auth_module.refresh_token(
            RefreshRequest(refresh_token=fresh),
            StaticSession(user),  # type: ignore[arg-type]
        )
    )
    assert response.refresh_token


def test_bootstrap_state_masks_email_for_non_desktop_and_skips_inactive_admin() -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            session.add(
                User(
                    email="admin@seroguld.dk",
                    name="Disabled Admin",
                    role=RoleEnum.ADMIN,
                    password_hash=get_password_hash("whatever-long-password"),
                    is_active=False,
                    must_change_password=False,
                )
            )
            await session.commit()

        async with Session() as session:
            for env, expected_email in (("production", "a***@seroguld.dk"), ("desktop", "admin@seroguld.dk")):
                monkey_settings = Settings(initial_admin_email="admin@seroguld.dk", env=env)
                original_get_settings = auth_module.get_settings
                auth_module.get_settings = lambda monkey_settings=monkey_settings: monkey_settings
                try:
                    state = await auth_module.bootstrap_state(session)
                finally:
                    auth_module.get_settings = original_get_settings
                # Devre dışı admin'in e-postası ifşa edilmez (desktop'ta kurulum
                # ipucu olarak tam adres kalır).
                assert state.email == expected_email, env
        await engine.dispose()

    asyncio.run(run())


def test_password_change_invalidates_refresh_tokens_issued_before_it() -> None:
    """Şifre değişimi, değişimden ÖNCE verilmiş refresh token'ları ölü doğurur;
    değişim anında/sonrasında verilmiş token (change-password yanıtındakiler
    dahil) sorunsuz döner."""

    user = _admin_user("rotate@example.com")
    settings = get_settings()
    # SQLite round-tripini simüle et: tz bilgisi atılmış naive UTC duvar saati.
    changed_at = datetime.now(timezone.utc).replace(microsecond=0)
    user.password_changed_at = changed_at.replace(tzinfo=None)
    threshold = int(changed_at.timestamp())

    def _refresh_token(iat: int) -> str:
        return jwt.encode(
            {
                "sub": str(user.id),
                "role": user.role.value,
                "type": "refresh",
                "iat": iat,
                "exp": changed_at + timedelta(days=1),
            },
            settings.jwt_refresh_secret,
            algorithm="HS256",
        )

    # Değişimden ÖNCEki saniyede verilmiş token → reddedilir.
    with pytest.raises(HTTPException) as captured:
        asyncio.run(
            auth_module.refresh_token(
                RefreshRequest(refresh_token=_refresh_token(threshold - 1)),
                StaticSession(user),  # type: ignore[arg-type]
            )
        )
    assert captured.value.status_code == 401

    # Değişim anında verilmiş token → geçerli.
    response = asyncio.run(
        auth_module.refresh_token(
            RefreshRequest(refresh_token=_refresh_token(threshold)),
            StaticSession(user),  # type: ignore[arg-type]
        )
    )
    assert response.refresh_token


def test_refresh_rejects_legacy_token_without_iat_after_password_change() -> None:
    """Bu sürüm öncesi verilmiş (iat'sız) refresh token, kullanıcının şifresi
    bir kez bile değişmişse reddedilir — tek seferlik yeniden giriş yeter."""

    user = _admin_user("legacy@example.com")
    user.password_changed_at = datetime.now(timezone.utc).replace(tzinfo=None)

    legacy_claims = {
        "sub": str(user.id),
        "role": user.role.value,
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
    }
    legacy_token = jwt.encode(legacy_claims, get_settings().jwt_refresh_secret, algorithm="HS256")

    with pytest.raises(HTTPException) as captured:
        asyncio.run(
            auth_module.refresh_token(
                RefreshRequest(refresh_token=legacy_token),
                StaticSession(user),  # type: ignore[arg-type]
            )
        )
    assert captured.value.status_code == 401


def test_bootstrap_delegate_call_rejects_customer_role() -> None:
    """/api/v2/bootstrap get_bootstrap'i açık argümanla çağırır; signature'daki
    Depends(require_admin) plain Python çağrısında çözümlenmez. Gövde içi rol
    denetimi CUSTOMER'ı 403'te kesmeli (ciro/stok/backup telemetrisi sızmasın)."""

    customer = User(
        id=uuid.uuid4(),
        email="portal@example.com",
        name="Portal Customer",
        role=RoleEnum.CUSTOMER,
        password_hash=get_password_hash("whatever-long-password"),
        is_active=True,
        must_change_password=False,
    )
    with pytest.raises(HTTPException) as captured:
        asyncio.run(
            get_bootstrap(
                db=StaticSession(None),  # type: ignore[arg-type]
                current_user=customer,  # type: ignore[arg-type]
            )
        )
    assert captured.value.status_code == 403


def test_bootstrap_route_is_role_gated_by_require_admin() -> None:
    """/api/bootstrap ve /api/v2/bootstrap aynı fonksiyona delege olur;
    route bağımlılığı require_admin olmalı (CUSTOMER token'ı ciro/stok/
    backup telemetrisini okuyamasın)."""

    bootstrap_route = next(r for r in bootstrap_router.routes if getattr(r, "path", None) == "")
    dependency_calls = [dep.call for dep in bootstrap_route.dependant.dependencies]
    assert require_admin in dependency_calls


def test_require_admin_rejects_customer_role() -> None:
    customer = User(
        email="customer@example.com",
        name="Customer",
        role=RoleEnum.CUSTOMER,
        password_hash=get_password_hash("whatever-long-password"),
        is_active=True,
    )
    with pytest.raises(HTTPException) as captured:
        require_admin(current_user=customer)
    assert captured.value.status_code == 403


def test_password_hash_roundtrip_for_policy_floor() -> None:
    hashed = get_password_hash("12345678")
    assert verify_password("12345678", hashed)
