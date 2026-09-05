from __future__ import annotations

import asyncio
from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.pos_session_product_link import PosSessionProductLink
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.pos import PosConfirmRequest, PosConfirmResponse
from app.services import pos_service
from app.services.pos_service import confirm_session
from app.utils.helpers import utc_now


def _build_buy_draft_session(clerk_id, customer_id, code: str) -> PosSession:
    # Satırsız alış oturumu: confirm, tek kalemlik örtük satırdan ürün üretir.
    return PosSession(
        session_code=code,
        display_token=f"display-token-{code}",
        clerk_user_id=clerk_id,
        customer_id=customer_id,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        live_rate_dkk=Decimal("600.00"),
        rate_source=PosRateSourceEnum.LIVE,
        margin_percent_internal=Decimal("8.00"),
        final_offer_dkk=Decimal("3000.00"),
        product_type=ProductTypeEnum.RING,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("10.00"),
        purity_karat="18K",
        purity_percentage=Decimal("75.00"),
        status=PosSessionStatusEnum.DRAFT,
        visible_snapshot={},
    )


async def _seed_clerk_and_customer(session: AsyncSession, code: str) -> tuple[User, User]:
    clerk = User(
        email=f"clerk-{code}@test.local",
        password_hash="x",
        name="Clerk",
        role=RoleEnum.ADMIN,
    )
    customer = User(
        email=f"customer-{code}@test.local",
        password_hash="x",
        name="Customer",
        role=RoleEnum.CUSTOMER,
    )
    session.add_all([clerk, customer])
    await session.flush()
    return clerk, customer


async def _counts(session: AsyncSession, model) -> int:
    return int(await session.scalar(select(func.count()).select_from(model)))


def test_confirm_explosion_after_product_creation_persists_nothing():
    """create_product sonrası patlama: session/ürün/status eski haline dönmeli
    (yarım confirm yok — parçalı commit kalıntısı bırakılmamalı)."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk, customer = await _seed_clerk_and_customer(session, "boom")
            pos_session = _build_buy_draft_session(clerk.id, customer.id, "BOOMAAA1")
            session.add(pos_session)
            await session.commit()

            async def boom(*args, **kwargs):
                raise RuntimeError("confirm patladı")

            original = pos_service._ensure_pos_document
            pos_service._ensure_pos_document = boom
            try:
                with pytest.raises(RuntimeError):
                    await confirm_session(
                        session,
                        pos_session=pos_session,
                        payload=PosConfirmRequest(reference_number="9702", notes="patlama testi"),
                        clerk_user=clerk,
                    )
            finally:
                pos_service._ensure_pos_document = original

            # HİÇBİR şey kalıcı olmamalı.
            assert await _counts(session, Product) == 0
            assert await _counts(session, PosSessionProductLink) == 0
            assert await _counts(session, PosDocument) == 0
            assert await _counts(session, Transaction) == 0
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(ProductHistory)
                    .where(ProductHistory.action == "pos_confirmed")
                )
            ) == 0

            # Oturum eski halinde: hâlâ taslak.
            await session.refresh(pos_session)
            assert pos_session.status == PosSessionStatusEnum.DRAFT
            assert pos_session.confirmed_at is None

        await engine.dispose()

    asyncio.run(run())


def test_parallel_double_confirm_single_success():
    """Paralel iki confirm çağrısından biri 400 almalı (çift onay yarışı)."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk, customer = await _seed_clerk_and_customer(session, "race")
            pos_session = _build_buy_draft_session(clerk.id, customer.id, "RACEAAA1")
            session.add(pos_session)
            await session.commit()

            results = await asyncio.gather(
                confirm_session(
                    session,
                    pos_session=pos_session,
                    payload=PosConfirmRequest(reference_number="9704", notes="yarış-1"),
                    clerk_user=clerk,
                ),
                confirm_session(
                    session,
                    pos_session=pos_session,
                    payload=PosConfirmRequest(reference_number="9704", notes="yarış-2"),
                    clerk_user=clerk,
                ),
                return_exceptions=True,
            )

            successes = [item for item in results if isinstance(item, PosConfirmResponse)]
            conflicts = [
                item for item in results if isinstance(item, HTTPException) and item.status_code == 400
            ]
            assert len(successes) == 1
            assert len(conflicts) == 1
            assert conflicts[0].detail == "Sadece taslak oturum onaylanabilir"

            # Yalnızca kazanan confirm'in ürünü kalıcı olur.
            assert await _counts(session, Product) == 1
            assert await _counts(session, PosSessionProductLink) == 1
            await session.refresh(pos_session)
            assert pos_session.status == PosSessionStatusEnum.CONFIRMED

        await engine.dispose()

    asyncio.run(run())


def test_confirm_reference_collision_leaves_no_partial_state():
    """create_product çakışması (unique reference_number) confirm'i temiz 409 ile
    bitirmeli; retry döngüsü dış transaction'ı yok etmeli ve ara yazı kalıcı
    olmamalı (savepoint tecriti)."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk, customer = await _seed_clerk_and_customer(session, "dupe")
            pos_session = _build_buy_draft_session(clerk.id, customer.id, "DUPEAAA1")
            session.add(pos_session)
            session.add(
                Product(
                    product_number="0001",
                    reference_number="9706",
                    display_name="Mevcut ürün",
                    product_type=ProductTypeEnum.RING,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("5.00"),
                    purchase_price_dkk=Decimal("100.00"),
                    purchase_date=utc_now(),
                    gdpr_release_date=utc_now() + timedelta(days=14),
                )
            )
            await session.commit()

            with pytest.raises(HTTPException) as excinfo:
                await confirm_session(
                    session,
                    pos_session=pos_session,
                    payload=PosConfirmRequest(reference_number="9706", notes="çakışma testi"),
                    clerk_user=clerk,
                )

            assert excinfo.value.status_code == 409
            assert excinfo.value.detail == "Bu referans numarası zaten kayıtlı"

            # Yalnız önceden var olan ürün kaldı; confirm kalıntısı yok.
            assert await _counts(session, Product) == 1
            assert await _counts(session, PosSessionProductLink) == 0
            assert await _counts(session, PosDocument) == 0
            assert await _counts(session, Transaction) == 0
            await session.refresh(pos_session)
            assert pos_session.status == PosSessionStatusEnum.DRAFT
            assert pos_session.confirmed_at is None

        await engine.dispose()

    asyncio.run(run())
