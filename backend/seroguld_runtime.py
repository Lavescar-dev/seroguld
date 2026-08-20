from __future__ import annotations

import json
import logging
import os
import secrets
import sqlite3
import sys
import threading
import tempfile
import time
import base64
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit


APP_DIR_NAME = "SeroGuldCRM"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8100
SMOKE_PORT_ENV = "SEROGULD_RUNTIME_SMOKE_PORT"
RUNTIME_PASSWORD_KEYS = {
    "INITIAL_ADMIN_PASSWORD",
    "ADMIN_PASSWORD",
    "LOGIN_PASSWORD",
    "PASSWORD_HASH",
    "SEROGULD_PASSWORD",
}
CONFIG_KEYS_FROM_SEED = {
    "KDS_ADDRESS_BASE_URL",
    "KDS_ADDRESS_TOKEN",
    "KDS_ADDRESS_TIMEOUT_SECONDS",
    "KDS_ADDRESS_CACHE_SECONDS",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "OPENAI_MAX_TOKENS",
    "OPENAI_TIMEOUT_SECONDS",
    "OPMC_API_URL",
    "OPMC_API_KEY",
    "OPMC_WEBHOOK_SECRET",
    "WOOCOMMERCE_BASE_URL",
    "WOOCOMMERCE_CONSUMER_KEY",
    "WOOCOMMERCE_CONSUMER_SECRET",
    "WOOCOMMERCE_WEBHOOK_SECRET",
    "WOOCOMMERCE_TIMEOUT_SECONDS",
    "WORDPRESS_BASE_URL",
    "WP_APP_USERNAME",
    "WP_APP_PASSWORD",
    "UNICONTA_API_URL",
    "UNICONTA_USERNAME",
    "UNICONTA_PASSWORD",
    "UNICONTA_COMPANY_ID",
    "UNICONTA_API_KEY",
    "UNICONTA_PURCHASE_VAT_CODE_25",
    "UNICONTA_PURCHASE_VAT_CODE_0",
    "UNICONTA_SEND_EMAIL_ON_FINALIZE",
    "UNICONTA_SEND_XML_ON_FINALIZE",
    "INVOICE_NUMBER_PREFIX",
    "INVOICE_DEFAULT_CURRENCY",
    "INVOICE_SALE_VAT_RATE_PERCENT",
    "INVOICE_SELLER_NAME",
    "INVOICE_SELLER_ADDRESS_LINE1",
    "INVOICE_SELLER_POSTAL_CODE",
    "INVOICE_SELLER_CITY",
    "INVOICE_SELLER_COUNTRY",
    "INVOICE_SELLER_CVR",
    "INVOICE_SELLER_EMAIL",
    "INVOICE_SELLER_PHONE",
    "POS_REFERENCE_START",
    "POS_REFERENCE_SCAN_WINDOW",
    "MARKET_RATES_LIVE_ENABLED",
    "MARKET_RATES_LIVE_FX_ENABLED",
    "MARKET_RATES_LIVE_PLATINUM_ENABLED",
    "MARKET_RATES_LIVE_PALLADIUM_ENABLED",
    "GOLD_PRICE_LIVE_ENABLED",
    "GOLD_PRICE_TIMEOUT_SECONDS",
    "GOLD_PRICE_CACHE_SECONDS",
    "METALS_DEV_API_KEY",
    "METALS_DEV_URL",
    "METALS_DEV_TIMEOUT_SECONDS",
    "METALS_DEV_CACHE_SECONDS",
    "INVENTORY_MARKET_GOLD_DKK",
    "INVENTORY_MARKET_SILVER_DKK",
    "INVENTORY_MARKET_PLATINUM_DKK",
    "INVENTORY_MARKET_PALLADIUM_DKK",
}

# A short-lived desktop migration series used these IDs before the source
# tree was consolidated around the 0027 compatibility marker.  Existing
# databases carrying them already contain the 0019-era schema; normalize the
# marker before Alembic resolves the current graph.
LEGACY_REVISION_ALIASES = {
    "0020_pos_session_product_links": "0019_log_module_audit",
    "0021_customer_activity_events": "0019_log_module_audit",
    "0022_pos_session_product_links": "0019_log_module_audit",
}
# YALNIZ son çare fallback — gerçek head her zaman Alembic script dizininden
# okunur (_current_migration_head). Bu sabit bayatlarsa migration-öncesi
# yedek yanlış atlanabilir; 0.3.8'de "0034" olarak bayat kalmıştı.
CURRENT_MIGRATION_HEAD = "0036_product_woo_categories"


def _current_migration_head() -> str:
    try:
        from alembic.script import ScriptDirectory

        heads = ScriptDirectory.from_config(_alembic_config()).get_heads()
        if len(heads) == 1:
            return heads[0]
    except Exception:  # pragma: no cover - yedek kararı fallback'e düşer
        logging.getLogger(__name__).warning(
            "Alembic head okunamadı; fallback sabiti kullanılacak", exc_info=True
        )
    return CURRENT_MIGRATION_HEAD


def _bundle_root() -> Path:
    if getattr(sys, "frozen", False) and getattr(sys, "_MEIPASS", None):
        return Path(getattr(sys, "_MEIPASS")).resolve()
    return Path(__file__).resolve().parents[1]


def _program_data_root() -> Path:
    override = os.environ.get("SEROGULD_PROGRAM_DATA", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    program_data = os.environ.get("PROGRAMDATA", "").strip()
    if program_data:
        return (Path(program_data) / APP_DIR_NAME).resolve()
    return (Path.home() / ".local" / "share" / APP_DIR_NAME).resolve()


def _parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def _render_env(values: dict[str, str]) -> str:
    lines = ["# Sero Guld CRM yerel runtime ayarları. Kullanıcı parolası burada tutulmaz."]
    for key in sorted(values):
        value = str(values[key]).replace("\r", "").replace("\n", "")
        lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"


def _safe_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def _is_valid_field_encryption_key(value: str | None) -> bool:
    """Return whether ``value`` can safely preserve encrypted customer data.

    New desktop installs generate a URL-safe base64 encoding of 32 random
    bytes.  Older production/dev installations also accepted an arbitrary
    non-empty secret and :class:`app.config.Settings` derives a SHA-256 key
    from that value.  Keep those legacy keys usable during an upgrade; the
    dangerous cases are a missing value and the repository placeholder.
    """

    candidate = str(value or "").strip()
    if not candidate or candidate in {"change-me-32-byte-base64-key", "change-me"}:
        return False
    if len(candidate) < 16:
        return False
    try:
        raw = base64.b64decode(candidate.encode("ascii"), altchars=b"-_", validate=True)
    except (ValueError, UnicodeEncodeError):
        # A legacy arbitrary secret is still deterministic and is supported by
        # Settings.encryption_key_bytes(); do not strand its ciphertext during
        # an installer upgrade merely because it is not base64.
        return True
    return len(raw) == 32 or len(candidate) >= 16


def _database_preexists(path: Path) -> bool:
    """Treat every non-empty pre-existing DB as customer state.

    A corrupt or partially copied SQLite file must fail closed too: replacing
    its encryption key would make a later recovery attempt even less safe.
    Fresh installs have no file (or only a zero-byte placeholder), so they may
    generate a new key.
    """

    try:
        return path.exists() and path.stat().st_size > 0
    except OSError:
        # If we cannot inspect the file, do not risk pairing it with a new key.
        return True


@dataclass(frozen=True, slots=True)
class RuntimePaths:
    root: Path
    data: Path
    config: Path
    logs: Path
    documents: Path
    working: Path
    database: Path
    env_file: Path


def prepare_runtime_environment() -> RuntimePaths:
    root = _program_data_root()
    paths = RuntimePaths(
        root=root,
        data=root / "data",
        config=root / "config",
        logs=root / "logs",
        documents=root / "documents",
        working=root / "documents" / "working",
        database=root / "data" / "seroguld.db",
        env_file=root / "config" / "runtime.env",
    )
    database_preexists = _database_preexists(paths.database)
    for directory in (
        paths.root,
        paths.data,
        paths.config,
        paths.logs,
        paths.documents,
        paths.working,
        paths.data / "uploads",
        paths.data / "backups",
        paths.data / "restore-drill",
    ):
        directory.mkdir(parents=True, exist_ok=True)

    current = _parse_env(paths.env_file)
    seed_path = _bundle_root() / "runtime-seed.env"
    seed = _parse_env(seed_path)
    for key in CONFIG_KEYS_FROM_SEED:
        if key not in current and seed.get(key, "").strip():
            current[key] = seed[key].strip()

    current.update(
        {
            "ENV": "desktop",
            "DATABASE_URL": f"sqlite+aiosqlite:///{paths.database.as_posix()}",
            "DATABASE_AUTO_CREATE": "false",
            "INITIAL_ADMIN_AUTO_SEED": "true",
            "INITIAL_ADMIN_FORCE_PASSWORD_CHANGE": "true",
            "INITIAL_ADMIN_EMAIL": "info@seroguld.dk",
            "INITIAL_ADMIN_NAME": "Recai",
            "MEDIA_ROOT_DIR": str(paths.data / "uploads"),
            "DOCUMENT_ROOT_DIR": str(paths.documents),
            "BACKUP_ROOT_DIR": str(paths.data / "backups"),
            "BACKUP_RESTORE_DRILL_DIR": str(paths.data / "restore-drill"),
            "BACKUP_HEALTH_MAX_AGE_MINUTES": "1500",
            "BACKUP_OFFSITE_MAX_AGE_MINUTES": "1500",
            "LOG_DIR": str(paths.logs),
            "CORS_ORIGINS": "http://tauri.localhost,https://tauri.localhost,tauri://localhost",
            "APP_URL": f"http://{DEFAULT_HOST}:{DEFAULT_PORT}",
            "OFFICE_PROVIDER_DEFAULT": "embedded",
            "OFFICE_PROVIDER_AFG": "embedded",
            "OFFICE_PROVIDER_DEPOLAMA": "embedded",
            "OFFICE_PROVIDER_LOG": "embedded",
        }
    )
    if len(current.get("JWT_ACCESS_SECRET", "")) < 32:
        current["JWT_ACCESS_SECRET"] = secrets.token_urlsafe(48)
    if len(current.get("JWT_REFRESH_SECRET", "")) < 32:
        current["JWT_REFRESH_SECRET"] = secrets.token_urlsafe(48)
    field_key = current.get("FIELD_ENCRYPTION_KEY", "").strip()
    if not _is_valid_field_encryption_key(field_key):
        if database_preexists:
            raise RuntimeError(
                "Mevcut Sero Guld veritabanı için FIELD_ENCRYPTION_KEY bulunamadı veya geçersiz; "
                "veri güvenliği için yeni anahtar üretilmedi"
            )
        current["FIELD_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")

    # Never carry login/bootstrap credentials into the runtime environment. The
    # clean-install bootstrap password is the code-level Settings default and
    # is consumed by the backend only; runtime.env and child-process env must
    # not become a second credential store.
    for key in RUNTIME_PASSWORD_KEYS:
        current.pop(key, None)
        os.environ.pop(key, None)
    _safe_write_text(paths.env_file, _render_env(current))

    os.environ["SEROGULD_DATA_DIR"] = str(paths.data)
    os.environ["SEROGULD_CONFIG_FILE"] = str(paths.env_file)
    for key, value in current.items():
        os.environ[key] = value
    return paths


def _configure_runtime_logging(paths: RuntimePaths, mode: str) -> None:
    target = paths.logs / ("backend.log" if mode in {"migrate", "serve"} else "excel-bridge.log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.FileHandler(target, encoding="utf-8")],
        force=True,
    )


def _configure_fallback_logging(mode: str) -> None:
    """Best-effort file logging when ProgramData cannot be prepared."""

    targets = [
        _program_data_root() / "logs" / "backend.log",
        Path(tempfile.gettempdir()) / APP_DIR_NAME / "logs" / f"runtime-{mode}.log",
    ]
    handler: logging.FileHandler | None = None
    for target in targets:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            handler = logging.FileHandler(target, encoding="utf-8")
            break
        except Exception:
            continue
    if handler is None:
        # This is a windowed executable; never fall back to stderr and expose
        # a raw traceback/dialog when both locations are unavailable.
        return
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[handler],
        force=True,
    )


def _alembic_config():
    from alembic.config import Config

    config_path = _bundle_root() / "backend" / "alembic.ini"
    script_path = _bundle_root() / "backend" / "alembic"
    if not config_path.exists():
        config_path = _bundle_root() / "alembic.ini"
    if not script_path.exists():
        script_path = _bundle_root() / "alembic"
    config = Config(str(config_path))
    config.set_main_option("script_location", str(script_path))
    return config


def _infer_versionless_sqlite_revision(connection: sqlite3.Connection | set[str]) -> str | None:
    """Infer a safe Alembic baseline for old SQLite files without metadata.

    Older desktop/dev builds used ``Base.metadata.create_all`` and therefore
    left no ``alembic_version`` row.  Stamping every such file at 0007 is
    unsafe: a current schema would then re-run table/column migrations and
    startup could either fail or leave a partially upgraded customer DB.
    Only known cumulative schema signatures are accepted; an incomplete or
    unfamiliar schema returns ``None`` so migration fails closed instead of
    guessing and rewriting data.
    """

    # Keep the helper fail-closed for callers/tests that only have a table-name
    # set.  Columns are required to distinguish a current ``create_all`` file
    # from an older partial schema, so guessing from names alone is unsafe.
    if isinstance(connection, set):
        return None

    table_names = {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    columns: dict[str, set[str]] = {}
    for table in table_names:
        columns[table] = {
            str(row[1])
            for row in connection.execute(f'PRAGMA table_info("{table}")').fetchall()
        }

    base_tables = {
        "users",
        "products",
        "product_history",
        "woocommerce_sync_log",
    }
    if not base_tables.issubset(table_names):
        return None
    # A versionless file that predates the 0007 line table is ambiguous: the
    # existing users/products/session tables would collide with the initial
    # migrations, while later migrations assume the line table already exists.
    # Fail closed rather than stamping an early revision and partially
    # upgrading a customer database.
    if "pos_session_lines" not in table_names:
        return None

    stages: list[tuple[str, set[str], dict[str, set[str]]]] = [
        ("0001_initial", base_tables, {}),
        (
            "0002_pos_and_identity",
            base_tables | {"customer_identity_documents", "pos_sessions"},
            {},
        ),
        ("0003_ai_usage_log", base_tables | {"customer_identity_documents", "pos_sessions", "ai_usage_log"}, {}),
        (
            "0004_pos_documents",
            base_tables | {"customer_identity_documents", "pos_sessions", "ai_usage_log", "pos_documents"},
            {},
        ),
        (
            "0005_reference_sequences",
            base_tables | {"customer_identity_documents", "pos_sessions", "ai_usage_log", "pos_documents", "reference_sequences"},
            {},
        ),
        (
            "0006_transactions_core",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
            },
            {},
        ),
        (
            "0007_pos_session_lines",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
            },
            {},
        ),
        (
            "0008_customer_postal_code",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
            },
            {"users": {"postal_code"}},
        ),
        (
            "0009_inventory_product_metadata",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
            },
            {
                "users": {"postal_code"},
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                },
            },
        ),
        (
            "0010_afg_melt_lots",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
            },
            {
                "users": {"postal_code"},
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                },
            },
        ),
        (
            "0012_product_soft_delete",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
            },
            {
                "users": {"postal_code"},
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
            },
        ),
        (
            "0013_document_artifacts",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "document_artifacts",
            },
            {
                "users": {"postal_code"},
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
            },
        ),
        (
            "0014_gdpr_module",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
            },
            {
                "users": {
                    "postal_code",
                    "gdpr_status",
                    "gdpr_pseudonymized_at",
                    "marketing_opt_out_at",
                    "last_gdpr_request_at",
                },
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
            },
        ),
        (
            "0015_gdpr_runner_and_woo_customer_map",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
            },
            {
                "users": {
                    "postal_code",
                    "gdpr_status",
                    "gdpr_pseudonymized_at",
                    "marketing_opt_out_at",
                    "last_gdpr_request_at",
                    "woocommerce_customer_id",
                },
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
            },
        ),
        (
            "0016_pos_document_uniconta_sync",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
            },
            {
                "users": {
                    "postal_code",
                    "gdpr_status",
                    "gdpr_pseudonymized_at",
                    "marketing_opt_out_at",
                    "last_gdpr_request_at",
                    "woocommerce_customer_id",
                },
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
                "pos_documents": {
                    "uniconta_sync_status",
                    "uniconta_invoice_number",
                    "uniconta_account",
                    "uniconta_invoice_date",
                    "uniconta_pdf_path",
                    "uniconta_synced_at",
                    "uniconta_sync_error",
                },
            },
        ),
        (
            "0018_pos_document_audit",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
            },
            {
                "users": {
                    "postal_code",
                    "gdpr_status",
                    "gdpr_pseudonymized_at",
                    "marketing_opt_out_at",
                    "last_gdpr_request_at",
                    "woocommerce_customer_id",
                },
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
                "pos_documents": {
                    "uniconta_sync_status",
                    "uniconta_invoice_number",
                    "uniconta_account",
                    "uniconta_invoice_date",
                    "uniconta_pdf_path",
                    "uniconta_synced_at",
                    "uniconta_sync_error",
                },
            },
        ),
        (
            "0019_log_module_audit",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "afg_melt_lot_history",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
            },
            {
                "users": {
                    "postal_code",
                    "gdpr_status",
                    "gdpr_pseudonymized_at",
                    "marketing_opt_out_at",
                    "last_gdpr_request_at",
                    "woocommerce_customer_id",
                },
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
                "pos_documents": {
                    "uniconta_sync_status",
                    "uniconta_invoice_number",
                    "uniconta_account",
                    "uniconta_invoice_date",
                    "uniconta_pdf_path",
                    "uniconta_synced_at",
                    "uniconta_sync_error",
                },
                "afg_melt_lots": {"status", "finalized_at", "finalized_by_user_id"},
                "transaction_lines": {"melt_lot_id"},
            },
        ),
        (
            "0028_user_password_security",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "afg_melt_lot_history",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
            },
            {
                "users": {
                    "postal_code",
                    "gdpr_status",
                    "gdpr_pseudonymized_at",
                    "marketing_opt_out_at",
                    "last_gdpr_request_at",
                    "woocommerce_customer_id",
                    "must_change_password",
                    "password_changed_at",
                },
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
                "pos_documents": {
                    "uniconta_sync_status",
                    "uniconta_invoice_number",
                    "uniconta_account",
                    "uniconta_invoice_date",
                    "uniconta_pdf_path",
                    "uniconta_synced_at",
                    "uniconta_sync_error",
                },
                "afg_melt_lots": {"status", "finalized_at", "finalized_by_user_id"},
                "transaction_lines": {"melt_lot_id"},
            },
        ),
        (
            "0029_document_artifact_revision",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "afg_melt_lot_history",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
            },
            {
                "users": {
                    "postal_code",
                    "gdpr_status",
                    "gdpr_pseudonymized_at",
                    "marketing_opt_out_at",
                    "last_gdpr_request_at",
                    "woocommerce_customer_id",
                    "must_change_password",
                    "password_changed_at",
                },
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
                "pos_documents": {
                    "uniconta_sync_status",
                    "uniconta_invoice_number",
                    "uniconta_account",
                    "uniconta_invoice_date",
                    "uniconta_pdf_path",
                    "uniconta_synced_at",
                    "uniconta_sync_error",
                },
                "afg_melt_lots": {"status", "finalized_at", "finalized_by_user_id"},
                "transaction_lines": {"melt_lot_id"},
                "document_artifacts": {"revision"},
            },
        ),
        (
            "0030_pos_session_document_date",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "afg_melt_lot_history",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
            },
            {
                "users": {
                    "postal_code",
                    "gdpr_status",
                    "gdpr_pseudonymized_at",
                    "marketing_opt_out_at",
                    "last_gdpr_request_at",
                    "woocommerce_customer_id",
                    "must_change_password",
                    "password_changed_at",
                },
                "products": {
                    "display_name",
                    "unit_count",
                    "total_weight_grams",
                    "shop_price_dkk",
                    "shop_sync_status",
                    "length_cm",
                    "width_mm",
                    "thickness_mm",
                    "producer",
                    "inventory_category",
                    "inventory_subcategory",
                    "operation_destination",
                    "operation_classification",
                    "deleted_at",
                    "deleted_by_user_id",
                },
                "pos_documents": {
                    "uniconta_sync_status",
                    "uniconta_invoice_number",
                    "uniconta_account",
                    "uniconta_invoice_date",
                    "uniconta_pdf_path",
                    "uniconta_synced_at",
                    "uniconta_sync_error",
                },
                "afg_melt_lots": {"status", "finalized_at", "finalized_by_user_id"},
                "transaction_lines": {"melt_lot_id"},
                "document_artifacts": {"revision"},
                "pos_sessions": {"document_date"},
            },
        ),
        (
            "0031_legacy_missing_tables_reconciliation",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "afg_melt_lot_history",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
                "customer_activity_events",
                "pos_session_product_links",
            },
            {"users": {"must_change_password", "password_changed_at"}, "document_artifacts": {"revision"}, "pos_sessions": {"document_date"}},
        ),
        (
            "0032_august_schema_reconciliation",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "afg_melt_lot_history",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
                "customer_activity_events",
                "pos_session_product_links",
                "gdpr_copy_tasks",
                "customer_notes",
                "customer_note_revisions",
                "legacy_migration_runs",
                "legacy_migration_files",
                "legacy_migration_records",
                "legacy_migration_links",
            },
            {
                "users": {"city", "must_change_password", "password_changed_at"},
                "document_artifacts": {"revision"},
                "pos_sessions": {"document_date"},
                "pos_documents": {
                    "uniconta_credit_note_number",
                    "uniconta_cancelled_at",
                    "uniconta_cancel_reason",
                    "customer_postal_code",
                    "customer_city",
                    "legacy_document_number",
                    "historical_import_hash",
                    "historical_imported_at",
                    "historical_imported_by",
                },
            },
        ),
        (
            "0033_woocommerce_catalog",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "afg_melt_lot_history",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
                "customer_activity_events",
                "pos_session_product_links",
                "gdpr_copy_tasks",
                "customer_notes",
                "customer_note_revisions",
                "legacy_migration_runs",
                "legacy_migration_files",
                "legacy_migration_records",
                "legacy_migration_links",
                "woocommerce_catalog_state",
                "woocommerce_catalog_items",
            },
            {
                "users": {"city", "must_change_password", "password_changed_at"},
                "document_artifacts": {"revision"},
                "pos_sessions": {"document_date"},
                "woocommerce_catalog_state": {"revision", "remote_published_count", "last_synced_at"},
                "woocommerce_catalog_items": {
                    "woocommerce_product_id",
                    "source_payload_sha256",
                    "is_active",
                    "linked_product_id",
                },
            },
        ),
        (
            "0034_market_rate_confirmation",
            base_tables
            | {
                "customer_identity_documents",
                "pos_sessions",
                "ai_usage_log",
                "pos_documents",
                "reference_sequences",
                "transactions",
                "transaction_lines",
                "pos_session_lines",
                "afg_melt_lots",
                "afg_melt_lot_history",
                "document_artifacts",
                "gdpr_requests",
                "gdpr_request_events",
                "gdpr_retention_policies",
                "gdpr_processors",
                "gdpr_jobs",
                "pos_document_audit",
                "customer_activity_events",
                "pos_session_product_links",
                "gdpr_copy_tasks",
                "customer_notes",
                "customer_note_revisions",
                "legacy_migration_runs",
                "legacy_migration_files",
                "legacy_migration_records",
                "legacy_migration_links",
                "woocommerce_catalog_state",
                "woocommerce_catalog_items",
                "market_rate_confirmations",
            },
            {
                "users": {"city", "must_change_password", "password_changed_at"},
                "document_artifacts": {"revision"},
                "pos_sessions": {"document_date"},
                "woocommerce_catalog_state": {"revision", "remote_published_count", "last_synced_at"},
                "woocommerce_catalog_items": {
                    "woocommerce_product_id",
                    "source_payload_sha256",
                    "is_active",
                    "linked_product_id",
                },
                "market_rate_confirmations": {
                    "business_date",
                    "confirmation_mode",
                    "gold_dkk",
                    "silver_dkk",
                    "confirmed_at",
                },
            },
        ),
    ]

    def matches(required_tables: set[str], required_columns: dict[str, set[str]]) -> bool:
        if not required_tables.issubset(table_names):
            return False
        return all(required.issubset(columns.get(table, set())) for table, required in required_columns.items())

    matched = [revision for revision, required_tables, required_columns in stages if matches(required_tables, required_columns)]
    return matched[-1] if matched else None


def _stamp_legacy_database_if_needed(database_path: Path) -> None:
    if not database_path.exists() or database_path.stat().st_size == 0:
        return
    inferred_revision: str | None = None
    with sqlite3.connect(database_path) as connection:
        has_users = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
        ).fetchone()
        has_alembic = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='alembic_version'"
        ).fetchone()
        has_version = False
        version: str | None = None
        if has_alembic:
            version_row = connection.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchone()
            version = str(version_row[0]) if version_row and version_row[0] else None
            has_version = version is not None
            if version in LEGACY_REVISION_ALIASES:
                target = LEGACY_REVISION_ALIASES[version]
                logging.getLogger(__name__).warning(
                    "Eski SQLite migration revision %s -> %s olarak uyumlulaştırılıyor",
                    version,
                    target,
                )
                connection.execute("UPDATE alembic_version SET version_num = ?", (target,))
                connection.commit()
                return
        if has_users and not has_version:
            inferred_revision = _infer_versionless_sqlite_revision(connection)
    if has_users and not has_version:
        if inferred_revision is None:
            raise RuntimeError(
                "Sürüm bilgisi olmayan SQLite şeması tanınamadı; veri güvenliği için migration baseline tahmin edilmedi"
            )
        from alembic import command

        logging.getLogger(__name__).info("Legacy SQLite migration başlangıcı işaretleniyor: %s", inferred_revision)
        command.stamp(_alembic_config(), inferred_revision)


def _sqlite_migration_revision(database_path: Path) -> str | None:
    """Read the current SQLite revision without changing the customer file."""

    if not _database_preexists(database_path):
        return None
    try:
        with sqlite3.connect(database_path, timeout=30) as connection:
            has_alembic = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='alembic_version'"
            ).fetchone()
            if not has_alembic:
                return None
            row = connection.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchone()
            return str(row[0]) if row and row[0] else None
    except sqlite3.DatabaseError:
        # The online backup below will raise a concrete error and leave the
        # source untouched.  Returning None here ensures a corrupt/non-SQLite
        # file is never mistaken for a current head and silently skipped.
        return None


def _create_sqlite_pre_migration_backup(database_path: Path, backup_root: Path) -> Path:
    """Create a consistent SQLite backup before an in-place Alembic upgrade.

    ``Connection.backup`` reads through SQLite's pager, including committed
    WAL content, instead of copying ``.db``/``-wal`` files independently.
    The source is never replaced or deleted on failure.
    """

    backup_root.mkdir(parents=True, exist_ok=True)
    backup_path = backup_root / (
        f"seroguld-pre-migration-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}-{secrets.token_hex(6)}.sqlite3"
    )
    source = None
    destination = None
    try:
        source = sqlite3.connect(database_path, timeout=30)
        destination = sqlite3.connect(backup_path, timeout=30)
        source.backup(destination)
        destination.commit()
        result = destination.execute("PRAGMA integrity_check").fetchone()
        if not result or str(result[0]).lower() != "ok":
            raise RuntimeError(f"Migration backup integrity_check başarısız: {result!r}")
    except Exception:
        try:
            backup_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    finally:
        if destination is not None:
            destination.close()
        if source is not None:
            source.close()
    return backup_path


def _ensure_sqlite_pre_migration_backup(
    database_path: Path,
    backup_root: Path,
    *,
    migration_head: str | None = None,
) -> Path | None:
    """Back up only an existing database that is not already at the head."""

    if not _database_preexists(database_path):
        return None
    resolved_head = migration_head if migration_head is not None else _current_migration_head()
    if _sqlite_migration_revision(database_path) == resolved_head:
        return None
    return _create_sqlite_pre_migration_backup(database_path, backup_root)


def migrate(paths: RuntimePaths) -> int:
    from alembic import command

    backup_path = _ensure_sqlite_pre_migration_backup(paths.database, paths.data / "backups")
    if backup_path is not None:
        logging.getLogger(__name__).warning(
            "Migration öncesi SQLite yedeği oluşturuldu: %s",
            backup_path,
        )
    _stamp_legacy_database_if_needed(paths.database)
    command.upgrade(_alembic_config(), "head")
    logging.getLogger(__name__).info("SQLite migration tamamlandı")
    return 0


def serve() -> int:
    import uvicorn

    port = DEFAULT_PORT
    raw_smoke_port = os.environ.get(SMOKE_PORT_ENV, "").strip()
    if raw_smoke_port:
        try:
            port = int(raw_smoke_port)
        except ValueError as exc:
            raise RuntimeError("Runtime smoke portu geçersiz") from exc
        if not 1024 <= port <= 65535:
            raise RuntimeError("Runtime smoke portu güvenli aralığın dışında")

    uvicorn.run(
        "app.main:app",
        host=DEFAULT_HOST,
        port=port,
        workers=1,
        access_log=False,
        log_config=None,
    )
    return 0


def _excel_request_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _excel_status_url(config: dict[str, Any]) -> str:
    """Derive the bearer-bound status endpoint from the fixed sync URL."""

    close_url = str(config.get("close_url") or "").strip()
    if close_url:
        return close_url
    sync = urlsplit(str(config["sync_url"]))
    return urlunsplit((sync.scheme, sync.netloc, sync.path[: -len("/sync")], "", ""))


def _touch_excel_session(config: dict[str, Any]) -> None:
    """Keep an idle managed session alive while Excel remains open."""

    import httpx

    response = httpx.get(
        _excel_status_url(config),
        headers=_excel_request_headers(str(config["session_token"])),
        timeout=8.0,
    )
    response.raise_for_status()


def _validate_excel_bridge_config(config: dict[str, Any]) -> None:
    """Keep a manually launched bridge from exfiltrating its session token.

    Tauri validates these values before spawning the bridge, but the packaged
    executable also accepts stdin and must defend itself if somebody invokes
    it directly.  Excel sync is a fixed loopback protocol; it never needs a
    remote URL or a workbook outside ProgramData's managed working root.
    """

    token = str(config.get("session_token") or "").strip()
    if not token:
        raise ValueError("Excel session tokenı boş olamaz")

    sync = urlsplit(str(config.get("sync_url") or "").strip())
    if (
        sync.scheme != "http"
        or sync.hostname != DEFAULT_HOST
        or sync.port != DEFAULT_PORT
        or sync.username
        or sync.password
        or sync.query
        or sync.fragment
    ):
        raise ValueError("Excel senkron adresi yalnız yerel backend olabilir")
    parts = sync.path.split("/")
    if len(parts) != 6 or parts[:4] != ["", "api", "v2", "excel-sessions"] or parts[5] != "sync":
        raise ValueError("Excel senkron yolu geçersiz")
    session_id = parts[4]
    if not session_id or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for character in session_id):
        raise ValueError("Excel session kimliği geçersiz")

    close = str(config.get("close_url") or "").strip()
    if close:
        close_parts = urlsplit(close)
        if (
            close_parts.scheme != "http"
            or close_parts.hostname != DEFAULT_HOST
            or close_parts.port != DEFAULT_PORT
            or close_parts.username
            or close_parts.password
            or close_parts.query
            or close_parts.fragment
            or close_parts.path != f"/api/v2/excel-sessions/{session_id}"
        ):
            raise ValueError("Excel kapanış adresi yalnız yerel backend olabilir")

    workbook_path = Path(str(config.get("workbook_path") or "")).expanduser().resolve()
    working_root = (_program_data_root() / "documents" / "working").resolve()
    if working_root not in workbook_path.parents:
        raise ValueError("Excel çalışma dosyası yönetilen klasörün dışında")


class ExcelSyncRejected(RuntimeError):
    """The bridge saved locally, but CRM deliberately rejected the update."""


def _excel_last_modified_at(workbook_path: Path) -> str:
    """Serialize the managed workbook mtime as an ISO-8601 UTC form value.

    FastAPI's ``datetime`` form parser accepts an ISO timestamp, not the
    epoch-millisecond string returned by ``st_mtime_ns``.  Keeping this
    conversion at the bridge boundary also makes the value unambiguous across
    Windows local time zones.
    """

    modified_at = datetime.fromtimestamp(
        workbook_path.stat().st_mtime_ns / 1_000_000_000,
        tz=timezone.utc,
    )
    return modified_at.isoformat()


def _sync_excel_workbook(config: dict[str, Any], workbook_path: Path) -> dict[str, Any]:
    import httpx

    with workbook_path.open("rb") as workbook:
        response = httpx.post(
            str(config["sync_url"]),
            headers=_excel_request_headers(str(config["session_token"])),
            params={"base_revision": str(config["base_revision"])},
            data={
                "last_modified_at": _excel_last_modified_at(workbook_path),
            },
            files={"workbook": (workbook_path.name, workbook, "application/octet-stream")},
            timeout=10.0,
        )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ExcelSyncRejected("Excel senkron yanıtı geçersiz")
    if payload.get("status") != "applied":
        errors = payload.get("blocking_errors")
        if isinstance(errors, list):
            detail = "; ".join(str(item) for item in errors if str(item).strip())
        else:
            detail = ""
        message = str(payload.get("message") or detail or "Excel değişikliği CRM tarafından reddedildi")
        raise ExcelSyncRejected(message)
    if isinstance(payload, dict) and payload.get("revision") is not None:
        config["base_revision"] = int(payload["revision"])
    return payload


def _notify_excel_closed(config: dict[str, Any], *, discard: bool = False) -> bool:
    import httpx

    close_url = str(config.get("close_url") or "").strip()
    if not close_url:
        return True
    try:
        response = httpx.delete(
            close_url,
            headers=_excel_request_headers(str(config["session_token"])),
            params={"discard": "true"} if discard else None,
            timeout=8.0,
        )
        # A timeout can happen after the backend has already released the
        # reservation.  Treat the subsequent idempotent 404 as success so the
        # bridge does not remain stuck forever waiting on a session that is
        # already closed (the managed copy has either been removed or moved
        # to recovery by the backend).
        if getattr(response, "status_code", None) == 404:
            return True
        response.raise_for_status()
        return True
    except Exception:
        logging.getLogger(__name__).exception("Excel close bildirimi gönderilemedi")
        return False


def _release_excel_session_after_startup_failure(config: dict[str, Any]) -> bool:
    """Release a session only after the bridge failed before opening Excel.

    ``discard=False`` is intentional: the backend's fingerprint check decides
    whether a clean copy can be removed or a dirty copy must be preserved.
    """

    return _notify_excel_closed(config, discard=False)


def _handle_excel_bridge_command(
    payload: dict[str, Any],
    *,
    close_requested: threading.Event,
    discard_requested: threading.Event,
    focus_requested: threading.Event | None = None,
) -> bool:
    """Apply one shell command; return whether the listener should continue."""

    action = str(payload.get("action") or "").lower()
    if action == "discard":
        discard_requested.set()
        close_requested.set()
        # The main loop performs the authenticated DELETE.  Keep the listener
        # alive until that request succeeds: a transient backend/pipe failure
        # must still allow a later explicit discard retry.
        return True
    if action == "close":
        close_requested.set()
        # A failed final sync clears this flag and waits for a later command;
        # the stdin listener must remain alive for that retry/discard command.
        return True
    if action == "focus":
        if focus_requested is not None:
            focus_requested.set()
        return True
    return True


@dataclass(slots=True)
class _ExcelBridgeController:
    config: dict[str, Any]
    workbook_path: Path
    logger: logging.Logger
    pending_since: float | None = None
    last_observed_mtime: int = 0
    close_sync_completed: bool = False
    close_attempted: bool = False
    last_sync_error: str | None = None
    discarding: bool = False

    def mark_changed(self) -> None:
        if self.config.get("can_write", False):
            self.pending_since = time.monotonic()

    def sync_saved_file(self, *, force: bool = False) -> None:
        if not self.config.get("can_write", False):
            return
        if not self.workbook_path.exists():
            if force:
                raise FileNotFoundError(self.workbook_path)
            return
        current_mtime = self.workbook_path.stat().st_mtime_ns
        if not force and current_mtime == self.last_observed_mtime:
            return
        result = _sync_excel_workbook(self.config, self.workbook_path)
        self.logger.info("Excel değişikliği senkronize edildi (revision=%s)", result.get("revision"))
        self.last_observed_mtime = current_mtime
        self.pending_since = None
        self.last_sync_error = None

    def before_close(self, workbook: Any) -> bool:
        self.close_attempted = True
        if self.discarding:
            self.close_sync_completed = True
            return True
        if not self.config.get("can_write", False):
            self.close_sync_completed = True
            return True
        workbook.Save()
        # WorkbookBeforeClose can race a filesystem write whose mtime has not
        # advanced at the platform's timestamp precision.  The close path is
        # final and must upload the managed copy even when the debounce
        # fingerprint says it is unchanged.
        self.sync_saved_file(force=True)
        self.close_sync_completed = True
        self.last_sync_error = None
        return True

    def sync_for_close(self) -> bool:
        """Finish a close after Excel has already released its workbook.

        Excel can disappear before ``WorkbookBeforeClose`` gives the bridge a
        usable COM object.  The managed working copy is still the authoritative
        source in that state, so a native close/retry command can sync it
        directly.  Keep this separate from ``before_close``: it must never try
        to call a stale COM object.
        """

        if self.close_sync_completed:
            return True
        self.close_attempted = True
        if self.discarding or not self.config.get("can_write", False):
            self.close_sync_completed = True
            self.last_sync_error = None
            return True
        # Excel may have disappeared before COM exposed a usable workbook.
        # Upload the managed copy unconditionally so a same-mtime write cannot
        # be acknowledged as a clean close without reaching CRM.
        self.sync_saved_file(force=True)
        self.close_sync_completed = True
        self.last_sync_error = None
        return True

    def try_close_for_request(self, workbook: Any) -> bool:
        """Try the final save without destroying a recoverable Excel session."""

        try:
            self.before_close(workbook)
            return True
        except Exception as exc:
            self.last_sync_error = str(exc)
            self.pending_since = time.monotonic()
            self.logger.exception("Excel kapatılırken son senkron başarısız")
            return False


def _try_sync_after_excel_closed(
    controller: _ExcelBridgeController,
    logger: logging.Logger,
) -> bool:
    """Retry a final sync from the managed file after Excel closed directly."""

    try:
        controller.sync_for_close()
        return True
    except Exception as exc:
        controller.last_sync_error = str(exc)
        controller.pending_since = time.monotonic()
        logger.exception("Excel doğrudan kapandıktan sonra son senkron başarısız")
        return False


class _ExcelApplicationEvents:
    controller: _ExcelBridgeController | None = None

    def OnSheetChange(self, _sheet: Any, _target: Any) -> None:  # noqa: N802 - COM callback name
        if self.controller is not None:
            self.controller.mark_changed()

    def OnWorkbookAfterSave(self, _workbook: Any, success: bool) -> None:  # noqa: N802 - COM callback name
        if success and self.controller is not None:
            try:
                self.controller.sync_saved_file()
            except Exception as exc:
                self.controller.last_sync_error = str(exc)
                self.controller.pending_since = time.monotonic()
                self.controller.logger.exception("WorkbookAfterSave senkron hatası")

    def OnWorkbookBeforeClose(self, workbook: Any, _cancel: Any) -> None:  # noqa: N802 - COM callback name
        if self.controller is not None:
            try:
                self.controller.before_close(workbook)
            except Exception as exc:
                # COM may not expose a mutable Cancel reference in every Excel
                # version. Keep the working copy; the main loop remains alive
                # so native close/retry/discard can resolve the session.
                self.controller.last_sync_error = str(exc)
                self.controller.pending_since = time.monotonic()
                self.controller.logger.exception("WorkbookBeforeClose son senkron hatası")


def _focus_excel_workbook(excel: Any, workbook: Any) -> None:
    """Activate the managed workbook without searching for another Excel."""

    excel.Visible = True
    try:
        # xlNormal; restoring a minimized managed instance is safe and keeps
        # focus tied to the COM object owned by this bridge.
        excel.WindowState = -4143
    except Exception:
        pass
    workbook.Activate()
    try:
        excel.Activate()
    except Exception:
        pass
    try:
        hwnd = int(getattr(excel, "Hwnd", 0) or 0)
    except (TypeError, ValueError):
        hwnd = 0
    if hwnd:
        try:
            import win32gui

            win32gui.ShowWindow(hwnd, 9)
            win32gui.SetForegroundWindow(hwnd)
        except Exception:
            # COM activation above remains the authoritative focus path. A
            # foreground steal can be rejected by Windows focus policy.
            pass


def _open_managed_excel_workbook(
    excel_client: Any,
    excel: Any,
    event_sink: Any,
    controller: _ExcelBridgeController,
    workbook_path: Path,
    config: dict[str, Any],
) -> tuple[Any, Any, Any]:
    """Open the preserved managed copy, recreating Excel only if needed."""

    if excel is None:
        excel = excel_client.DispatchEx("Excel.Application")
        event_sink = excel_client.WithEvents(excel, _ExcelApplicationEvents)
        event_sink.controller = controller
        excel.DisplayAlerts = True
        excel.Visible = True
    workbook = excel.Workbooks.Open(
        str(workbook_path),
        UpdateLinks=0,
        ReadOnly=not bool(config.get("can_write", False)),
    )
    return excel, event_sink, workbook


def excel_probe() -> int:
    """Gerçek COM tespiti: gizli bir Excel örneği başlatıp hemen kapatır.

    Stdout'a tek satır JSON verdict yazar; registry sezgisinin aksine
    'kayıtlı ama bozuk' Office kurulumlarını da yakalar. Exit: 0 = Excel
    kullanılabilir, 3 = kullanılamaz, 2 = platform desteklenmiyor.
    """
    if os.name != "nt":
        print(json.dumps({"available": False, "version": None, "error": "unsupported-platform"}))
        return 2
    excel = None
    try:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        try:
            excel = win32com.client.DispatchEx("Excel.Application")
            excel.DisplayAlerts = False
            excel.Visible = False
            version = str(getattr(excel, "Version", "") or "")
            print(json.dumps({"available": True, "version": version, "error": None}))
            return 0
        finally:
            if excel is not None:
                try:
                    excel.Quit()
                except Exception:
                    pass
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"available": False, "version": None, "error": str(exc)[:300]}))
        return 3


def excel_bridge() -> int:
    if os.name != "nt":
        raise RuntimeError("Microsoft Excel bridge yalnız Windows üzerinde çalışır")
    raw_config = sys.stdin.buffer.readline()
    if not raw_config:
        raise RuntimeError("Excel bridge oturum bilgisi alamadı")
    config = json.loads(raw_config.decode("utf-8"))
    if not isinstance(config, dict):
        raise RuntimeError("Excel bridge oturum bilgisi geçersiz")
    _validate_excel_bridge_config(config)
    close_requested = threading.Event()
    discard_requested = threading.Event()
    focus_requested = threading.Event()

    def _listen_for_commands() -> None:
        for raw_line in sys.stdin.buffer:
            try:
                payload = json.loads(raw_line.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            if not _handle_excel_bridge_command(
                payload,
                close_requested=close_requested,
                discard_requested=discard_requested,
                focus_requested=focus_requested,
            ):
                return

    threading.Thread(target=_listen_for_commands, name="excel-bridge-commands", daemon=True).start()
    try:
        workbook_path = Path(str(config["workbook_path"])).resolve()
        if not workbook_path.exists():
            raise FileNotFoundError(workbook_path)

        # Import/COM initialization can fail before a workbook is opened.
        # Keep cleanup guarded so a partial COM apartment never raises a
        # second error and leaves the backend slot active until TTL expiry.
        import pythoncom
        import win32com.client

        logger = logging.getLogger("seroguld.excel_bridge")
        com_initialized = False
        pythoncom.CoInitialize()
        com_initialized = True
    except Exception:
        _release_excel_session_after_startup_failure(config)
        raise
    excel = None
    workbook = None
    controller = _ExcelBridgeController(
        config=config,
        workbook_path=workbook_path,
        logger=logger,
        last_observed_mtime=workbook_path.stat().st_mtime_ns,
    )
    event_sink = None
    exit_code = 0
    notify_closed = False
    startup_complete = False
    last_session_touch = 0.0
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        event_sink = win32com.client.WithEvents(excel, _ExcelApplicationEvents)
        event_sink.controller = controller
        excel.DisplayAlerts = True
        excel.Visible = True
        workbook = excel.Workbooks.Open(
            str(workbook_path),
            UpdateLinks=0,
            ReadOnly=not bool(config.get("can_write", False)),
        )
        startup_complete = True
        while True:
            pythoncom.PumpWaitingMessages()
            if not close_requested.is_set():
                now_monotonic = time.monotonic()
                if now_monotonic - last_session_touch >= 30.0:
                    # A user may leave a clean workbook open beyond the
                    # backend TTL. Touching status extends the same bearer
                    # bound session without putting the token in argv/logs.
                    # Failed heartbeats remain recoverable and are retried.
                    last_session_touch = now_monotonic
                    try:
                        _touch_excel_session(config)
                    except Exception:
                        logger.warning("Excel oturum heartbeat başarısız; yeniden deneniyor")
            if close_requested.is_set():
                if discard_requested.is_set():
                    controller.discarding = True
                    try:
                        excel.EnableEvents = False
                    except Exception:
                        pass
                    try:
                        if workbook is not None:
                            workbook.Close(SaveChanges=False)
                            workbook = None
                        controller.close_sync_completed = True
                        if _notify_excel_closed(config, discard=True):
                            # The backend is notified only after Excel has
                            # released the managed copy and explicit discard
                            # has succeeded.
                            notify_closed = True
                            break
                        logger.error("Excel discard bildirimi başarısız; yeniden denenebilir")
                    except Exception as exc:
                        controller.last_sync_error = str(exc)
                        logger.exception("Excel çalışma kopyası atılırken kapatılamadı")
                    # Keep the bridge alive when the backend could not confirm
                    # discard. Rust retains child/stdin for a later command.
                    controller.discarding = False
                    controller.close_sync_completed = False
                    close_requested.clear()
                    discard_requested.clear()
                    controller.pending_since = time.monotonic()
                    continue
                close_succeeded = (
                    controller.try_close_for_request(workbook)
                    if workbook is not None
                    else _try_sync_after_excel_closed(controller, logger)
                )
                if not close_succeeded:
                    # Keep the managed Excel instance alive.  The user can
                    # return to the CRM, correct the cell, and send another
                    # close command; recovery data is never discarded here.
                    # A discard command can arrive while HTTP sync is in
                    # flight. Preserve that intent for the next iteration.
                    if not discard_requested.is_set():
                        close_requested.clear()
                        discard_requested.clear()
                    controller.pending_since = time.monotonic()
                    continue
                if workbook is not None:
                    try:
                        workbook.Close(SaveChanges=False)
                        workbook = None
                    except Exception as exc:
                        controller.last_sync_error = str(exc)
                        controller.pending_since = time.monotonic()
                        logger.exception("Excel kapatılırken workbook kapatılamadı")
                        close_requested.clear()
                        discard_requested.clear()
                        continue
                if _notify_excel_closed(config):
                    # Never release the backend reservation before the final
                    # sync and close notification both succeed.
                    notify_closed = True
                    break
                logger.error("Excel close bildirimi başarısız; yeniden denenebilir")
                controller.close_sync_completed = False
                if not discard_requested.is_set():
                    close_requested.clear()
                    discard_requested.clear()
                controller.pending_since = time.monotonic()
                continue
            if focus_requested.is_set():
                focus_requested.clear()
                try:
                    if workbook is None:
                        try:
                            excel, event_sink, workbook = _open_managed_excel_workbook(
                                win32com.client,
                                excel,
                                event_sink,
                                controller,
                                workbook_path,
                                config,
                            )
                        except Exception:
                            # A direct Excel close can invalidate the old COM
                            # application object. Quit that instance before
                            # recreating one so the session still owns one
                            # managed Excel process at a time.
                            try:
                                if excel is not None:
                                    excel.Quit()
                            except Exception:
                                pass
                            excel = None
                            event_sink = None
                            excel, event_sink, workbook = _open_managed_excel_workbook(
                                win32com.client,
                                excel,
                                event_sink,
                                controller,
                                workbook_path,
                                config,
                            )
                    _focus_excel_workbook(excel, workbook)
                    controller.last_sync_error = None
                    logger.info("Yönetilen Excel çalışma kopyası yeniden açıldı ve öne getirildi")
                except Exception as exc:
                    controller.last_sync_error = str(exc)
                    logger.exception("Yönetilen Excel çalışma kopyası açılamadı")
                continue
            if workbook is None:
                # Excel may have been closed directly by the user. The COM
                # object is gone, but the managed working copy remains
                # available for a later native close/retry/discard command.
                # Do not auto-notify the backend in this state.
                time.sleep(0.1)
                continue
            try:
                _ = workbook.Name
            except Exception:
                workbook = None
                logger.warning(
                    "Excel çalışma kitabı doğrudan kapandı; yönetilen kopya retry/discard için korunuyor"
                )
                if controller.close_sync_completed:
                    if _notify_excel_closed(config):
                        notify_closed = True
                        break
                    logger.error("Excel doğrudan kapanış bildirimi başarısız; yeniden denenebilir")
                    controller.close_sync_completed = False
                elif not controller.close_attempted:
                    # Preserve the historical fast path for a clean direct
                    # Excel close. If this first file-based attempt fails,
                    # leave the bridge alive for a later native retry.
                    if _try_sync_after_excel_closed(controller, logger):
                        if _notify_excel_closed(config):
                            notify_closed = True
                            break
                        logger.error("Excel doğrudan kapanış bildirimi başarısız; yeniden denenebilir")
                        controller.close_sync_completed = False
                continue
            if bool(config.get("can_write", False)):
                try:
                    if not bool(workbook.Saved) and controller.pending_since is None:
                        controller.mark_changed()
                    if controller.pending_since is not None and time.monotonic() - controller.pending_since >= 1.5:
                        workbook.Save()
                        controller.sync_saved_file()
                except Exception as exc:
                    controller.last_sync_error = str(exc)
                    logger.exception("Excel otomatik kayıt/senkron hatası")
                    # Keep retrying after the debounce interval.  The original
                    # working workbook remains the recovery source throughout.
                    controller.pending_since = time.monotonic()
            time.sleep(0.1)
    finally:
        if not startup_complete and not notify_closed:
            # DispatchEx/Workbooks.Open may fail after the backend reserved a
            # session.  The backend compares its clean/dirty fingerprint: a
            # clean copy releases the slot, while a dirty copy is retained as
            # recovery material and returns conflict rather than being lost.
            if not _release_excel_session_after_startup_failure(config):
                exit_code = 4
        try:
            event_sink = None
            if workbook is not None:
                workbook.Close(SaveChanges=bool(config.get("can_write", False)))
        except Exception:
            pass
        try:
            if excel is not None:
                excel.Quit()
        except Exception:
            pass
        if com_initialized:
            pythoncom.CoUninitialize()
    return exit_code


def main(argv: list[str] | None = None) -> int:
    arguments = list(argv if argv is not None else sys.argv[1:])
    mode = arguments[0].strip().lower() if arguments else "serve"
    if mode not in {"migrate", "serve", "excel-bridge", "excel-probe"}:
        try:
            if sys.stderr is not None:
                print("Kullanım: seroguld-runtime.exe [migrate|serve|excel-bridge|excel-probe]", file=sys.stderr)
        except Exception:
            pass
        return 2
    paths: RuntimePaths | None = None
    try:
        paths = prepare_runtime_environment()
        _configure_runtime_logging(paths, mode)
        if mode == "migrate":
            return migrate(paths)
        if mode == "serve":
            return serve()
        if mode == "excel-probe":
            return excel_probe()
        return excel_bridge()
    except Exception:
        try:
            if not logging.getLogger().handlers:
                _configure_fallback_logging(mode)
            logging.getLogger(__name__).exception("Runtime modu başarısız: %s", mode)
        except Exception:
            # No user-facing traceback/dialog is allowed from a windowed
            # runtime, even when ProgramData and TEMP are unavailable.
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
