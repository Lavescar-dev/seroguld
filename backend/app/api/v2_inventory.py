from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.api.inventory import (
    delete_inventory_product as delete_legacy_inventory_product,
    get_inventory_market_prices as get_legacy_inventory_market_prices,
    get_inventory_workspace as get_legacy_inventory_workspace,
    patch_inventory_product as patch_legacy_inventory_product,
    post_inventory_product as post_legacy_inventory_product,
    put_inventory_market_prices as put_legacy_inventory_market_prices,
)
from app.database import get_db
from app.models.user import User
from app.schemas.document_artifact import DocumentArtifactReconcilePreviewOut, DocumentArtifactRecordOut
from app.schemas.inventory import InventoryMarketPricesOut, InventoryMarketPricesUpdate, InventoryWorkspaceOut
from app.schemas.product import (
    ProductCreate,
    ProductHistoryEntryOut,
    ProductOut,
    ProductSourceAfgOut,
    ProductStatusUpdate,
    ProductUpdate,
)
from app.services.document_artifact_service import (
    build_inventory_reconcile_preview,
    list_artifact_records,
    parse_inventory_workbook_inputs_from_workbook,
    sync_inventory_workbook_artifact,
)
from app.services.product_service import get_product_or_404, to_product_out, update_status

from app.api.v2_support import (
    apply_inventory_workbook_artifact_inputs,
    artifact_file_response,
    ensure_inventory_artifact,
)

router = APIRouter()


@router.get("/depolama/workspace", response_model=InventoryWorkspaceOut)
async def get_depolama_workspace_v2(
    q: str | None = None,
    category: str | None = Query(default=None, pattern=r"^(kulce|sikke|taki|gumus|platin_pd)$"),
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
    limit: int = Query(default=500, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> InventoryWorkspaceOut:
    from decimal import Decimal as _D

    workspace = await get_legacy_inventory_workspace(
        q=q,
        category=category,
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
        await ensure_inventory_artifact(db, workspace, create_snapshot=False, force_sync=False)
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
    result = await put_legacy_inventory_market_prices(payload=payload, _=_)
    workspace = await get_legacy_inventory_workspace(q=None, db=db, _=_)
    await ensure_inventory_artifact(db, workspace, create_snapshot=True, force_sync=True)
    return result


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
    product = await patch_legacy_inventory_product(product_id=product_id, payload=payload, db=db, admin=admin)
    workspace = await get_legacy_inventory_workspace(q=None, db=db, _=admin)
    await ensure_inventory_artifact(db, workspace, create_snapshot=True, force_sync=True)
    return product


@router.post("/depolama/products", response_model=ProductOut, status_code=201)
async def post_depolama_product_v2(
    payload: ProductCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    product = await post_legacy_inventory_product(payload=payload, db=db, admin=admin)
    workspace = await get_legacy_inventory_workspace(q=None, db=db, _=admin)
    await ensure_inventory_artifact(db, workspace, create_snapshot=True, force_sync=True)
    return product


@router.delete("/depolama/products/{product_id}", status_code=204, response_class=Response)
async def delete_depolama_product_v2(
    product_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Response:
    await delete_legacy_inventory_product(product_id=product_id, db=db, admin=admin)
    workspace = await get_legacy_inventory_workspace(q=None, db=db, _=admin)
    await ensure_inventory_artifact(db, workspace, create_snapshot=True, force_sync=True)
    return Response(status_code=204)


@router.patch("/depolama/products/{product_id}/status", response_model=ProductOut)
async def patch_depolama_product_status_v2(
    product_id: UUID,
    payload: ProductStatusUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ProductOut:
    product = await get_product_or_404(db, product_id)
    updated = await update_status(db, product, payload, admin.id)
    workspace = await get_legacy_inventory_workspace(q=None, db=db, _=admin)
    await ensure_inventory_artifact(db, workspace, create_snapshot=True, force_sync=True)
    return updated


@router.get("/depolama/workbook")
async def get_depolama_workbook_v2(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    workspace = await get_legacy_inventory_workspace(q=None, db=db, _=_)
    bundle = await sync_inventory_workbook_artifact(db, workspace, create_snapshot=False)
    await db.commit()
    return artifact_file_response(bundle.artifact, content=bundle.content)


@router.post("/depolama/workbook/import", response_model=InventoryWorkspaceOut)
async def post_depolama_workbook_import_v2(
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> InventoryWorkspaceOut:
    content = await workbook.read()
    workspace = await apply_inventory_workbook_artifact_inputs(db, workbook_bytes=content, create_snapshot=True)
    await db.commit()
    return workspace


@router.post("/depolama/workbook/reconcile-preview", response_model=DocumentArtifactReconcilePreviewOut)
async def post_depolama_workbook_reconcile_preview_v2(
    workbook: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> DocumentArtifactReconcilePreviewOut:
    current_workspace = await get_legacy_inventory_workspace(q=None, db=db, _=None)
    content = await workbook.read()
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
