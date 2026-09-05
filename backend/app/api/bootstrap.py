from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import _to_user_out
from app.api.deps import require_admin
from app.database import get_db
from app.models.enums import ProductStatusEnum, RoleEnum
from app.models.pos_document import PosDocument
from app.models.product import Product
from app.models.user import User
from app.schemas.bootstrap import BootstrapAppInfoOut, BootstrapNavigationOut, DesktopBootstrapOut
from app.schemas.dashboard import DashboardIntegrationsOut, DashboardOpsOut, DashboardSummaryOut, StockValueOut
from app.schemas.pos import PosMetalRatesOut
from app.services.dashboard_helpers import (
    age_hours as _age_hours,
    age_minutes as _age_minutes,
    find_last_offsite_sync as _find_last_offsite_sync,
    find_latest_hourly_backup as _find_latest_hourly_backup,
    find_latest_restore_drill as _find_latest_restore_drill,
    has_any_photo as _has_any_photo,
    quantize_cost as _quantize_cost,
    to_utc as _to_utc,
)
from app.services.gold_price import GoldPriceService
from app.services.product_service import ACTIVE_STATUSES, visible_product_clause
from app.config import get_settings
from app.models.ai_usage_log import AIUsageLog
from app.models.woocommerce_log import WooCommerceSyncLog
from app.utils.helpers import to_decimal, utc_now

router = APIRouter()


async def product_summary_counts(db: AsyncSession, month_start: datetime) -> tuple:
    summary_row = await db.execute(
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
            func.sum(case((Product.status.in_(tuple(ACTIVE_STATUSES)), 1), else_=0)),
        )
        .where(visible_product_clause())
    )
    return summary_row.one()


async def woocommerce_sync_counters(db: AsyncSession, since: datetime) -> tuple:
    """24 saatlik Woo senkron sayaçları.

    dashboard.py /integrations ile aynı ``created_at >= now - 24h`` penceresi;
    filtresiz sorgu "24h" alanlarını yaşam boyu birikimli sayaca çeviriyordu.
    last_sync_at bilinçli olarak penceresizdir (son senkron zamanıdır).
    """

    counters = await db.execute(
        select(
            func.sum(case((WooCommerceSyncLog.status == "success", 1), else_=0)),
            func.sum(case((WooCommerceSyncLog.status == "failed", 1), else_=0)),
        ).where(WooCommerceSyncLog.created_at >= since)
    )
    sync_success_24h, sync_failed_24h = counters.one()
    last_sync_at = await db.scalar(select(func.max(WooCommerceSyncLog.created_at)))
    return sync_success_24h, sync_failed_24h, last_sync_at


@router.get("", response_model=DesktopBootstrapOut)
async def get_bootstrap(
    db: AsyncSession = Depends(get_db),
    # Route bağımlılığı /api/bootstrap ucu için rol + must_change_password
    # kapısını kurar.
    current_user: User = Depends(require_admin),
) -> DesktopBootstrapOut:
    # Gövde içi rol denetimi ZORUNLUDUR: /api/v2/bootstrap (v2.py) bu fonksiyonu
    # açık argümanla (db=..., current_user=...) çağırır; plain Python çağrısı
    # signature'daki Depends(require_admin) default'unu ÇÖZÜMLEMEZ. Denetim
    # yalnız bağımlılıkta kalsaydı CUSTOMER token'ı /api/v2/bootstrap üzerinden
    # ciro/stok/AI maliyeti/backup telemetrisini okuyabiliyordu.
    if current_user.role != RoleEnum.ADMIN:
        raise HTTPException(status_code=403, detail="Bu işlem için admin yetkisi gerekli")
    settings = get_settings()
    now = utc_now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total_products, locked, free, for_sale, sold_this_month, melted_this_month, active_inventory = (
        await product_summary_counts(db, month_start)
    )

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

    # Ops metrikleri yalnız dokuz kolona ihtiyaç duyar; tüm Product satırını
    # ORM entity olarak (photos JSON + ai_description dahil ~40 kolon) hydrate
    # etmek yerine kolon projeksiyonu kullanılır — metric mantığı birebir aynı
    # kalır, bellek/ayak izi ürün tablosuyla büyümez.
    ops_rows = await db.execute(
        select(
            Product.status,
            Product.photos,
            Product.needs_cleaning,
            Product.ai_description,
            Product.ai_description_approved,
            Product.is_gdpr_locked,
            Product.gdpr_release_date,
            Product.is_published_to_site,
            Product.purchase_date,
        ).where(visible_product_clause())
    )
    ops_items = ops_rows.all()
    active_items = [
        item for item in ops_items if item.status in active_statuses
    ]
    with_photo = sum(1 for item in active_items if _has_any_photo(item.photos))
    without_photo = len(active_items) - with_photo
    for_sale_without_photo = sum(
        1
        for item in active_items
        if item.status == ProductStatusEnum.FOR_SALE and not _has_any_photo(item.photos)
    )
    needs_cleaning_queue = sum(1 for item in active_items if item.needs_cleaning)
    pending_ai_description = sum(1 for item in active_items if not (item.ai_description or "").strip())
    pending_ai_approval = sum(
        1
        for item in active_items
        if (item.ai_description or "").strip() and not item.ai_description_approved
    )
    pending_publish = sum(
        1
        for item in active_items
        if item.status == ProductStatusEnum.IN_INVENTORY and not item.is_gdpr_locked and not item.is_published_to_site
    )
    stale_gdpr_lock = sum(
        1
        for item in ops_items
        if item.is_gdpr_locked and item.gdpr_release_date and _to_utc(item.gdpr_release_date) <= _to_utc(now)
    )
    ready_for_sale = sum(
        1
        for item in active_items
        if item.status == ProductStatusEnum.IN_INVENTORY
        and not item.is_gdpr_locked
        and _has_any_photo(item.photos)
        and (item.ai_description or "").strip()
        and item.ai_description_approved
        and not item.needs_cleaning
    )
    avg_active_age_days = Decimal("0")
    if active_items:
        total_days = Decimal("0")
        now_utc = _to_utc(now)
        for item in active_items:
            purchase_date = _to_utc(item.purchase_date)
            delta = now_utc - purchase_date
            total_days += Decimal(delta.total_seconds()) / Decimal(86400)
        avg_active_age_days = (total_days / Decimal(len(active_items))).quantize(Decimal("0.01"))
    urgent_action_count = for_sale_without_photo + pending_ai_description + needs_cleaning_queue + stale_gdpr_lock

    total_requests, total_cost, last_call_at = (
        await db.execute(
            select(
                func.count(AIUsageLog.id),
                func.coalesce(func.sum(AIUsageLog.total_cost_usd), Decimal("0")),
                func.max(AIUsageLog.created_at),
            )
        )
    ).one()

    sync_since = now - timedelta(hours=24)
    sync_success_24h, sync_failed_24h, last_sync_at = await woocommerce_sync_counters(db, sync_since)

    total_published_products = await db.scalar(
        select(func.count(Product.id)).where(Product.is_published_to_site.is_(True), visible_product_clause())
    )

    total_customers = await db.scalar(
        select(func.count(User.id)).where(User.role == RoleEnum.CUSTOMER, User.is_active.is_(True))
    )
    total_documents = await db.scalar(select(func.count(PosDocument.sequence_no)))
    pending_documents = await db.scalar(
        select(func.count(Product.id)).where(Product.status == ProductStatusEnum.PURCHASED, visible_product_clause())
    )

    backup_latest_at = _find_latest_hourly_backup(settings.backup_root_path())
    backup_age_minutes = _age_minutes(now, backup_latest_at)
    offsite_last_sync_at = _find_last_offsite_sync(settings.backup_offsite_status_path())
    offsite_age_minutes = _age_minutes(now, offsite_last_sync_at)
    restore_drill_last_at = _find_latest_restore_drill(settings.backup_restore_drill_path())
    restore_drill_age_hours = _age_hours(now, restore_drill_last_at)

    rates = await GoldPriceService().get_rates()

    return DesktopBootstrapOut(
        user=_to_user_out(current_user),
        app=BootstrapAppInfoOut(
            app_name=settings.app_name,
            app_url=settings.app_url,
            seller_name=settings.invoice_seller_name,
            seller_city=settings.invoice_seller_city,
            seller_country=settings.invoice_seller_country,
            currency_code=settings.invoice_default_currency,
        ),
        navigation=BootstrapNavigationOut(
            total_documents=int(total_documents or 0),
            pending_documents=int(pending_documents or 0),
            # Depolama listesi ACTIVE_STATUSES ile filtreler; menü sayacı aynı kümeyi saymalı
            total_inventory=int(active_inventory or 0),
            total_customers=int(total_customers or 0),
            locked_products=int(locked or 0),
            pending_ai=int(pending_ai_description or 0),
        ),
        summary=DashboardSummaryOut(
            total_products=int(total_products or 0),
            locked_products=int(locked or 0),
            free_products=int(free or 0),
            for_sale_products=int(for_sale or 0),
            sold_this_month=int(sold_this_month or 0),
            melted_this_month=int(melted_this_month or 0),
        ),
        stock_value=StockValueOut(
            total_stock_value_dkk=str(current_total or Decimal("0")),
            today_change_dkk=str((today_sales or Decimal("0")) - (today_purchases or Decimal("0"))),
        ),
        ops=DashboardOpsOut(
            active_products=len(active_items),
            products_with_photo=with_photo,
            products_without_photo=without_photo,
            photo_coverage_percent=str(
                (Decimal(with_photo) / Decimal(len(active_items)) * Decimal("100")).quantize(Decimal("0.01"))
                if active_items
                else Decimal("0.00")
            ),
            for_sale_without_photo=for_sale_without_photo,
            needs_cleaning_queue=needs_cleaning_queue,
            pending_ai_description=pending_ai_description,
            pending_ai_approval=pending_ai_approval,
            pending_publish=pending_publish,
            stale_gdpr_lock=stale_gdpr_lock,
            ready_for_sale=ready_for_sale,
            avg_active_age_days=str(avg_active_age_days),
            urgent_action_count=urgent_action_count,
        ),
        integrations=DashboardIntegrationsOut(
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
            total_published_products=int(total_published_products or 0),
            sync_success_24h=int(sync_success_24h or 0),
            sync_failed_24h=int(sync_failed_24h or 0),
            last_sync_at=last_sync_at,
            backup_latest_at=backup_latest_at,
            backup_recent_ok=bool(backup_age_minutes is not None and backup_age_minutes <= settings.backup_health_max_age_minutes),
            backup_age_minutes=backup_age_minutes,
            offsite_enabled=settings.backup_offsite_enabled,
            offsite_last_sync_at=offsite_last_sync_at,
            offsite_recent_ok=(
                None
                if not settings.backup_offsite_enabled
                else bool(
                    offsite_age_minutes is not None and offsite_age_minutes <= settings.backup_offsite_max_age_minutes
                )
            ),
            offsite_age_minutes=offsite_age_minutes,
            restore_drill_last_at=restore_drill_last_at,
            restore_drill_recent_ok=bool(
                restore_drill_age_hours is not None
                and restore_drill_age_hours <= settings.backup_restore_drill_max_age_hours
            ),
            restore_drill_age_hours=restore_drill_age_hours,
        ),
        market_rates=PosMetalRatesOut(
            yellow_gold=str(rates["gold"]),
            white_gold=str(rates["gold"]),
            silver=str(rates["silver"]),
            platinum=str(rates["platinum"]),
            palladium=str(rates["palladium"]),
        ),
    )
