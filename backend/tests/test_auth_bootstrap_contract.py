from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import main
from app.config import Settings
from app.database import Base
from app.models.enums import RoleEnum
from app.models.user import User
from app.api.auth import _password_policy_error, login
from app.schemas.auth import LoginRequest, PasswordChangeRequest
from app.utils.security import get_password_hash, verify_password


def test_password_policy_allows_same_as_old_password_for_legacy_desktop_flow() -> None:
    assert _password_policy_error("admin") is None
    assert _password_policy_error("  ") is not None


def test_password_change_schema_accepts_long_unicode_values() -> None:
    password = "Parola-" + "ü密码安全" * 80

    payload = PasswordChangeRequest(
        current_password="admin",
        new_password=password,
        new_password_confirmation=password,
    )

    assert payload.new_password == password


def test_login_with_unknown_hash_returns_401_instead_of_crashing() -> None:
    user = User(
        email="broken-hash@example.com",
        name="Broken Hash",
        role=RoleEnum.ADMIN,
        password_hash="$unknown$broken",
        is_active=True,
    )

    class StaticSession:
        async def scalar(self, _statement):
            return user

    with pytest.raises(HTTPException) as captured:
        asyncio.run(
            login(
                LoginRequest(email="broken-hash@example.com", password="admin"),
                StaticSession(),  # type: ignore[arg-type]
            )
        )

    assert captured.value.status_code == 401
    assert captured.value.detail == "Email veya şifre hatalı"


def test_clean_bootstrap_seeds_once_and_upgrade_database_is_untouched(monkeypatch) -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        monkeypatch.setattr(
            main,
            "settings",
            Settings(
                initial_admin_auto_seed=True,
                initial_admin_email="bootstrap@test.local",
                initial_admin_password="admin",
                initial_admin_name="Bootstrap Admin",
                initial_admin_force_password_change=True,
            ),
        )
        monkeypatch.setattr(main, "AsyncSessionLocal", Session)

        await main.ensure_initial_admin()
        await main.ensure_initial_admin()
        async with Session() as session:
            seeded = await session.scalar(
                select(User).where(User.email == "bootstrap@test.local")
            )
            assert seeded is not None
            assert seeded.name == "Bootstrap Admin"
            assert seeded.must_change_password is True
            assert verify_password("admin", seeded.password_hash)
            assert await session.scalar(select(func.count(User.id))) == 1
        await engine.dispose()

    asyncio.run(run())


def test_existing_upgrade_admin_is_not_reset_by_bootstrap(monkeypatch) -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        old_hash = get_password_hash("old-password")
        async with Session() as session:
            session.add(
                User(
                    email="bootstrap@test.local",
                    name="Existing Admin",
                    role=RoleEnum.ADMIN,
                    password_hash=old_hash,
                    city="København",
                    must_change_password=False,
                )
            )
            await session.commit()
        monkeypatch.setattr(
            main,
            "settings",
            Settings(
                initial_admin_auto_seed=True,
                initial_admin_email="bootstrap@test.local",
                initial_admin_password="new-password-that-must-not-apply",
                initial_admin_name="Replacement",
                initial_admin_force_password_change=True,
            ),
        )
        monkeypatch.setattr(main, "AsyncSessionLocal", Session)
        await main.ensure_initial_admin()
        async with Session() as session:
            existing = await session.scalar(
                select(User).where(User.email == "bootstrap@test.local")
            )
            assert existing is not None
            assert existing.name == "Existing Admin"
            assert existing.city == "København"
            assert existing.must_change_password is False
            assert verify_password("old-password", existing.password_hash)
            assert not verify_password("new-password-that-must-not-apply", existing.password_hash)
        await engine.dispose()

    asyncio.run(run())
