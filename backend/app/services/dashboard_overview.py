from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.models.enums import MetalTypeEnum, PosDocumentTypeEnum, RoleEnum
from app.models.market_rate_confirmation import MarketRateConfirmation
from app.models.pos_document import PosDocument
from app.models.product import Product
from app.models.user import User
from app.models.woocommerce_catalog import WooCommerceCatalogItem, WooCommerceCatalogState
from app.schemas.dashboard_overview import (
    DashboardBackupHealthOut,
    DashboardFinancialCoverageOut,
    DashboardInventorySnapshotOut,
    DashboardMarketRateConfirmationOut,
    DashboardMarketRatesOut,
    DashboardOverviewOut,
    DashboardPurchasePeriodOut,
    DashboardUnicontaQueueOut,
    DashboardWooCatalogTasksOut,
    MarketRateConfirmationMode,
)
from app.services.dashboard_helpers import (
    age_hours,
    age_minutes,
    find_last_offsite_sync,
    find_latest_hourly_backup,
    find_latest_restore_drill,
)
from app.services.product_service import ACTIVE_STATUSES, visible_product_clause
from app.utils.helpers import to_decimal, utc_now


DASHBOARD_TIMEZONE_NAME = "Europe/Copenhagen"
DASHBOARD_TIMEZONE = ZoneInfo(DASHBOARD_TIMEZONE_NAME)
MONEY_QUANTUM = Decimal("0.01")


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _money(value: Decimal | str | float | int | None) -> Decimal:
    return to_decimal(value).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def copenhagen_business_date(now: datetime | None = None) -> date:
    return _to_utc(now or utc_now()).astimezone(DASHBOARD_TIMEZONE).date()


def _month_start_months_ago(value: date, months: int) -> date:
    month_index = value.year * 12 + (value.month - 1) - months
    year, zero_based_month = divmod(month_index, 12)
    return date(year, zero_based_month + 1, 1)


def _period_bounds(now: datetime) -> list[tuple[str, datetime, datetime]]:
    business_date = copenhagen_business_date(now)
    end_local = datetime.combine(business_date + timedelta(days=1), time.min, tzinfo=DASHBOARD_TIMEZONE)
    starts = (
        ("7d", business_date - timedelta(days=6)),
        ("30d", business_date - timedelta(days=29)),
        ("90d", business_date - timedelta(days=89)),
        # Twelve calendar months, including the current partial month.
        ("12m", _month_start_months_ago(business_date, 11)),
    )
    return [
        (
            key,
            datetime.combine(start_date, time.min, tzinfo=DASHBOARD_TIMEZONE).astimezone(timezone.utc),
            end_local.astimezone(timezone.utc),
        )
        for key, start_date in starts
    ]


def _current_market_rates(settings: Settings) -> DashboardMarketRatesOut:
    return DashboardMarketRatesOut(
        goldDkk=_money(settings.inventory_market_gold_dkk),
        silverDkk=_money(settings.inventory_market_silver_dkk),
        platinumDkk=_money(settings.inventory_market_platinum_dkk),
        palladiumDkk=_money(settings.inventory_market_palladium_dkk),
    )


def _confirmation_rates(row: MarketRateConfirmation) -> DashboardMarketRatesOut:
    return DashboardMarketRatesOut(
        goldDkk=_money(row.gold_dkk),
        silverDkk=_money(row.silver_dkk),
        platinumDkk=_money(row.platinum_dkk),
        palladiumDkk=_money(row.palladium_dkk),
    )


async def build_market_rate_confirmation_state(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    settings: Settings | None = None,
) -> DashboardMarketRateConfirmationOut:
    effective_now = _to_utc(now or utc_now())
    effective_settings = settings or get_settings()
    business_date = copenhagen_business_date(effective_now)
    row = await db.scalar(
        select(MarketRateConfirmation).where(MarketRateConfirmation.business_date == business_date)
    )
    current_rates = _current_market_rates(effective_settings)
    if row is None:
        return DashboardMarketRateConfirmationOut(
            businessDate=business_date,
            recorded=False,
            confirmed=False,
            currentRates=current_rates,
        )

    confirmed_rates = _confirmation_rates(row)
    matches = confirmed_rates == current_rates
    return DashboardMarketRateConfirmationOut(
        businessDate=business_date,
        recorded=True,
        confirmed=matches,
        confirmationMode=row.confirmation_mode,
        confirmedAt=_to_utc(row.confirmed_at),
        confirmedByUserId=str(row.confirmed_by_user_id) if row.confirmed_by_user_id else None,
        confirmedRates=confirmed_rates,
        currentRates=current_rates,
        matchesCurrentRates=matches,
    )


async def record_market_rate_confirmation(
    db: AsyncSession,
    *,
    confirmed_by_user_id,
    mode: MarketRateConfirmationMode,
    now: datetime | None = None,
    settings: Settings | None = None,
) -> DashboardMarketRateConfirmationOut:
    effective_now = _to_utc(now or utc_now())
    effective_settings = settings or get_settings()
    business_date = copenhagen_business_date(effective_now)
    rates = _current_market_rates(effective_settings)
    row = await db.scalar(
        select(MarketRateConfirmation)
        .where(MarketRateConfirmation.business_date == business_date)
        .with_for_update()
    )
    if row is None:
        row = MarketRateConfirmation(
            business_date=business_date,
            confirmation_mode=mode,
            gold_dkk=rates.goldDkk,
            silver_dkk=rates.silverDkk,
            platinum_dkk=rates.platinumDkk,
            palladium_dkk=rates.palladiumDkk,
            confirmed_by_user_id=confirmed_by_user_id,
            confirmed_at=effective_now,
        )
        db.add(row)
    else:
        row.confirmation_mode = mode
        row.gold_dkk = rates.goldDkk
        row.silver_dkk = rates.silverDkk
        row.platinum_dkk = rates.platinumDkk
        row.palladium_dkk = rates.palladiumDkk
        row.confirmed_by_user_id = confirmed_by_user_id
        row.confirmed_at = effective_now
    await db.flush()
    return await build_market_rate_confirmation_state(
        db,
        now=effective_now,
        settings=effective_settings,
    )


def _product_pure_metal_grams(product: Product) -> Decimal:
    if product.pure_gold_grams is not None:
        return to_decimal(product.pure_gold_grams)
    total_weight = (
        to_decimal(product.total_weight_grams)
        if product.total_weight_grams is not None
        else to_decimal(product.weight_grams) * Decimal(int(product.unit_count or 1))
    )
    if product.purity_percentage is None:
        return Decimal("0")
    return total_weight * (to_decimal(product.purity_percentage) / Decimal("100"))


def _inventory_snapshot(
    products: Iterable[Product],
    *,
    settings: Settings,
) -> DashboardInventorySnapshotOut:
    rows = list(products)
    purchase_value = Decimal("0")
    spot_value = Decimal("0")
    pure_total = Decimal("0")
    fine_silver = Decimal("0")
    gold_related = Decimal("0")
    rates = {
        MetalTypeEnum.SILVER: to_decimal(settings.inventory_market_silver_dkk),
        MetalTypeEnum.PLATINUM: to_decimal(settings.inventory_market_platinum_dkk),
        MetalTypeEnum.PALLADIUM: to_decimal(settings.inventory_market_palladium_dkk),
    }
    gold_rate = to_decimal(settings.inventory_market_gold_dkk)
    for product in rows:
        purchase_value += to_decimal(product.purchase_price_dkk)
        pure = _product_pure_metal_grams(product)
        pure_total += pure
        spot_value += pure * rates.get(product.metal_type, gold_rate)
        if product.metal_type == MetalTypeEnum.SILVER:
            fine_silver += pure
        else:
            gold_related += pure
    return DashboardInventorySnapshotOut(
        activeItemCount=len(rows),
        totalPurchaseValueDkk=_money(purchase_value),
        totalSpotValueDkk=_money(spot_value),
        totalPureMetalGrams=_money(pure_total),
        totalFineSilverGrams=_money(fine_silver),
        totalGoldRelatedGrams=_money(gold_related),
    )


def _backup_health(settings: Settings, *, now: datetime) -> DashboardBackupHealthOut:
    latest_backup = find_latest_hourly_backup(settings.backup_root_path())
    backup_age = age_minutes(now, latest_backup)
    desktop_config_path = settings.backup_root_path().parent.parent / "config" / "backup-settings.v1.json"
    desktop_offsite_enabled = False
    desktop_offsite_latest: datetime | None = None
    try:
        import json
        from pathlib import Path

        configured = json.loads(desktop_config_path.read_text(encoding="utf-8")).get("destinationDir")
        if configured:
            destination = Path(str(configured))
            desktop_offsite_enabled = True
            candidates = list(destination.glob("*.sgbackup")) if destination.is_dir() else []
            if candidates:
                newest = max(candidates, key=lambda path: path.stat().st_mtime)
                desktop_offsite_latest = datetime.fromtimestamp(newest.stat().st_mtime, tz=timezone.utc)
    except (OSError, ValueError, TypeError):
        pass
    offsite_enabled = bool(settings.backup_offsite_enabled or desktop_offsite_enabled)
    last_offsite = desktop_offsite_latest or find_last_offsite_sync(settings.backup_offsite_status_path())
    offsite_age = age_minutes(now, last_offsite)
    last_restore_drill = find_latest_restore_drill(settings.backup_restore_drill_path())
    restore_age = age_hours(now, last_restore_drill)
    return DashboardBackupHealthOut(
        latestLocalBackupAt=latest_backup,
        localBackupAgeMinutes=backup_age,
        localBackupRecent=bool(
            backup_age is not None and backup_age <= settings.backup_health_max_age_minutes
        ),
        offsiteEnabled=offsite_enabled,
        lastOffsiteSyncAt=last_offsite,
        offsiteAgeMinutes=offsite_age,
        offsiteRecent=(
            None
            if not offsite_enabled
            else bool(
                offsite_age is not None
                and offsite_age <= settings.backup_offsite_max_age_minutes
            )
        ),
        lastRestoreDrillAt=last_restore_drill,
        restoreDrillAgeHours=restore_age,
        restoreDrillRecent=bool(
            restore_age is not None
            and restore_age <= settings.backup_restore_drill_max_age_hours
        ),
    )


async def build_dashboard_overview(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    settings: Settings | None = None,
) -> DashboardOverviewOut:
    effective_now = _to_utc(now or utc_now())
    effective_settings = settings or get_settings()
    bounds = _period_bounds(effective_now)
    purchase_rows = (
        await db.execute(
            select(
                PosDocument.issued_at,
                PosDocument.net_amount_dkk,
                PosDocument.vat_amount_dkk,
                PosDocument.gross_amount_dkk,
                PosDocument.uniconta_sync_status,
                PosDocument.uniconta_synced_at,
                PosDocument.created_at,
            )
            .where(PosDocument.document_type == PosDocumentTypeEnum.PURCHASE_RECEIPT)
        )
    ).all()
    active_customer_dates = list(
        await db.scalars(
            select(User.created_at).where(
                User.role == RoleEnum.CUSTOMER,
                User.is_active.is_(True),
            )
        )
    )
    active_customer_count = len(active_customer_dates)

    periods: list[DashboardPurchasePeriodOut] = []
    for key, start, end in bounds:
        period_rows = [
            row
            for row in purchase_rows
            if row.issued_at is not None and start <= _to_utc(row.issued_at) < end
        ]
        periods.append(
            DashboardPurchasePeriodOut(
                period=key,
                startsAt=start,
                endsAtExclusive=end,
                purchaseCount=len(period_rows),
                purchaseNetDkk=_money(sum((to_decimal(row.net_amount_dkk) for row in period_rows), Decimal("0"))),
                purchaseVatDkk=_money(sum((to_decimal(row.vat_amount_dkk) for row in period_rows), Decimal("0"))),
                purchaseGrossDkk=_money(sum((to_decimal(row.gross_amount_dkk) for row in period_rows), Decimal("0"))),
                newActiveCustomerCount=sum(
                    1 for created_at in active_customer_dates if start <= _to_utc(created_at) < end
                ),
            )
        )

    products = list(
        await db.scalars(
            select(Product).where(
                Product.status.in_(tuple(ACTIVE_STATUSES)),
                visible_product_clause(),
            )
        )
    )

    catalog_items = list(await db.scalars(select(WooCommerceCatalogItem)))
    catalog_state = await db.get(WooCommerceCatalogState, "default")
    active_catalog_items = [item for item in catalog_items if item.is_active]
    woo_tasks = DashboardWooCatalogTasksOut(
        activeCatalogItemCount=len(active_catalog_items),
        inactiveCatalogItemCount=len(catalog_items) - len(active_catalog_items),
        manualReviewCount=sum(1 for item in active_catalog_items if item.manual_review_required),
        photoMissingCount=sum(1 for item in active_catalog_items if item.photo_missing),
        unlinkedCount=sum(1 for item in active_catalog_items if item.linked_product_id is None),
        catalogRevision=int(catalog_state.revision if catalog_state else 0),
        remotePublishedCount=int(catalog_state.remote_published_count if catalog_state else 0),
        lastSyncedAt=catalog_state.last_synced_at if catalog_state else None,
    )

    uniconta_counts = {"pending": 0, "failed": 0, "skipped": 0, "synced": 0, "historical": 0}
    last_synced_at: datetime | None = None
    latest_failed_document_created_at: datetime | None = None
    for row in purchase_rows:
        status = (row.uniconta_sync_status or "pending").strip().lower()
        normalized_status = status if status in uniconta_counts else "pending"
        uniconta_counts[normalized_status] += 1
        if normalized_status == "synced" and row.uniconta_synced_at is not None:
            candidate = _to_utc(row.uniconta_synced_at)
            if last_synced_at is None or candidate > last_synced_at:
                last_synced_at = candidate
        if normalized_status == "failed" and row.created_at is not None:
            candidate = _to_utc(row.created_at)
            if (
                latest_failed_document_created_at is None
                or candidate > latest_failed_document_created_at
            ):
                latest_failed_document_created_at = candidate

    return DashboardOverviewOut(
        generatedAt=effective_now,
        periods=periods,
        activeCustomerCount=active_customer_count,
        inventory=_inventory_snapshot(products, settings=effective_settings),
        wooCatalogTasks=woo_tasks,
        unicontaQueue=DashboardUnicontaQueueOut(
            pendingCount=uniconta_counts["pending"],
            failedCount=uniconta_counts["failed"],
            skippedCount=uniconta_counts["skipped"],
            syncedCount=uniconta_counts["synced"],
            historicalCount=uniconta_counts["historical"],
            lastSyncedAt=last_synced_at,
            latestFailedDocumentCreatedAt=latest_failed_document_created_at,
        ),
        backupHealth=_backup_health(effective_settings, now=effective_now),
        marketRateConfirmation=await build_market_rate_confirmation_state(
            db,
            now=effective_now,
            settings=effective_settings,
        ),
        financialCoverage=DashboardFinancialCoverageOut(
            reason="local_purchase_costs_only_remote_uniconta_financials_excluded"
        ),
    )
