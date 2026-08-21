from __future__ import annotations

import base64
import hashlib
import os
import sys
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = (
    Path(getattr(sys, "_MEIPASS")).resolve()
    if getattr(sys, "frozen", False) and getattr(sys, "_MEIPASS", None)
    else Path(__file__).resolve().parents[2]
)
APP_DATA_DIR = (
    Path(os.environ["SEROGULD_DATA_DIR"]).expanduser()
    if os.environ.get("SEROGULD_DATA_DIR")
    else ROOT_DIR / "data"
)
ROOT_ENV_FILE = (
    Path(os.environ["SEROGULD_CONFIG_FILE"]).expanduser()
    if os.environ.get("SEROGULD_CONFIG_FILE")
    else ROOT_DIR / ".env"
)
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


def _is_usable_field_encryption_key(value: str | None) -> bool:
    candidate = str(value or "").strip()
    return bool(candidate) and candidate not in {
        "change-me-32-byte-base64-key",
        "change-me",
    } and len(candidate) >= 16


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

    kds_address_base_url: str = "https://api.dataforsyningen.dk/rest"
    kds_address_token: str = ""
    kds_address_timeout_seconds: float = 8.0
    kds_address_cache_seconds: int = 300

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-5.6-luna"
    # Reasoning effort AYRI parametredir; model ID'sine yapıştırılmaz (404).
    # Değerler: none|low|medium|high|xhigh|max. Boş = gönderme (model default).
    openai_reasoning_effort: str = "high"
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
    # Site eşleme haritaları (JSON string; probe_woocommerce_site aracının
    # çıktısı Settings > WooCommerce Eşlemeleri'nden yapıştırılır). Boş harita
    # ilgili özelliği atlar — publish uyarıyla devam eder (graceful degrade).
    woocommerce_category_map_json: str = ""
    woocommerce_stonex_meta_map_json: str = ""
    woocommerce_badge_meta_json: str = ""
    # Takı ürünlerinin uzun açıklamasının sonuna eklenen sabit Danca blok;
    # boş = koda gömülü varsayılan (DESC_FOOTER_DA_DEFAULT). Env tek satır.
    woocommerce_desc_footer_html: str = ""
    woocommerce_desc_footer_enabled: bool = True
    # Yatırım ürünleri (külçe/sikke/platin) alt bloğu; boşsa gömülü default.
    woocommerce_desc_footer_investment_html: str = ""
    woocommerce_primary_term_meta_key: str = "_yoast_wpseo_primary_product_cat"

    wordpress_base_url: str = ""
    wp_app_username: str = ""
    wp_app_password: str = ""

    # GenerateDebtorInvoice gövde sözleşmesi adayları (hedefte 2xx + düz metin
    # "ArgumentMissing" görüldü). Sözleşme belgesiz olduğundan düzeltmeler
    # bayraklı ve varsayılan KAPALI — hedefte bayrak bayrak denenir.
    uniconta_ordernumber_in_order: bool = False
    uniconta_omit_null_item: bool = False
    uniconta_accept_json: bool = False

    uniconta_api_url: str = "https://api.uniconta.com"
    uniconta_username: str = ""
    uniconta_password: str = ""
    uniconta_company_id: str = ""
    uniconta_api_key: str = ""
    # Purchase-line VAT codes used when the AFG purchase is transferred to
    # Uniconta. They are public accounting identifiers, not credentials.
    uniconta_purchase_vat_code_25: str = "Købsmoms"
    uniconta_purchase_vat_code_0: str = "KøbBrugtmoms"
    # Otomatik fatura gönderim toggle'ları — UI ayarlanır, .env'e yazılır.
    uniconta_send_email_on_finalize: bool = False
    uniconta_send_xml_on_finalize: bool = False

    invoice_number_prefix: str = "SG"
    invoice_default_currency: str = "DKK"
    invoice_sale_vat_rate_percent: Decimal = Decimal("0")
    # Varsayılanlar AFG şablonundaki resmi footer metniyle eşleşir.
    invoice_seller_name: str = "Sero Guld og Sølv ApS"
    invoice_seller_address_line1: str = "Valby Langgade 84"
    invoice_seller_postal_code: str = "2500"
    invoice_seller_city: str = "Valby"
    invoice_seller_country: str = "Danmark"
    invoice_seller_cvr: str = "DK34093083"
    invoice_seller_email: str = "info@seroguld.dk"
    invoice_seller_phone: str = "22255504"
    invoice_seller_website: str = "www.seroguld.dk"

    pos_reference_start: int = 9600
    pos_reference_scan_window: int = 5000

    media_root_dir: str = str(APP_DATA_DIR / "uploads")
    document_root_dir: str = str(APP_DATA_DIR / "documents")
    office_provider_default: str = "embedded"
    office_provider_afg: str = "embedded"
    office_provider_depolama: str = "embedded"
    office_provider_log: str = "embedded"
    office_runtime_url: str = "http://127.0.0.1:9980"
    office_wopi_base_url: str = "http://127.0.0.1:8100"
    onlyoffice_runtime_url: str = "http://127.0.0.1:8082"
    # Kept for legacy config compatibility; embedded office is the desktop
    # default and these values must never point at a Docker host by default.
    onlyoffice_callback_base_url: str = "http://127.0.0.1:8100"
    onlyoffice_jwt_secret: str = ""
    office_session_ttl_seconds: int = 3600
    photo_max_size_mb: int = 15

    backup_root_dir: str = str(APP_DATA_DIR / "backups")
    backup_restore_drill_dir: str = str(APP_DATA_DIR / "restore-drill")

    log_dir: str = str(APP_DATA_DIR / "logs")
    log_max_bytes: int = 10 * 1024 * 1024  # 10 MB
    log_backup_count: int = 5  # 10 MB × 5 backup = 50 MB ceiling
    backup_offsite_enabled: bool = False
    backup_offsite_status_file: str = str(ROOT_DIR / ".run" / "backup-offsite-last-sync.json")
    backup_health_max_age_minutes: int = 180
    backup_offsite_max_age_minutes: int = 1440
    backup_restore_drill_max_age_hours: int = 168

    # Tek kanonik piyasa modu.  Eski GOLD_PRICE_LIVE_ENABLED alanı yalnızca
    # geriye dönük yapılandırma uyumluluğu için tutulur; UI ve çalışma profili
    # MARKET_RATES_LIVE_ENABLED üzerinden aynı durumu okumalıdır.
    market_rates_live_enabled: bool = False
    # Alan bazlı canlı mod: master kapalıyken hepsi kapalıdır; master açıkken
    # operatör hangi alanların otomatikte kalacağını tek tek seçebilir.
    market_rates_live_fx_enabled: bool = True
    market_rates_live_platinum_enabled: bool = True
    market_rates_live_palladium_enabled: bool = True
    gold_price_live_enabled: bool = True
    gold_price_timeout_seconds: float = 6.0
    gold_price_cache_seconds: int = 20

    # Metals.Dev tek çağrıda DKK/gram döndürür (canlı Pt/Pd + spot referans).
    # Anahtar boşsa servis devre dışıdır ve Stooq/fallback zinciri kullanılır.
    metals_dev_api_key: str = ""
    metals_dev_url: str = "https://api.metals.dev/v1/latest"
    metals_dev_timeout_seconds: float = 8.0
    metals_dev_cache_seconds: int = 1800
    ecb_fx_url: str = (
        "https://data-api.ecb.europa.eu/service/data/EXR/D.DKK.EUR.SP00.A"
        "?lastNObservations=1&format=csvdata"
    )
    ecb_fx_timeout_seconds: float = 6.0
    ecb_fx_cache_seconds: int = 3600
    # Stooq Pt/Pd sembolleri hedef makinede probe_market_feeds ile doğrulanıp
    # gerekirse buradan geçersiz kılınır (boş = gömülü varsayılan).
    stooq_symbol_platinum: str = ""
    stooq_symbol_palladium: str = ""

    inventory_market_gold_dkk: Decimal = Decimal("615.50")
    inventory_market_silver_dkk: Decimal = Decimal("7.80")
    inventory_market_platinum_dkk: Decimal = Decimal("280")
    inventory_market_palladium_dkk: Decimal = Decimal("335")
    inventory_market_gold_bar_dkk: Decimal = Decimal("615.50")
    inventory_market_silver_bar_dkk: Decimal = Decimal("7.80")
    inventory_market_plet_dkk: Decimal = Decimal("0.02")
    # save_manual_market_rate_profile bu anahtarı yazar; Settings'te bildirilmezse
    # pydantic (extra="ignore") değeri yutar ve kayıtlı karat matrisi hiç okunmaz.
    inventory_market_rate_profile_json: str = ""

    initial_admin_email: str = "info@seroguld.dk"
    initial_admin_password: str = "admin"
    initial_admin_name: str = "Recai"
    initial_admin_force_password_change: bool = True

    def is_production(self) -> bool:
        return self.env.strip().lower() in {"production", "prod"}

    def validate_runtime_configuration(self) -> None:
        if self.initial_admin_auto_seed and not self.initial_admin_password.strip():
            raise RuntimeError("INITIAL_ADMIN_PASSWORD boş olamaz; ilk admin hesabı oluşturulamaz.")

        if self.env.strip().lower() == "desktop":
            failures: list[str] = []

            def _check_desktop_secret(name: str, value: str, *, blocked: set[str]) -> None:
                candidate = value.strip()
                if not candidate or candidate in blocked or len(candidate) < 32:
                    failures.append(f"{name} güvenli bir desktop değeri olmalı.")

            _check_desktop_secret("JWT_ACCESS_SECRET", self.jwt_access_secret, blocked={"change-me-access-secret"})
            _check_desktop_secret("JWT_REFRESH_SECRET", self.jwt_refresh_secret, blocked={"change-me-refresh-secret"})
            if not _is_usable_field_encryption_key(self.field_encryption_key):
                failures.append("FIELD_ENCRYPTION_KEY güvenli bir desktop değeri olmalı (legacy anahtarlar için en az 16 karakter).")
            if failures:
                rendered = "\n".join(f"- {item}" for item in failures)
                raise RuntimeError(f"Desktop runtime config geçersiz:\n{rendered}")
            return

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
        if any(
            provider.strip().lower() == "onlyoffice"
            for provider in (
                self.office_provider_default,
                self.office_provider_afg,
                self.office_provider_depolama,
                self.office_provider_log,
            )
        ):
            _check_secret("ONLYOFFICE_JWT_SECRET", self.onlyoffice_jwt_secret, blocked={"seroguld-onlyoffice-secret"}, min_length=24)
        if not self.initial_admin_force_password_change:
            _check_secret(
                "INITIAL_ADMIN_PASSWORD",
                self.initial_admin_password,
                blocked={"admin", "Admin123!"},
                min_length=12,
            )

        if self.database_auto_create:
            failures.append("DATABASE_AUTO_CREATE production ortamında kapalı olmalı.")
        if self.initial_admin_auto_seed and not self.initial_admin_force_password_change:
            failures.append(
                "INITIAL_ADMIN_AUTO_SEED production ortamında yalnız zorunlu ilk şifre değişimiyle kullanılmalı."
            )

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
        return bool(self.initial_admin_auto_seed)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def resolve_desktop_onlyoffice_jwt_secret(configured_secret: str) -> str:
    runtime_dir = os.environ.get("SEROGULD_OFFICE_RUNTIME_DIR", "").strip()
    if not runtime_dir:
        local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
        if local_app_data:
            runtime_dir = str(Path(local_app_data) / "SeroGuldCRM" / "office-runtime")
    if not runtime_dir:
        return configured_secret

    env_path = Path(runtime_dir) / "onlyoffice.env"
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return configured_secret

    for line in lines:
        key, separator, value = line.partition("=")
        candidate = value.strip()
        if key.strip() == "ONLYOFFICE_JWT_SECRET" and separator and len(candidate) >= 32:
            return candidate
    return configured_secret
