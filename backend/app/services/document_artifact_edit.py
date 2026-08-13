from __future__ import annotations

"""Controlled cell edits for the embedded workbook editor.

Legacy multipart import remains available only for editable AFG drafts and the
current inventory workbook.  Log/history import is fail-closed.  This module is
the narrower, optimistic-concurrency surface used by the desktop grid and the
Excel bridge: it accepts only cells advertised by the current artifact contract
and then delegates domain updates to the existing reconcile/apply pipeline.
"""

import io
import os
import re
import asyncio
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from openpyxl import load_workbook
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document_artifact import DocumentArtifact
from app.models.enums import PosSessionStatusEnum
from app.schemas.document_artifact import (
    DocumentArtifactAppliedCellOut,
    DocumentArtifactCellErrorOut,
    DocumentArtifactCellsPatchIn,
    DocumentArtifactCellsPatchOut,
)
from app.services.document_artifact_service import (
    AFG_EDITABLE_CELLS,
    AFG_PRIMARY_SHEET,
    _fmt_decimal,
    _inventory_editable_refs,
    _inventory_sync_mappings,
    _normalized_cell_value,
    artifact_absolute_path,
    get_artifact_record,
    sync_afg_workspace_artifact,
    sync_inventory_workbook_artifact,
)


_CELL_REF_RE = re.compile(r"^[A-Z]{1,3}[1-9][0-9]*$")
_PHONE_LITERAL_RE = re.compile(r"\+\d[\d .()\-]{4,}")

# The revision check and the subsequent domain/file transaction must be one
# process-wide critical section.  ``SELECT ... FOR UPDATE`` is not honored by
# SQLite, which is the packaged desktop database, so a small per-artifact
# asyncio lock is also required to prevent two UI/Excel requests from both
# accepting the same base revision.
_artifact_locks: dict[str, asyncio.Lock] = {}


def _canonical_mutation_key(kind: str, key: str) -> str:
    """Use one in-process lock for equivalent artifact URL spellings."""

    if kind == "depolama":
        return "live"
    if kind == "alis-workspace":
        try:
            return str(__import__("uuid").UUID(key))
        except (ValueError, AttributeError, TypeError):
            return key.strip()
    return key


def artifact_mutation_lock(kind: str, key: str) -> asyncio.Lock:
    lock_key = f"{kind}:{_canonical_mutation_key(kind, key)}"
    lock = _artifact_locks.get(lock_key)
    if lock is None:
        lock = asyncio.Lock()
        _artifact_locks[lock_key] = lock
    return lock


def _restore_file(path: Path, content: bytes) -> None:
    """Compensate a DB rollback when a sync already published a workbook."""

    temporary = path.with_name(f".{path.name}.{uuid4().hex}.rollback")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _close_workbook(workbook: Any) -> None:
    """Release openpyxl's ZipFile handles before Windows replaces the file."""

    try:
        workbook.close()
    except Exception:
        # A validation failure must not hide its domain error just because a
        # custom/older openpyxl workbook object lacks close().
        pass


@dataclass(slots=True)
class PreparedArtifact:
    kind: str
    key: str
    record: DocumentArtifact
    path: Path
    editable_cells: dict[str, dict[str, str]]
    workspace: Any | None = None


def _cell_key(sheet: str, cell_ref: str) -> str:
    return f"{sheet}!{cell_ref.upper()}"


def _parse_decimal(value: str | None) -> Decimal:
    text = str(value or "").strip().replace(" ", "")
    if not text:
        raise ValueError("Değer boş olamaz")
    # Accept Danish/Turkish decimal commas and the common thousands forms
    # without accepting ambiguous junk such as multiple decimal separators.
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        parsed = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Geçerli bir sayı olmalıdır") from exc
    if not parsed.is_finite():
        raise ValueError("Geçerli bir sayı olmalıdır")
    if parsed < 0:
        raise ValueError("Değer negatif olamaz")
    return parsed


def _normalize_cell_input(
    value: str | None,
    *,
    input_kind: str,
    cell_ref: str | None = None,
) -> tuple[str, Any]:
    """Return the API-normalized value and its safe Excel representation."""

    if input_kind == "percent":
        amount = _parse_decimal(value)
        percent = amount * Decimal("100") if amount <= 1 else amount
        if percent > 100:
            raise ValueError("Yüzde değeri 0 ile 100 arasında olmalıdır")
        normalized = _fmt_decimal(percent)
        return normalized, percent / Decimal("100")
    if input_kind == "decimal":
        amount = _parse_decimal(value)
        return _fmt_decimal(amount), amount
    if input_kind == "integer":
        amount = _parse_decimal(value)
        if amount != amount.to_integral_value() or amount < 1 or amount > 9999:
            raise ValueError("Adet 1 ile 9999 arasında tam sayı olmalıdır")
        integer = int(amount)
        return str(integer), integer
    if input_kind == "payment_method":
        candidate = str(value or "").strip().casefold()
        if candidate in {"cash", "kontant", "nakit"}:
            return "Kontant", "Kontant"
        if candidate in {"bank", "overførsel", "overfarsel", "transfer"}:
            return "Overførsel", "Overførsel"
        raise ValueError("Ödeme yöntemi Kontant veya Overførsel olmalıdır")
    if input_kind == "boolean":
        candidate = str(value or "").strip().casefold()
        if candidate in {"1", "true", "yes", "evet", "ja", "on", "aktif", "açık", "acik"}:
            return "1", 1
        if candidate in {"0", "false", "no", "hayır", "hayir", "nej", "off", "pasif", "kapalı", "kapali", ""}:
            return "0", 0
        raise ValueError("Değer Evet veya Hayır olmalıdır")
    if input_kind == "status":
        candidate = str(value or "").strip().casefold()
        if candidate in {"active", "aktif", "aktiv", "enabled", "açık", "acik"}:
            return "active", "active"
        if candidate in {"inactive", "inaktiv", "pasif", "disabled", "kapalı", "kapali"}:
            return "inactive", "inactive"
        if not candidate:
            return "", None
        raise ValueError("Stok durumu active veya inactive olmalıdır")
    if input_kind == "date":
        text = str(value or "").strip()
        if not text:
            raise ValueError("Belge tarihi boş olamaz")
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                parsed = datetime.strptime(text, fmt).date()
                return parsed.isoformat(), parsed
            except ValueError:
                continue
        raise ValueError("Belge tarihi geçerli bir tarih olmalıdır (YYYY-AA-GG)")
    text = str(value or "").strip()
    if text in {"—", "–", "-"}:
        text = ""
    # Do not let a CRM text field become an Excel formula when the workbook
    # is opened in Microsoft Excel.  This covers the common formula-injection
    # prefixes while retaining the explicit placeholder handling above.
    is_legacy_phone = cell_ref == "F18" and bool(_PHONE_LITERAL_RE.fullmatch(text))
    if (
        text.startswith(("=", "@"))
        or (text.startswith("+") and not is_legacy_phone)
        or (text.startswith("-") and len(text) > 1)
    ):
        raise ValueError("Metin alanı Excel formülü içeremez")
    return text, text or None


def _normalized_existing_value(value: Any, *, input_kind: str) -> str:
    if input_kind == "status":
        candidate = str(value or "").strip().casefold()
        if candidate in {"active", "aktif", "aktiv", "enabled", "açık", "acik"}:
            return "active"
        if candidate in {"inactive", "inaktiv", "pasif", "disabled", "kapalı", "kapali"}:
            return "inactive"
        return ""
    if input_kind == "date":
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
    return _normalized_cell_value(value, input_kind=input_kind)


def _inventory_editable_cell_map(workspace) -> dict[str, dict[str, str]]:
    from app.services.document_artifact_inventory import _inventory_editable_cell_map as _map

    return _map(workspace)


async def prepare_artifact(
    db: AsyncSession,
    *,
    kind: str,
    key: str,
    admin: Any,
) -> PreparedArtifact:
    """Resolve an editable live artifact and its server-side allowlist."""

    if kind == "alis-workspace":
        from app.services.pos_service import build_purchase_workspace, get_pos_session_or_404

        try:
            session_id = __import__("uuid").UUID(key)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Geçersiz AFG çalışma anahtarı") from exc
        pos_session = await get_pos_session_or_404(db, session_id)
        if pos_session.status != PosSessionStatusEnum.DRAFT:
            raise HTTPException(status_code=403, detail="Tamamlanmış AFG belgeleri salt okunurdur")
        workspace = await build_purchase_workspace(db, pos_session=pos_session)
        record = await get_artifact_record(db, f"alis.workspace.{session_id}")
        if record is None:
            record = (await sync_afg_workspace_artifact(db, workspace)).artifact
            await db.flush()
        allowlist = {
            _cell_key(cell.get("sheet", AFG_PRIMARY_SHEET), cell["cell_ref"]): {
                "sheet": cell.get("sheet", AFG_PRIMARY_SHEET),
                "cell_ref": cell["cell_ref"],
                "label": cell["label"],
                "input_kind": cell["input_kind"],
            }
            for cell in AFG_EDITABLE_CELLS
        }
        return PreparedArtifact(kind, str(session_id), record, artifact_absolute_path(record), allowlist, workspace)

    if kind == "depolama":
        if key not in {"live", ""}:
            raise HTTPException(status_code=403, detail="Yalnız güncel depolama workbook’u düzenlenebilir")
        from app.api.inventory import get_inventory_workspace

        workspace = await get_inventory_workspace(q=None, db=db, _=admin)
        record = await get_artifact_record(db, "depolama.live")
        if record is None:
            record = (await sync_inventory_workbook_artifact(db, workspace, create_snapshot=False)).artifact
            await db.flush()
        allowlist = _inventory_editable_cell_map(workspace)
        return PreparedArtifact("depolama", "live", record, artifact_absolute_path(record), allowlist, workspace)

    if kind in {"alis-document", "log"}:
        raise HTTPException(status_code=403, detail="Bu belge geçmiş kaydıdır ve salt okunurdur")
    raise HTTPException(status_code=404, detail="Belge türü bulunamadı")


def _patch_error(change, message: str) -> DocumentArtifactCellErrorOut:
    return DocumentArtifactCellErrorOut(sheet=change.sheet, cell_ref=change.cell_ref, message=message)


async def apply_cell_patch(
    db: AsyncSession,
    *,
    prepared: PreparedArtifact,
    payload: DocumentArtifactCellsPatchIn,
) -> DocumentArtifactCellsPatchOut:
    current_revision = int(prepared.record.revision or 0)
    if payload.base_revision != current_revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "artifact_revision_conflict",
                "message": "Belge başka bir işlem tarafından güncellendi.",
                "current_revision": current_revision,
            },
        )

    if not payload.changes:
        return DocumentArtifactCellsPatchOut(
            revision=current_revision,
            status="applied",
            warnings=["Uygulanacak hücre değişikliği yok."],
        )
    if not prepared.path.exists():
        raise HTTPException(status_code=404, detail="Belge dosyası bulunamadı")
    original_content = prepared.path.read_bytes()

    keep_vba = prepared.path.suffix.lower() == ".xlsm"
    try:
        workbook = load_workbook(
            prepared.path,
            data_only=False,
            keep_vba=keep_vba,
            keep_links=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Workbook okunamadı") from exc

    errors: list[DocumentArtifactCellErrorOut] = []
    normalized_changes: list[tuple[Any, dict[str, str], str, Any, str]] = []
    seen: set[str] = set()
    # Keep the workbook inside a finally block.  On Windows openpyxl owns a
    # ZipFile handle; every validation/save path must release it before the
    # canonical artifact is replaced or a domain reconcile starts.
    try:
        for change in payload.changes:
            sheet_name = str(change.sheet).strip()
            cell_ref = str(change.cell_ref).strip().upper()
            key = _cell_key(sheet_name, cell_ref)
            definition = prepared.editable_cells.get(key)
            if not _CELL_REF_RE.fullmatch(cell_ref):
                errors.append(_patch_error(change, "Geçersiz hücre adresi"))
                continue
            if key in seen:
                errors.append(_patch_error(change, "Aynı hücre bir istekte birden fazla kez gönderilemez"))
                continue
            seen.add(key)
            if definition is None:
                errors.append(_patch_error(change, "Bu hücre düzenlenebilir değil"))
                continue
            sheet = workbook.get(sheet_name)
            if sheet is None:
                errors.append(_patch_error(change, "Sheet bulunamadı"))
                continue
            cell = sheet[cell_ref]
            if cell.__class__.__name__ == "MergedCell":
                errors.append(_patch_error(change, "Birleştirilmiş hücre düzenlenemez"))
                continue
            if cell.data_type == "f" or (isinstance(cell.value, str) and cell.value.startswith("=")):
                errors.append(_patch_error(change, "Formül hücresi düzenlenemez"))
                continue
            try:
                normalized, excel_value = _normalize_cell_input(
                    change.value,
                    input_kind=definition["input_kind"],
                    cell_ref=cell_ref,
                )
            except ValueError as exc:
                errors.append(_patch_error(change, str(exc)))
                continue
            old_value = _normalized_existing_value(cell.value, input_kind=definition["input_kind"])
            normalized_changes.append((cell, definition, old_value, excel_value, normalized))

        if errors:
            return DocumentArtifactCellsPatchOut(
                revision=current_revision,
                status="rejected",
                cell_errors=errors,
            )

        for cell, _definition, _old_value, excel_value, _normalized in normalized_changes:
            cell.value = excel_value
        try:
            buffer = io.BytesIO()
            workbook.save(buffer)
            staged_content = buffer.getvalue()
        except Exception as exc:
            await db.rollback()
            return DocumentArtifactCellsPatchOut(
                revision=current_revision,
                status="rejected",
                cell_errors=[
                    DocumentArtifactCellErrorOut(sheet="", cell_ref="", message=f"Workbook kaydedilemedi: {exc}")
                ],
            )
    finally:
        _close_workbook(workbook)

    try:
        inventory_env_snapshot = None
        if prepared.kind == "alis-workspace":
            from app.api.v2 import _apply_afg_workspace_artifact_inputs
            from app.services.pos_service import get_pos_session_or_404

            pos_session = await get_pos_session_or_404(db, __import__("uuid").UUID(prepared.key))
            await _apply_afg_workspace_artifact_inputs(
                db,
                pos_session=pos_session,
                workbook_bytes=staged_content,
            )
        else:
            from app.api.v2_support import (
                apply_inventory_workbook_artifact_inputs,
                snapshot_inventory_environment,
                restore_inventory_environment,
            )

            inventory_env_snapshot = snapshot_inventory_environment()

            await apply_inventory_workbook_artifact_inputs(
                db,
                workbook_bytes=staged_content,
                create_snapshot=False,
            )
        await db.commit()
    except HTTPException as exc:
        if inventory_env_snapshot is not None:
            restore_inventory_environment(inventory_env_snapshot)
        await db.rollback()
        _restore_file(prepared.path, original_content)
        if exc.status_code == status.HTTP_409_CONFLICT:
            raise
        detail = exc.detail if isinstance(exc.detail, str) else "Değişiklik reddedildi"
        return DocumentArtifactCellsPatchOut(
            revision=current_revision,
            status="rejected",
            cell_errors=[_patch_error(change, detail) for change in payload.changes],
        )
    except (ValueError, TypeError) as exc:
        if inventory_env_snapshot is not None:
            restore_inventory_environment(inventory_env_snapshot)
        await db.rollback()
        _restore_file(prepared.path, original_content)
        return DocumentArtifactCellsPatchOut(
            revision=current_revision,
            status="rejected",
            cell_errors=[
                DocumentArtifactCellErrorOut(sheet="", cell_ref="", message=str(exc))
            ],
        )
    except Exception as exc:
        if inventory_env_snapshot is not None:
            restore_inventory_environment(inventory_env_snapshot)
        await db.rollback()
        _restore_file(prepared.path, original_content)
        return DocumentArtifactCellsPatchOut(
            revision=current_revision,
            status="rejected",
            cell_errors=[
                DocumentArtifactCellErrorOut(sheet="", cell_ref="", message="Değişiklik uygulanamadı")
            ],
        )

    updated = await get_artifact_record(db, prepared.record.artifact_key)
    next_revision = int(updated.revision if updated is not None else current_revision)
    applied = [
        DocumentArtifactAppliedCellOut(
            sheet=definition["sheet"],
            cell_ref=definition["cell_ref"],
            value=normalized,
        )
        for _cell, definition, old_value, _excel_value, normalized in normalized_changes
    ]
    return DocumentArtifactCellsPatchOut(
        revision=next_revision,
        status="applied",
        applied_changes=applied,
        warnings=[],
    )
