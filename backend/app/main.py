from __future__ import annotations

from contextlib import asynccontextmanager

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
from app.api.products import router as products_router
from app.api.reports import router as reports_router
from app.api.settings import router as settings_router
from app.api.v2 import router as v2_router
from app.api.webhooks import router as webhooks_router
from app.config import get_settings
from app.database import AsyncSessionLocal, Base, engine
from app.models import *  # noqa: F401,F403
from app.models.enums import RoleEnum
from app.models.user import User
from app.schemas.runtime import RuntimeReadinessOut
from app.services.runtime_readiness import collect_runtime_readiness
from app.utils.security import get_password_hash

settings = get_settings()


async def ensure_initial_admin() -> None:
    if not settings.should_auto_seed_initial_admin():
        return

    async with AsyncSessionLocal() as session:
        existing_admin = await session.scalar(
            select(User).where(User.email == settings.initial_admin_email)
        )
        if existing_admin:
            return

        admin = User(
            email=settings.initial_admin_email,
            name=settings.initial_admin_name,
            role=RoleEnum.ADMIN,
            password_hash=get_password_hash(settings.initial_admin_password),
            is_active=True,
        )
        session.add(admin)
        await session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate_runtime_configuration()
    if settings.database_auto_create:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    await ensure_initial_admin()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

media_root = settings.media_root_path()
media_root.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(media_root)), name="media")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz", response_model=RuntimeReadinessOut)
async def readiness() -> JSONResponse:
    payload = await collect_runtime_readiness()
    return JSONResponse(status_code=200 if payload.ready else 503, content=payload.model_dump(mode="json"))


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(v2_router, prefix="/api/v2", tags=["v2"])
app.include_router(bootstrap_router, prefix="/api/bootstrap", tags=["bootstrap"])
app.include_router(afg_router, prefix="/api/afg", tags=["afg"])
app.include_router(antifraud_router, prefix="/api/antifraud", tags=["antifraud"])
app.include_router(customer_portal_router, prefix="/api/customer", tags=["customer"])
app.include_router(products_router, prefix="/api/products", tags=["products"])
app.include_router(customers_router, prefix="/api/customers", tags=["customers"])
app.include_router(pos_router, prefix="/api/pos", tags=["pos"])
app.include_router(inventory_router, prefix="/api/inventory", tags=["inventory"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(gdpr_admin_router, prefix="/api/v2/gdpr", tags=["gdpr"])
app.include_router(gdpr_public_router, prefix="/api/v2/public/gdpr", tags=["gdpr-public"])
app.include_router(reports_router, prefix="/api/reports", tags=["reports"])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])
app.include_router(webhooks_router, prefix="/api/webhooks", tags=["webhooks"])
