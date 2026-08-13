from __future__ import annotations

import io
import logging
import os
import secrets
import shutil
import asyncio
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from openpyxl import load_workbook
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.schemas.document_artifact import ExcelSessionCloseOut, ExcelSessionOut, ExcelSessionSyncOut
from app.services.document_artifact_edit import (
    _restore_file,
    artifact_mutation_lock,
    prepare_artifact,
)
from app.services.document_artifact_service import artifact_absolute_path, get_artifact_record
from app.utils.helpers import utc_now


@dataclass(slots=True)
class ExcelSession:
    session_id: str
    bearer_token: str
    kind: str
    key: str
    artifact_key: str
    file_name: str
    working_path: Path
    created_at: datetime
    expires_at: datetime
    revision: int
    can_write: bool = True
    last_synced_at: datetime | None = None
    last_modified_at: datetime | None = None
    status: str = "active"
    dirty: bool = False
    # The bridge writes a workbook to this path before it can always report a
    # SheetChange/Save event back to the API.  Keep a fingerprint of the last
    # server-accepted bytes so a process crash, bridge timeout, or session TTL
    # expiry cannot silently delete an edited working copy merely because the
    # in-memory ``dirty`` flag was never set.
    last_known_checksum: str | None = None
    last_known_mtime_ns: int | None = None
    last_message: str | None = None
    last_blocking_errors: list[str] | None = None


_active_session: ExcelSession | None = None
_session_lock = asyncio.Lock()
_logger = logging.getLogger(__name__)


def _working_root() -> Path:
    root = get_settings().document_root_path() / "working"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_file_name(file_name: str) -> str:
    candidate = Path(file_name.replace("\\", "/")).name.strip()
    return candidate or "workbook.xlsx"


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _working_fingerprint(path: Path) -> tuple[str | None, int | None]:
    """Return a content+mtime fingerprint without turning missing files into errors."""

    try:
        stat = path.stat()
        return hashlib.sha256(path.read_bytes()).hexdigest(), stat.st_mtime_ns
    except OSError:
        return None, None


def _remember_working_fingerprint(entry: ExcelSession) -> None:
    checksum, mtime_ns = _working_fingerprint(entry.working_path)
    entry.last_known_checksum = checksum
    entry.last_known_mtime_ns = mtime_ns


def _record_applied_working_copy(entry: ExcelSession, workbook_bytes: bytes) -> None:
    """Record the bridge's already-written copy after a committed sync.

    The Excel bridge uploads the managed working file itself.  Replacing that
    still-open path after the database commit is therefore only a consistency
    aid, not part of the commit.  On Windows Excel can reject the replacement
    (or a transient disk error can occur); turning that post-commit cleanup
    failure into an API error makes the bridge retry with a stale revision and
    strands an otherwise successful sync in an endless conflict loop.

    Prefer the existing bytes when they already match the upload.  If a caller
    supplied different bytes and replacement fails, keep the session dirty so
    close/TTL preserves the copy rather than silently deleting it.
    """

    expected_checksum = hashlib.sha256(workbook_bytes).hexdigest()
    current_checksum, _ = _working_fingerprint(entry.working_path)
    if current_checksum == expected_checksum:
        _remember_working_fingerprint(entry)
        return
    # A bridge upload is read from the managed working path, but Excel can
    # write a newer copy while the API is committing the parsed domain
    # changes.  Never replace that newer copy with the bytes from the older
    # request: doing so would silently destroy an unsynced edit.  Keep the
    # previous accepted baseline so close/TTL preserves the newer file.
    if (
        current_checksum is None
        or entry.last_known_checksum is None
        or current_checksum != entry.last_known_checksum
    ):
        entry.dirty = True
        _logger.warning(
            "Excel senkronu sırasında çalışma kopyası değişti; daha yeni kopya korunuyor"
        )
        return
    try:
        _atomic_write(entry.working_path, workbook_bytes)
    except Exception:
        entry.dirty = True
        _logger.warning(
            "Excel senkronu commit sonrası çalışma kopyası güncellenemedi; kopya korunuyor",
            exc_info=True,
        )
        return
    current_checksum, current_mtime_ns = _working_fingerprint(entry.working_path)
    if current_checksum != expected_checksum:
        entry.dirty = True
        _logger.warning(
            "Excel senkronu sonrası çalışma kopyası doğrulanamadı; kopya korunuyor"
        )
        return
    entry.last_known_checksum = current_checksum
    entry.last_known_mtime_ns = current_mtime_ns


def _working_copy_changed(entry: ExcelSession) -> bool:
    """Detect edits that happened before the bridge could mark ``dirty``.

    Comparing both SHA-256 and nanosecond mtime catches normal writes while
    avoiding a false negative on filesystems whose timestamp precision is
    coarse.  A missing copy is considered changed when a baseline existed;
    it must never be treated as a clean session eligible for silent discard.
    """

    current_checksum, current_mtime_ns = _working_fingerprint(entry.working_path)
    # Real sessions always call _remember_working_fingerprint at creation. If
    # that baseline could not be read (for example, a transient disk error),
    # fail closed and preserve the copy rather than treating unknown bytes as
    # clean. Hand-built test/legacy entries are safer under this behavior too.
    if entry.last_known_checksum is None:
        return True
    return (
        current_checksum != entry.last_known_checksum
        or current_mtime_ns != entry.last_known_mtime_ns
    )


def _preserve_recovery_copy(entry: ExcelSession) -> None:
    """Move an expired/abandoned workbook to a recoverable recovery folder."""

    if not entry.working_path.parent.exists():
        return
    recovery_path = _working_root() / f"recovery-{entry.session_id}-{utc_now().strftime('%Y%m%d%H%M%S')}"
    try:
        entry.working_path.parent.replace(recovery_path)
    except OSError:
        # A concurrent Excel close may have removed the directory.  If the
        # move fails, leave it in place rather than deleting user work.
        return


def _remove_working_copy(entry: ExcelSession) -> None:
    """Delete a session copy, but never report success when Windows kept it open.

    ``shutil.rmtree(ignore_errors=True)`` is unsafe for a managed Excel
    session: Excel/antivirus/indexer handles can make the delete a no-op while
    the caller still receives a successful close response.  That would clear
    the in-memory lock and strand the only recovery copy without telling the
    operator.  Let the caller retain the active session so close can be
    retried; the copy remains available for recovery/TTL handling.
    """

    try:
        shutil.rmtree(entry.working_path.parent)
    except FileNotFoundError:
        return
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "excel_working_copy_locked",
                "message": "Excel çalışma kopyası hâlâ kullanımda; dosya korunuyor.",
                "working_file_name": entry.working_path.name,
            },
        ) from exc
    if entry.working_path.parent.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "excel_working_copy_locked",
                "message": "Excel çalışma kopyası silinemedi; dosya korunuyor.",
                "working_file_name": entry.working_path.name,
            },
        )


def _expire_if_needed() -> None:
    global _active_session
    if _active_session is None:
        return
    if _active_session.expires_at <= utc_now():
        try:
            if _active_session.dirty or _working_copy_changed(_active_session):
                _preserve_recovery_copy(_active_session)
            else:
                try:
                    _remove_working_copy(_active_session)
                except HTTPException:
                    # A clean copy is safe to discard, but a failed delete
                    # still needs an observable recovery location.  Never
                    # silently drop the only file merely because the session
                    # TTL elapsed while Windows held a handle.
                    _preserve_recovery_copy(_active_session)
        finally:
            _active_session = None


def _entry_out(entry: ExcelSession, *, include_token: bool = False, message: str | None = None) -> ExcelSessionOut:
    return ExcelSessionOut(
        session_id=entry.session_id,
        kind=entry.kind,
        key=entry.key,
        bearer_token=entry.bearer_token if include_token else None,
        status=entry.status,
        can_write=entry.can_write,
        revision=entry.revision,
        file_name=entry.file_name,
        working_file_name=entry.working_path.name,
        created_at=entry.created_at,
        last_synced_at=entry.last_synced_at,
        last_modified_at=entry.last_modified_at,
        message=message if message is not None else entry.last_message,
        blocking_errors=list(entry.last_blocking_errors or ()),
    )


async def _prepare_readonly_artifact(db: AsyncSession, *, kind: str, key: str, admin):
    """Resolve final/log artifacts without exposing a write-capable session."""

    if kind == "alis-document":
        try:
            sequence_no = int(key)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Geçersiz final AFG anahtarı") from exc
        existing = await get_artifact_record(db, f"alis.document.{sequence_no}")
        if existing is not None and artifact_absolute_path(existing).is_file():
            return existing
        from app.api.pos import get_pos_document_detail
        from app.services.document_artifact_service import sync_afg_document_artifact

        detail = await get_pos_document_detail(sequence_no=sequence_no, db=db, _=admin)
        return (await sync_afg_document_artifact(db, detail)).artifact
    if kind == "log":
        try:
            year = int(key)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Geçersiz log anahtarı") from exc
        existing = await get_artifact_record(db, f"log.live.{year}")
        if existing is not None and artifact_absolute_path(existing).is_file():
            return existing
        from app.api.afg import build_log_workspace
        from app.services.document_artifact_service import sync_log_workbook_artifact

        workspace = await build_log_workspace(db, q=None, year=year, limit=200)
        return (await sync_log_workbook_artifact(db, workspace, year=year, create_snapshot=False)).artifact
    if kind == "depolama-snapshot":
        if not key.startswith("depolama.snapshot."):
            raise HTTPException(status_code=400, detail="Geçersiz depolama snapshot anahtarı")
        artifact = await get_artifact_record(db, key)
        if (
            artifact is None
            or artifact.module_name != "depolama"
            or artifact.document_type != "inventory_workbook"
            or artifact.version_kind != "snapshot"
        ):
            raise HTTPException(status_code=404, detail="Depolama arşiv workbook’u bulunamadı")
        return artifact
    raise HTTPException(status_code=404, detail="Excel belge türü bulunamadı")


async def create_excel_session(db: AsyncSession, *, kind: str, key: str, admin) -> ExcelSessionOut:
    global _active_session
    async with _session_lock:
        async with artifact_mutation_lock(kind, key):
            _expire_if_needed()
            if _active_session is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "excel_session_active",
                        "message": "Başka bir Excel belgesi düzenleniyor.",
                        "session_id": _active_session.session_id,
                        "kind": _active_session.kind,
                        "key": _active_session.key,
                    },
                )
            can_write = kind in {"alis-workspace", "depolama"}
            if can_write:
                prepared = await prepare_artifact(db, kind=kind, key=key, admin=admin)
                artifact = prepared.record
                source_path = prepared.path
                resolved_kind = prepared.kind
                resolved_key = prepared.key
            else:
                artifact = await _prepare_readonly_artifact(db, kind=kind, key=key, admin=admin)
                source_path = artifact_absolute_path(artifact)
                resolved_kind = kind
                resolved_key = key
            await db.flush()
            session_id = str(uuid4())
            token = secrets.token_urlsafe(32)
            file_name = _safe_file_name(artifact.file_name)
            working_path = _working_root() / session_id / file_name
            _atomic_write(working_path, source_path.read_bytes())
            entry = ExcelSession(
                session_id=session_id,
                bearer_token=token,
                kind=resolved_kind,
                key=resolved_key,
                artifact_key=artifact.artifact_key,
                file_name=file_name,
                working_path=working_path,
                created_at=utc_now(),
                expires_at=utc_now() + timedelta(seconds=max(60, int(get_settings().office_session_ttl_seconds))),
                revision=int(artifact.revision or 0),
                can_write=can_write,
            )
            _remember_working_fingerprint(entry)
            _active_session = entry
            try:
                await db.commit()
            except BaseException:
                # The API did not return a token, so this working copy is not
                # user-addressable yet.  Still remove it (or move it to
                # recovery if a Windows file handle prevents deletion) before
                # releasing the single-session reservation.
                try:
                    await db.rollback()
                finally:
                    if _active_session is entry:
                        _active_session = None
                    try:
                        _remove_working_copy(entry)
                    except HTTPException:
                        _preserve_recovery_copy(entry)
                raise
            return _entry_out(entry, include_token=True)


def get_excel_session(session_id: str, bearer_token: str | None) -> ExcelSession:
    _expire_if_needed()
    entry = _active_session
    if entry is None or entry.session_id != session_id:
        raise HTTPException(status_code=404, detail="Excel oturumu bulunamadı")
    if not bearer_token or not secrets.compare_digest(entry.bearer_token, bearer_token):
        raise HTTPException(status_code=401, detail="Excel session token geçersiz")
    entry.expires_at = utc_now() + timedelta(seconds=max(60, int(get_settings().office_session_ttl_seconds)))
    return entry


def excel_session_status(session_id: str, bearer_token: str | None) -> ExcelSessionOut:
    return _entry_out(get_excel_session(session_id, bearer_token))


async def sync_excel_session(
    db: AsyncSession,
    *,
    session_id: str,
    bearer_token: str | None,
    workbook_bytes: bytes,
    base_revision: int,
    last_modified_at: datetime | None = None,
) -> ExcelSessionSyncOut:
    entry = get_excel_session(session_id, bearer_token)
    if not entry.can_write:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Salt okunur Excel oturumu yazılamaz")
    prepared = await prepare_artifact(db, kind=entry.kind, key=entry.key, admin=None)
    current_revision = int(prepared.record.revision or 0)
    original_content = prepared.path.read_bytes()
    if base_revision != current_revision or entry.revision != current_revision:
        entry.status = "rejected"
        entry.dirty = True
        entry.last_message = "Belge başka bir işlem tarafından güncellendi."
        entry.last_blocking_errors = [entry.last_message]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "artifact_revision_conflict",
                "message": "Belge başka bir işlem tarafından güncellendi.",
                "current_revision": current_revision,
            },
        )
    keep_vba = Path(entry.file_name).suffix.lower() == ".xlsm"
    try:
        # Validate the uploaded archive before handing it to the domain parser;
        # keep_vba is essential for .xlsm working copies.
        load_workbook(io.BytesIO(workbook_bytes), data_only=False, keep_vba=keep_vba, keep_links=True).close()
    except Exception as exc:
        _atomic_write(entry.working_path, workbook_bytes)
        entry.status = "rejected"
        entry.dirty = True
        entry.last_message = "Excel workbook okunamadı."
        entry.last_blocking_errors = [str(exc)]
        entry.last_modified_at = last_modified_at or utc_now()
        return ExcelSessionSyncOut(
            session_id=session_id,
            status="rejected",
            revision=current_revision,
            message="Excel workbook okunamadı.",
            last_modified_at=entry.last_modified_at,
            blocking_errors=[str(exc)],
        )

    try:
        inventory_env_snapshot = None
        if entry.kind == "alis-workspace":
            from app.api.v2 import _apply_afg_workspace_artifact_inputs
            from app.services.pos_service import get_pos_session_or_404

            pos_session = await get_pos_session_or_404(db, UUID(entry.key))
            await _apply_afg_workspace_artifact_inputs(
                db,
                pos_session=pos_session,
                workbook_bytes=workbook_bytes,
                enforce_base_version=False,
            )
        else:
            from app.api.v2_support import apply_inventory_workbook_artifact_inputs
            from app.api.v2_support import snapshot_inventory_environment

            inventory_env_snapshot = snapshot_inventory_environment()

            await apply_inventory_workbook_artifact_inputs(
                db,
                workbook_bytes=workbook_bytes,
                create_snapshot=False,
                enforce_base_version=False,
            )
        await db.commit()
    except HTTPException as exc:
        if inventory_env_snapshot is not None:
            from app.api.v2_support import restore_inventory_environment

            restore_inventory_environment(inventory_env_snapshot)
        await db.rollback()
        _restore_file(prepared.path, original_content)
        if exc.status_code == status.HTTP_409_CONFLICT:
            entry.status = "rejected"
            entry.dirty = True
            entry.last_message = "Belge başka bir işlem tarafından güncellendi."
            entry.last_blocking_errors = [entry.last_message]
            raise
        detail = exc.detail if isinstance(exc.detail, str) else "Excel değişikliği reddedildi"
        _atomic_write(entry.working_path, workbook_bytes)
        entry.status = "rejected"
        entry.dirty = True
        entry.last_message = detail
        entry.last_blocking_errors = [detail]
        entry.last_modified_at = last_modified_at or utc_now()
        return ExcelSessionSyncOut(
            session_id=session_id,
            status="rejected",
            revision=current_revision,
            message=detail,
            last_modified_at=entry.last_modified_at,
            blocking_errors=[detail],
        )
    except Exception as exc:
        if inventory_env_snapshot is not None:
            from app.api.v2_support import restore_inventory_environment

            restore_inventory_environment(inventory_env_snapshot)
        await db.rollback()
        _restore_file(prepared.path, original_content)
        _atomic_write(entry.working_path, workbook_bytes)
        entry.status = "rejected"
        entry.dirty = True
        entry.last_message = "Excel değişiklikleri CRM'ye aktarılamadı."
        entry.last_blocking_errors = [str(exc)]
        entry.last_modified_at = last_modified_at or utc_now()
        return ExcelSessionSyncOut(
            session_id=session_id,
            status="rejected",
            revision=current_revision,
            message="Excel değişiklikleri CRM'ye aktarılamadı.",
            last_modified_at=entry.last_modified_at,
            blocking_errors=[str(exc)],
        )

    updated = await get_artifact_record(db, entry.artifact_key)
    next_revision = int(updated.revision if updated is not None else current_revision)
    entry.revision = next_revision
    entry.last_synced_at = utc_now()
    entry.last_modified_at = last_modified_at or entry.last_synced_at
    entry.status = "active"
    entry.dirty = False
    entry.last_message = "Excel değişiklikleri CRM'ye aktarıldı."
    entry.last_blocking_errors = []
    _record_applied_working_copy(entry, workbook_bytes)
    return ExcelSessionSyncOut(
        session_id=session_id,
        status="applied",
        revision=next_revision,
        message="Excel değişiklikleri CRM'ye aktarıldı.",
        last_modified_at=entry.last_modified_at,
    )


def close_excel_session(
    session_id: str,
    bearer_token: str | None,
    *,
    discard: bool = False,
) -> ExcelSessionCloseOut:
    global _active_session
    entry = get_excel_session(session_id, bearer_token)
    # Excel/bridge may have written a new archive without a corresponding
    # callback.  Treat that as dirty and preserve it until the caller
    # explicitly asks to discard it.
    if _working_copy_changed(entry):
        entry.dirty = True
    if entry.dirty and not discard:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "excel_unsynced_changes",
                "message": "Açık Excel değişiklikleri CRM'ye aktarılamadı; dosya korunuyor.",
                "working_file_name": entry.working_path.name,
            },
        )
    # Keep the entry and its lock intact if the OS refuses to remove the
    # working copy.  Explicit discard authorizes deletion of the user's copy,
    # but it does not authorize claiming that deletion succeeded when Excel
    # still has the file open.
    _remove_working_copy(entry)
    entry.status = "closed"
    _active_session = None
    return ExcelSessionCloseOut(session_id=session_id)
