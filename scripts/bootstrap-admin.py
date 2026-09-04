#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


async def bootstrap_admin() -> int:
    from sqlalchemy import select

    from app.config import get_settings
    from app.database import AsyncSessionLocal
    from app.models.enums import RoleEnum
    from app.models.user import User
    from app.utils.security import get_password_hash

    settings = get_settings()
    settings.validate_runtime_configuration()

    async with AsyncSessionLocal() as session:
        existing = await session.scalar(select(User).where(User.email == settings.initial_admin_email))
        if not existing:
            existing = await session.scalar(
                select(User).where(User.role == RoleEnum.ADMIN).order_by(User.created_at.asc())
            )
        if existing:
            existing.email = settings.initial_admin_email
            existing.name = settings.initial_admin_name
            existing.password_hash = get_password_hash(settings.initial_admin_password)
            existing.role = RoleEnum.ADMIN
            existing.is_active = True
            existing.must_change_password = settings.initial_admin_force_password_change
            existing.password_changed_at = None
            action = "updated"
        else:
            session.add(
                User(
                    email=settings.initial_admin_email,
                    name=settings.initial_admin_name,
                    role=RoleEnum.ADMIN,
                    password_hash=get_password_hash(settings.initial_admin_password),
                    is_active=True,
                    must_change_password=settings.initial_admin_force_password_change,
                )
            )
            action = "created"

        await session.commit()

    print(f"[bootstrap-admin] admin {action}: {settings.initial_admin_email}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create or recover the initial admin user and require a password change."
    )
    parser.add_argument(
        "--env-file",
        default=str(ROOT_DIR / ".env"),
        help="Env file to load before importing backend settings.",
    )
    parser.add_argument("--email", help="Override INITIAL_ADMIN_EMAIL for this recovery run.")
    parser.add_argument("--password", help="Override INITIAL_ADMIN_PASSWORD for this recovery run.")
    parser.add_argument("--name", help="Override INITIAL_ADMIN_NAME for this recovery run.")
    args = parser.parse_args()

    load_env_file(Path(args.env_file))
    if args.email:
        os.environ["INITIAL_ADMIN_EMAIL"] = args.email
    if args.password:
        os.environ["INITIAL_ADMIN_PASSWORD"] = args.password
    if args.name:
        os.environ["INITIAL_ADMIN_NAME"] = args.name
    # Kurtarma varsayılanı zorunlu ilk şifre değişimidir; ancak çağıran (örn.
    # frontend smoke) bilinçli olarak INITIAL_ADMIN_FORCE_PASSWORD_CHANGE=false
    # verdiyse ezilmesin — setdefault dış değere saygı duyar.
    os.environ.setdefault("INITIAL_ADMIN_FORCE_PASSWORD_CHANGE", "true")
    sys.path.insert(0, str(BACKEND_DIR))
    return asyncio.run(bootstrap_admin())


if __name__ == "__main__":
    raise SystemExit(main())
