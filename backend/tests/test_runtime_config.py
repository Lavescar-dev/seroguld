from __future__ import annotations

import base64

import pytest

from app.config import Settings


def _secure_key() -> str:
    return base64.urlsafe_b64encode(b"a" * 32).decode("utf-8")


def test_validate_runtime_configuration_rejects_default_production_values() -> None:
    settings = Settings(
        env="production",
        database_auto_create=False,
        initial_admin_auto_seed=False,
    )

    with pytest.raises(RuntimeError):
        settings.validate_runtime_configuration()


def test_validate_runtime_configuration_accepts_secure_production_values() -> None:
    settings = Settings(
        env="production",
        jwt_access_secret="a" * 48,
        jwt_refresh_secret="b" * 48,
        field_encryption_key=_secure_key(),
        onlyoffice_jwt_secret="c" * 32,
        initial_admin_password="S3cure-Admin-Pass",
        database_auto_create=False,
        initial_admin_auto_seed=False,
    )

    settings.validate_runtime_configuration()
