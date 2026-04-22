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
from app.schemas.product import ProductCreate, ProductOut, ProductStatusUpdate, ProductUpdate
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
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> InventoryWorkspaceOut:
    workspace = await get_legacy_inventory_workspace(q=q, db=db, _=_)
    if not q:
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
