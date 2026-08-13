from __future__ import annotations

import hashlib

from fastapi import HTTPException, Response
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.inventory import (
    get_inventory_workspace as get_legacy_inventory_workspace,
    put_inventory_market_prices as put_legacy_inventory_market_prices,
)
from app.config import ROOT_ENV_FILE, get_settings
from app.schemas.inventory import InventoryWorkspaceOut
from app.services.document_artifact_service import (
    artifact_absolute_path,
    get_artifact_record,
    resolve_artifact_conflict_state,
    parse_inventory_workbook_inputs_from_workbook,
    sync_inventory_workbook_artifact,
)
from app.services.product_service import get_product_or_404, update_product


def snapshot_inventory_environment() -> tuple[bool, bytes | None]:
    existed = ROOT_ENV_FILE.exists()
    return existed, ROOT_ENV_FILE.read_bytes() if existed else None


def restore_inventory_environment(snapshot: tuple[bool, bytes | None]) -> None:
    existed, content = snapshot
    try:
        if existed and content is not None:
            temporary = ROOT_ENV_FILE.with_name(f".{ROOT_ENV_FILE.name}.restore.tmp")
            temporary.write_bytes(content)
            temporary.replace(ROOT_ENV_FILE)
        elif not existed:
            ROOT_ENV_FILE.unlink(missing_ok=True)
        get_settings.cache_clear()
    except OSError:
        # Never hide the domain/database exception with a best-effort config
        # restoration failure.
        return


def artifact_file_response(record, *, content: bytes | None = None) -> Response:
    payload = content if content is not None else artifact_absolute_path(record).read_bytes()
    checksum = hashlib.sha256(payload).hexdigest()
    return Response(
        content=payload,
        media_type=record.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{record.file_name}"',
            "ETag": f'"{checksum}"',
            "X-Sero-Artifact-Sha256": checksum,
            "X-Sero-Artifact-Revision": getattr(record, "checksum_sha256", None) or checksum,
        },
    )


async def ensure_inventory_artifact(
    db: AsyncSession,
    workspace: InventoryWorkspaceOut,
    *,
    create_snapshot: bool,
    force_sync: bool,
    commit: bool = True,
) -> None:
    if not force_sync and await get_artifact_record(db, "depolama.live"):
        return
    await sync_inventory_workbook_artifact(db, workspace, create_snapshot=create_snapshot)
    if commit:
        await db.commit()


async def apply_inventory_workbook_artifact_inputs(
    db: AsyncSession,
    *,
    workbook_bytes: bytes,
    create_snapshot: bool,
    enforce_base_version: bool = True,
) -> InventoryWorkspaceOut:
    env_snapshot = snapshot_inventory_environment()
    current_workspace = await get_legacy_inventory_workspace(q=None, db=db, _=None)
    try:
        parsed = parse_inventory_workbook_inputs_from_workbook(
            workbook_bytes,
            current_workspace=current_workspace,
        )
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if enforce_base_version and parsed.base_version:
        record = await get_artifact_record(db, "depolama.live")
        if record is not None:
            conflict_state = resolve_artifact_conflict_state(
                current_revision=getattr(record, "revision", 1),
                incoming_revision=parsed.base_version,
            )
            if conflict_state != "clean":
                raise HTTPException(
                    status_code=409,
                    detail=f"Depolama artifact conflict_state={conflict_state}; önce yenileyin.",
                )
    try:
        current_prices = current_workspace.market_prices
        if (
            parsed.market_prices.gold != current_prices.gold
            or parsed.market_prices.silver != current_prices.silver
            or parsed.market_prices.platinum != current_prices.platinum
            or parsed.market_prices.palladium != current_prices.palladium
        ):
            await put_legacy_inventory_market_prices(payload=parsed.market_prices, _=None)

        for product_id, payload in parsed.product_updates.items():
            product = await get_product_or_404(db, product_id, commit_gdpr_changes=False)
            await update_product(db, product, payload, None, commit=False)

        workspace = await get_legacy_inventory_workspace(q=None, db=db, _=None)
        await ensure_inventory_artifact(
            db,
            workspace,
            create_snapshot=create_snapshot,
            force_sync=True,
            commit=False,
        )
        return workspace
    except Exception:
        restore_inventory_environment(env_snapshot)
        # Workbook projection and product/price mutations share the caller's
        # transaction.  Roll back here as well as in endpoint wrappers so a
        # direct bridge/service invocation cannot leave a partial update
        # pending for a later request.
        await db.rollback()
        raise
