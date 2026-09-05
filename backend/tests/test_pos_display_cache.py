from __future__ import annotations

import asyncio
import json
import logging
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

import app.services.pos_service as pos_service_module
import app.services.pos_display_service as pos_display_service
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
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.user import User
from app.services.pos_service import (
    _workspace_row_line_total,
    _workspace_row_unit_price_from_matrix,
    display_snapshot,
)
from app.utils.helpers import utc_now


def _draft_session(clerk: User, code: str, token: str) -> PosSession:
    return PosSession(
        session_code=code,
        display_token=token,
        clerk_user_id=clerk.id,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        margin_percent_internal=Decimal("8.00"),
        rate_source=PosRateSourceEnum.LIVE,
        live_rate_dkk=Decimal("615.50"),
        status=PosSessionStatusEnum.DRAFT,
        visible_snapshot={},
    )


def test_display_snapshot_reuses_workspace_sections_within_ttl(monkeypatch):
    """Aynı (session_id, workspace_revision) için tekrarlanan display polling
    çağrıları workspace kurulumunu TEK SEFER çalıştırır; TTL dolunca veya
    revizyon atlayınca bölüm satırları yeniden kurulur."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="cache-admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            session.add(clerk)
            await session.flush()

            pos_session = _draft_session(clerk, "DSPCACHE1", "cache-token-1")
            session.add(pos_session)
            await session.flush()
            session.add(
                PosSessionLine(
                    pos_session_id=pos_session.id,
                    line_no=1,
                    product_type=ProductTypeEnum.BRACELET,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("24.50"),
                    purity_karat="18K",
                    purity_percentage=Decimal("75.00"),
                    rate_dkk=Decimal("615.50"),
                    margin_percent_internal=Decimal("8.00"),
                    line_offer_dkk=Decimal("10405.03"),
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:18"}),
                )
            )
            await session.commit()

            original = pos_service_module.build_purchase_workspace
            calls = {"count": 0}

            async def counting_build(session, *, pos_session):
                calls["count"] += 1
                return await original(session, pos_session=pos_session)

            monkeypatch.setattr(pos_service_module, "build_purchase_workspace", counting_build)
            pos_display_service.reset_display_workspace_cache()
            try:
                first = await display_snapshot(session, pos_session)
                second = await display_snapshot(session, pos_session)
                assert calls["count"] == 1
                # Önbellekten gelen bölümler canlı hesapla aynı içeriktedir.
                assert [r.row_key for r in second.gold_rows] == [r.row_key for r in first.gold_rows]
                assert second.lines_total_dkk == first.lines_total_dkk
                assert second.final_offer_dkk == first.final_offer_dkk

                # TTL sıfırlanınca yeniden kurulur.
                monkeypatch.setattr(pos_display_service, "DISPLAY_WORKSPACE_CACHE_TTL_SECONDS", 0.0)
                await display_snapshot(session, pos_session)
                assert calls["count"] == 2
                monkeypatch.setattr(pos_display_service, "DISPLAY_WORKSPACE_CACHE_TTL_SECONDS", 1.0)

                # Revizyon atlaması yeni anahtar demektir: yeniden kurulur.
                pos_session.notes = json.dumps(
                    {"kind": pos_service_module.WORKSPACE_NOTE_KIND, "workspace_revision": 2}
                )
                third = await display_snapshot(session, pos_session)
                assert calls["count"] == 3
                assert third.workspace_revision == 2
            finally:
                pos_display_service.reset_display_workspace_cache()

        await engine.dispose()

    asyncio.run(run())


def test_display_snapshot_workspace_failure_is_logged_and_falls_back(monkeypatch, caplog):
    """M3 — build_purchase_workspace patlarsa snapshot bayat döner ama SESSİZ
    kalmaz: grid satırları ve TOPLAM canlı workspace özetinden geldiği için
    sessiz düşüş ikisini birden donuk bırakıyordu, tek bozuk decrypt/parse
    bile iz bırakmadan kayboluyordu. logger.exception izini zorunlu kılar."""

    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="cache-stale@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            session.add(clerk)
            await session.flush()

            pos_session = _draft_session(clerk, "DSPSTALE1", "stale-token-1")
            session.add(pos_session)
            await session.commit()

            async def broken_build(session, *, pos_session):
                raise RuntimeError("decrypt patladı")

            monkeypatch.setattr(pos_service_module, "build_purchase_workspace", broken_build)
            pos_display_service.reset_display_workspace_cache()
            try:
                with caplog.at_level(logging.ERROR, logger="app.services.pos_display_service"):
                    snapshot = await display_snapshot(session, pos_session)
                # Workspace satırları eklenemedi: bayat (satırsız) snapshot döner.
                assert snapshot.lines_total_dkk is None
                assert snapshot.gold_rows == []
                # Ama artık izsiz değil: hata + stack trace loglanır.
                assert any("bayat snapshot" in rec.getMessage() for rec in caplog.records)
                assert any(rec.exc_info for rec in caplog.records)
            finally:
                pos_display_service.reset_display_workspace_cache()

        await engine.dispose()

    asyncio.run(run())


def test_workspace_unit_price_is_additive_mer_pris_backend_anchor():
    """Parite çapası (A12): backend tek kaynak formülü
    ``unit = quantize_2(rate + mer pris kr/g)``, ``total = quantize_2(unit × gram)``.
    Mer pris YÜZDE DEĞİLDİR — frontend computedPreview* bu semantiği aynalar
    (src-v2/make/alis/__tests__/previewParity.test.ts aynı örnekleri kullanır)."""

    # Pozitif mer pris EKLENİR (eski yüzde yorumu 564.21 × 0.85 üretirdi).
    assert _workspace_row_unit_price_from_matrix(
        rate_dkk=Decimal("564.21"), avance_percent=Decimal("15")
    ) == Decimal("579.21")
    # Negatif mer pris düşürür: 615.50 − 15 = 600.50.
    assert _workspace_row_unit_price_from_matrix(
        rate_dkk=Decimal("615.50"), avance_percent=Decimal("-15")
    ) == Decimal("600.50")
    # Sıfır mer pris oranı olduğu gibi korur.
    assert _workspace_row_unit_price_from_matrix(
        rate_dkk=Decimal("461.63"), avance_percent=Decimal("0")
    ) == Decimal("461.63")
    # Toplam KAPALI birimle çarpulur: 579.21 × 24.50 = 14190.645 → HALF_UP → 14190.65.
    assert _workspace_row_line_total(
        unit_price_dkk=Decimal("579.21"), gram=Decimal("24.50")
    ) == Decimal("14190.65")


def test_preview_workspace_totals_include_extra_rows():
    """Preview toplamları kniv/çeyrek (extra) satırlarını da sayar — müşteri
    ekranında 'satır var ama toplamda yok' para hatası bundan korunur."""

    gold = SimpleNamespace(
        gram=Decimal("24.50"), line_total_dkk=Decimal("14190.65"), purity_percentage=Decimal("91.60")
    )
    extra = SimpleNamespace(
        gram=Decimal("5.00"), line_total_dkk=Decimal("100.00"), purity_percentage=Decimal("92.50")
    )
    empty = SimpleNamespace(gram=Decimal("0.00"), line_total_dkk=Decimal("0.00"), purity_percentage=Decimal("0"))

    count, total, weight, pure = pos_display_service._preview_workspace_totals(
        gold_rows=[gold],
        silver_rows=[],
        extra_rows=[extra, empty],
    )
    assert count == 2  # gram>0 satırlar: gold + extra (empty satır sayılmaz)
    assert total == Decimal("14290.65")
    assert weight == Decimal("29.50")
    expected_pure = (Decimal("24.50") * Decimal("91.60") / Decimal("100")) + (
        Decimal("5.00") * Decimal("92.50") / Decimal("100")
    )
    assert pure == expected_pure.quantize(Decimal("0.01"))
