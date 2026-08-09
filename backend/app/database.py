from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def _normalize_async_database_url(value: str) -> str:
    if value.startswith("sqlite:///"):
        return value.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if value.startswith("postgresql+psycopg://"):
        return value.replace("postgresql+psycopg://", "postgresql+asyncpg://", 1)
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+asyncpg://", 1)
    return value


settings = get_settings()
database_url = _normalize_async_database_url(settings.database_url)
engine_kwargs: dict[str, object] = {
    "pool_pre_ping": True,
    "echo": False,
}
if database_url.startswith("sqlite+"):
    # SQLite has no row-level FOR UPDATE.  The workspace mutation still uses
    # a compare-and-swap revision update; this timeout gives a competing
    # request enough time to observe that CAS result instead of immediately
    # surfacing ``database is locked`` as a transport failure.
    engine_kwargs["connect_args"] = {"timeout": 15.0}

engine = create_async_engine(database_url, **engine_kwargs)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
