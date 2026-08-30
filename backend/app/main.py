from __future__ import annotations

import logging
import re
import uuid
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from app.api.auth import router as auth_router
from app.api.afg import router as afg_router
from app.api.antifraud import router as antifraud_router
from app.api.bootstrap import router as bootstrap_router
from app.api.customer_portal import router as customer_portal_router
from app.api.customers import router as customers_router
from app.api.dashboard import router as dashboard_router
from app.api.gdpr import admin_router as gdpr_admin_router
from app.api.gdpr import public_router as gdpr_public_router
from app.api.pos import router as pos_router
from app.api.inventory import router as inventory_router
from app.api.market_rates import router as market_rates_router
from app.api.products import router as products_router
from app.api.reports import router as reports_router
from app.api.settings import router as settings_router
from app.api.v2 import router as v2_router
from app.api.v2_backup import router as v2_backup_router
from app.api.v2_dashboard import router as v2_dashboard_router
from app.api.webhooks import router as webhooks_router
from app.config import get_settings
from app.database import AsyncSessionLocal, Base, engine
from app.models import *  # noqa: F401,F403
from app.models.enums import RoleEnum
from app.models.user import User
from app.schemas.runtime import RuntimeReadinessOut
from app.services.runtime_readiness import collect_runtime_readiness
from app.services.seed_inventory import ensure_seed_inventory
from app.utils.security import get_password_hash

settings = get_settings()


_LOG_SECRET_PATTERN = re.compile(
    r"(?i)([?&](?:token|access_token|refresh_token|api_key|secret|password)=)[^&\s\"']+"
)


def _redact_log_value(value: Any) -> Any:
    if isinstance(value, str):
        return _LOG_SECRET_PATTERN.sub(r"\1[REDACTED]", value)
    if isinstance(value, tuple):
        return tuple(_redact_log_value(item) for item in value)
    if isinstance(value, list):
        return [_redact_log_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _redact_log_value(item) for key, item in value.items()}
    return value


class _SecretRedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact_log_value(record.msg)
        record.args = _redact_log_value(record.args)
        return True


class _RequestIdErrorMiddleware:
    """Return a safe JSON error while preserving CORS and a diagnostic id."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        request_id = self._request_id(scope)
        response_started = False

        async def send_with_request_id(message: dict[str, Any]) -> None:
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
                headers = list(message.get("headers") or [])
                headers.append((b"x-request-id", request_id.encode("ascii")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            logging.getLogger("app.http").exception(
                "Unhandled request error (request_id=%s, method=%s, path=%s)",
                request_id,
                scope.get("method", ""),
                scope.get("path", ""),
            )
            if response_started:
                raise
            response = JSONResponse(
                status_code=500,
                content={
                    "detail": "Beklenmeyen sunucu hatası.",
                    "request_id": request_id,
                },
                headers={"X-Request-ID": request_id},
            )
            await response(scope, receive, send)

    @staticmethod
    def _request_id(scope: dict[str, Any]) -> str:
        for name, value in scope.get("headers") or []:
            if name.lower() != b"x-request-id":
                continue
            candidate = value.decode("ascii", errors="ignore").strip()
            if candidate and len(candidate) <= 64 and re.fullmatch(r"[A-Za-z0-9._-]+", candidate):
                return candidate
        return uuid.uuid4().hex


def _configure_app_logging() -> None:
    """App logger'larına RotatingFileHandler ekle.

    data/logs/app.log (10 MB × 5 backup). uvicorn stdout/stderr ayrı kalır
    (shell redirect ile .run/backend.log'a yazılır), bu Python tarafından
    üretilen log'ları yakalar ve disk dolmasını önler.
    """
    log_dir = Path(settings.log_dir) if settings.log_dir else Path("data/logs")
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    target = log_dir / "app.log"
    root = logging.getLogger()
    redaction_filter = _SecretRedactionFilter()
    logging.getLogger("uvicorn.access").addFilter(redaction_filter)
    for existing in root.handlers:
        existing.addFilter(redaction_filter)
    for existing in root.handlers:
        if isinstance(existing, RotatingFileHandler) and Path(existing.baseFilename) == target.resolve():
            return
    handler = RotatingFileHandler(
        target,
        maxBytes=settings.log_max_bytes,
        backupCount=settings.log_backup_count,
        encoding="utf-8",
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    handler.setLevel(logging.INFO)
    handler.addFilter(redaction_filter)
    root.addHandler(handler)
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)

    # httpx/httpcore her istekte INFO basar (URL + account parametreleri düşer);
    # app.log'a yalnızca uyarılar yazsın.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


async def ensure_initial_admin() -> None:
    if not settings.should_auto_seed_initial_admin():
        return

    async with AsyncSessionLocal() as session:
        # Bootstrap credentials are created only on a genuinely empty
        # application database. Never rename, reset, or force-change an
        # existing upgrade/admin account.
        for table in Base.metadata.sorted_tables:
            if (await session.execute(select(table).limit(1))).first() is not None:
                await session.rollback()
                return

        admin = User(
            email=settings.initial_admin_email,
            name=settings.initial_admin_name,
            role=RoleEnum.ADMIN,
            password_hash=get_password_hash(settings.initial_admin_password),
            is_active=True,
            must_change_password=settings.initial_admin_force_password_change,
        )
        session.add(admin)
        await session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    _configure_app_logging()
    logging.getLogger("app.startup").info(
        "backend started (log_dir=%s, max_bytes=%s, backups=%s)",
        settings.log_dir,
        settings.log_max_bytes,
        settings.log_backup_count,
    )
    settings.validate_runtime_configuration()
    if settings.database_auto_create:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    await ensure_initial_admin()
    try:
        await ensure_seed_inventory()
    except Exception:  # pragma: no cover - seed asla başlatmayı bloke etmez
        logging.getLogger("app.startup").exception("Depolama seed yüklenemedi")
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

media_root = settings.media_root_path()
media_root.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(media_root)), name="media")

app.add_middleware(_RequestIdErrorMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    from app.version import APP_VERSION

    return {"status": "ok", "version": APP_VERSION}


@app.get("/readyz", response_model=RuntimeReadinessOut)
async def readiness() -> JSONResponse:
    payload = await collect_runtime_readiness()
    return JSONResponse(status_code=200 if payload.ready else 503, content=payload.model_dump(mode="json"))


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(v2_router, prefix="/api/v2", tags=["v2"])
app.include_router(v2_backup_router, prefix="/api/v2/backups", tags=["desktop-backups"])
app.include_router(v2_dashboard_router, prefix="/api/v2/dashboard", tags=["dashboard-v2"])
app.include_router(bootstrap_router, prefix="/api/bootstrap", tags=["bootstrap"])
app.include_router(afg_router, prefix="/api/afg", tags=["afg"])
app.include_router(antifraud_router, prefix="/api/antifraud", tags=["antifraud"])
app.include_router(customer_portal_router, prefix="/api/customer", tags=["customer"])
app.include_router(products_router, prefix="/api/products", tags=["products"])
app.include_router(customers_router, prefix="/api/customers", tags=["customers"])
app.include_router(pos_router, prefix="/api/pos", tags=["pos"])
app.include_router(inventory_router, prefix="/api/inventory", tags=["inventory"])
app.include_router(market_rates_router, prefix="/api/v2/market-rates", tags=["market-rates"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(gdpr_admin_router, prefix="/api/v2/gdpr", tags=["gdpr"])
app.include_router(gdpr_public_router, prefix="/api/v2/public/gdpr", tags=["gdpr-public"])
app.include_router(reports_router, prefix="/api/reports", tags=["reports"])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])
app.include_router(webhooks_router, prefix="/api/webhooks", tags=["webhooks"])
