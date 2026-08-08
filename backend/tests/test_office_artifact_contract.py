from __future__ import annotations

from uuid import uuid4

from openpyxl import Workbook

from app.services.document_artifact_service import (
    ARTIFACT_CONFLICT_CLEAN,
    ARTIFACT_CONFLICT_CONFLICT,
    ARTIFACT_CONFLICT_INVALID,
    ARTIFACT_CONFLICT_STALE,
    ArtifactSyncContext,
    _read_sync_sheet,
    _sha256,
    _write_sync_sheet,
    read_artifact_sync_metadata,
    resolve_artifact_conflict_state,
)
from app.services.office_host_service import OfficeHostService
from app.schemas.document_artifact import DocumentArtifactPreviewOut, DocumentArtifactRecordOut
from app.utils.helpers import utc_now


def test_artifact_checksum_is_sha256_of_exact_bytes() -> None:
    content = b"artifact-contract"
    assert _sha256(content) == "96fa27d48ba4770b490059f7335b56d29d539be704d8534180de41e400c73214"


def test_revision_conflict_state_is_deterministic() -> None:
    assert resolve_artifact_conflict_state(current_revision=4, incoming_revision=4) == ARTIFACT_CONFLICT_CLEAN
    assert resolve_artifact_conflict_state(current_revision=4, incoming_revision=3) == ARTIFACT_CONFLICT_STALE
    assert resolve_artifact_conflict_state(current_revision=4, incoming_revision=5) == ARTIFACT_CONFLICT_CONFLICT
    assert resolve_artifact_conflict_state(current_revision=4, incoming_revision=None) == ARTIFACT_CONFLICT_INVALID
    assert resolve_artifact_conflict_state(current_revision=4, incoming_revision="not-a-revision") == ARTIFACT_CONFLICT_INVALID


def test_sync_metadata_carries_revision_used_by_office_callbacks() -> None:
    workbook = Workbook()
    _write_sync_sheet(
        workbook,
        context=ArtifactSyncContext(
            kind="alis-workspace",
            key="workspace-1",
            artifact_key="alis.workspace.workspace-1",
            base_version="7",
        ),
    )
    parsed = _read_sync_sheet(workbook)
    assert parsed.base_version == "7"

    parsed_from_bytes = read_artifact_sync_metadata(
        _workbook_bytes(workbook),
        expected_kind="alis-workspace",
        expected_key="workspace-1",
    )
    assert parsed_from_bytes.base_version == "7"


def test_office_session_version_uses_artifact_revision() -> None:
    service = OfficeHostService()
    preview = DocumentArtifactPreviewOut(
        title="draft.xlsx",
        download_path="/api/v2/office/mock-download",
        artifact=DocumentArtifactRecordOut(
            id=uuid4(),
            artifact_key="depolama.live",
            module_name="depolama",
            document_type="inventory_workbook",
            business_key="live",
            version_kind="live",
            is_live=True,
            file_name="draft.xlsx",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            revision=12,
            updated_at=utc_now(),
        ),
        import_supported=True,
    )
    entry = service.create_session(kind="depolama", key="ignored", preview=preview, can_write=True)
    try:
        assert entry.version == "12"
    finally:
        service._sessions.pop(entry.access_token, None)


def _workbook_bytes(workbook: Workbook) -> bytes:
    import io

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
