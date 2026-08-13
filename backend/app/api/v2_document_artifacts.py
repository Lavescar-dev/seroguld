from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models.user import User
from app.schemas.document_artifact import DocumentArtifactCellsPatchIn, DocumentArtifactCellsPatchOut
from app.services.document_artifact_edit import (
    apply_cell_patch,
    artifact_mutation_lock,
    prepare_artifact,
)


router = APIRouter()


@router.patch(
    "/document-artifacts/{kind}/{key}/cells",
    response_model=DocumentArtifactCellsPatchOut,
)
async def patch_document_artifact_cells_v2(
    kind: str,
    key: str,
    payload: DocumentArtifactCellsPatchIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> DocumentArtifactCellsPatchOut:
    async with artifact_mutation_lock(kind, key):
        prepared = await prepare_artifact(db, kind=kind, key=key, admin=admin)
        return await apply_cell_patch(db, prepared=prepared, payload=payload)
