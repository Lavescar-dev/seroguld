from __future__ import annotations

import asyncio
import json
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.config import Settings
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
from app.services import market_rate_profile
from app.services.pos_service import build_purchase_workspace


def _profile_json(gold_8k: str) -> str:
    """Per-karat GLOBAL profil (manuel). 8K bağımsız verilir; 24K=2850 sabit —
    böylece doğrusal fan-out (2850×8/24=950) ile per-karat 8K'yı karıştıran her
    hata testte açıkça yakalanır."""
    gold = {
        "8": gold_8k,
        "14": "1662.50",
        "18": "2137.50",
        "21": "2493.75",
        "21.6": "2565.00",
        "22": "2612.50",
        "24": "2850.00",
    }
    silver = {"999": "14.56", "925": "13.48", "830": "12.10"}
    return json.dumps({"gold_rates_dkk": gold, "silver_rates_dkk": silver})


def test_open_draft_prices_gold_from_live_global_profile(monkeypatch) -> None:
    """KIRMIZI ALARM düzeltmesi — CANLI TEK KAYNAK.

    Açık AFG taslağı altın satır BİRİM FİYATINI her zaman GÜNCEL global per-karat
    profilinden hesaplar:
      * Donmuş ``line_offer_dkk`` / bayat ``rate_dkk`` GÖSTERİLMEZ.
      * 24K'dan doğrusal TÜRETME yok: profil 8K=750 iken satır 750 gösterir (950 DEĞİL).
      * Profil 750→800 değişince aynı açık taslak ANINDA yeni fiyatı yansıtır.
    """
    current = {"json": _profile_json("750.00")}

    def profile_settings() -> Settings:
        return Settings(
            _env_file=None,
            database_url="sqlite+aiosqlite:///test.db",
            inventory_market_rate_profile_json=current["json"],
        )

    monkeypatch.setattr(market_rate_profile, "get_settings", profile_settings)

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="live-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            customer = User(
                email="live-customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER
            )
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="LIVE0001",
                display_token="display-live-global-profile",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("0.00"),
                rate_source=PosRateSourceEnum.MANUAL,
                live_rate_dkk=Decimal("2850.00"),
                manual_rate_dkk=Decimal("2850.00"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
                notes=json.dumps(
                    {
                        "kind": "purchase_workspace_v1",
                        "workspace_revision": 1,
                        # Kasıtlı BAYAT donmuş snapshot (yalnız 24K taşır; per-karat yok).
                        "market_rates": {"gold_24k_dkk": "2850.00", "silver_dkk": "14.56"},
                    }
                ),
            )
            session.add(pos_session)
            await session.flush()
            session.add(
                PosSessionLine(
                    pos_session_id=pos_session.id,
                    line_no=1,
                    product_type=ProductTypeEnum.JEWELRY,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("22.00"),
                    purity_karat="8K",
                    purity_percentage=Decimal("33.30"),
                    # Kasıtlı BAYAT donmuş değerler (eski 950 fan-out hatası):
                    rate_dkk=Decimal("950.00"),
                    margin_percent_internal=Decimal("0.00"),
                    line_offer_dkk=Decimal("20900.00"),
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:8"}),
                )
            )
            await session.commit()

            # 1) Profil 8K=750 → satır CANLI 750 gösterir (bayat 950 DEĞİL, türetme YOK).
            workspace = await build_purchase_workspace(session, pos_session=pos_session)
            assert workspace.market_rates.gold_rates_dkk["8"] == Decimal("750.00")
            row = next(item for item in workspace.gold_rows if item.row_key == "gold:8")
            assert row.rate_dkk == Decimal("750.00")
            assert row.unit_price_dkk == Decimal("750.00")  # avance 0
            assert row.line_total_dkk == Decimal("16500.00")  # 750 × 22

            # 2) Profil 8K 750→800 → AYNI açık taslak ANINDA 800 yansıtır (donmuş kopya yok).
            current["json"] = _profile_json("800.00")
            refreshed = await build_purchase_workspace(session, pos_session=pos_session)
            row2 = next(item for item in refreshed.gold_rows if item.row_key == "gold:8")
            assert row2.rate_dkk == Decimal("800.00")
            assert row2.unit_price_dkk == Decimal("800.00")
            assert row2.line_total_dkk == Decimal("17600.00")  # 800 × 22

        await engine.dispose()

    asyncio.run(scenario())


def test_extra_kniv_and_quarter_rows_render_and_price_live(monkeypatch) -> None:
    """R2-01 — dinamik 'Kniv / Çeyrek altın' satırları.

    Sabit karat/bar tanımına oturmayan, notes.kind = quarter/kniv taşıyan
    satırlar workspace.extra_rows olarak render edilir ve CANLI matris fiyatından
    hesaplanır (çeyrek = altın karat, kniv = gümüş). Toplamlara dahil olur.
    """
    profile = json.dumps(
        {
            "gold_rates_dkk": {"8": "950", "14": "1662.50", "18": "2137.50", "21": "2493.75", "21.6": "2565.00", "22": "2612.50", "24": "2850.00"},
            "silver_rates_dkk": {"999": "14.56", "925": "13.48", "830": "12.10"},
        }
    )
    monkeypatch.setattr(
        market_rate_profile,
        "get_settings",
        lambda: Settings(_env_file=None, database_url="sqlite+aiosqlite:///test.db", inventory_market_rate_profile_json=profile),
    )

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="extra-clerk@test.local", password_hash="x", name="C", role=RoleEnum.ADMIN)
            cust = User(email="extra-cust@test.local", password_hash="x", name="K", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, cust])
            await session.flush()
            pos_session = PosSession(
                session_code="EXTRA001", display_token="display-extra", clerk_user_id=clerk.id, customer_id=cust.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER, margin_percent_internal=Decimal("0.00"),
                rate_source=PosRateSourceEnum.MANUAL, live_rate_dkk=Decimal("2850.00"),
                status=PosSessionStatusEnum.DRAFT, visible_snapshot={},
                notes=json.dumps({"kind": "purchase_workspace_v1", "workspace_revision": 1}),
            )
            session.add(pos_session)
            await session.flush()
            session.add_all([
                PosSessionLine(
                    pos_session_id=pos_session.id, line_no=1, product_type=ProductTypeEnum.JEWELRY,
                    metal_type=MetalTypeEnum.YELLOW_GOLD, weight_grams=Decimal("7.016"), purity_karat="22",
                    purity_percentage=Decimal("91.67"), rate_dkk=Decimal("0"), margin_percent_internal=Decimal("0"),
                    line_offer_dkk=Decimal("0"),
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "extra:1", "kind": "quarter", "metal": "gold", "karat": "22", "label": "Çeyrek altın"}),
                ),
                PosSessionLine(
                    pos_session_id=pos_session.id, line_no=2, product_type=ProductTypeEnum.JEWELRY,
                    metal_type=MetalTypeEnum.SILVER, weight_grams=Decimal("8.00"), purity_karat="999",
                    purity_percentage=Decimal("99.90"), rate_dkk=Decimal("0"), margin_percent_internal=Decimal("0"),
                    line_offer_dkk=Decimal("0"),
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "extra:2", "kind": "kniv", "metal": "silver", "karat": "999", "label": "Kniv"}),
                ),
            ])
            await session.commit()

            ws = await build_purchase_workspace(session, pos_session=pos_session)
            quarter = next(r for r in ws.extra_rows if r.kind == "quarter")
            assert quarter.rate_dkk == Decimal("2612.50")
            # gram workspace'te 2 ondalığa yuvarlanır (7.016 → 7.02), diğer tüm
            # satırlarla tutarlı: 2612.50 × 7.02 = 18339.75.
            assert quarter.line_total_dkk == Decimal("18339.75")
            kniv = next(r for r in ws.extra_rows if r.kind == "kniv")
            assert kniv.rate_dkk == Decimal("14.56")
            assert kniv.line_total_dkk == Decimal("116.48")  # 14.56 × 8
            # Toplamlara girdi mi?
            assert ws.summary.total_amount_dkk == quarter.line_total_dkk + kniv.line_total_dkk

        await engine.dispose()

    asyncio.run(scenario())


def test_mer_pris_is_additive_and_allows_negative() -> None:
    """R2-07 — 'Mer pris' (kr/g) birim fiyata EKLENİR, yüzde DEĞİL; negatif serbest.

    enhedspris (matris oranı) 650 iken:
      * mer pris +15 → efektif 665 kr/g
      * mer pris −15 → efektif 635 kr/g
      * mer pris 0   → 650 kr/g (değişmez)
    Eski yüzde formülü (650×(1−15/100)=552,50) ARTIK kullanılmaz.
    """
    from app.services.pos_workspace_state import _workspace_row_unit_price_from_matrix as unit

    assert unit(rate_dkk=Decimal("650.00"), avance_percent=Decimal("15")) == Decimal("665.00")
    assert unit(rate_dkk=Decimal("650.00"), avance_percent=Decimal("-15")) == Decimal("635.00")
    assert unit(rate_dkk=Decimal("650.00"), avance_percent=Decimal("0")) == Decimal("650.00")
    # Yüzde formülünün sonucu (552.50) ASLA çıkmamalı.
    assert unit(rate_dkk=Decimal("650.00"), avance_percent=Decimal("15")) != Decimal("552.50")


def test_platinum_and_bar_rows_price_live_ignoring_frozen_zero_offer(monkeypatch) -> None:
    """R1-23 / R1-24 — CANLI TEK HESAP (para hatası).

    Platin ve Guldbarre satırları da altın/gümüş gibi DAİMA güncel matris
    oranından hesaplanır; donmuş ``line_offer_dkk = 0`` satırı 0 GÖSTERMEZ.
    Eski hata: 33 g × 280 platin satırı TOPLAM 0,00 kalıyordu ve müşteri
    ekranına eksik tutar yansıyordu.
    """
    profile = json.dumps(
        {
            "gold_rates_dkk": {k: "2850.00" for k in ("8", "14", "18", "21", "21.6", "22", "24")},
            "silver_rates_dkk": {"999": "14.56", "925": "13.48", "830": "12.10"},
            "gold_bar_dkk": "615.50",
            "platinum_dkk": "280.00",
            "palladium_dkk": "335.00",
        }
    )

    def profile_settings() -> Settings:
        return Settings(
            _env_file=None,
            database_url="sqlite+aiosqlite:///test.db",
            inventory_market_rate_profile_json=profile,
        )

    monkeypatch.setattr(market_rate_profile, "get_settings", profile_settings)

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="ptbar-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            customer = User(email="ptbar-cust@test.local", password_hash="x", name="Cust", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="PTBAR001",
                display_token="display-ptbar",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("0.00"),
                rate_source=PosRateSourceEnum.MANUAL,
                live_rate_dkk=Decimal("2850.00"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
                notes=json.dumps({"kind": "purchase_workspace_v1", "workspace_revision": 1}),
            )
            session.add(pos_session)
            await session.flush()
            session.add_all(
                [
                    # Kasıtlı DONMUŞ offer=0 platin satırı (eski 0,00 hatası).
                    PosSessionLine(
                        pos_session_id=pos_session.id,
                        line_no=1,
                        product_type=ProductTypeEnum.JEWELRY,
                        metal_type=MetalTypeEnum.PLATINUM,
                        weight_grams=Decimal("33.00"),
                        purity_karat="PT",
                        purity_percentage=Decimal("95.00"),
                        rate_dkk=Decimal("0.00"),
                        margin_percent_internal=Decimal("0.00"),
                        line_offer_dkk=Decimal("0.00"),
                        notes=json.dumps({"source": "purchase_workspace", "row_key": "ptpd:platinum"}),
                    ),
                    PosSessionLine(
                        pos_session_id=pos_session.id,
                        line_no=2,
                        product_type=ProductTypeEnum.JEWELRY,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("22.00"),
                        purity_karat="24K",
                        purity_percentage=Decimal("99.90"),
                        rate_dkk=Decimal("0.00"),
                        margin_percent_internal=Decimal("0.00"),
                        line_offer_dkk=Decimal("0.00"),
                        notes=json.dumps({"source": "purchase_workspace", "row_key": "bar:gold"}),
                    ),
                ]
            )
            await session.commit()

            workspace = await build_purchase_workspace(session, pos_session=pos_session)
            platin = next(r for r in workspace.ptpd_rows if r.row_key == "ptpd:platinum")
            assert platin.rate_dkk == Decimal("280.00")
            assert platin.unit_price_dkk == Decimal("280.00")  # avance 0
            assert platin.line_total_dkk == Decimal("9240.00")  # 280 × 33 (0 DEĞİL)

            bar = next(r for r in workspace.bar_rows if r.row_key == "bar:gold")
            assert bar.rate_dkk == Decimal("615.50")
            assert bar.line_total_dkk == Decimal("13541.00")  # 615.50 × 22

        await engine.dispose()

    asyncio.run(scenario())


def test_22b_quarter_row_prices_from_independent_22b_rate(monkeypatch) -> None:
    """R2-10 takip / roadmap madde 2 — 22K-2 (karat '22b') extra satırı.

    '22b' sabit grid'e ALINMAZ (gold:22 ile karat eşleşmesi çakışır); quarter-extra
    olarak gold_rates_dkk['22b'] bağımsız fiyatından çözülür — gold:22 fiyatından
    DEĞİL. Purity 22/24 = 91.67. Dropdown'dan oluşturulan satır bu hattı kullanır.
    """
    profile = json.dumps(
        {
            "gold_rates_dkk": {"8": "950", "14": "1662.50", "18": "2137.50", "21": "2493.75", "21.6": "2565.00", "22": "2612.50", "22b": "2500.00", "24": "2850.00"},
            "silver_rates_dkk": {"999": "14.56", "925": "13.48", "830": "12.10"},
        }
    )
    monkeypatch.setattr(
        market_rate_profile,
        "get_settings",
        lambda: Settings(_env_file=None, database_url="sqlite+aiosqlite:///test.db", inventory_market_rate_profile_json=profile),
    )

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="karat22b-clerk@test.local", password_hash="x", name="C", role=RoleEnum.ADMIN)
            cust = User(email="karat22b-cust@test.local", password_hash="x", name="K", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, cust])
            await session.flush()
            pos_session = PosSession(
                session_code="EXTRA002", display_token="display-extra-22b", clerk_user_id=clerk.id, customer_id=cust.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER, margin_percent_internal=Decimal("0.00"),
                rate_source=PosRateSourceEnum.MANUAL, live_rate_dkk=Decimal("2850.00"),
                status=PosSessionStatusEnum.DRAFT, visible_snapshot={},
                notes=json.dumps({"kind": "purchase_workspace_v1", "workspace_revision": 1}),
            )
            session.add(pos_session)
            await session.flush()
            session.add(
                PosSessionLine(
                    pos_session_id=pos_session.id, line_no=1, product_type=ProductTypeEnum.JEWELRY,
                    metal_type=MetalTypeEnum.YELLOW_GOLD, weight_grams=Decimal("5.00"), purity_karat="22b",
                    purity_percentage=Decimal("91.67"), rate_dkk=Decimal("0"), margin_percent_internal=Decimal("0"),
                    line_offer_dkk=Decimal("0"),
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "extra:22b-1", "kind": "quarter", "metal": "gold", "karat": "22b", "label": "22K-2"}),
                )
            )
            await session.commit()

            ws = await build_purchase_workspace(session, pos_session=pos_session)
            row = next(r for r in ws.extra_rows if r.karat == "22b")
            assert row.label == "22K-2"
            assert row.rate_dkk == Decimal("2500.00")  # bağımsız 22b fiyatı (22 → 2612.50 DEĞİL)
            assert row.unit_price_dkk == Decimal("2500.00")  # avance 0
            assert row.line_total_dkk == Decimal("12500.00")  # 2500 × 5
            assert row.purity_percentage == Decimal("91.67")  # karat_numeric_key('22b') → 22/24

        await engine.dispose()

    asyncio.run(scenario())


# ---------------------------------------------------------------------------
# Finalize repricing uyarı sözleşmesi — matris dışı satırlar sessiz kalmaz
# ---------------------------------------------------------------------------

def _finalize_profile_json() -> str:
    """99 karat KASITLI yok — 'gold:99' satırı matrise oturmasın."""
    gold = {k: "2850.00" for k in ("14", "18", "21", "21.6", "22", "24")}
    silver = {"999": "14.56", "925": "13.48", "830": "12.10"}
    return json.dumps({"gold_rates_dkk": gold, "silver_rates_dkk": silver})


async def _run_finalize_scenario(monkeypatch, lines_builder, body, mock_side_effects=True):
    """Ortak finalize test iskeleti: profil enjekte et, uniconta/email no-op.

    ``body(session, pos_session, finalize)`` — finalize asenkron callable'ı;
    body içinde birden çok çağrı yapılabilir (ör. 409 idempotency testi).
    ``mock_side_effects=False`` → gerçek _sync_uniconta ('not_applicable'
    yazar) ve _send_afg_email_best_effort (transport yoksa sessiz erken
    çıkış) yolları çalışır.
    """
    from app.schemas.pos import PosWorkspaceFinalizeRequest
    from app.services import pos_purchase_finalize
    from app.services.pos_service import finalize_purchase_workspace

    monkeypatch.setattr(
        market_rate_profile,
        "get_settings",
        lambda: Settings(
            _env_file=None,
            database_url="sqlite+aiosqlite:///test.db",
            inventory_market_rate_profile_json=_finalize_profile_json(),
        ),
    )

    async def _noop(*args, **kwargs):  # noqa: ANN002, ANN003
        return None

    if mock_side_effects:
        monkeypatch.setattr(pos_purchase_finalize, "_sync_uniconta", _noop)
        monkeypatch.setattr(pos_purchase_finalize, "_send_afg_email_best_effort", _noop)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        clerk = User(email="finwarn-clerk@test.local", password_hash="x", name="C", role=RoleEnum.ADMIN)
        customer = User(email="finwarn-cust@test.local", password_hash="x", name="K", role=RoleEnum.CUSTOMER)
        session.add_all([clerk, customer])
        await session.flush()
        pos_session = PosSession(
            session_code="FINWARN001",
            display_token="display-finwarn",
            clerk_user_id=clerk.id,
            customer_id=customer.id,
            trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
            margin_percent_internal=Decimal("0.00"),
            rate_source=PosRateSourceEnum.MANUAL,
            live_rate_dkk=Decimal("2850.00"),
            status=PosSessionStatusEnum.DRAFT,
            visible_snapshot={},
            notes=json.dumps({"kind": "purchase_workspace_v1", "workspace_revision": 1}),
        )
        session.add(pos_session)
        await session.flush()
        lines_builder(session, pos_session)
        await session.commit()

        async def finalize():
            return await finalize_purchase_workspace(
                session,
                pos_session=pos_session,
                payload=PosWorkspaceFinalizeRequest(),
            )

        await body(session, pos_session, finalize)

    await engine.dispose()


async def _first_line(session, pos_session) -> PosSessionLine | None:
    return (
        (
            await session.execute(
                select(PosSessionLine)
                .where(PosSessionLine.pos_session_id == pos_session.id)
                .order_by(PosSessionLine.line_no.asc())
            )
        )
        .scalars()
        .first()
    )


def test_finalize_keeps_line_price_when_karat_key_missing_and_warns(monkeypatch) -> None:
    """Matrise oturmayan satır donmuş değerinde KALIR ve yanıtta uyarı döner.

    Koruma davranışı (rate 0 → satır eski tutarında) aynen sürer; eksik olan
    görünürlüktü — artık ``repricing_warnings`` hangi satırın güncel oranla
    fiyatlanamadığını söylüyor.
    """

    def lines(session, pos_session) -> None:
        session.add(
            PosSessionLine(
                pos_session_id=pos_session.id,
                line_no=1,
                product_type=ProductTypeEnum.JEWELRY,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("22.00"),
                purity_karat="99K",
                purity_percentage=Decimal("33.30"),
                rate_dkk=Decimal("750.00"),
                margin_percent_internal=Decimal("0.00"),
                line_offer_dkk=Decimal("16500.00"),  # donmuş eski tutar
                notes=json.dumps(
                    {
                        "source": "purchase_workspace",
                        "row_key": "gold:99",
                        "type_label": "99 karat (test)",
                    }
                ),
            )
        )

    async def body(session, pos_session, finalize) -> None:
        result = await finalize()
        # Satır eski (dondurulmuş) tutarıyla kesinleşti — 0'a çekilmedi.
        line = await _first_line(session, pos_session)
        assert line is not None
        assert line.line_offer_dkk == Decimal("16500.00")
        assert line.rate_dkk == Decimal("750.00")
        # Uyarı: hangi satır, neden.
        assert len(result.repricing_warnings) == 1
        warning = result.repricing_warnings[0]
        assert warning.row_key == "gold:99"
        assert warning.label == "99 karat (test)"
        assert warning.reason == "rate_missing"
        # Toplam donmuş tutardan geldi (korumalı satır sayesinde > 0).
        assert result.session.final_offer_dkk == Decimal("16500.00")

    asyncio.run(_run_finalize_scenario(monkeypatch, lines, body))


def test_finalize_zero_total_lists_unpriced_rows_in_422(monkeypatch) -> None:
    """Tüm satırlar matris dışı + donmuş tutar 0 → 422 satırları adlandırır.

    Eski davranışta tek satırlık anlamsız 'Toplam teklif tutarı geçersiz'
    dönüyordu; müşteri hangi satırın sorunlu olduğunu göremiyordu.
    """
    from fastapi import HTTPException
    import pytest

    def lines(session, pos_session) -> None:
        session.add(
            PosSessionLine(
                pos_session_id=pos_session.id,
                line_no=1,
                product_type=ProductTypeEnum.JEWELRY,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("10.00"),
                purity_karat="99K",
                purity_percentage=Decimal("33.30"),
                rate_dkk=Decimal("0.00"),
                margin_percent_internal=Decimal("0.00"),
                line_offer_dkk=Decimal("0.00"),
                notes=json.dumps(
                    {"source": "purchase_workspace", "row_key": "gold:99", "type_label": "99 karat (test)"}
                ),
            )
        )

    async def body(session, pos_session, finalize) -> None:
        with pytest.raises(HTTPException) as excinfo:
            await finalize()
        detail = str(excinfo.value.detail)
        assert "99 karat (test)" in detail
        assert "karşılık bulunamadı" in detail
        assert detail != "Toplam teklif tutarı geçersiz"

    asyncio.run(_run_finalize_scenario(monkeypatch, lines, body))


def test_finalize_accepts_mixed_priced_and_unpriced_rows(monkeypatch) -> None:
    """Tek satır fiyatlanamasa bile toplam > 0 ise finalize BAŞARILI döner.

    Bug'ın en sık tetiklenme biçimi: satırların çoğu matrisli, biri değil →
    tüm işlem bloklanmaz; uyarı listesi operatöre gider.
    """

    def lines(session, pos_session) -> None:
        session.add_all(
            [
                PosSessionLine(
                    pos_session_id=pos_session.id,
                    line_no=1,
                    product_type=ProductTypeEnum.JEWELRY,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("10.00"),
                    purity_karat="24K",
                    purity_percentage=Decimal("99.90"),
                    rate_dkk=Decimal("0.00"),
                    margin_percent_internal=Decimal("0.00"),
                    line_offer_dkk=Decimal("0.00"),
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:24", "type_label": "24 karat"}),
                ),
                PosSessionLine(
                    pos_session_id=pos_session.id,
                    line_no=2,
                    product_type=ProductTypeEnum.JEWELRY,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("5.00"),
                    purity_karat="99K",
                    purity_percentage=Decimal("33.30"),
                    rate_dkk=Decimal("0.00"),
                    margin_percent_internal=Decimal("0.00"),
                    line_offer_dkk=Decimal("1000.00"),  # donmuş eski tutar
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:99", "type_label": "99 karat (test)"}),
                ),
            ]
        )

    async def body(session, pos_session, finalize) -> None:
        result = await finalize()
        # 24K canlı 2850×10 = 28500 + korunan donmuş 1000 = 29500.
        assert result.session.final_offer_dkk == Decimal("29500.00")
        assert len(result.repricing_warnings) == 1
        assert result.repricing_warnings[0].row_key == "gold:99"
        # Matrisli satırda uyarı yok (yalnız matris dışı satır uyarır).
        assert all(w.row_key != "gold:24" for w in result.repricing_warnings)

    asyncio.run(_run_finalize_scenario(monkeypatch, lines, body))


def test_finalize_with_warnings_stays_idempotent(monkeypatch) -> None:
    """Uyarılı finalize sonrası session CONFIRMED; ikinci finalize 409 atar.

    ``repricing_warnings`` yalnız yanıtta taşınır — satır tutarına, notes'a
    veya audit kaydına yazılmaz; idempotency/CAS sözleşmesi değişmez.
    """
    from fastapi import HTTPException
    import pytest

    def lines(session, pos_session) -> None:
        session.add(
            PosSessionLine(
                pos_session_id=pos_session.id,
                line_no=1,
                product_type=ProductTypeEnum.JEWELRY,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("10.00"),
                purity_karat="99K",
                purity_percentage=Decimal("33.30"),
                rate_dkk=Decimal("200.00"),
                margin_percent_internal=Decimal("0.00"),
                line_offer_dkk=Decimal("2000.00"),
                notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:99", "type_label": "99 karat (test)"}),
            )
        )

    async def body(session, pos_session, finalize) -> None:
        first = await finalize()
        assert first.session.final_offer_dkk == Decimal("2000.00")
        assert len(first.repricing_warnings) == 1
        frozen_total = first.session.final_offer_dkk

        with pytest.raises(HTTPException) as excinfo:
            await finalize()
        assert excinfo.value.status_code == 409

        refreshed = await session.get(PosSession, pos_session.id)
        assert refreshed is not None
        assert refreshed.status == PosSessionStatusEnum.CONFIRMED
        assert refreshed.final_offer_dkk == frozen_total
        # Satır tutarı ikinci çağrıda da değişmedi (uyarı yanıt-sade).
        line = await _first_line(session, pos_session)
        assert line is not None
        assert line.line_offer_dkk == Decimal("2000.00")

    asyncio.run(_run_finalize_scenario(monkeypatch, lines, body))


def test_finalize_marks_uniconta_not_applicable_for_purchases(monkeypatch) -> None:
    """Alış (AFG) finalize'ı Uniconta'ya DOKUNMAZ — durum 'not_applicable'.

    Satış modülü eklenene dek alış belgeleri Uniconta senkron kapsamı dışında:
    credential olsun bile otomatik fatura senkronu denenmez; durum
    'failed'/'skipped' yerine 'not_applicable' yazılır (arayüzde hata rozeti
    ve retry çıkmaz) ve karar PosDocumentAudit'e iz olarak düşer.
    """

    def lines(session, pos_session) -> None:
        session.add(
            PosSessionLine(
                pos_session_id=pos_session.id,
                line_no=1,
                product_type=ProductTypeEnum.JEWELRY,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("10.00"),
                purity_karat="18",
                purity_percentage=Decimal("75.00"),
                rate_dkk=Decimal("2137.50"),
                margin_percent_internal=Decimal("0.00"),
                line_offer_dkk=Decimal("21375.00"),
                notes=json.dumps(
                    {
                        "source": "purchase_workspace",
                        "row_key": "gold:18",
                        "type_label": "18 karat",
                    }
                ),
            )
        )

    async def body(session, pos_session, finalize) -> None:
        from app.models.pos_document import PosDocument
        from app.models.pos_document_audit import PosDocumentAudit

        result = await finalize()
        assert result.uniconta_sync_status == "not_applicable"
        assert result.uniconta_sync_error is None

        # Belge kalıcısı da aynı — retry tetikleyen 'failed'/'skipped' yok.
        document = await session.get(PosDocument, result.document_sequence_no)
        assert document is not None
        assert document.uniconta_sync_status == "not_applicable"
        assert document.uniconta_sync_error is None

        # Karar audit izi bıraktı.
        audits = (
            (
                await session.execute(
                    select(PosDocumentAudit).where(PosDocumentAudit.sequence_no == result.document_sequence_no)
                )
            )
            .scalars()
            .all()
        )
        assert any(a.action == "uniconta_auto_skipped" for a in audits)

    asyncio.run(_run_finalize_scenario(monkeypatch, lines, body, mock_side_effects=False))
