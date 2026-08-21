from __future__ import annotations

from datetime import timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.enums import MetalTypeEnum, ProductStatusEnum, ProductTypeEnum
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.user import User
from app.schemas.customer import CustomerCreate
from app.schemas.product import ProductCreate, ProductOut, ProductStatusUpdate, ProductUpdate
from app.services.customer_service import create_customer
from app.services.sequence_service import consume_product_number
from app.utils.helpers import quantize_2, to_decimal, utc_now


ACTIVE_STATUSES = {
    ProductStatusEnum.PURCHASED,
    ProductStatusEnum.IN_INVENTORY,
    ProductStatusEnum.FOR_SALE,
    ProductStatusEnum.UNDECIDED,
}

MANUAL_REVIEW_TAG = "[MANUAL_REVIEW"
SOURCE_TYPE_TAG = "[SOURCE_TYPE:"


def extract_manual_review_reasons(notes: str | None) -> list[str]:
    text = str(notes or "")
    marker_start = text.find(MANUAL_REVIEW_TAG)
    if marker_start < 0:
        return []
    marker_end = text.find("]", marker_start)
    if marker_end < 0:
        return []
    marker = text[marker_start:marker_end + 1]
    if ":" not in marker:
        return ["manual_review"]
    raw = marker.split(":", 1)[1].rstrip("]")
    reasons = [part.strip() for part in raw.split(",") if part.strip()]
    return reasons or ["manual_review"]


def has_manual_review_flag(notes: str | None) -> bool:
    return bool(extract_manual_review_reasons(notes))


def extract_import_source_type(notes: str | None) -> str | None:
    text = str(notes or "")
    marker_start = text.find(SOURCE_TYPE_TAG)
    if marker_start < 0:
        return None
    marker_end = text.find("]", marker_start)
    if marker_end < 0:
        return None
    marker = text[marker_start:marker_end + 1]
    raw = marker.removeprefix(SOURCE_TYPE_TAG).rstrip("]").strip().lower()
    return raw or None


def calculate_pure_gold_grams(weight_grams: Decimal, purity_percentage: Decimal | None) -> Decimal | None:
    if purity_percentage is None:
        return None
    return quantize_2(weight_grams * (purity_percentage / Decimal("100")))


def calculate_offer_price(
    pure_gold_grams: Decimal,
    gold_rate_dkk_per_gram: Decimal,
    commission_rate: Decimal,
) -> Decimal:
    # commission_rate is 0-1 based ratio (0.10 = 10%)
    return quantize_2(pure_gold_grams * gold_rate_dkk_per_gram * (Decimal("1") - commission_rate))


def _resolved_publish_profile(product: Product) -> str | None:
    try:
        from app.services.woocommerce_profiles import resolve_publish_profile

        return resolve_publish_profile(product)
    except Exception:  # pragma: no cover - türetim UI için bilgi amaçlı
        return None


def infer_inventory_categories(
    metal_type: MetalTypeEnum, product_type: ProductTypeEnum
) -> tuple[str, str | None]:
    """Depo kategorisinin tek kaynağı; api/inventory.py görüntüleme ve
    kayıt yazma yolları aynı türetmeyi kullanır (liste filtresi ham kolona
    baktığından kolon her kayıtta dolu tutulmalıdır — 0035 backfill)."""
    if metal_type == MetalTypeEnum.SILVER:
        return "gumus", ("barrer" if product_type == ProductTypeEnum.BAR else "smykker")
    if metal_type in {MetalTypeEnum.PLATINUM, MetalTypeEnum.PALLADIUM}:
        return "platin_pd", ("palladyum" if metal_type == MetalTypeEnum.PALLADIUM else "platin")
    if product_type == ProductTypeEnum.BAR:
        return "kulce", None
    return "taki", None


def visible_product_clause():
    return Product.deleted_at.is_(None)


async def _get_next_product_number(session: AsyncSession) -> str:
    return await consume_product_number(session)


def _is_locked(gdpr_release_date) -> bool:
    if gdpr_release_date.tzinfo is None:
        gdpr_release_date = gdpr_release_date.replace(tzinfo=timezone.utc)
    return utc_now() < gdpr_release_date


async def _log_history(
    session: AsyncSession,
    *,
    product_id,
    action: str,
    performed_by,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    notes: str | None = None,
) -> None:
    entry = ProductHistory(
        product_id=product_id,
        action=action,
        performed_by=performed_by,
        old_value=jsonable_encoder(old_value),
        new_value=jsonable_encoder(new_value),
        notes=notes,
    )
    session.add(entry)


def _allowed_status_transition(current: ProductStatusEnum, new: ProductStatusEnum) -> bool:
    allowed: dict[ProductStatusEnum, set[ProductStatusEnum]] = {
        ProductStatusEnum.PURCHASED: {
            ProductStatusEnum.IN_INVENTORY,
            ProductStatusEnum.UNDECIDED,
            ProductStatusEnum.MELTED,
            # GDPR penceresi bilgilendirme olduğu için taze alım doğrudan
            # satışa/satılmışa alınabilir (0.3.8 kararı).
            ProductStatusEnum.FOR_SALE,
            ProductStatusEnum.SOLD,
        },
        ProductStatusEnum.IN_INVENTORY: {
            ProductStatusEnum.FOR_SALE,
            ProductStatusEnum.MELTED,
            ProductStatusEnum.UNDECIDED,
        },
        ProductStatusEnum.FOR_SALE: {
            ProductStatusEnum.SOLD,
            ProductStatusEnum.MELTED,
            ProductStatusEnum.IN_INVENTORY,
        },
        ProductStatusEnum.UNDECIDED: {
            ProductStatusEnum.IN_INVENTORY,
            ProductStatusEnum.FOR_SALE,
            ProductStatusEnum.MELTED,
        },
        ProductStatusEnum.SOLD: set(),
        ProductStatusEnum.MELTED: set(),
    }
    return new in allowed[current]


async def refresh_gdpr_state(session: AsyncSession, product: Product) -> bool:
    locked = _is_locked(product.gdpr_release_date)
    changed = False

    if product.is_gdpr_locked != locked:
        old = {"is_gdpr_locked": product.is_gdpr_locked}
        product.is_gdpr_locked = locked
        await _log_history(
            session,
            product_id=product.id,
            action="gdpr_lock_updated",
            performed_by=None,
            old_value=old,
            new_value={"is_gdpr_locked": locked},
            notes="Sistem tarafından otomatik güncellendi",
        )
        changed = True

    if not locked and product.status == ProductStatusEnum.PURCHASED:
        old_status = product.status
        product.status = ProductStatusEnum.IN_INVENTORY
        await _log_history(
            session,
            product_id=product.id,
            action="status_changed",
            performed_by=None,
            old_value={"status": old_status},
            new_value={"status": product.status},
            notes="14 gün bekleme tamamlandı",
        )
        changed = True

    return changed


async def _resolve_seller(session: AsyncSession, payload: ProductCreate) -> User | None:
    if payload.seller_customer_id:
        seller = await session.get(User, payload.seller_customer_id)
        if not seller:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Satıcı müşteri bulunamadı")
        return seller

    if payload.seller_new:
        try:
            seller_payload = CustomerCreate(
                name=payload.seller_new.name,
                email=payload.seller_new.email,
                phone=payload.seller_new.phone,
                address=payload.seller_new.address,
                cpr_number=payload.seller_new.cpr_number,
            )
        except ValidationError as exc:
            first_error = exc.errors()[0] if exc.errors() else None
            message = first_error.get("msg") if isinstance(first_error, dict) else "Satıcı bilgisi geçersiz"
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message) from exc

        seller = await create_customer(
            session,
            seller_payload,
        )
        return seller

    return None


def to_product_out(product: Product) -> ProductOut:
    manual_review_reasons = extract_manual_review_reasons(product.notes)
    source_type = extract_import_source_type(product.notes)
    total_weight = product.total_weight_grams
    if total_weight is None and product.weight_grams is not None:
        total_weight = quantize_2(product.weight_grams * Decimal(product.unit_count or 1))
    return ProductOut(
        id=product.id,
        product_number=product.product_number,
        reference_number=product.reference_number,
        display_name=product.display_name,
        product_type=product.product_type,
        metal_type=product.metal_type,
        weight_grams=product.weight_grams,
        purity_karat=product.purity_karat,
        purity_percentage=product.purity_percentage,
        pure_gold_grams=product.pure_gold_grams,
        unit_count=int(product.unit_count or 1),
        total_weight_grams=total_weight,
        purchase_date=product.purchase_date,
        purchase_price_dkk=product.purchase_price_dkk,
        gold_rate_at_purchase=product.gold_rate_at_purchase,
        commission=product.commission,
        seller_customer_id=product.seller_customer_id,
        seller_name=(product.seller_customer.name if product.seller_customer else None),
        gdpr_release_date=product.gdpr_release_date,
        is_gdpr_locked=product.is_gdpr_locked,
        status=product.status,
        sale_date=product.sale_date,
        sale_price_dkk=product.sale_price_dkk,
        buyer_customer_id=product.buyer_customer_id,
        buyer_name=(product.buyer_customer.name if product.buyer_customer else None),
        profit_dkk=product.profit_dkk,
        melt_date=product.melt_date,
        melt_reason=product.melt_reason,
        ai_description=product.ai_description,
        ai_description_approved=product.ai_description_approved,
        woocommerce_product_id=product.woocommerce_product_id,
        woocommerce_category_ids=(
            [int(value) for value in product.woocommerce_category_ids]
            if product.woocommerce_category_ids
            else None
        ),
        woocommerce_publish_profile=getattr(product, "woocommerce_publish_profile", None),
        production_year=getattr(product, "production_year", None),
        resolved_publish_profile=_resolved_publish_profile(product),
        is_published_to_site=product.is_published_to_site,
        published_at=product.published_at,
        photos=product.photos or [],
        notes=product.notes,
        storage_location=product.storage_location,
        needs_cleaning=product.needs_cleaning,
        shop_price_dkk=product.shop_price_dkk,
        shop_sync_status=product.shop_sync_status,
        length_cm=product.length_cm,
        width_mm=product.width_mm,
        thickness_mm=product.thickness_mm,
        producer=product.producer,
        diameter_mm=product.diameter_mm,
        inventory_category=product.inventory_category,
        inventory_subcategory=product.inventory_subcategory,
        operation_destination=product.operation_destination,
        operation_classification=product.operation_classification,
        manual_review_required=bool(manual_review_reasons),
        manual_review_reasons=manual_review_reasons,
        import_source_type=source_type,
        created_at=product.created_at,
        updated_at=product.updated_at,
    )


async def _load_product_for_output(
    session: AsyncSession,
    product_id,
    *,
    include_deleted: bool = False,
    commit_gdpr_changes: bool = True,
) -> Product:
    product = await session.scalar(
        select(Product)
        .where(Product.id == product_id, *(tuple() if include_deleted else (visible_product_clause(),)))
        .options(selectinload(Product.seller_customer), selectinload(Product.buyer_customer))
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ürün bulunamadı")

    changed = await refresh_gdpr_state(session, product)
    if changed:
        if commit_gdpr_changes:
            await session.commit()
        else:
            await session.flush()
        product = await session.scalar(
            select(Product)
            .where(Product.id == product_id, *(tuple() if include_deleted else (visible_product_clause(),)))
            .options(selectinload(Product.seller_customer), selectinload(Product.buyer_customer))
        )
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ürün bulunamadı")
    return product


async def create_product(session: AsyncSession, payload: ProductCreate, actor_id, *, commit: bool = True) -> ProductOut:
    seller = await _resolve_seller(session, payload)
    purchase_date = payload.purchase_date or utc_now()
    gdpr_release_date = purchase_date + timedelta(days=14)

    pure_gold_grams = calculate_pure_gold_grams(payload.weight_grams, payload.purity_percentage)
    total_weight_grams = payload.total_weight_grams or quantize_2(payload.weight_grams * Decimal(payload.unit_count))
    locked = _is_locked(gdpr_release_date)
    _inferred_category, _inferred_subcategory = infer_inventory_categories(payload.metal_type, payload.product_type)

    for _ in range(3):
        try:
            product = Product(
                product_number=await _get_next_product_number(session),
                reference_number=payload.reference_number,
                display_name=payload.display_name,
                product_type=payload.product_type,
                metal_type=payload.metal_type,
                weight_grams=quantize_2(payload.weight_grams),
                purity_karat=payload.purity_karat,
                purity_percentage=(quantize_2(payload.purity_percentage) if payload.purity_percentage is not None else None),
                pure_gold_grams=pure_gold_grams,
                unit_count=int(payload.unit_count),
                total_weight_grams=quantize_2(total_weight_grams),
                purchase_date=purchase_date,
                purchase_price_dkk=quantize_2(payload.purchase_price_dkk),
                gold_rate_at_purchase=(quantize_2(payload.gold_rate_at_purchase) if payload.gold_rate_at_purchase is not None else None),
                commission=quantize_2(payload.commission),
                seller_customer_id=(seller.id if seller else None),
                gdpr_release_date=gdpr_release_date,
                is_gdpr_locked=locked,
                status=(ProductStatusEnum.PURCHASED if locked else ProductStatusEnum.IN_INVENTORY),
                notes=payload.notes,
                storage_location=payload.storage_location,
                needs_cleaning=payload.needs_cleaning,
                shop_price_dkk=(quantize_2(payload.shop_price_dkk) if payload.shop_price_dkk is not None else None),
                shop_sync_status=payload.shop_sync_status,
                length_cm=payload.length_cm,
                width_mm=(quantize_2(payload.width_mm) if payload.width_mm is not None else None),
                thickness_mm=(quantize_2(payload.thickness_mm) if payload.thickness_mm is not None else None),
                diameter_mm=(quantize_2(payload.diameter_mm) if payload.diameter_mm is not None else None),
                producer=payload.producer,
                inventory_category=payload.inventory_category or _inferred_category,
                inventory_subcategory=(
                    payload.inventory_subcategory
                    if payload.inventory_category or payload.inventory_subcategory
                    else _inferred_subcategory
                ),
                operation_destination=payload.operation_destination,
                operation_classification=payload.operation_classification,
                photos=[item.model_dump() for item in payload.photos],
            )
            session.add(product)
            await session.flush()

            await _log_history(
                session,
                product_id=product.id,
                action="created",
                performed_by=actor_id,
                old_value=None,
                new_value={
                    "product_number": product.product_number,
                    "status": product.status,
                    "is_gdpr_locked": product.is_gdpr_locked,
                },
            )
            if commit:
                await session.commit()
            loaded_product = await _load_product_for_output(
                session,
                product.id,
                commit_gdpr_changes=commit,
            )
            return to_product_out(loaded_product)
        except IntegrityError:
            await session.rollback()

    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ürün numarası üretilirken çakışma oluştu")


async def get_product_or_404(
    session: AsyncSession,
    product_id,
    *,
    include_deleted: bool = False,
    commit_gdpr_changes: bool = True,
) -> Product:
    return await _load_product_for_output(
        session,
        product_id,
        include_deleted=include_deleted,
        commit_gdpr_changes=commit_gdpr_changes,
    )


async def list_products(
    session: AsyncSession,
    *,
    page: int,
    page_size: int,
    status_filter: ProductStatusEnum | None,
    metal_type,
    product_type,
    search: str | None,
    date_from,
    date_to,
) -> tuple[list[ProductOut], int]:
    filters = []
    filters.append(visible_product_clause())
    if status_filter:
        filters.append(Product.status == status_filter)
    if metal_type:
        filters.append(Product.metal_type == metal_type)
    if product_type:
        filters.append(Product.product_type == product_type)
    if date_from:
        filters.append(Product.purchase_date >= date_from)
    if date_to:
        filters.append(Product.purchase_date <= date_to)

    base_query = select(Product).outerjoin(User, Product.seller_customer_id == User.id)

    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                Product.product_number.ilike(pattern),
                Product.reference_number.ilike(pattern),
                User.name.ilike(pattern),
            )
        )

    if filters:
        base_query = base_query.where(and_(*filters))

    total_subquery = base_query.with_only_columns(Product.id).subquery()
    total = await session.scalar(select(func.count()).select_from(total_subquery))

    stmt = (
        base_query.options(selectinload(Product.seller_customer), selectinload(Product.buyer_customer))
        .order_by(Product.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    products = list((await session.scalars(stmt)).unique().all())
    changed = False
    for product in products:
        changed = await refresh_gdpr_state(session, product) or changed

    if changed:
        await session.commit()
        for product in products:
            await session.refresh(product)

    return [to_product_out(item) for item in products], int(total or 0)


async def update_product(
    session: AsyncSession,
    product: Product,
    payload: ProductUpdate,
    actor_id,
    *,
    commit: bool = True,
) -> ProductOut:
    if payload.expected_updated_at is not None and product.updated_at is not None:
        # Tolerans yok — milisaniye farkı bile başka bir kullanıcı güncellemesidir.
        expected = payload.expected_updated_at
        current = product.updated_at
        # tz-aware karşılaştırma için her ikisini UTC'ye düşür
        try:
            if expected.tzinfo is None:
                expected = expected.replace(tzinfo=current.tzinfo)
            diff = abs((current - expected).total_seconds())
        except Exception:  # noqa: BLE001
            diff = None
        if diff is None or diff > 1.0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "stale_product",
                    "message": "Bu ürün başka bir kullanıcı tarafından güncellenmiş. Lütfen sayfayı yenileyin.",
                    "current_updated_at": current.isoformat(),
                },
            )

    _old_inferred_category, _ = infer_inventory_categories(product.metal_type, product.product_type)
    old_snapshot = {
        "reference_number": product.reference_number,
        "display_name": product.display_name,
        "purchase_date": product.purchase_date,
        "weight_grams": product.weight_grams,
        "unit_count": product.unit_count,
        "total_weight_grams": product.total_weight_grams,
        "purity_percentage": product.purity_percentage,
        "purchase_price_dkk": product.purchase_price_dkk,
        "notes": product.notes,
    }

    if payload.reference_number is not None:
        product.reference_number = payload.reference_number
    if payload.display_name is not None:
        product.display_name = payload.display_name
    if payload.product_type is not None:
        product.product_type = payload.product_type
    if payload.metal_type is not None:
        product.metal_type = payload.metal_type
    if payload.purchase_date is not None:
        product.purchase_date = payload.purchase_date
        product.gdpr_release_date = payload.purchase_date + timedelta(days=14)
        product.is_gdpr_locked = _is_locked(product.gdpr_release_date)
        # Kilit artık kullanıcı seçimini EZMEZ: tarih düzeltmesi ürünü zorla
        # PURCHASED'a çekmiyordu olmamalı. Yalnız hâlâ PURCHASED bekleyen ürün
        # kilit düşünce depoya alınır (kolaylık).
        if not product.is_gdpr_locked and product.status == ProductStatusEnum.PURCHASED:
            product.status = ProductStatusEnum.IN_INVENTORY
    if payload.weight_grams is not None:
        product.weight_grams = quantize_2(payload.weight_grams)
    if payload.purity_karat is not None:
        product.purity_karat = payload.purity_karat
    if payload.purity_percentage is not None:
        product.purity_percentage = quantize_2(payload.purity_percentage)
    if payload.unit_count is not None:
        product.unit_count = int(payload.unit_count)
    if payload.total_weight_grams is not None:
        product.total_weight_grams = quantize_2(payload.total_weight_grams)
    if payload.purchase_price_dkk is not None:
        product.purchase_price_dkk = quantize_2(payload.purchase_price_dkk)
    if payload.gold_rate_at_purchase is not None:
        product.gold_rate_at_purchase = quantize_2(payload.gold_rate_at_purchase)
    if payload.commission is not None:
        product.commission = quantize_2(payload.commission)
    if payload.clear_notes or payload.notes is not None:
        product.notes = payload.notes
    if payload.storage_location is not None:
        product.storage_location = payload.storage_location
    if payload.needs_cleaning is not None:
        product.needs_cleaning = payload.needs_cleaning
    if payload.shop_price_dkk is not None:
        product.shop_price_dkk = quantize_2(payload.shop_price_dkk)
    if payload.shop_sync_status is not None:
        product.shop_sync_status = payload.shop_sync_status
    if payload.clear_length_cm:
        product.length_cm = None
    elif payload.length_cm is not None:
        product.length_cm = payload.length_cm
    if payload.clear_width_mm:
        product.width_mm = None
    elif payload.width_mm is not None:
        product.width_mm = quantize_2(payload.width_mm)
    if payload.clear_thickness_mm:
        product.thickness_mm = None
    elif payload.thickness_mm is not None:
        product.thickness_mm = quantize_2(payload.thickness_mm)
    if payload.clear_diameter_mm:
        product.diameter_mm = None
    elif payload.diameter_mm is not None:
        product.diameter_mm = quantize_2(payload.diameter_mm)
    if payload.clear_producer:
        product.producer = None
    elif payload.producer is not None:
        product.producer = payload.producer
    if payload.inventory_category is not None:
        product.inventory_category = payload.inventory_category
    if payload.inventory_subcategory is not None:
        product.inventory_subcategory = payload.inventory_subcategory
    if payload.inventory_category is None and (
        product.inventory_category is None
        # Tip değişiminde yalnız türetilmiş (elle atanmamış) kategori tazelenir;
        # operatörün elle seçtiği kategori (ör. 'sikke') korunur.
        or (
            (payload.metal_type is not None or payload.product_type is not None)
            and product.inventory_category == _old_inferred_category
        )
    ):
        _new_category, _new_subcategory = infer_inventory_categories(product.metal_type, product.product_type)
        product.inventory_category = _new_category
        if payload.inventory_subcategory is None:
            product.inventory_subcategory = _new_subcategory
    if payload.operation_destination is not None:
        product.operation_destination = payload.operation_destination
    if payload.operation_classification is not None:
        product.operation_classification = payload.operation_classification
    if payload.ai_description is not None:
        product.ai_description = payload.ai_description
    if payload.ai_description_approved is not None:
        product.ai_description_approved = payload.ai_description_approved

    if payload.weight_grams is not None or payload.purity_percentage is not None:
        weight = to_decimal(product.weight_grams)
        purity = to_decimal(product.purity_percentage) if product.purity_percentage is not None else None
        product.pure_gold_grams = calculate_pure_gold_grams(weight, purity)
    if (
        payload.weight_grams is not None
        or payload.unit_count is not None
        or payload.total_weight_grams is not None
    ) and payload.total_weight_grams is None:
        product.total_weight_grams = quantize_2(to_decimal(product.weight_grams) * Decimal(product.unit_count or 1))

    await _log_history(
        session,
        product_id=product.id,
        action="updated",
        performed_by=actor_id,
        old_value=old_snapshot,
        new_value={
            "reference_number": product.reference_number,
            "display_name": product.display_name,
            "purchase_date": product.purchase_date,
            "weight_grams": product.weight_grams,
            "unit_count": product.unit_count,
            "total_weight_grams": product.total_weight_grams,
            "purity_percentage": product.purity_percentage,
            "purchase_price_dkk": product.purchase_price_dkk,
            "notes": product.notes,
        },
    )

    if commit:
        await session.commit()
    else:
        await session.flush()
    updated = await _load_product_for_output(session, product.id, commit_gdpr_changes=commit)
    return to_product_out(updated)


async def soft_delete_product(
    session: AsyncSession,
    product: Product,
    actor_id,
    *,
    commit: bool = True,
) -> None:
    if product.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ürün bulunamadı")

    product.deleted_at = utc_now()
    product.deleted_by_user_id = actor_id

    await _log_history(
        session,
        product_id=product.id,
        action="deleted",
        performed_by=actor_id,
        old_value={"deleted_at": None, "status": product.status},
        new_value={"deleted_at": product.deleted_at.isoformat(), "status": product.status},
        notes="Depolama soft-delete",
    )

    if commit:
        await session.commit()
    else:
        await session.flush()


async def update_status(
    session: AsyncSession,
    product: Product,
    payload: ProductStatusUpdate,
    actor_id,
    *,
    commit: bool = True,
) -> ProductOut:
    if payload.expected_updated_at is not None and product.updated_at is not None:
        expected = payload.expected_updated_at
        current = product.updated_at
        try:
            if expected.tzinfo is None:
                expected = expected.replace(tzinfo=current.tzinfo)
            diff = abs((current - expected).total_seconds())
        except Exception:  # noqa: BLE001
            diff = None
        if diff is None or diff > 1.0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "stale_product",
                    "message": "Bu ürünün durumu başka bir kullanıcı tarafından güncellenmiş.",
                    "current_updated_at": current.isoformat(),
                },
            )

    await refresh_gdpr_state(session, product)

    current_status = product.status
    new_status = payload.status

    if new_status == current_status:
        return to_product_out(product)

    # GDPR kilidi artık durum geçişlerini engellemez (yalnız bilgi).

    if not _allowed_status_transition(current_status, new_status):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Geçersiz durum geçişi: {current_status.value} -> {new_status.value}",
        )

    old_snapshot = {
        "status": current_status,
        "sale_price_dkk": product.sale_price_dkk,
        "melt_reason": product.melt_reason,
    }

    product.status = new_status

    if new_status == ProductStatusEnum.SOLD:
        if payload.sale_price_dkk is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Satış fiyatı zorunlu")
        product.sale_price_dkk = quantize_2(payload.sale_price_dkk)
        product.sale_date = utc_now()
        product.buyer_customer_id = payload.buyer_customer_id
        product.profit_dkk = quantize_2(to_decimal(product.sale_price_dkk) - to_decimal(product.purchase_price_dkk))
    elif new_status == ProductStatusEnum.MELTED:
        if not payload.melt_reason:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Eritme nedeni zorunlu")
        product.melt_reason = payload.melt_reason
        product.melt_date = utc_now()
        product.sale_price_dkk = None
        product.sale_date = None
        product.profit_dkk = None
        product.buyer_customer_id = None
    elif new_status in {ProductStatusEnum.IN_INVENTORY, ProductStatusEnum.FOR_SALE, ProductStatusEnum.UNDECIDED}:
        # keep clean flow for unsold items
        product.sale_price_dkk = None
        product.sale_date = None
        product.profit_dkk = None
        product.buyer_customer_id = None
        product.melt_reason = None
        product.melt_date = None

    await _log_history(
        session,
        product_id=product.id,
        action="status_changed",
        performed_by=actor_id,
        old_value=old_snapshot,
        new_value={
            "status": product.status,
            "sale_price_dkk": product.sale_price_dkk,
            "melt_reason": product.melt_reason,
        },
    )

    if commit:
        await session.commit()
    else:
        await session.flush()
    updated = await _load_product_for_output(session, product.id, commit_gdpr_changes=commit)
    return to_product_out(updated)
