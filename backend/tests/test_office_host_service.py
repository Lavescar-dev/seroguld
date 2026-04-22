from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.api import v2
from app.schemas.document_artifact import DocumentArtifactPreviewOut
from app.services.office_host_service import OfficeHostService, OnlyOfficeProvider
from app.utils.helpers import utc_now


def test_onlyoffice_document_key_stays_stable_after_save():
    service = OfficeHostService()
    provider = OnlyOfficeProvider()
    preview = DocumentArtifactPreviewOut(
        title="1003.xlsm",
        download_path="/api/v2/office/mock-download",
        import_supported=True,
    )

    entry = service.create_session(
        kind="alis-workspace",
        key="draft-1003",
        preview=preview,
        can_write=True,
    )

    initial_key = provider._document_key(entry)

    service.update_after_save(
        entry.access_token,
        updated_at=utc_now() + timedelta(seconds=5),
    )

    assert provider._document_key(entry) == initial_key


@pytest.mark.asyncio
async def test_onlyoffice_callback_downloads_workbook_and_applies(monkeypatch):
    preview = DocumentArtifactPreviewOut(
        title="1003.xlsm",
        download_path="/api/v2/office/mock-download",
        import_supported=True,
    )
    entry = v2.office_host_service.create_session(
        kind="alis-workspace",
        key="draft-1003",
        preview=preview,
        can_write=True,
    )
    captured: dict[str, object] = {}

    class FakeRequest:
        async def json(self) -> dict[str, object]:
            return {
                "status": 2,
                "url": "http://onlyoffice.test/download.xlsx",
            }

    class FakeResponse:
        content = b"workbook-bytes"

        def raise_for_status(self) -> None:
            return None

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            captured["client_timeout"] = kwargs.get("timeout")

        async def __aenter__(self) -> "FakeAsyncClient":
            return self

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

        async def get(self, url: str) -> FakeResponse:
            captured["download_url"] = url
            return FakeResponse()

    class FakeDb:
        async def commit(self) -> None:
            captured["committed"] = True

        async def rollback(self) -> None:
            captured["rolled_back"] = True

    async def fake_office_artifact_record_or_404(db, access_token: str):
        assert access_token == entry.access_token
        return entry, SimpleNamespace()

    async def fake_apply_office_session_content(db, *, entry, workbook_bytes: bytes) -> None:
        captured["applied_token"] = entry.access_token
        captured["workbook_bytes"] = workbook_bytes

    async def fake_get_artifact_record(db, artifact_key: str):
        captured["artifact_key"] = artifact_key
        return SimpleNamespace(updated_at=utc_now())

    def fake_verify_onlyoffice_callback_token(request, payload: dict) -> None:
        assert payload["status"] == 2
        assert payload["url"] == "http://onlyoffice.test/download.xlsx"

    monkeypatch.setattr(v2, "_office_artifact_record_or_404", fake_office_artifact_record_or_404)
    monkeypatch.setattr(v2, "_apply_office_session_content", fake_apply_office_session_content)
    monkeypatch.setattr(v2, "_verify_onlyoffice_callback_token", fake_verify_onlyoffice_callback_token)
    monkeypatch.setattr(v2, "get_artifact_record", fake_get_artifact_record)
    monkeypatch.setattr(v2.httpx, "AsyncClient", FakeAsyncClient)

    try:
        result = await v2.post_onlyoffice_callback_v2(
            entry.access_token,
            FakeRequest(),
            FakeDb(),
        )
    finally:
        v2.office_host_service._sessions.pop(entry.access_token, None)

    assert result == {"error": 0}
    assert captured["client_timeout"] == 60.0
    assert captured["download_url"] == "http://onlyoffice.test/download.xlsx"
    assert captured["workbook_bytes"] == b"workbook-bytes"
    assert captured["artifact_key"] == (entry.artifact_key or "")
    assert captured["committed"] is True
    assert "rolled_back" not in captured
