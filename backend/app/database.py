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
engine = create_async_engine(
    _normalize_async_database_url(settings.database_url),
    pool_pre_ping=True,
    echo=False,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
