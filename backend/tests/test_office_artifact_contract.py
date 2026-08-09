from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from openpyxl import Workbook

from app.api import v2
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
            workspace_revision="12",
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
    assert parsed_from_bytes.workspace_revision == "12"


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


@pytest.mark.asyncio
async def test_alis_office_session_accepts_sequential_save_and_rejects_external_write(monkeypatch):
    artifact = SimpleNamespace(revision=5)
    entry = SimpleNamespace(
        artifact_key="alis.workspace.test",
        kind="alis-workspace",
        key=str(uuid4()),
        launch_revision=5,
        artifact_revision=5,
    )
    metadata = SimpleNamespace(base_version="5", workspace_revision="1")
    applied: list[bytes] = []

    async def fake_get_artifact_record(db, artifact_key: str):
        assert artifact_key == entry.artifact_key
        return artifact

    async def fake_apply_afg_workspace_artifact_inputs(db, *, pos_session, workbook_bytes, office_lineage):
        assert office_lineage is True
        applied.append(workbook_bytes)

    async def fake_get_pos_session_or_404(db, session_id):
        return SimpleNamespace(id=session_id)

    async def fake_build_purchase_workspace(db, *, pos_session):
        return SimpleNamespace(workspace_revision=1)

    monkeypatch.setattr(v2, "get_artifact_record", fake_get_artifact_record)
    monkeypatch.setattr(v2, "read_artifact_sync_metadata", lambda *args, **kwargs: metadata)
    monkeypatch.setattr(v2, "_apply_afg_workspace_artifact_inputs", fake_apply_afg_workspace_artifact_inputs)
    monkeypatch.setattr(v2, "get_pos_session_or_404", fake_get_pos_session_or_404)
    monkeypatch.setattr(v2, "build_purchase_workspace", fake_build_purchase_workspace)

    await v2._apply_office_session_content(db=SimpleNamespace(), entry=entry, workbook_bytes=b"first-save")
    artifact.revision = 6
    entry.artifact_revision = 6

    # OnlyOffice still sends base_version=5 from the open workbook.  With no
    # external artifact revision between callbacks, the second user save is
    # part of the same session lineage and must be applied.
    await v2._apply_office_session_content(db=SimpleNamespace(), entry=entry, workbook_bytes=b"second-save")
    artifact.revision = 7
    entry.artifact_revision = 7

    # A UI/other-session write advances the artifact beyond this Office entry;
    # the same stale workbook must now be rejected instead of resurrecting it.
    artifact.revision = 8

    with pytest.raises(HTTPException) as external_save:
        await v2._apply_office_session_content(db=SimpleNamespace(), entry=entry, workbook_bytes=b"external-stale-save")

    assert external_save.value.status_code == 409
    assert "external_write" in str(external_save.value.detail)
    assert applied == [b"first-save", b"second-save"]
