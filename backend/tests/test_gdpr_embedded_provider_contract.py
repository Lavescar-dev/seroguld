from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings
from app.database import Base
from app.services import gdpr_service


@pytest.mark.asyncio
async def test_embedded_office_does_not_register_onlyoffice_as_active_processor(monkeypatch) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    monkeypatch.setattr(
        gdpr_service,
        "get_settings",
        lambda: Settings(
            office_provider_default="embedded",
            office_provider_afg="embedded",
            office_provider_depolama="embedded",
            office_provider_log="embedded",
            onlyoffice_runtime_url="http://127.0.0.1:8082",
        ),
    )
    monkeypatch.setattr(
        gdpr_service,
        "collect_runtime_readiness",
        lambda: _ready(),
    )

    async with Session() as session:
        processors = await gdpr_service._sync_processors(session)
        onlyoffice = next(item for item in processors if item.processor_key == "onlyoffice")
        assert onlyoffice.configured is False
        assert onlyoffice.status == "retired"
        assert onlyoffice.endpoint_url is None

    await engine.dispose()


async def _ready():
    return SimpleNamespace(checks=[])
