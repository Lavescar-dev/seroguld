"""R1-CPR — cpr_birth_hash backfill servis testleri.

Backfill migration İÇİNDE çalışmaz (anahtar erişimi + uzun batch); bu servis
idempotenttir: yalnız ``cpr_birth_hash IS NULL`` satırları işler, bozuk
şifreli değer ATLANIR ve kuyrukta kalır (bir sonraki koşuda tekrar denenir).
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import RoleEnum
from app.models.user import User
from app.services.cpr_birth_hash_backfill import backfill_cpr_birth_hashes
from app.utils.security import decrypt_field, encrypt_field, hash_cpr, hash_cpr_birth


def _session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    return engine, async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def _seed(session: AsyncSession) -> None:
    # 1) Tam-CPR eski kayıt: hash/last4 dolu, birth_hash boş.
    session.add(
        User(
            email="legacy-full@example.com",
            password_hash="x",
            name="Legacy Full",
            role=RoleEnum.CUSTOMER,
            cpr_number_encrypted=encrypt_field("0101901234"),
            cpr_hash=hash_cpr("0101901234"),
            cpr_last4="1234",
        )
    )
    # 2) last4'süz eski tam kayıt: backfill tamamlamalı.
    session.add(
        User(
            email="legacy-nolast4@example.com",
            password_hash="x",
            name="Legacy NoLast4",
            role=RoleEnum.CUSTOMER,
            cpr_number_encrypted=encrypt_field("0202905678"),
            cpr_hash=hash_cpr("0202905678"),
        )
    )
    # 3) Tarihsel kısmi kayıt: yalnız 6 hane şifreli.
    session.add(
        User(
            email="legacy-partial@example.com",
            password_hash="x",
            name="Legacy Partial",
            role=RoleEnum.CUSTOMER,
            cpr_number_encrypted=encrypt_field("030391"),
        )
    )
    # 4) Bozuk şifreli değer: atlanmalı ve kuyrukta kalmalı.
    session.add(
        User(
            email="legacy-corrupt@example.com",
            password_hash="x",
            name="Legacy Corrupt",
            role=RoleEnum.CUSTOMER,
            cpr_number_encrypted="not-a-valid-payload",
        )
    )
    # 5) Müşteri olmayan rol: backfill kapsamı dışı.
    session.add(
        User(
            email="staff-nobackfill@example.com",
            password_hash="x",
            name="Staff NoBackfill",
            role=RoleEnum.ADMIN,
            cpr_number_encrypted=encrypt_field("0404901234"),
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_backfill_fills_birth_hash_and_completes_legacy_columns() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with Session() as session:
        await _seed(session)

    stats = await backfill_cpr_birth_hashes(Session)

    assert stats["scanned"] == 4  # müşteri olmayan rol işlenmez
    assert stats["backfilled"] == 3
    assert stats["partial_marked"] == 1
    assert stats["skipped_undecryptable"] == 1

    async with Session() as session:
        from sqlalchemy import select  # noqa: PLC0415

        full = await session.scalar(select(User).where(User.email == "legacy-full@example.com"))
        assert full is not None
        assert full.cpr_birth_hash == hash_cpr_birth("0101901234")
        assert full.cpr_is_partial is False

        nolast4 = await session.scalar(select(User).where(User.email == "legacy-nolast4@example.com"))
        assert nolast4 is not None
        assert nolast4.cpr_last4 == "5678"
        assert nolast4.cpr_birth_hash == hash_cpr_birth("0202905678")

        partial = await session.scalar(select(User).where(User.email == "legacy-partial@example.com"))
        assert partial is not None
        assert partial.cpr_is_partial is True
        assert partial.cpr_hash is None
        assert partial.cpr_last4 is None
        assert partial.cpr_birth_hash == hash_cpr_birth("030391")

        corrupt = await session.scalar(select(User).where(User.email == "legacy-corrupt@example.com"))
        assert corrupt is not None
        assert corrupt.cpr_birth_hash is None
        assert decrypt_field(corrupt.cpr_number_encrypted) is None

    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_is_idempotent_and_reports_remaining() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with Session() as session:
        await _seed(session)

    first = await backfill_cpr_birth_hashes(Session)
    assert first["remaining"] == 1  # yalnız bozuk satır kuyrukta kalır

    # İkinci koşu: dolu satırlara dokunmaz, bozuk satır yine atlanır.
    second = await backfill_cpr_birth_hashes(Session)
    assert second["scanned"] == 1
    assert second["backfilled"] == 0
    assert second["remaining"] == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_dry_run_writes_nothing() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with Session() as session:
        await _seed(session)

    stats = await backfill_cpr_birth_hashes(Session, dry_run=True)
    assert stats["backfilled"] == 3
    assert stats["partial_marked"] == 1

    async with Session() as session:
        from sqlalchemy import select  # noqa: PLC0415

        full = await session.scalar(select(User).where(User.email == "legacy-full@example.com"))
        assert full is not None
        assert full.cpr_birth_hash is None  # dry-run yazmadı

    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_max_batches_limits_a_run() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with Session() as session:
        await _seed(session)

    stats = await backfill_cpr_birth_hashes(Session, batch_size=2, max_batches=1)
    assert stats["scanned"] == 2
    assert stats["backfilled"] == 2
    assert stats["remaining"] == 2  # kalan: 1 bozuk + 1 işlenmemiş

    await engine.dispose()
