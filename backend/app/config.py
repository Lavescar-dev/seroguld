from __future__ import annotations

import base64
import hashlib
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]
ROOT_ENV_FILE = ROOT_DIR / ".env"
DEFAULT_DESKTOP_CORS_ORIGINS = (
    "http://127.0.0.1:3300",
    "http://localhost:3300",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    env: str = "development"
    app_name: str = "Sero Guld CRM"
    app_url: str = "http://localhost:3000"

    database_url: str = "postgresql+asyncpg://seroguld:seroguld@localhost:5432/seroguld"

    jwt_access_secret: str = "change-me-access-secret"
    jwt_refresh_secret: str = "change-me-refresh-secret"
    jwt_access_expire_minutes: int = 30
    jwt_refresh_expire_days: int = 14
    database_auto_create: bool = True
    initial_admin_auto_seed: bool = True

    field_encryption_key: str = Field(
        default="change-me-32-byte-base64-key",
        description="Base64-encoded 32-byte key used for AES-GCM field encryption.",
    )

    cors_origins: str = "http://localhost:3000"

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-5.4"
    openai_max_tokens: int = 4096
    openai_timeout_seconds: float = 20.0

    opmc_api_url: str = "https://api.opmc.dk/v1"
    opmc_api_key: str = ""
    opmc_webhook_secret: str = ""

    woocommerce_base_url: str = ""
    woocommerce_consumer_key: str = ""
    woocommerce_consumer_secret: str = ""
    woocommerce_webhook_secret: str = ""
    woocommerce_timeout_seconds: float = 20.0

    # KDS Adressevælger is called only by the backend.  The token is kept out
    # of browser requests so it can be changed when KDS enables user-specific
    # access management.
    kds_address_base_url: str = "https://adressevaelger.dk"
    kds_address_token: str = "adressevaelger123"
    kds_address_timeout_seconds: float = 4.0
    kds_address_cache_seconds: int = 300

    wordpress_base_url: str = ""
    wp_app_username: str = ""
    wp_app_password: str = ""

    uniconta_api_url: str = "https://www.uniconta.com/api"
    uniconta_username: str = ""
    uniconta_password: str = ""
    uniconta_company_id: str = ""
    uniconta_api_key: str = ""
    # Otomatik fatura gönderim toggle'ları — UI ayarlanır, .env'e yazılır.
    uniconta_send_email_on_finalize: bool = False
    uniconta_send_xml_on_finalize: bool = False

    invoice_number_prefix: str = "SG"
    invoice_default_currency: str = "DKK"
    invoice_sale_vat_rate_percent: Decimal = Decimal("0")
    invoice_seller_name: str = "Sero Guld ApS"
    invoice_seller_address_line1: str = "Valby Langgade 84"
    invoice_seller_postal_code: str = "2500"
    invoice_seller_city: str = "København"
    invoice_seller_country: str = "DK"
    invoice_seller_cvr: str = "34 09 30 83"
    invoice_seller_email: str = ""
    invoice_seller_phone: str = ""

    pos_reference_start: int = 9600
    pos_reference_scan_window: int = 5000

    media_root_dir: str = str(ROOT_DIR / "data" / "uploads")
    document_root_dir: str = str(ROOT_DIR / "data" / "documents")
    office_provider_default: str = "collabora"
    office_provider_afg: str = "onlyoffice"
    office_provider_depolama: str = "onlyoffice"
    office_provider_log: str = "onlyoffice"
    office_runtime_url: str = "http://127.0.0.1:9980"
    office_wopi_base_url: str = "http://127.0.0.1:8100"
    onlyoffice_runtime_url: str = "http://127.0.0.1"
    onlyoffice_callback_base_url: str = "http://127.0.0.1:8100"
    onlyoffice_jwt_secret: str = "seroguld-onlyoffice-secret"
    office_session_ttl_seconds: int = 3600
    photo_max_size_mb: int = 15

    backup_root_dir: str = str(ROOT_DIR / "data" / "backups")
    backup_restore_drill_dir: str = str(ROOT_DIR / "data" / "restore-drill")

    log_dir: str = str(ROOT_DIR / "data" / "logs")
    log_max_bytes: int = 10 * 1024 * 1024  # 10 MB
    log_backup_count: int = 5  # 10 MB × 5 backup = 50 MB ceiling
    backup_offsite_enabled: bool = False
    backup_offsite_status_file: str = str(ROOT_DIR / ".run" / "backup-offsite-last-sync.json")
    backup_health_max_age_minutes: int = 180
    backup_offsite_max_age_minutes: int = 1440
    backup_restore_drill_max_age_hours: int = 168

    gold_price_live_enabled: bool = True
    gold_price_timeout_seconds: float = 6.0
    gold_price_cache_seconds: int = 20

    inventory_market_gold_dkk: Decimal = Decimal("2850")
    inventory_market_silver_dkk: Decimal = Decimal("8.5")
    inventory_market_platinum_dkk: Decimal = Decimal("280")
    inventory_market_palladium_dkk: Decimal = Decimal("335")

    initial_admin_email: str = "admin@seroguld.dk"
    initial_admin_password: str = "Admin123!"
    initial_admin_name: str = "Recai Admin"

    def is_production(self) -> bool:
        return self.env.strip().lower() in {"production", "prod"}

    def validate_runtime_configuration(self) -> None:
        if not self.is_production():
            return

        failures: list[str] = []

        def _check_secret(name: str, value: str, *, blocked: set[str], min_length: int = 24) -> None:
            candidate = value.strip()
            if not candidate or candidate in blocked or len(candidate) < min_length:
                failures.append(f"{name} güvenli bir production değeri olmalı.")

        _check_secret(
            "JWT_ACCESS_SECRET",
            self.jwt_access_secret,
            blocked={"change-me-access-secret"},
            min_length=32,
        )
        _check_secret(
            "JWT_REFRESH_SECRET",
            self.jwt_refresh_secret,
            blocked={"change-me-refresh-secret"},
            min_length=32,
        )
        _check_secret(
            "FIELD_ENCRYPTION_KEY",
            self.field_encryption_key,
            blocked={"change-me-32-byte-base64-key"},
            min_length=32,
        )
        _check_secret(
            "ONLYOFFICE_JWT_SECRET",
            self.onlyoffice_jwt_secret,
            blocked={"seroguld-onlyoffice-secret"},
            min_length=24,
        )
        _check_secret(
            "INITIAL_ADMIN_PASSWORD",
            self.initial_admin_password,
            blocked={"Admin123!"},
            min_length=12,
        )

        if self.database_auto_create:
            failures.append("DATABASE_AUTO_CREATE production ortamında kapalı olmalı.")
        if self.initial_admin_auto_seed:
            failures.append("INITIAL_ADMIN_AUTO_SEED production ortamında kapalı olmalı.")

        if failures:
            rendered = "\n".join(f"- {item}" for item in failures)
            raise RuntimeError(f"Production runtime config geçersiz:\n{rendered}")

    def encryption_key_bytes(self) -> bytes:
        try:
            raw = base64.urlsafe_b64decode(self.field_encryption_key.encode("utf-8"))
            if len(raw) == 32:
                return raw
        except Exception:
            pass
        return hashlib.sha256(self.field_encryption_key.encode("utf-8")).digest()

    def cors_origins_list(self) -> list[str]:
        configured = [item.strip() for item in self.cors_origins.split(",") if item.strip()]
        merged: list[str] = []
        for origin in [*configured, *DEFAULT_DESKTOP_CORS_ORIGINS]:
            if origin and origin not in merged:
                merged.append(origin)
        return merged

    def media_root_path(self) -> Path:
        raw = Path(self.media_root_dir).expanduser()
        if raw.is_absolute():
            return raw.resolve()
        return (ROOT_DIR / raw).resolve()

    def document_root_path(self) -> Path:
        raw = Path(self.document_root_dir).expanduser()
        if raw.is_absolute():
            return raw.resolve()
        return (ROOT_DIR / raw).resolve()

    def backup_root_path(self) -> Path:
        raw = Path(self.backup_root_dir).expanduser()
        if raw.is_absolute():
            return raw.resolve()
        return (ROOT_DIR / raw).resolve()

    def backup_restore_drill_path(self) -> Path:
        raw = Path(self.backup_restore_drill_dir).expanduser()
        if raw.is_absolute():
            return raw.resolve()
        return (ROOT_DIR / raw).resolve()

    def backup_offsite_status_path(self) -> Path:
        raw = Path(self.backup_offsite_status_file).expanduser()
        if raw.is_absolute():
            return raw.resolve()
        return (ROOT_DIR / raw).resolve()

    def should_auto_seed_initial_admin(self) -> bool:
        return bool(self.initial_admin_auto_seed and not self.is_production())


@lru_cache
def get_settings() -> Settings:
    return Settings()
