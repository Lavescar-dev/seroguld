from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.config import get_settings
from app.database import get_db
from app.models.ai_usage_log import AIUsageLog
from app.models.enums import ProductStatusEnum
from app.models.product import Product
from app.models.woocommerce_log import WooCommerceSyncLog
from app.schemas.dashboard import (
    DashboardChartsOut,
    CalendarItem,
    DashboardAICostOut,
    DashboardCalendarOut,
    DashboardMetalDistributionItemOut,
    DashboardOpsOut,
    DashboardIntegrationsOut,
    DashboardMonthlyProfitPointOut,
    DashboardProfitOut,
    DashboardStatusDistributionItemOut,
    DashboardStockFlowPointOut,
    DashboardSummaryOut,
    StockValueOut,
)
from app.services.dashboard_helpers import (
    METAL_LABELS,
    STATUS_LABELS,
    age_hours as _age_hours,
    age_minutes as _age_minutes,
    find_last_offsite_sync as _find_last_offsite_sync,
    find_latest_hourly_backup as _find_latest_hourly_backup,
    find_latest_restore_drill as _find_latest_restore_drill,
    has_any_photo as _has_any_photo,
    money as _money,
    quantize_cost as _quantize_cost,
    to_utc as _to_utc,
)
from app.services.product_service import visible_product_clause
from app.utils.helpers import to_decimal, utc_now

router = APIRouter()


@router.get("/summary", response_model=DashboardSummaryOut)
async def summary(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> DashboardSummaryOut:
    now = utc_now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    data = await db.execute(
        select(
            func.count(Product.id),
            func.sum(case((Product.is_gdpr_locked.is_(True), 1), else_=0)),
            func.sum(case((Product.is_gdpr_locked.is_(False), 1), else_=0)),
            func.sum(case((Product.status == ProductStatusEnum.FOR_SALE, 1), else_=0)),
            func.sum(
                case(
                    (and_(Product.status == ProductStatusEnum.SOLD, Product.sale_date >= month_start), 1),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (and_(Product.status == ProductStatusEnum.MELTED, Product.melt_date >= month_start), 1),
                    else_=0,
                )
            ),
        )
        .where(visible_product_clause())
    )

    total, locked, free, for_sale, sold_this_month, melted_this_month = data.one()

    return DashboardSummaryOut(
        total_products=int(total or 0),
        locked_products=int(locked or 0),
        free_products=int(free or 0),
        for_sale_products=int(for_sale or 0),
        sold_this_month=int(sold_this_month or 0),
        melted_this_month=int(melted_this_month or 0),
    )


@router.get("/stock-value", response_model=StockValueOut)
async def stock_value(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> StockValueOut:
    now = utc_now()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    active_statuses = [
        ProductStatusEnum.PURCHASED,
        ProductStatusEnum.IN_INVENTORY,
        ProductStatusEnum.FOR_SALE,
        ProductStatusEnum.UNDECIDED,
    ]

    current_total = await db.scalar(
        select(func.coalesce(func.sum(Product.purchase_price_dkk), Decimal("0"))).where(Product.status.in_(active_statuses), visible_product_clause())
    )

    today_purchases = await db.scalar(
        select(func.coalesce(func.sum(Product.purchase_price_dkk), Decimal("0"))).where(Product.purchase_date >= day_start, visible_product_clause())
    )
    today_sales = await db.scalar(
        select(func.coalesce(func.sum(Product.sale_price_dkk), Decimal("0"))).where(Product.sale_date >= day_start, visible_product_clause())
    )

    change = (today_sales or Decimal("0")) - (today_purchases or Decimal("0"))

    return StockValueOut(
        total_stock_value_dkk=str(current_total or Decimal("0")),
        today_change_dkk=str(change),
    )


@router.get("/calendar", response_model=DashboardCalendarOut)
async def calendar(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> DashboardCalendarOut:
    now = _to_utc(utc_now())
    future = now + timedelta(days=14)

    rows = await db.scalars(
        select(Product)
        .where(Product.status == ProductStatusEnum.PURCHASED, visible_product_clause())
        .order_by(Product.gdpr_release_date.asc())
        .limit(500)
    )

    items = []
    for product in rows.all():
        release_date = _to_utc(product.gdpr_release_date)
        if release_date < now or release_date > future:
            continue

        delta = release_date - now
        days_remaining = max(0, delta.days)
        items.append(
            CalendarItem(
                product_id=str(product.id),
                product_number=product.product_number,
                product_type=product.product_type.value,
                metal_type=product.metal_type.value,
                gdpr_release_date=release_date,
                days_remaining=days_remaining,
            )
        )

    return DashboardCalendarOut(items=items)


@router.get("/profit", response_model=DashboardProfitOut)
async def profit(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> DashboardProfitOut:
    now = utc_now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    monthly_profit = await db.scalar(
        select(func.coalesce(func.sum(Product.profit_dkk), Decimal("0"))).where(
            Product.status == ProductStatusEnum.SOLD,
            Product.sale_date >= month_start,
            visible_product_clause(),
        )
    )

    top_category_row = await db.execute(
        select(
            Product.product_type,
            func.coalesce(func.sum(Product.profit_dkk), Decimal("0")).label("profit"),
        )
        .where(Product.status == ProductStatusEnum.SOLD, Product.sale_date >= month_start)
        .where(visible_product_clause())
        .group_by(Product.product_type)
        .order_by(func.sum(Product.profit_dkk).desc())
        .limit(1)
    )
    category_data = top_category_row.first()

    total_count = await db.scalar(select(func.count(Product.id)).where(visible_product_clause()))
    melted_count = await db.scalar(select(func.count(Product.id)).where(Product.status == ProductStatusEnum.MELTED, visible_product_clause()))

    ratio = Decimal("0")
    if total_count:
        ratio = (Decimal(melted_count or 0) / Decimal(total_count)) * Decimal("100")

    return DashboardProfitOut(
        monthly_profit_dkk=str(monthly_profit or Decimal("0")),
        top_category=(category_data[0].value if category_data else None),
        top_category_profit_dkk=str(category_data[1] if category_data else Decimal("0")),
        melted_ratio_percent=str(ratio.quantize(Decimal("0.01"))),
    )


@router.get("/ai-cost", response_model=DashboardAICostOut)
async def ai_cost(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> DashboardAICostOut:
    now = utc_now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    totals_row = await db.execute(
        select(
            func.count(AIUsageLog.id),
            func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.total_cost_usd), Decimal("0")),
            func.max(AIUsageLog.created_at),
        )
    )
    total_requests, prompt_tokens, completion_tokens, total_tokens, total_cost, last_call_at = totals_row.one()

    this_month_cost = await db.scalar(
        select(func.coalesce(func.sum(AIUsageLog.total_cost_usd), Decimal("0"))).where(AIUsageLog.created_at >= month_start)
    )

    avg_cost = Decimal("0")
    if int(total_requests or 0) > 0:
        avg_cost = to_decimal(total_cost) / Decimal(int(total_requests))

    return DashboardAICostOut(
        total_requests=int(total_requests or 0),
        total_prompt_tokens=int(prompt_tokens or 0),
        total_completion_tokens=int(completion_tokens or 0),
        total_tokens=int(total_tokens or 0),
        total_cost_usd=_quantize_cost(total_cost),
        average_cost_per_request_usd=_quantize_cost(avg_cost),
        this_month_cost_usd=_quantize_cost(this_month_cost),
        last_call_at=last_call_at,
    )


@router.get("/ops", response_model=DashboardOpsOut)
async def operations(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> DashboardOpsOut:
    """Ops sayaçları iki aşamada hesaplanır.

    Önceki sürüm tüm görünür ürünleri 9 kolonla (photos JSON ve ai_description
    serbest metni dahil) belleğe alıp Python döngüsünde sayıyordu; pano 60 sn
    poll ile aynı process'i paylaştığından büyük envanterde tüm istekler
    gecikiyordu. Artık durum-bazlı sayaçlar tek agregasyon sorgusunda SQL'e
    iner; yalnız aktif ürünlerin (status, photos, tarihler) kolonları okunur.
    """
    now = _to_utc(utc_now())
    active_statuses = {
        ProductStatusEnum.PURCHASED,
        ProductStatusEnum.IN_INVENTORY,
        ProductStatusEnum.FOR_SALE,
        ProductStatusEnum.UNDECIDED,
    }
    visible = visible_product_clause()
    for_sale = Product.status == ProductStatusEnum.FOR_SALE
    has_ai_description = func.length(func.trim(func.coalesce(Product.ai_description, ""))) > 0

    aggregate = await db.execute(
        select(
            func.sum(case((Product.status.in_(active_statuses), 1), else_=0)),
            func.sum(
                case(
                    (and_(Product.status.in_(active_statuses), Product.needs_cleaning.is_(True)), 1),
                    else_=0,
                )
            ),
            func.sum(case((and_(for_sale, ~has_ai_description), 1), else_=0)),
            func.sum(case((and_(for_sale, has_ai_description, Product.ai_description_approved.is_not(True)), 1), else_=0)),
            func.sum(
                case(
                    (
                        and_(
                            for_sale,
                            Product.ai_description_approved.is_(True),
                            Product.is_published_to_site.is_not(True),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (
                        and_(
                            Product.status.in_([ProductStatusEnum.IN_INVENTORY, ProductStatusEnum.FOR_SALE]),
                            Product.is_gdpr_locked.is_not(True),
                        ),
                        1,
                    ),
                    else_=0,
                )
            ),
        ).where(visible)
    )
    (
        active_products,
        needs_cleaning_queue,
        pending_ai_description,
        pending_ai_approval,
        pending_publish,
        ready_for_sale,
    ) = (int(value or 0) for value in aggregate.one())

    # Fotoğraf JSON'u ancak aktif ürünlerde anlam taşıyor: yalnız o satırlar
    # okunur (kapak: foto kapsama, satışta fotosuz, bayat GDPR kilidi, yaş).
    lean_rows = (
        await db.execute(
            select(
                Product.status,
                Product.photos,
                Product.is_gdpr_locked,
                Product.gdpr_release_date,
                Product.purchase_date,
            ).where(Product.status.in_(active_statuses), visible)
        )
    ).all()

    products_with_photo = 0
    for_sale_without_photo = 0
    stale_gdpr_lock = 0
    total_active_age_days = Decimal("0")
    for status, photos, is_gdpr_locked, gdpr_release_date, purchase_date in lean_rows:
        has_photo = _has_any_photo(photos)
        if has_photo:
            products_with_photo += 1
        if status == ProductStatusEnum.FOR_SALE and not has_photo:
            for_sale_without_photo += 1
        if (
            status == ProductStatusEnum.PURCHASED
            and bool(is_gdpr_locked)
            and gdpr_release_date is not None
            and _to_utc(gdpr_release_date) <= now
        ):
            stale_gdpr_lock += 1
        if purchase_date is not None:
            age_days = max(0, (_to_utc(now) - _to_utc(purchase_date)).days)
            total_active_age_days += Decimal(age_days)

    products_without_photo = max(0, active_products - products_with_photo)
    photo_coverage_percent = Decimal("0")
    avg_active_age_days = Decimal("0")
    if active_products > 0:
        photo_coverage_percent = (Decimal(products_with_photo) / Decimal(active_products)) * Decimal("100")
        avg_active_age_days = total_active_age_days / Decimal(active_products)

    urgent_action_count = (
        for_sale_without_photo + pending_ai_description + pending_ai_approval + pending_publish + stale_gdpr_lock
    )

    return DashboardOpsOut(
        active_products=active_products,
        products_with_photo=products_with_photo,
        products_without_photo=products_without_photo,
        photo_coverage_percent=format(photo_coverage_percent.quantize(Decimal("0.01")), "f"),
        for_sale_without_photo=for_sale_without_photo,
        needs_cleaning_queue=needs_cleaning_queue,
        pending_ai_description=pending_ai_description,
        pending_ai_approval=pending_ai_approval,
        pending_publish=pending_publish,
        stale_gdpr_lock=stale_gdpr_lock,
        ready_for_sale=ready_for_sale,
        avg_active_age_days=format(avg_active_age_days.quantize(Decimal("0.01")), "f"),
        urgent_action_count=urgent_action_count,
    )


@router.get("/charts", response_model=DashboardChartsOut)
async def charts(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> DashboardChartsOut:
    today = utc_now().date()
    days = [today - timedelta(days=idx) for idx in range(29, -1, -1)]
    start_dt = datetime.combine(days[0], datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

    purchases_by_day: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    removals_by_day: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))

    purchase_rows = await db.execute(
        select(Product.purchase_date, Product.purchase_price_dkk).where(
            Product.purchase_date >= start_dt,
            Product.purchase_date < end_dt,
            visible_product_clause(),
        )
    )
    for purchase_date, purchase_value in purchase_rows.all():
        if purchase_date is None:
            continue
        key = _to_utc(purchase_date).date()
        purchases_by_day[key] += to_decimal(purchase_value)

    sold_rows = await db.execute(
        select(Product.sale_date, Product.purchase_price_dkk).where(
            Product.status == ProductStatusEnum.SOLD,
            Product.sale_date >= start_dt,
            Product.sale_date < end_dt,
            visible_product_clause(),
        )
    )
    for sale_date, purchase_value in sold_rows.all():
        if sale_date is None:
            continue
        key = _to_utc(sale_date).date()
        removals_by_day[key] += to_decimal(purchase_value)

    melted_rows = await db.execute(
        select(Product.melt_date, Product.purchase_price_dkk).where(
            Product.status == ProductStatusEnum.MELTED,
            Product.melt_date >= start_dt,
            Product.melt_date < end_dt,
            visible_product_clause(),
        )
    )
    for melt_date, purchase_value in melted_rows.all():
        if melt_date is None:
            continue
        key = _to_utc(melt_date).date()
        removals_by_day[key] += to_decimal(purchase_value)

    active_statuses = [
        ProductStatusEnum.PURCHASED,
        ProductStatusEnum.IN_INVENTORY,
        ProductStatusEnum.FOR_SALE,
        ProductStatusEnum.UNDECIDED,
    ]
    current_stock_value = to_decimal(
        await db.scalar(
            select(func.coalesce(func.sum(Product.purchase_price_dkk), Decimal("0"))).where(Product.status.in_(active_statuses), visible_product_clause())
        )
    )

    stock_value_by_day: dict[date, Decimal] = {today: current_stock_value}
    running = current_stock_value
    for day in reversed(days[:-1]):
        next_day = day + timedelta(days=1)
        running = running - purchases_by_day[next_day] + removals_by_day[next_day]
        stock_value_by_day[day] = running

    stock_flow_30d = [
        DashboardStockFlowPointOut(
            day=day.isoformat(),
            stock_value_dkk=_money(stock_value_by_day[day]),
            purchases_dkk=_money(purchases_by_day[day]),
            removals_dkk=_money(removals_by_day[day]),
            net_change_dkk=_money(purchases_by_day[day] - removals_by_day[day]),
        )
        for day in days
    ]

    status_rows = await db.execute(select(Product.status, func.count(Product.id)).where(visible_product_clause()).group_by(Product.status))
    status_distribution = [
        DashboardStatusDistributionItemOut(
            key=item_status.value,
            label=STATUS_LABELS.get(item_status, item_status.value),
            count=int(item_count or 0),
        )
        for item_status, item_count in status_rows.all()
    ]
    status_distribution.sort(key=lambda x: x.count, reverse=True)

    metal_rows = await db.execute(
        select(Product.metal_type, func.count(Product.id))
        .where(Product.status.in_(active_statuses), visible_product_clause())
        .group_by(Product.metal_type)
    )
    active_metal_distribution = [
        DashboardMetalDistributionItemOut(
            key=item_metal.value,
            label=METAL_LABELS.get(item_metal.value, item_metal.value),
            count=int(item_count or 0),
        )
        for item_metal, item_count in metal_rows.all()
    ]
    active_metal_distribution.sort(key=lambda x: x.count, reverse=True)

    month_start = today.replace(day=1)
    start_month = (month_start - timedelta(days=365)).replace(day=1)
    monthly_sales_rows = await db.execute(
        select(Product.sale_date, Product.profit_dkk).where(
            Product.status == ProductStatusEnum.SOLD,
            Product.sale_date >= datetime.combine(start_month, datetime.min.time(), tzinfo=timezone.utc),
            visible_product_clause(),
        )
    )

    monthly_profit_map: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    monthly_sold_count_map: dict[str, int] = defaultdict(int)
    for sale_date, profit_value in monthly_sales_rows.all():
        if sale_date is None:
            continue
        month_key = _to_utc(sale_date).strftime("%Y-%m")
        monthly_profit_map[month_key] += to_decimal(profit_value)
        monthly_sold_count_map[month_key] += 1

    monthly_profit_12m: list[DashboardMonthlyProfitPointOut] = []
    cursor_month = month_start
    month_keys: list[str] = []
    for _ in range(12):
        month_keys.append(cursor_month.strftime("%Y-%m"))
        cursor_month = (cursor_month.replace(day=1) - timedelta(days=1)).replace(day=1)
    month_keys.reverse()

    for month_key in month_keys:
        monthly_profit_12m.append(
            DashboardMonthlyProfitPointOut(
                month=month_key,
                profit_dkk=_money(monthly_profit_map[month_key]),
                sold_count=monthly_sold_count_map[month_key],
            )
        )

    return DashboardChartsOut(
        stock_flow_30d=stock_flow_30d,
        status_distribution=status_distribution,
        active_metal_distribution=active_metal_distribution,
        monthly_profit_12m=monthly_profit_12m,
    )


@router.get("/integrations", response_model=DashboardIntegrationsOut)
async def integrations(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> DashboardIntegrationsOut:
    settings = get_settings()
    now = _to_utc(utc_now())
    since = now - timedelta(hours=24)

    total_published = await db.scalar(select(func.count(Product.id)).where(Product.is_published_to_site.is_(True), visible_product_clause()))
    sync_success_24h = await db.scalar(
        select(func.count(WooCommerceSyncLog.id)).where(
            WooCommerceSyncLog.created_at >= since,
            WooCommerceSyncLog.status == "success",
        )
    )
    sync_failed_24h = await db.scalar(
        select(func.count(WooCommerceSyncLog.id)).where(
            WooCommerceSyncLog.created_at >= since,
            WooCommerceSyncLog.status == "failed",
        )
    )
    last_sync_at = await db.scalar(select(func.max(WooCommerceSyncLog.created_at)))

    # Yedek taramaları senkron disk IO (glob/stat/read): event loop'u
    # bloklamamak için iş parçacığına alınır.
    backup_latest_at = await asyncio.to_thread(_find_latest_hourly_backup, settings.backup_root_path())
    backup_age_minutes = _age_minutes(now, backup_latest_at)
    backup_recent_ok = bool(
        backup_latest_at is not None
        and backup_age_minutes is not None
        and backup_age_minutes <= settings.backup_health_max_age_minutes
    )

    offsite_enabled = settings.backup_offsite_enabled
    offsite_last_sync_at = await asyncio.to_thread(_find_last_offsite_sync, settings.backup_offsite_status_path())
    offsite_age_minutes = _age_minutes(now, offsite_last_sync_at)
    offsite_recent_ok: bool | None = None
    if offsite_enabled:
        offsite_recent_ok = bool(
            offsite_last_sync_at is not None
            and offsite_age_minutes is not None
            and offsite_age_minutes <= settings.backup_offsite_max_age_minutes
        )

    restore_drill_last_at = await asyncio.to_thread(_find_latest_restore_drill, settings.backup_restore_drill_path())
    restore_drill_age_hours = _age_hours(now, restore_drill_last_at)
    restore_drill_recent_ok = bool(
        restore_drill_last_at is not None
        and restore_drill_age_hours is not None
        and restore_drill_age_hours <= settings.backup_restore_drill_max_age_hours
    )

    return DashboardIntegrationsOut(
        openai_configured=bool(settings.openai_api_key.strip()),
        woocommerce_configured=bool(
            settings.woocommerce_base_url.strip()
            and settings.woocommerce_consumer_key.strip()
            and settings.woocommerce_consumer_secret.strip()
        ),
        wordpress_media_configured=bool(
            settings.wordpress_base_url.strip()
            and settings.wp_app_username.strip()
            and settings.wp_app_password.strip()
        ),
        webhook_secret_set=bool(settings.woocommerce_webhook_secret.strip()),
        total_published_products=int(total_published or 0),
        sync_success_24h=int(sync_success_24h or 0),
        sync_failed_24h=int(sync_failed_24h or 0),
        last_sync_at=last_sync_at,
        backup_latest_at=backup_latest_at,
        backup_recent_ok=backup_recent_ok,
        backup_age_minutes=backup_age_minutes,
        offsite_enabled=offsite_enabled,
        offsite_last_sync_at=offsite_last_sync_at,
        offsite_recent_ok=offsite_recent_ok,
        offsite_age_minutes=offsite_age_minutes,
        restore_drill_last_at=restore_drill_last_at,
        restore_drill_recent_ok=restore_drill_recent_ok,
        restore_drill_age_hours=restore_drill_age_hours,
    )
