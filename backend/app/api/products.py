from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from math import ceil
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import require_admin
from app.database import get_db
from app.models.ai_usage_log import AIUsageLog
from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.woocommerce_log import WooCommerceSyncLog
from app.schemas.product import (
    ProductAIDescriptionUpdate,
    ProductCreate,
    ProductHistoryOut,
    ProductListResponse,
    ProductOut,
    ProductPublishRequest,
    ProductPublishResponse,
    ProductWooImportRequest,
    ProductWooImportResponse,
    ProductStatusUpdate,
    ProductUpdate,
    WooSyncLogOut,
)
from app.services.ai_service import AIService
from app.services.photo_service import PhotoService
from app.services.product_service import (
    calculate_pure_gold_grams,
    get_product_or_404,
    has_manual_review_flag,
    list_products,
    visible_product_clause,
    to_product_out,
    update_product,
    update_status,
)
from app.services.product_service import _get_next_product_number
from app.services.product_service import create_product as create_product_service
from app.services.woocommerce_import_helpers import (
    build_wc_product_summary,
    clear_manual_review_marker,
    compose_import_notes,
    delete_mock_seed_products,
    extract_order_match_for_wc_product,
    extract_purity,
    extract_wc_price_dkk,
    extract_weight_grams,
    infer_metal_type_details,
    infer_product_type_details,
    map_wc_images,
    parse_wc_datetime,
)
from app.services.woocommerce import WooCommerceService, missing_required_seo_fields
from app.utils.helpers import quantize_2, utc_now

router = APIRouter()

# Backward-compat exports for existing tests and internal imports.
_parse_wc_datetime = parse_wc_datetime
_extract_order_match_for_wc_product = extract_order_match_for_wc_product
_infer_product_type_details = infer_product_type_details
_infer_metal_type_details = infer_metal_type_details
_compose_import_notes = compose_import_notes
_clear_manual_review_marker = clear_manual_review_marker
_extract_weight_grams = extract_weight_grams
_extract_purity = extract_purity
_extract_wc_price_dkk = extract_wc_price_dkk
_map_wc_images = map_wc_images
_build_wc_product_summary = build_wc_product_summary
_delete_mock_seed_products = delete_mock_seed_products


@router.get("", response_model=ProductListResponse)
async def get_products(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    status_filter: ProductStatusEnum | None = Query(default=None, alias="status"),
    metal_type: MetalTypeEnum | None = None,
    product_type: ProductTypeEnum | None = None,
    search: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> ProductListResponse:
    items, total = await list_products(
        db,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
        metal_type=metal_type,
        product_type=product_type,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )

    total_pages = max(1, ceil(total / page_size))
    return ProductListResponse(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=total_pages,
    )


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    return await create_product_service(db, payload, admin.id)


@router.post("/import/woocommerce-live", response_model=ProductWooImportResponse)
async def import_woocommerce_live_products(
    payload: ProductWooImportRequest,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductWooImportResponse:
    deleted_mock_seed = 0
    if payload.replace_mock_seed:
        deleted_mock_seed = await delete_mock_seed_products(db)

    wc_service = WooCommerceService()
    wc_items = await wc_service.fetch_recent_published_products(limit=payload.limit)

    created = 0
    updated = 0
    skipped = 0
    imported_product_ids: list[str] = []
    errors: list[str] = []

    for wc_product in wc_items:
        wc_id = int(wc_product.get("id") or 0)
        if wc_id <= 0:
            skipped += 1
            continue

        try:
            existing = await db.scalar(select(Product).where(Product.woocommerce_product_id == wc_id, visible_product_clause()))
            price_dkk = extract_wc_price_dkk(wc_product)
            if price_dkk is None:
                skipped += 1
                continue

            product_type, source_type, type_review_reasons = infer_product_type_details(wc_product)
            metal_type, metal_review_reasons = infer_metal_type_details(wc_product)
            manual_review_reasons = [*type_review_reasons, *metal_review_reasons]
            weight_grams = extract_weight_grams(wc_product)
            if weight_grams is None:
                if existing and existing.weight_grams is not None and Decimal(existing.weight_grams) > 0:
                    weight_grams = Decimal(existing.weight_grams)
                else:
                    skipped += 1
                    errors.append(f"wc_id={wc_id}: ürün ağırlığı çözümlenemedi")
                    continue
            purity_karat, purity_percentage = extract_purity(metal_type, wc_product)
            pure_gold_grams = calculate_pure_gold_grams(weight_grams, purity_percentage)

            purchase_date = parse_wc_datetime(wc_product.get("date_created_gmt")) or parse_wc_datetime(
                wc_product.get("date_created")
            )
            if purchase_date is None:
                purchase_date = utc_now() - timedelta(days=30)

            published_at = parse_wc_datetime(wc_product.get("date_created_gmt")) or utc_now()
            photos = map_wc_images(wc_product)
            reference_number = str(wc_id)[:10]
            title = str(wc_product.get("name") or "").strip()
            import_status = ProductStatusEnum.UNDECIDED if manual_review_reasons else ProductStatusEnum.FOR_SALE
            composed_notes = compose_import_notes(
                title=title,
                is_update=bool(existing),
                source_type=source_type,
                manual_review_reasons=manual_review_reasons,
            )

            if existing:
                if existing.status in {ProductStatusEnum.SOLD, ProductStatusEnum.MELTED}:
                    skipped += 1
                    continue

                existing.reference_number = reference_number
                existing.product_type = product_type
                existing.metal_type = metal_type
                existing.weight_grams = weight_grams
                existing.purity_karat = purity_karat
                existing.purity_percentage = quantize_2(purity_percentage)
                existing.pure_gold_grams = pure_gold_grams
                existing.purchase_price_dkk = price_dkk
                existing.sale_price_dkk = price_dkk
                existing.gold_rate_at_purchase = quantize_2(price_dkk / max(weight_grams, Decimal("0.01")))
                existing.commission = Decimal("0.00")
                existing.purchase_date = purchase_date
                existing.gdpr_release_date = purchase_date
                existing.is_gdpr_locked = False
                existing.status = import_status
                existing.photos = photos
                existing.notes = composed_notes
                existing.woocommerce_product_id = wc_id
                existing.is_published_to_site = True
                existing.published_at = published_at

                db.add(
                    ProductHistory(
                        product_id=existing.id,
                        action="wc_import_updated",
                        old_value=None,
                        new_value=jsonable_encoder(
                            {
                                "wc_product_id": wc_id,
                                "sale_price_dkk": str(price_dkk),
                                "status": existing.status,
                                "manual_review_reasons": manual_review_reasons,
                                "source_type": source_type,
                            }
                        ),
                        performed_by=admin.id,
                        notes=(
                            "WooCommerce canlı ürün import güncellemesi"
                            if not manual_review_reasons
                            else "WooCommerce canlı ürün import güncellemesi (manuel inceleme gerekli)"
                        ),
                    )
                )
                await db.commit()
                updated += 1
                imported_product_ids.append(str(existing.id))
                continue

            product = Product(
                product_number=await _get_next_product_number(db),
                reference_number=reference_number,
                product_type=product_type,
                metal_type=metal_type,
                weight_grams=weight_grams,
                purity_karat=purity_karat,
                purity_percentage=quantize_2(purity_percentage),
                pure_gold_grams=pure_gold_grams,
                purchase_date=purchase_date,
                purchase_price_dkk=price_dkk,
                gold_rate_at_purchase=quantize_2(price_dkk / max(weight_grams, Decimal("0.01"))),
                commission=Decimal("0.00"),
                seller_customer_id=None,
                gdpr_release_date=purchase_date,
                is_gdpr_locked=False,
                status=import_status,
                sale_date=None,
                sale_price_dkk=price_dkk,
                buyer_customer_id=None,
                profit_dkk=None,
                melt_date=None,
                melt_reason=None,
                ai_description=None,
                ai_description_approved=False,
                woocommerce_product_id=wc_id,
                is_published_to_site=True,
                published_at=published_at,
                photos=photos,
                notes=composed_notes,
                storage_location="WooCommerce canlı stok",
                needs_cleaning=False,
            )
            db.add(product)
            await db.flush()

            db.add(
                ProductHistory(
                    product_id=product.id,
                    action="wc_import_created",
                    old_value=None,
                    new_value=jsonable_encoder(
                        {
                            "wc_product_id": wc_id,
                            "status": product.status,
                            "is_published_to_site": True,
                            "sale_price_dkk": str(price_dkk),
                            "manual_review_reasons": manual_review_reasons,
                            "source_type": source_type,
                        }
                    ),
                    performed_by=admin.id,
                    notes=(
                        "WooCommerce canlı ürün import kaydı oluşturuldu"
                        if not manual_review_reasons
                        else "WooCommerce canlı ürün import kaydı oluşturuldu (manuel inceleme gerekli)"
                    ),
                )
            )

            await db.commit()
            created += 1
            imported_product_ids.append(str(product.id))
        except Exception as exc:
            await db.rollback()
            errors.append(f"wc_id={wc_id}: {exc}")

    return ProductWooImportResponse(
        fetched=len(wc_items),
        created=created,
        updated=updated,
        skipped=skipped,
        deleted_mock_seed=deleted_mock_seed,
        imported_product_ids=imported_product_ids,
        errors=errors[:25],
    )


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    return to_product_out(product)


@router.get("/{product_id}/history", response_model=list[ProductHistoryOut])
async def get_product_history(
    product_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> list[ProductHistoryOut]:
    product = await get_product_or_404(db, product_id)
    rows = await db.scalars(
        select(ProductHistory)
        .where(ProductHistory.product_id == product.id)
        .order_by(ProductHistory.created_at.desc())
        .limit(limit)
    )
    return [
        ProductHistoryOut(
            id=item.id,
            action=item.action,
            old_value=item.old_value,
            new_value=item.new_value,
            notes=item.notes,
            created_at=item.created_at,
        )
        for item in rows.all()
    ]


@router.get("/{product_id}/sync-log", response_model=list[WooSyncLogOut])
async def get_product_sync_log(
    product_id: UUID,
    limit: int = Query(default=30, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> list[WooSyncLogOut]:
    product = await get_product_or_404(db, product_id)
    rows = await db.scalars(
        select(WooCommerceSyncLog)
        .where(WooCommerceSyncLog.product_id == product.id)
        .order_by(WooCommerceSyncLog.created_at.desc())
        .limit(limit)
    )
    return [
        WooSyncLogOut(
            id=item.id,
            action=item.action,
            wc_product_id=item.wc_product_id,
            request_payload=item.request_payload,
            response_payload=item.response_payload,
            status=item.status,
            error_message=item.error_message,
            created_at=item.created_at,
        )
        for item in rows.all()
    ]


@router.post("/{product_id}/manual-review/approve", response_model=ProductOut)
async def approve_product_manual_review(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    if not has_manual_review_flag(product.notes):
        return to_product_out(product)

    old_snapshot = {
        "notes": product.notes,
        "status": product.status,
    }
    product.notes = clear_manual_review_marker(product.notes)
    if product.status == ProductStatusEnum.UNDECIDED and product.is_published_to_site:
        product.status = ProductStatusEnum.FOR_SALE

    db.add(
        ProductHistory(
            product_id=product.id,
            action="manual_review_approved",
            old_value=jsonable_encoder(old_snapshot),
            new_value=jsonable_encoder(
                {
                    "notes": product.notes,
                    "status": product.status,
                }
            ),
            performed_by=admin.id,
            notes="Manuel inceleme onayı verildi ve bayrak kaldırıldı",
        )
    )
    await db.commit()
    refreshed = await get_product_or_404(db, product.id)
    return to_product_out(refreshed)


@router.get("/{product_id}/woocommerce-raw")
async def get_product_woocommerce_raw(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
) -> dict:
    product = await get_product_or_404(db, product_id)
    if not product.woocommerce_product_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Bu üründe WooCommerce ürün ID yok.",
        )

    wc_service = WooCommerceService()
    wc_product = await wc_service.fetch_product(wc_product_id=int(product.woocommerce_product_id))
    summary = build_wc_product_summary(wc_product)

    return {
        "crm_product_id": str(product.id),
        "crm_product_number": product.product_number,
        "wc_product_id": int(product.woocommerce_product_id),
        "fetched_at": utc_now().isoformat(),
        "summary": summary,
        "raw": wc_product,
    }


@router.post("/{product_id}/sync-sale-status")
async def sync_product_sale_status(
    product_id: UUID,
    days: int = Query(default=30, ge=1, le=365),
    per_page: int = Query(default=100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> dict:
    product = await get_product_or_404(db, product_id)
    if not product.woocommerce_product_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Üründe WooCommerce ürün ID yok")

    wc_product_id = int(product.woocommerce_product_id)
    svc = WooCommerceService()
    orders = await svc.fetch_recent_orders(days=days, per_page=per_page)

    matched: dict[str, object] | None = None
    for order in orders:
        if not isinstance(order, dict):
            continue
        current_match = extract_order_match_for_wc_product(order, wc_product_id=wc_product_id)
        if current_match is not None:
            matched = current_match
            break

    if matched is None:
        db.add(
            WooCommerceSyncLog(
                product_id=product.id,
                action="sold_sync_checked",
                wc_product_id=wc_product_id,
                request_payload=jsonable_encoder({"days": days, "per_page": per_page}),
                response_payload=None,
                status="success",
                error_message="not_found_in_recent_orders",
            )
        )
        await db.commit()
        return {
            "ok": True,
            "matched": False,
            "updated": False,
            "message": "Son siparişlerde bu ürün için satış bulunamadı.",
        }

    updated = False
    if product.status != ProductStatusEnum.SOLD:
        old_snapshot = {
            "status": product.status,
            "sale_date": product.sale_date,
            "sale_price_dkk": product.sale_price_dkk,
            "profit_dkk": product.profit_dkk,
            "is_published_to_site": product.is_published_to_site,
        }
        product.status = ProductStatusEnum.SOLD
        product.sale_date = matched.get("sale_date") if isinstance(matched.get("sale_date"), datetime) else utc_now()
        matched_sale_price = matched.get("sale_price_dkk")
        if isinstance(matched_sale_price, Decimal):
            product.sale_price_dkk = matched_sale_price
        product.profit_dkk = (
            quantize_2(product.sale_price_dkk - product.purchase_price_dkk)
            if product.sale_price_dkk is not None
            else None
        )
        product.is_published_to_site = False
        product.published_at = None
        updated = True

        db.add(
            ProductHistory(
                product_id=product.id,
                action="sold",
                old_value=jsonable_encoder(old_snapshot),
                new_value=jsonable_encoder(
                    {
                        "status": product.status,
                        "sale_date": product.sale_date,
                        "sale_price_dkk": product.sale_price_dkk,
                        "profit_dkk": product.profit_dkk,
                        "is_published_to_site": product.is_published_to_site,
                    }
                ),
                performed_by=admin.id,
                notes="Ürün detayından Woo satış senkronu ile otomatik satıldı güncellemesi",
            )
        )

    db.add(
        WooCommerceSyncLog(
            product_id=product.id,
            action="sold_sync_checked",
            wc_product_id=wc_product_id,
            request_payload=jsonable_encoder({"days": days, "per_page": per_page}),
            response_payload=jsonable_encoder(
                {
                    "order_id": matched.get("order_id"),
                    "line_item_id": matched.get("line_item_id"),
                    "order_status": matched.get("order_status"),
                    "sale_date": matched.get("sale_date"),
                    "sale_price_dkk": matched.get("sale_price_dkk"),
                }
            ),
            status="success",
            error_message=None,
        )
    )
    await db.commit()
    refreshed = await get_product_or_404(db, product.id)
    return {
        "ok": True,
        "matched": True,
        "updated": updated,
        "message": "Woo satış kaydı bulundu ve ürün güncellendi." if updated else "Woo satış kaydı bulundu (ürün zaten satılmış).",
        "order_id": matched.get("order_id"),
        "product": to_product_out(refreshed),
    }


@router.put("/{product_id}", response_model=ProductOut)
async def put_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    if product.status in {ProductStatusEnum.SOLD, ProductStatusEnum.MELTED}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Terminal durumdaki ürün güncellenemez")
    return await update_product(db, product, payload, admin.id)


@router.patch("/{product_id}/status", response_model=ProductOut)
async def patch_status(
    product_id: UUID,
    payload: ProductStatusUpdate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    return await update_status(db, product, payload, admin.id)


@router.post("/{product_id}/photos")
async def upload_photos(
    product_id: UUID,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    service = PhotoService()
    old_count = len(product.photos or [])
    updated_photos = await service.upload_product_photos(product=product, files=files, db=db)
    product.photos = updated_photos

    db.add(
        ProductHistory(
            product_id=product.id,
            action="photo_uploaded",
            old_value=jsonable_encoder({"photo_count": old_count}),
            new_value=jsonable_encoder({"photo_count": len(updated_photos)}),
            performed_by=admin.id,
            notes=f"{len(files)} fotoğraf yüklendi",
        )
    )
    await db.commit()
    updated = await get_product_or_404(db, product.id)
    return to_product_out(updated)


@router.delete("/{product_id}/photos/{photo_id}")
async def delete_photo(
    product_id: UUID,
    photo_id: str,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    old_count = len(product.photos or [])
    updated_photos = PhotoService().delete_product_photo(product=product, photo_id=photo_id)
    product.photos = updated_photos

    db.add(
        ProductHistory(
            product_id=product.id,
            action="photo_deleted",
            old_value=jsonable_encoder({"photo_count": old_count}),
            new_value=jsonable_encoder({"photo_count": len(updated_photos)}),
            performed_by=admin.id,
            notes=f"Fotoğraf silindi: {photo_id}",
        )
    )
    await db.commit()
    updated = await get_product_or_404(db, product.id)
    return to_product_out(updated)


@router.post("/{product_id}/ai-describe")
async def ai_describe(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    description, usage, images_analyzed = await AIService().generate_description_with_usage(product=product)
    updated = await update_product(
        db,
        product,
        ProductUpdate(ai_description=description, ai_description_approved=False),
        admin.id,
    )
    db.add(
        AIUsageLog(
            product_id=product.id,
            performed_by=admin.id,
            provider=usage.provider,
            model=usage.model,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            total_tokens=usage.total_tokens,
            input_cost_usd=usage.input_cost_usd,
            output_cost_usd=usage.output_cost_usd,
            total_cost_usd=usage.total_cost_usd,
        )
    )
    db.add(
        ProductHistory(
            product_id=product.id,
            action="ai_generated",
            old_value=None,
            new_value=jsonable_encoder(
                {
                    "model": usage.model,
                    "prompt_tokens": usage.prompt_tokens,
                    "completion_tokens": usage.completion_tokens,
                    "total_tokens": usage.total_tokens,
                    "total_cost_usd": str(usage.total_cost_usd),
                    "images_analyzed": images_analyzed,
                }
            ),
            performed_by=admin.id,
            notes=(
                f"AI açıklama üretildi ({images_analyzed} fotoğraf analiz edildi)"
                if images_analyzed
                else "AI açıklama üretildi (fotoğraf gönderilemedi — yalnız metin)"
            ),
        )
    )
    await db.commit()
    return updated


@router.put("/{product_id}/ai-describe")
async def update_ai_describe(
    product_id: UUID,
    payload: ProductAIDescriptionUpdate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    updated = await update_product(
        db,
        product,
        ProductUpdate(
            ai_description=payload.ai_description.strip(),
            ai_description_approved=payload.ai_description_approved,
        ),
        admin.id,
    )
    return updated


@router.post("/{product_id}/publish")
async def publish(
    product_id: UUID,
    payload: ProductPublishRequest,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductPublishResponse:
    product = await get_product_or_404(db, product_id)

    # GDPR 14 gün penceresi 0.3.8'den itibaren HİÇBİR işlemi engellemez;
    # yalnız bilgi olarak gösterilir (kullanıcı kararı: "hiçbir yerde
    # engellememeli, sadece yazmalı").
    if product.status in {ProductStatusEnum.SOLD, ProductStatusEnum.MELTED}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Satılmış/eritilmiş ürün yayınlanamaz")
    if not product.ai_description or not product.ai_description.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Önce AI açıklama oluşturun")
    if not product.ai_description_approved:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="AI açıklaması onaylanmadan yayınlanamaz")
    if has_manual_review_flag(product.notes):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Bu ürün manuel inceleme bayrağı taşıyor. Yayınlamadan önce inceleme tamamlanmalı.",
        )
    missing_fields = missing_required_seo_fields(product.ai_description)
    if missing_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"SEO paketi eksik. Yayın için zorunlu alanlar: {', '.join(missing_fields)}",
        )

    # Yayın panelindeki kategori seçimi ürüne kalıcı yazılır; None = dokunma,
    # [] = override'ı temizle (Settings haritasına dön).
    if payload.category_ids is not None:
        product.woocommerce_category_ids = [int(value) for value in payload.category_ids] or None

    wc_service = WooCommerceService()
    request_payload = {
        "regular_price_dkk": str(payload.regular_price_dkk),
        "name": payload.name,
        "category_ids": payload.category_ids,
    }

    try:
        wc_product, publish_warnings = await wc_service.publish_product(
            product=product,
            regular_price_dkk=payload.regular_price_dkk,
            name=payload.name,
        )
    except HTTPException as exc:
        db.add(
            WooCommerceSyncLog(
                product_id=product.id,
                action="published",
                wc_product_id=product.woocommerce_product_id,
                request_payload=request_payload,
                response_payload=None,
                status="failed",
                error_message=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            )
        )
        await db.commit()
        raise

    product.woocommerce_product_id = int(wc_product.get("id"))
    product.is_published_to_site = True
    product.published_at = utc_now()
    product.sale_price_dkk = quantize_2(payload.regular_price_dkk)
    product.status = ProductStatusEnum.FOR_SALE
    # _upload_media foto dict'lerine wc_media_id yazdı; JSON kolonun in-place
    # mutasyonu SQLAlchemy tarafından izlenmez — açıkça işaretlenmeli.
    flag_modified(product, "photos")

    db.add(
        ProductHistory(
            product_id=product.id,
            action="published",
            old_value=jsonable_encoder({"is_published_to_site": False}),
            new_value=jsonable_encoder({
                "is_published_to_site": True,
                "woocommerce_product_id": product.woocommerce_product_id,
                "status": product.status,
                "sale_price_dkk": product.sale_price_dkk,
            }),
            performed_by=admin.id,
            notes="WooCommerce'e yayınlandı",
        )
    )
    db.add(
        WooCommerceSyncLog(
            product_id=product.id,
            action="published",
            wc_product_id=product.woocommerce_product_id,
            request_payload=request_payload,
            response_payload={"warnings": publish_warnings, "wc": wc_product},
            status="partial" if publish_warnings else "success",
            error_message=None,
        )
    )

    await db.commit()
    updated = await get_product_or_404(db, product.id)
    return ProductPublishResponse(
        wc_product_id=updated.woocommerce_product_id or 0,
        wc_permalink=wc_product.get("permalink"),
        product=to_product_out(updated),
        warnings=publish_warnings,
    )


@router.post("/{product_id}/unpublish")
async def unpublish(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    if not product.woocommerce_product_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ürün WooCommerce tarafında yayınlı değil")

    wc_service = WooCommerceService()
    request_payload = {"wc_product_id": product.woocommerce_product_id}

    try:
        wc_response = await wc_service.unpublish_product(product.woocommerce_product_id)
    except HTTPException as exc:
        db.add(
            WooCommerceSyncLog(
                product_id=product.id,
                action="unpublished",
                wc_product_id=product.woocommerce_product_id,
                request_payload=request_payload,
                response_payload=None,
                status="failed",
                error_message=exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            )
        )
        await db.commit()
        raise

    old_status = product.status
    product.is_published_to_site = False
    product.published_at = None
    if product.status == ProductStatusEnum.FOR_SALE:
        product.status = ProductStatusEnum.IN_INVENTORY

    db.add(
        ProductHistory(
            product_id=product.id,
            action="unpublished",
            old_value=jsonable_encoder({"is_published_to_site": True, "status": old_status}),
            new_value=jsonable_encoder({"is_published_to_site": False, "status": product.status}),
            performed_by=admin.id,
            notes="WooCommerce yayını kaldırıldı",
        )
    )
    db.add(
        WooCommerceSyncLog(
            product_id=product.id,
            action="unpublished",
            wc_product_id=product.woocommerce_product_id,
            request_payload=request_payload,
            response_payload=wc_response,
            status="success",
            error_message=None,
        )
    )
    await db.commit()
    updated = await get_product_or_404(db, product.id)
    return to_product_out(updated)
