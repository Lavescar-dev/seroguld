from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from jose import jwt as jose_jwt

from app.api import v2
from app.api import v2_office_runtime as runtime
from app.schemas.document_artifact import DocumentArtifactPreviewOut
from app.services import office_host_service as office_module
from app.services.office_host_service import CollaboraOfficeProvider, OfficeHostService, OnlyOfficeProvider
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
    entry = runtime.office_host_service.create_session(
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
        headers = {"content-length": str(len(b"workbook-bytes"))}

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

    # İndirme allowlist'i yapılandırılmış ONLYOFFICE host'una kilitli; test
    # ortamında host eşleşmesini stub settings ile sağlıyoruz.
    monkeypatch.setattr(
        runtime,
        "get_settings",
        lambda: SimpleNamespace(
            onlyoffice_runtime_url="http://onlyoffice.test:8082",
            onlyoffice_callback_base_url="http://onlyoffice-callback.test:8100",
        ),
    )
    monkeypatch.setattr(runtime, "_office_artifact_record_or_404", fake_office_artifact_record_or_404)
    monkeypatch.setattr(runtime, "_apply_office_session_content", fake_apply_office_session_content)
    monkeypatch.setattr(runtime, "_verify_onlyoffice_callback_token", fake_verify_onlyoffice_callback_token)
    monkeypatch.setattr(runtime, "get_artifact_record", fake_get_artifact_record)
    monkeypatch.setattr(runtime.httpx, "AsyncClient", FakeAsyncClient)

    try:
        result = await runtime.post_onlyoffice_callback_v2(
            entry.access_token,
            FakeRequest(),
            FakeDb(),
        )
    finally:
        runtime.office_host_service._sessions.pop(entry.access_token, None)

    assert result == {"error": 0}
    assert captured["client_timeout"] == 60.0
    assert captured["download_url"] == "http://onlyoffice.test/download.xlsx"
    assert captured["workbook_bytes"] == b"workbook-bytes"
    assert captured["artifact_key"] == (entry.artifact_key or "")
    assert captured["committed"] is True
    assert "rolled_back" not in captured


@pytest.mark.asyncio
async def test_onlyoffice_callback_ignores_older_save_id(monkeypatch):
    preview = DocumentArtifactPreviewOut(
        title="1003.xlsm",
        download_path="/api/v2/office/mock-download",
        import_supported=True,
    )
    entry = runtime.office_host_service.create_session(
        kind="alis-workspace",
        key="draft-1003",
        preview=preview,
        can_write=True,
    )
    entry.last_applied_save_id = 2
    applied = False

    class FakeRequest:
        async def json(self) -> dict[str, object]:
            return {
                "status": 2,
                "url": "http://onlyoffice.test/older.xlsx",
                "userdata": "alis-workspace:draft-1003:1",
            }

    class FakeDb:
        pass

    async def fake_office_artifact_record_or_404(db, access_token: str):
        return entry, SimpleNamespace()

    async def fake_apply_office_session_content(db, *, entry, workbook_bytes: bytes) -> None:
        nonlocal applied
        applied = True

    monkeypatch.setattr(runtime, "_office_artifact_record_or_404", fake_office_artifact_record_or_404)
    monkeypatch.setattr(runtime, "_apply_office_session_content", fake_apply_office_session_content)
    monkeypatch.setattr(runtime, "_verify_onlyoffice_callback_token", lambda request, payload: None)

    try:
        result = await runtime.post_onlyoffice_callback_v2(entry.access_token, FakeRequest(), FakeDb())
    finally:
        runtime.office_host_service._sessions.pop(entry.access_token, None)

    assert result == {"error": 0}
    assert applied is False


def test_onlyoffice_download_host_allowlist(monkeypatch):
    monkeypatch.setattr(
        runtime,
        "get_settings",
        lambda: SimpleNamespace(
            onlyoffice_runtime_url="http://onlyoffice.test:8082",
            onlyoffice_callback_base_url="http://onlyoffice-callback.test:8100",
        ),
    )
    assert runtime._onlyoffice_download_host_allowed("http://onlyoffice.test/download.xlsx")
    assert runtime._onlyoffice_download_host_allowed("https://onlyoffice-callback.test/x.xlsx")
    assert not runtime._onlyoffice_download_host_allowed("http://169.254.169.254/latest/meta-data")
    assert not runtime._onlyoffice_download_host_allowed("file:///etc/passwd")
    assert not runtime._onlyoffice_download_host_allowed("http://onlyoffice.test.evil.example/x.xlsx")

    # Yapılandırma boşken yalnız şema+host varlığı beklenir (JWT ana savunma).
    monkeypatch.setattr(
        runtime,
        "get_settings",
        lambda: SimpleNamespace(onlyoffice_runtime_url="", onlyoffice_callback_base_url=""),
    )
    assert runtime._onlyoffice_download_host_allowed("http://any-configured-host.test/x.xlsx")


@pytest.mark.asyncio
async def test_onlyoffice_callback_rejects_foreign_download_host(monkeypatch):
    """SSRF savunması: allowlist dışı URL apply akışına hiç girmemeli."""

    preview = DocumentArtifactPreviewOut(
        title="1003.xlsm",
        download_path="/api/v2/office/mock-download",
        import_supported=True,
    )
    entry = runtime.office_host_service.create_session(
        kind="alis-workspace",
        key="draft-1003",
        preview=preview,
        can_write=True,
    )
    applied = False
    downloaded = False

    class FakeRequest:
        async def json(self) -> dict[str, object]:
            return {"status": 2, "url": "http://169.254.169.254/latest/meta-data"}

    class FakeDb:
        async def commit(self) -> None:
            raise AssertionError("apply olmadan commit yapılmamalı")

        async def rollback(self) -> None:
            raise AssertionError("işlem başlamadan rollback yapılmamalı")

    async def fake_office_artifact_record_or_404(db, access_token: str):
        return entry, SimpleNamespace()

    async def fake_apply_office_session_content(db, *, entry, workbook_bytes: bytes) -> None:
        nonlocal applied
        applied = True

    class FailingAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            nonlocal downloaded
            downloaded = True
            return self

        async def __aexit__(self, *exc_info) -> bool:
            return False

    monkeypatch.setattr(
        runtime,
        "get_settings",
        lambda: SimpleNamespace(
            onlyoffice_runtime_url="http://onlyoffice.test:8082",
            onlyoffice_callback_base_url="",
        ),
    )
    monkeypatch.setattr(runtime, "_office_artifact_record_or_404", fake_office_artifact_record_or_404)
    monkeypatch.setattr(runtime, "_apply_office_session_content", fake_apply_office_session_content)
    monkeypatch.setattr(runtime, "_verify_onlyoffice_callback_token", lambda request, payload: None)
    monkeypatch.setattr(runtime.httpx, "AsyncClient", FailingAsyncClient)

    try:
        result = await runtime.post_onlyoffice_callback_v2(entry.access_token, FakeRequest(), FakeDb())
    finally:
        runtime.office_host_service._sessions.pop(entry.access_token, None)

    assert result == {"error": 1}
    assert downloaded is False
    assert applied is False


@pytest.mark.asyncio
async def test_onlyoffice_callback_survives_malformed_body_and_status(monkeypatch):
    """Bozuk gövde 500 değil DS hata sözleşmesiyle; geçersiz status apply tetiklemez."""

    preview = DocumentArtifactPreviewOut(
        title="1003.xlsm",
        download_path="/api/v2/office/mock-download",
        import_supported=True,
    )
    entry = runtime.office_host_service.create_session(
        kind="alis-workspace",
        key="draft-1003",
        preview=preview,
        can_write=True,
    )
    applied = False

    class BrokenJsonRequest:
        async def json(self) -> dict[str, object]:
            raise ValueError("bozuk gövde")

    class InvalidStatusRequest:
        async def json(self) -> dict[str, object]:
            return {"status": "iki", "url": "http://onlyoffice.test/x.xlsx"}

    class FakeDb:
        async def commit(self) -> None:
            raise AssertionError("apply olmadan commit yapılmamalı")

        async def rollback(self) -> None:
            raise AssertionError("işlem başlamadan rollback yapılmamalı")

    async def fake_office_artifact_record_or_404(db, access_token: str):
        return entry, SimpleNamespace()

    async def fake_apply_office_session_content(db, *, entry, workbook_bytes: bytes) -> None:
        nonlocal applied
        applied = True

    monkeypatch.setattr(runtime, "_office_artifact_record_or_404", fake_office_artifact_record_or_404)
    monkeypatch.setattr(runtime, "_apply_office_session_content", fake_apply_office_session_content)
    monkeypatch.setattr(runtime, "_verify_onlyoffice_callback_token", lambda request, payload: None)

    try:
        broken_result = await runtime.post_onlyoffice_callback_v2(
            entry.access_token, BrokenJsonRequest(), FakeDb()
        )
        invalid_status_result = await runtime.post_onlyoffice_callback_v2(
            entry.access_token, InvalidStatusRequest(), FakeDb()
        )
    finally:
        runtime.office_host_service._sessions.pop(entry.access_token, None)

    assert broken_result == {"error": 1}
    assert invalid_status_result == {"error": 0}
    assert applied is False


@pytest.mark.asyncio
async def test_collabora_discovery_network_error_becomes_runtime_error(monkeypatch):
    """Discovery httpx hatası ham fırlamaz — dosyanın RuntimeError sözleşmesine çevrilir."""

    class FailingAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def get(self, *args, **kwargs):
            raise httpx.ConnectError("runtime kapalı")

    monkeypatch.setattr(office_module.httpx, "AsyncClient", FailingAsyncClient)
    monkeypatch.setattr(
        office_module,
        "get_settings",
        lambda: SimpleNamespace(office_runtime_url="http://office.invalid/"),
    )

    provider = CollaboraOfficeProvider()
    with pytest.raises(RuntimeError, match="discovery'ye ulaşılamadı"):
        await provider._load_discovery_actions()


# --- ONLYOFFICE callback token doğrulaması (token zorunlu + claim bağı) -----


def _callback_request(authorization: str | None) -> SimpleNamespace:
    headers = {"authorization": authorization} if authorization is not None else {}
    return SimpleNamespace(headers=headers)


def _signed_callback(secret: str, claims: dict) -> str:
    return jose_jwt.encode({"payload": claims}, secret, algorithm="HS256")


@pytest.fixture
def onlyoffice_secret(monkeypatch: pytest.MonkeyPatch) -> str:
    secret = "onlyoffice-test-secret-0123456789abcdef"
    monkeypatch.setattr(v2, "get_settings", lambda: SimpleNamespace(onlyoffice_jwt_secret=secret))
    monkeypatch.setattr(v2, "resolve_desktop_onlyoffice_jwt_secret", lambda configured: configured)
    return secret


def test_onlyoffice_callback_without_token_is_rejected(onlyoffice_secret: str) -> None:
    with pytest.raises(HTTPException) as excinfo:
        v2._verify_onlyoffice_callback_token(_callback_request(None), {"status": 2})
    assert excinfo.value.status_code == 401


def test_onlyoffice_callback_with_empty_secret_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(v2, "get_settings", lambda: SimpleNamespace(onlyoffice_jwt_secret=""))
    monkeypatch.setattr(v2, "resolve_desktop_onlyoffice_jwt_secret", lambda configured: configured)
    token = _signed_callback("", {"status": 2})
    with pytest.raises(HTTPException) as excinfo:
        v2._verify_onlyoffice_callback_token(_callback_request(f"Bearer {token}"), {"status": 2})
    assert excinfo.value.status_code == 401


def test_onlyoffice_callback_with_bad_signature_is_rejected(onlyoffice_secret: str) -> None:
    body = {"status": 2, "url": "http://onlyoffice.test/dl.xlsx"}
    forged = _signed_callback("totally-different-secret-value-123456", body)
    with pytest.raises(HTTPException) as excinfo:
        v2._verify_onlyoffice_callback_token(_callback_request(f"Bearer {forged}"), body)
    assert excinfo.value.status_code == 401


def test_onlyoffice_callback_body_must_match_signed_claims(onlyoffice_secret: str) -> None:
    """Çalınan/yeniden kullanılan token'la gövde url'i değiştirilemez."""
    signed = _signed_callback(onlyoffice_secret, {"status": 2, "url": "http://onlyoffice.test/real.xlsx"})
    with pytest.raises(HTTPException) as excinfo:
        v2._verify_onlyoffice_callback_token(
            _callback_request(f"Bearer {signed}"),
            {"status": 2, "url": "http://attacker.test/evil.xlsx"},
        )
    assert excinfo.value.status_code == 401


def test_onlyoffice_callback_valid_signed_body_passes(onlyoffice_secret: str) -> None:
    body = {
        "status": 2,
        "url": "http://onlyoffice.test/dl.xlsx",
        "userdata": "alis-workspace:draft-1:3",
        "key": "doc-key",
    }
    token = _signed_callback(onlyoffice_secret, body)
    v2._verify_onlyoffice_callback_token(_callback_request(f"Bearer {token}"), body)
