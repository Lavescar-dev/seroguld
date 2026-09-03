from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v2_dashboard import get_market_rate_confirmation, post_market_rate_confirmation
from app.config import Settings
from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosDocumentTypeEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductStatusEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.market_rate_confirmation import MarketRateConfirmation
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.product import Product
from app.models.user import User
from app.models.woocommerce_catalog import WooCommerceCatalogItem, WooCommerceCatalogState
from app.services.dashboard_overview import (
    build_dashboard_overview,
    build_market_rate_confirmation_state,
    copenhagen_business_date,
    record_market_rate_confirmation,
)
from app.schemas.dashboard_overview import DashboardMarketRateConfirmationIn


NOW = datetime(2026, 8, 13, 8, 0, tzinfo=timezone.utc)


def _settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "backup_root_dir": str(tmp_path / "backups"),
        "backup_restore_drill_dir": str(tmp_path / "restore-drill"),
        "backup_offsite_status_file": str(tmp_path / "offsite.json"),
        "backup_offsite_enabled": False,
        "backup_health_max_age_minutes": 180,
        "backup_restore_drill_max_age_hours": 48,
        "inventory_market_gold_dkk": Decimal("100"),
        "inventory_market_silver_dkk": Decimal("10"),
        "inventory_market_platinum_dkk": Decimal("20"),
        "inventory_market_palladium_dkk": Decimal("30"),
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


async def _session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def _run(coro):
    return asyncio.run(coro)


def test_dashboard_market_profile_route_is_registered() -> None:
    """Dashboard and the shared rate drawer must agree on this API path."""

    from app.main import app

    route = app.openapi()["paths"].get("/api/v2/market-rates/defaults")
    assert route is not None
    assert {"get", "put"}.issubset(route)


async def _add_purchase(
    db: AsyncSession,
    *,
    admin_id,
    code: str,
    issued_at: datetime,
    net: str,
    vat: str,
    gross: str,
    sync_status: str | None,
) -> PosDocument:
    pos_session = PosSession(
        session_code=code,
        display_token=f"token-{code}",
        clerk_user_id=admin_id,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        margin_percent_internal=Decimal("0"),
        status=PosSessionStatusEnum.CONFIRMED,
        visible_snapshot={},
    )
    db.add(pos_session)
    await db.flush()
    document = PosDocument(
        pos_session_id=pos_session.id,
        document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
        issued_at=issued_at,
        created_at=issued_at,
        net_amount_dkk=Decimal(net),
        vat_amount_dkk=Decimal(vat),
        gross_amount_dkk=Decimal(gross),
        vat_rate_percent=Decimal("25") if Decimal(vat) else Decimal("0"),
        uniconta_sync_status=sync_status,
        uniconta_synced_at=issued_at if sync_status == "synced" else None,
    )
    db.add(document)
    return document


def _catalog_item(remote_id: int, *, active: bool, linked_product_id=None, review=False, photo=False):
    return WooCommerceCatalogItem(
        woocommerce_product_id=remote_id,
        name=f"Remote {remote_id}",
        remote_status="publish",
        weight_missing=False,
        manual_review_required=review,
        manual_review_reasons=["review"] if review else [],
        photo_missing=photo,
        image_count=0 if photo else 1,
        images_json=[],
        categories_json=[],
        source_payload_json={},
        source_payload_sha256=f"hash-{remote_id}",
        is_active=active,
        linked_product_id=linked_product_id,
    )


def test_dashboard_overview_uses_local_semantic_sources_and_period_boundaries(tmp_path: Path) -> None:
    async def scenario() -> None:
        engine, Session = await _session_factory()
        settings = _settings(tmp_path)
        hourly = settings.backup_root_path() / "hourly"
        hourly.mkdir(parents=True)
        (hourly / "seroguld-backup-20260813-070000.tar.gz").write_bytes(b"backup")
        (settings.backup_restore_drill_path() / "restore-20260812-080000").mkdir(parents=True)

        async with Session() as db:
            admin = User(email="admin@example.test", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            recent_customer = User(
                email="recent@example.test",
                password_hash="x",
                name="Recent",
                role=RoleEnum.CUSTOMER,
                is_active=True,
                created_at=NOW - timedelta(days=1),
            )
            old_customer = User(
                email="old@example.test",
                password_hash="x",
                name="Old",
                role=RoleEnum.CUSTOMER,
                is_active=True,
                created_at=NOW - timedelta(days=100),
            )
            inactive_customer = User(
                email="inactive@example.test",
                password_hash="x",
                name="Inactive",
                role=RoleEnum.CUSTOMER,
                is_active=False,
                created_at=NOW,
            )
            db.add_all([admin, recent_customer, old_customer, inactive_customer])
            await db.flush()

            await _add_purchase(
                db,
                admin_id=admin.id,
                code="DASH0001",
                issued_at=NOW,
                net="80",
                vat="20",
                gross="100",
                sync_status=None,
            )
            await _add_purchase(
                db,
                admin_id=admin.id,
                code="DASH0002",
                issued_at=NOW - timedelta(days=6),
                net="160",
                vat="40",
                gross="200",
                sync_status="failed",
            )
            await _add_purchase(
                db,
                admin_id=admin.id,
                code="DASH0003",
                issued_at=NOW - timedelta(days=7),
                net="240",
                vat="60",
                gross="300",
                sync_status="skipped",
            )
            await _add_purchase(
                db,
                admin_id=admin.id,
                code="DASH0004",
                issued_at=datetime(2025, 9, 1, 0, 0, tzinfo=timezone.utc),
                net="400",
                vat="0",
                gross="400",
                sync_status="synced",
            )
            await _add_purchase(
                db,
                admin_id=admin.id,
                code="DASH0005",
                issued_at=datetime(2025, 8, 31, 0, 0, tzinfo=timezone.utc),
                net="500",
                vat="0",
                gross="500",
                sync_status="historical",
            )

            gold_product = Product(
                product_number="1001",
                product_type=ProductTypeEnum.RING,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("10"),
                purity_percentage=Decimal("50"),
                purchase_date=NOW,
                purchase_price_dkk=Decimal("300"),
                gdpr_release_date=NOW,
                status=ProductStatusEnum.IN_INVENTORY,
            )
            silver_product = Product(
                product_number="1002",
                product_type=ProductTypeEnum.BAR,
                metal_type=MetalTypeEnum.SILVER,
                weight_grams=Decimal("100"),
                purity_percentage=Decimal("80"),
                purchase_date=NOW,
                purchase_price_dkk=Decimal("400"),
                gdpr_release_date=NOW,
                status=ProductStatusEnum.FOR_SALE,
            )
            sold_product = Product(
                product_number="1003",
                product_type=ProductTypeEnum.CHAIN,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("1"),
                purchase_date=NOW,
                purchase_price_dkk=Decimal("999"),
                gdpr_release_date=NOW,
                status=ProductStatusEnum.SOLD,
            )
            db.add_all([gold_product, silver_product, sold_product])
            await db.flush()

            db.add(
                WooCommerceCatalogState(
                    catalog_key="default",
                    revision=7,
                    remote_published_count=2,
                    last_synced_at=NOW - timedelta(minutes=5),
                )
            )
            db.add_all(
                [
                    _catalog_item(1, active=True, linked_product_id=gold_product.id),
                    _catalog_item(2, active=True, review=True, photo=True),
                    _catalog_item(3, active=False, photo=True),
                ]
            )
            await db.commit()

            result = await build_dashboard_overview(db, now=NOW, settings=settings)
            by_period = {item.period: item for item in result.periods}

            assert by_period["7d"].purchaseCount == 2
            assert by_period["7d"].purchaseNetDkk == Decimal("240.00")
            assert by_period["7d"].purchaseVatDkk == Decimal("60.00")
            assert by_period["7d"].purchaseGrossDkk == Decimal("300.00")
            assert by_period["7d"].newActiveCustomerCount == 1
            assert by_period["30d"].purchaseCount == 3
            assert by_period["12m"].purchaseCount == 4
            assert by_period["12m"].startsAt == datetime(2025, 8, 31, 22, 0, tzinfo=timezone.utc)

            assert result.activeCustomerCount == 2
            assert result.inventory.activeItemCount == 2
            assert result.inventory.totalPurchaseValueDkk == Decimal("700.00")
            assert result.inventory.totalPureMetalGrams == Decimal("85.00")
            assert result.inventory.totalFineSilverGrams == Decimal("80.00")
            assert result.inventory.totalGoldRelatedGrams == Decimal("5.00")
            assert result.inventory.totalSpotValueDkk == Decimal("1300.00")

            assert result.wooCatalogTasks.activeCatalogItemCount == 2
            assert result.wooCatalogTasks.inactiveCatalogItemCount == 1
            assert result.wooCatalogTasks.manualReviewCount == 1
            assert result.wooCatalogTasks.photoMissingCount == 1
            assert result.wooCatalogTasks.unlinkedCount == 1
            assert result.wooCatalogTasks.catalogRevision == 7

            assert result.unicontaQueue.pendingCount == 1
            assert result.unicontaQueue.failedCount == 1
            assert result.unicontaQueue.skippedCount == 1
            assert result.unicontaQueue.syncedCount == 1
            assert result.unicontaQueue.historicalCount == 1
            assert result.backupHealth.localBackupRecent is True
            assert result.backupHealth.localBackupAgeMinutes == 60
            assert result.backupHealth.restoreDrillRecent is True

            assert result.financialCoverage.complete is False
            assert result.financialCoverage.companyRevenueDkk is None
            assert result.financialCoverage.companyProfitDkk is None
            assert result.financialCoverage.reason == "local_purchase_costs_only_remote_uniconta_financials_excluded"
            assert result.marketRateConfirmation.recorded is False
        await engine.dispose()

    _run(scenario())


def test_market_rate_confirmation_uses_copenhagen_day_and_detects_changed_rates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Güncel oranlar env yerine ETKİN profilden okunur (canlı overlay dahil);
    # değişim simülasyonu env değeriyle değil profil değeriyle yapılır.
    import app.services.dashboard_overview as dashboard_module

    profile_initial = {
        "gold_24k_dkk": "615.50",
        "silver_dkk": "7.80",
        "platinum_dkk": "280.00",
        "palladium_dkk": "335.00",
    }
    profile_next = {**profile_initial, "gold_24k_dkk": "101.00"}
    active_profile = {"value": profile_initial}
    monkeypatch.setattr(
        dashboard_module,
        "get_effective_market_rate_profile_cached",
        lambda: active_profile["value"],
    )

    async def scenario() -> None:
        engine, Session = await _session_factory()
        settings = _settings(tmp_path)
        before_midnight = datetime(2026, 1, 1, 22, 59, tzinfo=timezone.utc)
        after_midnight = datetime(2026, 1, 1, 23, 1, tzinfo=timezone.utc)
        assert copenhagen_business_date(before_midnight).isoformat() == "2026-01-01"
        assert copenhagen_business_date(after_midnight).isoformat() == "2026-01-02"

        async with Session() as db:
            admin = User(email="admin@example.test", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            db.add(admin)
            await db.flush()

            empty = await build_market_rate_confirmation_state(
                db, now=before_midnight, settings=settings
            )
            assert empty.recorded is False
            assert empty.confirmed is False

            unchanged = await record_market_rate_confirmation(
                db,
                confirmed_by_user_id=admin.id,
                mode="unchanged",
                now=before_midnight,
                settings=settings,
            )
            assert unchanged.businessDate.isoformat() == "2026-01-01"
            assert unchanged.recorded is True
            assert unchanged.confirmed is True
            assert unchanged.matchesCurrentRates is True
            assert unchanged.confirmationMode == "unchanged"

            active_profile["value"] = profile_next
            changed = await build_market_rate_confirmation_state(
                db, now=before_midnight, settings=settings
            )
            assert changed.recorded is True
            assert changed.confirmed is False
            assert changed.matchesCurrentRates is False

            saved = await record_market_rate_confirmation(
                db,
                confirmed_by_user_id=admin.id,
                mode="saved",
                now=before_midnight + timedelta(seconds=30),
                settings=settings,
            )
            assert saved.confirmed is True
            assert saved.confirmationMode == "saved"
            assert saved.confirmedRates.goldDkk == Decimal("101.00")
            assert int(await db.scalar(select(func.count(MarketRateConfirmation.id))) or 0) == 1

            next_day = await record_market_rate_confirmation(
                db,
                confirmed_by_user_id=admin.id,
                mode="unchanged",
                now=after_midnight,
                settings=settings,
            )
            assert next_day.businessDate.isoformat() == "2026-01-02"
            assert int(await db.scalar(select(func.count(MarketRateConfirmation.id))) or 0) == 2
            await db.commit()
        await engine.dispose()

    _run(scenario())


def test_current_market_rates_read_effective_profile_with_overlay() -> None:
    """Dashboard güncel oranları etkin profilden alır: canlı Pt/Pd overlay'i
    ve WP'den çekilen değerler env'e yazılmasa da yansır."""
    from app.services.dashboard_overview import _current_market_rates

    rates = _current_market_rates(
        {
            "gold_24k_dkk": "867.00",
            "silver_dkk": "12.80",
            "platinum_dkk": "355.91",  # Stooq overlay değer gibi
            "palladium_dkk": "266.31",
        }
    )
    assert rates.goldDkk == Decimal("867.00")
    assert rates.silverDkk == Decimal("12.80")
    assert rates.platinumDkk == Decimal("355.91")
    assert rates.palladiumDkk == Decimal("266.31")


def test_market_rate_confirmation_get_post_endpoints_commit_the_daily_record(
    tmp_path: Path,
    monkeypatch,
) -> None:
    async def scenario() -> None:
        engine, Session = await _session_factory()
        settings = _settings(tmp_path)
        monkeypatch.setattr(
            "app.services.dashboard_overview.get_settings",
            lambda: settings,
        )
        async with Session() as db:
            admin = User(email="admin@example.test", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            db.add(admin)
            await db.commit()

            before = await get_market_rate_confirmation(db=db, _=admin)
            assert before.recorded is False

            posted = await post_market_rate_confirmation(
                payload=DashboardMarketRateConfirmationIn(mode="unchanged"),
                db=db,
                admin=admin,
            )
            assert posted.recorded is True
            assert posted.confirmed is True

            after = await get_market_rate_confirmation(db=db, _=admin)
            assert after.businessDate == posted.businessDate
            assert after.confirmationMode == "unchanged"
            assert int(await db.scalar(select(func.count(MarketRateConfirmation.id))) or 0) == 1
        await engine.dispose()

    _run(scenario())
