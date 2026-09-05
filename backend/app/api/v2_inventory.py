from __future__ import annotations

import logging
from pathlib import Path
from uuid import UUID
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from openpyxl.utils.exceptions import InvalidFileException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.api.inventory import (
    get_inventory_market_prices as get_legacy_inventory_market_prices,
    get_inventory_workspace as get_legacy_inventory_workspace,
    put_inventory_market_prices as put_legacy_inventory_market_prices,
)
from app.database import get_db
from app.models.user import User
from app.schemas.document_artifact import DocumentArtifactReconcilePreviewOut, DocumentArtifactRecordOut
from app.schemas.inventory import InventoryMarketPricesOut, InventoryMarketPricesUpdate, InventoryWorkspaceOut
from app.schemas.product import (
    LibraryPhotoAttach,
    ProductCreate,
    ProductHistoryEntryOut,
    ProductOut,
    ProductSourceAfgOut,
    ProductStatusUpdate,
    ProductUpdate,
)
from app.services.document_artifact_service import (
    build_inventory_reconcile_preview,
    get_artifact_record,
    list_artifact_records,
    parse_inventory_workbook_inputs_from_workbook,
    sync_inventory_workbook_artifact,
)
from app.services.product_service import get_product_or_404, to_product_out, update_status
from app.services.product_service import (
    create_product as create_product_service,
    soft_delete_product,
    update_product as update_product_service,
)

from app.api.v2_support import (
    apply_inventory_workbook_artifact_inputs,
    artifact_file_response,
    ensure_inventory_artifact,
    restore_inventory_environment,
    snapshot_inventory_environment,
)

router = APIRouter()
logger = logging.getLogger(__name__)


async def _sync_inventory_projection(
    db: AsyncSession,
    *,
    admin: User,
) -> None:
    """Flush the workbook projection inside the caller's DB transaction.

    Product mutations and their DocumentArtifact records must either become
    visible together or roll back together.  In particular, a workbook error
    must never leave a product behind after the API returned HTTP 500.
    """

    workspace = await get_legacy_inventory_workspace(q=None, db=db, _=admin)
    await ensure_inventory_artifact(
        db,
        workspace,
        create_snapshot=True,
        force_sync=True,
        commit=False,
    )


async def sync_inventory_projection_guarded(
    db: AsyncSession,
    *,
    admin: User,
) -> None:
    """Şablon altyapısı eksik kurulumda mutasyonu kilitlemeyen senkron.

    ``_template_path`` FileNotFoundError fırlatır; yazma uçlarında bu 500'e
    düşüp ürün oluşturma/güncelleme/silme akışını tamamen kilitliyordu. DB tek
    doğruluk kaynağıdır: mutasyon geçer, projeksiyon bir sonraki workbook
    üretiminde yakalanır (legacy/v2/ürün uçları bu tek yardımcıyı kullanır)."""
    try:
        await _sync_inventory_projection(db, admin=admin)
    except FileNotFoundError:
        logger.warning("depolama template eksik, depolama artifact senkronu atlandı")


# Workbook yükleme üst sınırı: nginx 25M sınırı masaüstü doğrudan bağlantıyı
# kapsamaz; workbook'lar birkaç MB'ı geçtiği için read() ÖNCESİNDE uygulama
# içi sınır, belleği şişiren istekleri erken keser.
_WORKBOOK_MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Kullanıcı kaynaklı bozuk workbook'ta fırlayabilecek hata sınıfları:
# BadZipFile/InvalidFileException (geçersiz dosya), ArithmeticError
# ('1,5'/'abc' hücrede to_decimal → decimal.InvalidOperation alt sınıfı),
# KeyError (beklenen sayfa/satır eksik).
_WORKBOOK_DECODE_ERRORS = (BadZipFile, InvalidFileException, ArithmeticError, KeyError)


def _workbook_decode_message(exc: Exception) -> str:
    if isinstance(exc, (BadZipFile, InvalidFileException)):
        return "Dosya okunamadı: geçerli bir Excel çalışma kitabı değil."
    return f"Workbook içeriği çözümlenemedi: {exc}"


async def _read_workbook_upload(workbook: UploadFile) -> bytes:
    size = getattr(workbook, "size", None)
    if size is not None and int(size) > _WORKBOOK_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail="Workbook 10 MB boyut sınırını aşıyor.")
    content = await workbook.read()
    if not content:
        raise HTTPException(status_code=422, detail="Boş dosya: geçerli bir workbook yükleyin.")
    if len(content) > _WORKBOOK_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=422, detail="Workbook 10 MB boyut sınırını aşıyor.")
    return content


@router.get("/depolama/workspace", response_model=InventoryWorkspaceOut)
async def get_depolama_workspace_v2(
    q: str | None = None,
    category: str | None = Query(default=None, pattern=r"^(kulce|sikke|taki|gumus|platin_pd)$"),
    status: str | None = Query(
        default=None, pattern=r"^(purchased|in_inventory|for_sale|sold|melted|undecided)$"
    ),
    subcategory: str | None = Query(default=None, max_length=30),
    location: str | None = Query(default=None, max_length=100),
    needs_cleaning: bool | None = Query(default=None),
    gdpr_locked: bool | None = Query(default=None),
    date_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    weight_min: float | None = Query(default=None, ge=0),
    weight_max: float | None = Query(default=None, ge=0),
    price_min: float | None = Query(default=None, ge=0),
    price_max: float | None = Query(default=None, ge=0),
    # limit=None → tüm eşleşen satırlar (legacy workspace ile aynı sözleşme);
    # varsayılan 500 v2 yüzeyinde de sessiz kesmeye yol açıyordu.
    limit: int | None = Query(default=None, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> InventoryWorkspaceOut:
    from decimal import Decimal as _D

    workspace = await get_legacy_inventory_workspace(
        q=q,
        category=category,
        status=status,
        subcategory=subcategory,
        location=location,
        needs_cleaning=needs_cleaning,
        gdpr_locked=gdpr_locked,
        date_from=date_from,
        date_to=date_to,
        weight_min=_D(str(weight_min)) if weight_min is not None else None,
        weight_max=_D(str(weight_max)) if weight_max is not None else None,
        price_min=_D(str(price_min)) if price_min is not None else None,
        price_max=_D(str(price_max)) if price_max is not None else None,
        limit=limit,
        offset=offset,
        db=db,
        _=_,
    )
    no_filters = (
        not q
        and not category
        and not status
        and not subcategory
        and not location
        and needs_cleaning is None
        and gdpr_locked is None
        and not date_from
        and not date_to
        and weight_min is None
        and weight_max is None
        and price_min is None
        and price_max is None
        and offset == 0
    )
    if no_filters:
        try:
            await ensure_inventory_artifact(db, workspace, create_snapshot=False, force_sync=False)
        except FileNotFoundError:
            logger.warning("depolama template eksik, depolama artifact senkronu atlandı")
    return workspace


@router.get("/depolama/market-prices", response_model=InventoryMarketPricesOut)
async def get_depolama_market_prices_v2(
    _: User = Depends(require_admin),
) -> InventoryMarketPricesOut:
    return await get_legacy_inventory_market_prices(_=_)


@router.put("/depolama/market-prices", response_model=InventoryMarketPricesOut)
async def put_depolama_market_prices_v2(
    payload: InventoryMarketPricesUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> InventoryMarketPricesOut:
    # Env yazımı geri alınamaz bir dosya mutasyonudur: artifact senkronu patlarsa
    # istemci 500 görüp fiyatın yazılmadığını sanırdı. Import yolundaki
    # snapshot/restore deseni burada da uygulanır — senkron hatasında env ve DB
    # birlikte geri alınır (şablon eksikliği hariç: o durumda yalnız projeksiyon
    # atlanır, fiyat yazımı geçerlidir).
    env_snapshot = snapshot_inventory_environment()
    try:
        # db=None: legacy uç kendi best-effort senkronunu atlar; strict
        # senkronu bu sarmalayıcı aşağıda env snapshot/restore ile üstlenir.
        result = await put_legacy_inventory_market_prices(payload=payload, db=None, _=_)
        workspace = await get_legacy_inventory_workspace(q=None, db=db, _=_)
        try:
            await ensure_inventory_artifact(db, workspace, create_snapshot=True, force_sync=True, commit=False)
        except FileNotFoundError:
            # Şablon eksikse fiyat yazımı GEÇERLİ kalır; yalnız projeksiyon atlanır.
            logger.warning("depolama template eksik, depolama artifact senkronu atlandı")
        await db.commit()
        return result
    except Exception:
        restore_inventory_environment(env_snapshot)
        await db.rollback()
        raise


@router.get("/depolama/products/{product_id}", response_model=ProductOut)
async def get_depolama_product_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    return to_product_out(product)


@router.patch("/depolama/products/{product_id}", response_model=ProductOut)
async def patch_depolama_product_v2(
    product_id: UUID,
    payload: ProductUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    try:
        current = await get_product_or_404(db, product_id, commit_gdpr_changes=False)
        product = await update_product_service(db, current, payload, admin.id, commit=False)
        await sync_inventory_projection_guarded(db, admin=admin)
        await db.commit()
        return product
    except Exception:
        await db.rollback()
        raise


@router.post("/depolama/products", response_model=ProductOut, status_code=201)
async def post_depolama_product_v2(
    payload: ProductCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    try:
        product = await create_product_service(db, payload, admin.id, commit=False)
        await sync_inventory_projection_guarded(db, admin=admin)
        await db.commit()
        return product
    except Exception:
        await db.rollback()
        raise


@router.delete("/depolama/products/{product_id}", status_code=204, response_class=Response)
async def delete_depolama_product_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    try:
        product = await get_product_or_404(db, product_id, commit_gdpr_changes=False)
        await soft_delete_product(db, product, admin.id, commit=False)
        await sync_inventory_projection_guarded(db, admin=admin)
        await db.commit()
        return Response(status_code=204)
    except Exception:
        await db.rollback()
        raise


@router.patch("/depolama/products/{product_id}/status", response_model=ProductOut)
async def patch_depolama_product_status_v2(
    product_id: UUID,
    payload: ProductStatusUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    try:
        product = await get_product_or_404(db, product_id, commit_gdpr_changes=False)
        updated = await update_status(db, product, payload, admin.id, commit=False)
        await sync_inventory_projection_guarded(db, admin=admin)
        await db.commit()
        return updated
    except Exception:
        await db.rollback()
        raise


# Seed foto havuzunun servis edildiği klasör (media_root altında, /media ile sunulur).
_SEED_PHOTO_REL = "seed-library/depolama"

# Havuzda .json manifesti de bulunabilir; ürüne iliştirilebilenler yalnız görüntü
# dosyalarıdır. mime/avif eşlemesi dosya sonekinden türetilir — sabit
# 'image/avif' etiketi .png/.webp dosyaları yanlış bildiriyordu.
_SEED_PHOTO_MIME_BY_SUFFIX = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".avif": "image/avif",
}


@router.post("/depolama/products/{product_id}/photos/from-library", response_model=ProductOut)
async def attach_library_photo_v2(
    product_id: UUID,
    payload: LibraryPhotoAttach,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    """Depolama foto havuzundaki bir fotoyu ürüne iliştirir (elle eşleme).

    Fotolar seed'de havuz olarak gelir; operatör doğru fotoyu bu uçla ürüne
    bağlar. Yalnız havuzda gerçekten var olan dosya adı kabul edilir (yol
    bileşenleri düşürülür — path traversal engellenir)."""
    from datetime import datetime, timezone
    from uuid import uuid4

    from fastapi.encoders import jsonable_encoder

    from app.config import get_settings
    from app.models.product_history import ProductHistory

    safe_name = Path(payload.file).name  # yol bileşenlerini at
    if not safe_name or safe_name != payload.file:
        raise HTTPException(status_code=422, detail="Geçersiz foto adı.")
    mime_type = _SEED_PHOTO_MIME_BY_SUFFIX.get(Path(safe_name).suffix.lower())
    if mime_type is None:
        raise HTTPException(
            status_code=422,
            detail="Desteklenmeyen foto formatı; yalnız jpg/png/webp/avif iliştirilebilir.",
        )
    pool_dir = get_settings().media_root_path() / _SEED_PHOTO_REL
    if not (pool_dir / safe_name).is_file():
        raise HTTPException(status_code=404, detail="Foto havuzda bulunamadı.")

    product = await get_product_or_404(db, product_id, commit_gdpr_changes=False)
    photos = list(product.photos or [])
    url = f"/media/{_SEED_PHOTO_REL}/{safe_name}"
    if any((p or {}).get("url") == url for p in photos):
        raise HTTPException(status_code=409, detail="Bu foto zaten iliştirilmiş.")
    make_primary = payload.make_primary or not photos
    if make_primary:
        for p in photos:
            p["is_primary"] = False
    photos.append({
        "id": str(uuid4()),
        "url": url,
        # AVIF varyantı yalnız gerçekten AVIF dosyada var; diğer formatlarda
        # frontend url'e düşer (types.ts: avif_url?: string | null).
        "avif_url": (url if mime_type == "image/avif" else None),
        "filename": safe_name,
        "is_primary": make_primary,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "mime_type": mime_type,
        "source": "depolama_seed_library",
    })
    product.photos = photos
    db.add(
        ProductHistory(
            product_id=product.id,
            action="photo_attached_from_library",
            old_value=None,
            new_value=jsonable_encoder({"file": safe_name}),
            performed_by=admin.id,
            notes="Depolama foto havuzundan iliştirildi",
        )
    )
    await db.commit()
    # Workbook 'Foto' kolonu: mutasyon kalıcı olduğundan projeksiyon senkronu
    # hatası yanıtı 500'e çevirmez, yalnız loglanır.
    try:
        await sync_inventory_projection_guarded(db, admin=admin)
        await db.commit()
    except Exception:  # noqa: BLE001
        await db.rollback()
        logger.warning("Foto iliştirme sonrası depolama projeksiyon senkronu tamamlanamadı", exc_info=True)
    updated = await get_product_or_404(db, product.id)
    return to_product_out(updated)


@router.get("/depolama/workbook")
async def get_depolama_workbook_v2(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    workspace = await get_legacy_inventory_workspace(q=None, db=db, _=_)
    try:
        bundle = await sync_inventory_workbook_artifact(db, workspace, create_snapshot=False)
        await db.commit()
    except FileNotFoundError:
        # Şablonu olmayan kurulumda Log/Depolama workbook'u 500 ile açılmıyordu.
        # Mevcut artifact varsa onu servis et; hiç üretilmemişse anlamlı 503.
        await db.rollback()
        record = await get_artifact_record(db, "depolama.live")
        if record is None:
            raise HTTPException(
                status_code=503,
                detail="Depolama workbook altyapısı hazır değil: referans şablon dosyası eksik.",
            ) from None
        logger.warning("depolama template eksik, workbook mevcut artifact sürümünden servis edildi")
        return artifact_file_response(record)


@router.post("/depolama/workbook/import", response_model=InventoryWorkspaceOut)
async def post_depolama_workbook_import_v2(
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> InventoryWorkspaceOut:
    content = await _read_workbook_upload(workbook)
    try:
        workspace = await apply_inventory_workbook_artifact_inputs(db, workbook_bytes=content, create_snapshot=True)
    except HTTPException:
        raise  # helper'ın 400 (parse) / 409 (conflict) sözleşmesi korunur
    except _WORKBOOK_DECODE_ERRORS as exc:
        # Bozuk dosya/bozuk hücre istemci hatasıdır: ham 500 yerine 422.
        raise HTTPException(status_code=422, detail=_workbook_decode_message(exc)) from exc
    await db.commit()
    return workspace


@router.post("/depolama/workbook/reconcile-preview", response_model=DocumentArtifactReconcilePreviewOut)
async def post_depolama_workbook_reconcile_preview_v2(
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> DocumentArtifactReconcilePreviewOut:
    current_workspace = await get_legacy_inventory_workspace(q=None, db=db, _=None)
    content = await _read_workbook_upload(workbook)
    try:
        parsed = parse_inventory_workbook_inputs_from_workbook(
            content,
            current_workspace=current_workspace,
        )
    except (ValidationError, ValueError) as exc:
        return DocumentArtifactReconcilePreviewOut(
            editable=False,
            changes=[],
            warnings=[],
            blocking_errors=[str(exc)],
        )
    except _WORKBOOK_DECODE_ERRORS as exc:
        # Dry-run sözleşmesi: mutasyonsuz güvenli önizleme 500 ile ölmez;
        # frontend blocking_errors bekliyor (InventoryWorkbookImport.tsx).
        return DocumentArtifactReconcilePreviewOut(
            editable=False,
            changes=[],
            warnings=[],
            blocking_errors=[_workbook_decode_message(exc)],
        )
    return build_inventory_reconcile_preview(current_workspace, parsed)


@router.get("/depolama/products/{product_id}/history", response_model=list[ProductHistoryEntryOut])
async def get_depolama_product_history_v2(
    product_id: UUID,
    limit: int = Query(default=50, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[ProductHistoryEntryOut]:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.product_history import ProductHistory
    from app.models.user import User as UserModel

    stmt = (
        select(ProductHistory, UserModel.email)
        .outerjoin(UserModel, UserModel.id == ProductHistory.performed_by)
        .where(ProductHistory.product_id == product_id)
        .order_by(ProductHistory.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        ProductHistoryEntryOut(
            id=entry.id,
            product_id=entry.product_id,
            action=entry.action,
            old_value=entry.old_value if isinstance(entry.old_value, dict) else None,
            new_value=entry.new_value if isinstance(entry.new_value, dict) else None,
            performed_by=entry.performed_by,
            performed_by_email=email,
            notes=entry.notes,
            created_at=entry.created_at,
        )
        for entry, email in rows
    ]


@router.get("/depolama/products/{product_id}/source-afg", response_model=ProductSourceAfgOut | None)
async def get_depolama_product_source_afg_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> ProductSourceAfgOut | None:
    """Bu ürünün hangi AFG'den geldiğini döner; bağı yoksa null.

    Zincir: Product.id → TransactionLine.product_id → Transaction.pos_document_sequence_no
            → PosDocument → PosSession → User (customer)
    Yeni AFG akışında `PosSessionProductLink` yazılmaz; bu zincir authoritative kaynak.
    Legacy sale akışı için PosSessionProductLink fallback olarak denenmiş olabilir.
    """
    from sqlalchemy import select

    from app.models.pos_document import PosDocument
    from app.models.pos_session import PosSession
    from app.models.transaction import Transaction
    from app.models.transaction_line import TransactionLine
    from app.models.user import User as UserModel
    from app.services.pos_document_service import format_document_number

    stmt = (
        select(TransactionLine, Transaction, PosDocument, PosSession, UserModel)
        .join(Transaction, Transaction.id == TransactionLine.transaction_id)
        .outerjoin(PosDocument, PosDocument.sequence_no == Transaction.pos_document_sequence_no)
        .outerjoin(PosSession, PosSession.id == PosDocument.pos_session_id)
        .outerjoin(UserModel, UserModel.id == PosSession.customer_id)
        .where(TransactionLine.product_id == product_id)
        .order_by(TransactionLine.line_no.asc())
        .limit(1)
    )
    result = (await db.execute(stmt)).first()

    if result is None:
        # Legacy fallback: PosSessionProductLink
        from app.models.pos_session_product_link import PosSessionProductLink

        legacy_stmt = (
            select(PosSessionProductLink, PosSession, PosDocument, UserModel)
            .join(PosSession, PosSession.id == PosSessionProductLink.pos_session_id)
            .outerjoin(PosDocument, PosDocument.pos_session_id == PosSession.id)
            .outerjoin(UserModel, UserModel.id == PosSession.customer_id)
            .where(PosSessionProductLink.product_id == product_id)
            .limit(1)
        )
        legacy = (await db.execute(legacy_stmt)).first()
        if legacy is None:
            return None
        _, pos_session, pos_document, customer = legacy
        return ProductSourceAfgOut(
            pos_session_id=pos_session.id,
            sequence_no=getattr(pos_document, "sequence_no", None),
            document_number=format_document_number(pos_document) if pos_document else None,
            issued_at=getattr(pos_document, "issued_at", None) if pos_document else None,
            customer_id=getattr(pos_session, "customer_id", None),
            customer_name=getattr(customer, "name", None) if customer else None,
        )

    line, transaction, pos_document, pos_session, customer = result
    return ProductSourceAfgOut(
        pos_session_id=getattr(pos_session, "id", None) or transaction.pos_session_id,
        sequence_no=getattr(pos_document, "sequence_no", None),
        document_number=format_document_number(pos_document) if pos_document else None,
        issued_at=getattr(pos_document, "issued_at", None) if pos_document else None,
        customer_id=getattr(pos_session, "customer_id", None) if pos_session else None,
        customer_name=getattr(customer, "name", None) if customer else None,
        line_no=line.line_no,
        line_weight_grams=(str(line.weight_grams) if line.weight_grams is not None else None),
        line_pure_gold_grams=(str(line.pure_gold_grams) if line.pure_gold_grams is not None else None),
        line_total_dkk=(str(line.line_total_dkk) if line.line_total_dkk is not None else None),
        rate_dkk=(str(line.rate_dkk) if line.rate_dkk is not None else None),
        transaction_id=transaction.id,
    )


@router.get("/depolama/products/{product_id}/label")
async def get_depolama_product_label_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    """ESC/POS thermal printer için ürün etiketi (62mm).

    Frontend bunu blob olarak indirir + Tauri host print kuyruğuna iletir.
    """
    from app.services.thermal_label import build_thermal_product_label

    product = await get_product_or_404(db, product_id)
    payload = build_thermal_product_label(product)
    return Response(
        content=payload,
        media_type="application/vnd.escpos+raw",
        headers={
            "Content-Disposition": f'attachment; filename="depo-{product.product_number}-label.escpos"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/depolama/workbook/snapshots", response_model=list[DocumentArtifactRecordOut])
async def get_depolama_workbook_snapshots_v2(
    limit: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[DocumentArtifactRecordOut]:
    return await list_artifact_records(
        db,
        module_name="depolama",
        document_type="inventory_workbook",
        version_kind="snapshot",
        limit=limit,
    )
