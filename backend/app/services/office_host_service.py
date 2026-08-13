from __future__ import annotations

import asyncio
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote, urlsplit, urlunsplit
from xml.etree import ElementTree

import httpx
from jose import jwt

from app.config import get_settings, resolve_desktop_onlyoffice_jwt_secret
from app.schemas.document_artifact import DocumentArtifactPreviewOut, OfficeRuntimeStatusOut
from app.utils.helpers import utc_now


@dataclass(slots=True)
class OfficeSessionEntry:
    access_token: str
    document_key: str
    kind: str
    key: str
    provider: str
    provider_label: str
    provider_branding_level: str
    title: str
    subtitle: str | None
    module_route: str | None
    fallback_route: str
    download_path: str
    artifact_key: str | None
    file_name: str
    mime_type: str
    can_write: bool
    import_supported: bool
    updated_at: datetime
    expires_at: datetime
    artifact_revision: int = 0
    launch_revision: int = 0
    workspace_launch_revision: int | None = None
    workspace_applied_revision: int | None = None
    lock_value: str | None = None
    lock_expires_at: datetime | None = None
    last_saved_at: datetime | None = None
    live_sync_state: str = "idle"
    last_sync_error: str | None = None
    last_forcesave_requested_at: datetime | None = None
    last_callback_received_at: datetime | None = None
    last_applied_artifact_updated_at: datetime | None = None
    last_requested_save_id: int = 0
    last_applied_save_id: int = 0

    @property
    def version(self) -> str:
        return str(self.artifact_revision)


@dataclass(slots=True)
class OfficeProviderRuntime:
    provider: str
    provider_label: str
    provider_branding_level: str
    runtime_available: bool
    discovery_cached: bool
    last_discovery_checked_at: datetime | None
    runtime_url: str
    wopi_base_url: str
    callback_base_url: str | None = None
    reason: str | None = None


class OfficeProvider(Protocol):
    provider: str
    provider_label: str
    provider_branding_level: str

    async def build_launch(self, *, entry: OfficeSessionEntry) -> "OfficeProviderLaunch": ...
    async def is_available(self) -> bool: ...
    async def runtime_status(self) -> OfficeProviderRuntime: ...


@dataclass(slots=True)
class OfficeProviderLaunch:
    launch_mode: str
    office_available: bool
    office_reason: str | None = None
    editor_url: str | None = None
    onlyoffice_api_js_url: str | None = None
    onlyoffice_document_server_url: str | None = None
    onlyoffice_config: dict[str, Any] | None = None


@dataclass(slots=True)
class OfficeProviderForceSaveResult:
    accepted: bool
    state: str
    detail: str | None = None
    save_id: int | None = None


class EmbeddedOfficeProvider:
    """Desktop-local provider used when no Docker office service is present.

    The actual workbook surface is the controlled grid/Excel bridge exposed by
    ``/api/v2/document-artifacts`` and ``/api/v2/excel-sessions``.  Keeping a
    provider object here preserves the legacy office status/session contract
    for callers that still probe ``/office-runtime`` while making the
    Dockerless path deterministic and network-free.
    """

    provider = "embedded"
    provider_label = "Sero Guld Embedded Workbook"
    provider_branding_level = "native-local"

    async def build_launch(self, *, entry: OfficeSessionEntry) -> OfficeProviderLaunch:
        return OfficeProviderLaunch(
            launch_mode="embedded-grid",
            office_available=True,
            office_reason=None,
        )

    async def is_available(self) -> bool:
        return True

    async def runtime_status(self) -> OfficeProviderRuntime:
        now = utc_now()
        return OfficeProviderRuntime(
            provider=self.provider,
            provider_label=self.provider_label,
            provider_branding_level=self.provider_branding_level,
            runtime_available=True,
            discovery_cached=True,
            last_discovery_checked_at=now,
            runtime_url="embedded://local",
            wopi_base_url="embedded://local",
            callback_base_url=None,
        )


class CollaboraOfficeProvider:
    provider = "collabora"
    provider_label = "Collabora / LibreOffice"
    provider_branding_level = "vendor-dev-branding"

    def __init__(self) -> None:
        self._discovery_actions: dict[tuple[str, str], str] = {}
        self._discovery_checked_at: datetime | None = None

    async def build_launch(self, *, entry: OfficeSessionEntry) -> OfficeProviderLaunch:
        settings = get_settings()
        wopi_src = f"{settings.office_wopi_base_url.rstrip('/')}/api/v2/office/wopi/files/{entry.access_token}"
        ext = Path(entry.file_name).suffix.lower().lstrip(".") or "xlsx"
        action_names = ["edit", "view"] if entry.can_write else ["view", "edit"]
        urlsrc = await self._discovery_url(ext=ext, action_names=action_names)
        return OfficeProviderLaunch(
            launch_mode="wopi-iframe",
            office_available=True,
            editor_url=self._bind_wopi_src(urlsrc, wopi_src),
        )

    async def is_available(self) -> bool:
        try:
            await self._load_discovery_actions()
        except Exception:
            return False
        return True

    async def runtime_status(self) -> OfficeProviderRuntime:
        settings = get_settings()
        reason: str | None = None
        try:
            await self._load_discovery_actions()
            available = True
        except Exception as exc:
            available = False
            reason = str(exc)
        return OfficeProviderRuntime(
            provider=self.provider,
            provider_label=self.provider_label,
            provider_branding_level=self.provider_branding_level,
            runtime_available=available,
            discovery_cached=bool(self._discovery_actions),
            last_discovery_checked_at=self._discovery_checked_at,
            runtime_url=settings.office_runtime_url,
            wopi_base_url=settings.office_wopi_base_url,
            callback_base_url=settings.office_wopi_base_url,
            reason=reason,
        )

    async def _discovery_url(self, *, ext: str, action_names: list[str]) -> str:
        actions = await self._load_discovery_actions()
        extension_candidates = [ext]
        if ext == "xlsm":
            extension_candidates.append("xlsx")
        for candidate_ext in extension_candidates:
            for action_name in action_names:
                urlsrc = actions.get((candidate_ext, action_name))
                if urlsrc:
                    return urlsrc
        raise RuntimeError(f"Office runtime {ext} için uygun action döndürmedi")

    async def _load_discovery_actions(self) -> dict[tuple[str, str], str]:
        now = utc_now()
        if self._discovery_actions and self._discovery_checked_at and now - self._discovery_checked_at < timedelta(hours=1):
            return self._discovery_actions

        settings = get_settings()
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{settings.office_runtime_url.rstrip('/')}/hosting/discovery")
            response.raise_for_status()
        root = ElementTree.fromstring(response.text)
        actions: dict[tuple[str, str], str] = {}
        for node in root.iter():
            if not node.tag.endswith("action"):
                continue
            ext = str(node.attrib.get("ext") or "").strip().lower()
            name = str(node.attrib.get("name") or "").strip().lower()
            urlsrc = str(node.attrib.get("urlsrc") or "").strip()
            if not ext or not name or not urlsrc:
                continue
            actions[(ext, name)] = urlsrc
        if not actions:
            raise RuntimeError("Office discovery boş döndü")
        self._discovery_actions = actions
        self._discovery_checked_at = now
        return actions

    def _bind_wopi_src(self, urlsrc: str, wopi_src: str) -> str:
        cleaned = re.sub(r"<[^>]+>", "", urlsrc)
        runtime_origin = urlsplit(get_settings().office_runtime_url.rstrip("/"))
        current_parts = urlsplit(cleaned)
        cleaned = urlunsplit(
            (
                runtime_origin.scheme or current_parts.scheme,
                runtime_origin.netloc or current_parts.netloc,
                current_parts.path,
                current_parts.query,
                current_parts.fragment,
            )
        )
        encoded = quote(wopi_src, safe="")
        if "WOPISrc=" in cleaned:
            return re.sub(r"WOPISrc=[^&]*", f"WOPISrc={encoded}", cleaned, count=1)
        separator = "&" if "?" in cleaned else "?"
        return f"{cleaned}{separator}WOPISrc={encoded}"


class OnlyOfficeProvider:
    provider = "onlyoffice"
    provider_label = "ONLYOFFICE Community"
    provider_branding_level = "community-open-source"

    def __init__(self) -> None:
        self._last_checked_at: datetime | None = None
        self._last_available: bool = False
        self._last_reason: str | None = None

    async def build_launch(self, *, entry: OfficeSessionEntry) -> OfficeProviderLaunch:
        settings = get_settings()
        await self._check_health()
        document_server_url = settings.onlyoffice_runtime_url.rstrip("/")
        callback_base_url = settings.onlyoffice_callback_base_url.rstrip("/")
        ext = Path(entry.file_name).suffix.lower().lstrip(".") or "xlsx"
        download_url = f"{callback_base_url}/api/v2/office/onlyoffice/files/{entry.access_token}/download"
        callback_url = f"{callback_base_url}/api/v2/office/onlyoffice/callback/{entry.access_token}"
        config: dict[str, Any] = {
            "documentType": "cell",
            "type": "desktop",
            "document": {
                "fileType": ext,
                "key": self._document_key(entry),
                "title": entry.file_name,
                "url": download_url,
                "permissions": {
                    "edit": entry.can_write,
                    "download": True,
                    "print": True,
                    "comment": entry.can_write,
                    "review": False,
                    "copy": True,
                    "chat": False,
                },
            },
            "editorConfig": {
                "mode": "edit" if entry.can_write else "view",
                "lang": "tr",
                "callbackUrl": callback_url,
                "user": {
                    "id": "seroguld-admin",
                    "name": "Sero Guld Admin",
                },
                "customization": {
                    "compactHeader": True,
                    "compactToolbar": False,
                    "forcesave": entry.can_write,
                    "toolbarNoTabs": False,
                    "autosave": True,
                    "zoom": 50 if entry.kind == "depolama" else 140 if entry.kind in {"alis-workspace", "alis-document"} else 100,
                },
            },
        }
        token = jwt.encode(
            config,
            resolve_desktop_onlyoffice_jwt_secret(settings.onlyoffice_jwt_secret),
            algorithm="HS256",
        )
        config["token"] = token
        return OfficeProviderLaunch(
            launch_mode="onlyoffice-docs-api",
            office_available=True,
            onlyoffice_api_js_url=f"{document_server_url}/web-apps/apps/api/documents/api.js",
            onlyoffice_document_server_url=document_server_url,
            onlyoffice_config=config,
        )

    async def is_available(self) -> bool:
        try:
            await self._check_health()
        except Exception:
            return False
        return True

    async def runtime_status(self) -> OfficeProviderRuntime:
        settings = get_settings()
        reason: str | None = None
        try:
            available = await self._check_health()
        except Exception as exc:
            available = False
            reason = str(exc)
        return OfficeProviderRuntime(
            provider=self.provider,
            provider_label=self.provider_label,
            provider_branding_level=self.provider_branding_level,
            runtime_available=available,
            discovery_cached=self._last_checked_at is not None,
            last_discovery_checked_at=self._last_checked_at,
            runtime_url=settings.onlyoffice_runtime_url,
            wopi_base_url=settings.onlyoffice_callback_base_url,
            callback_base_url=settings.onlyoffice_callback_base_url,
            reason=reason,
        )

    async def force_save(
        self,
        *,
        entry: OfficeSessionEntry,
        save_id: int | None = None,
    ) -> OfficeProviderForceSaveResult:
        settings = get_settings()
        await self._check_health()
        requested_save_id = int(save_id if save_id is not None else entry.last_requested_save_id)
        payload = {
            "c": "forcesave",
            "key": self._document_key(entry),
            "userdata": f"{entry.kind}:{entry.key}:{requested_save_id}",
        }
        token = jwt.encode(
            payload,
            resolve_desktop_onlyoffice_jwt_secret(settings.onlyoffice_jwt_secret),
            algorithm="HS256",
        )
        command_url = f"{settings.onlyoffice_runtime_url.rstrip('/')}/coauthoring/CommandService.ashx"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                command_url,
                json={**payload, "token": token},
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            command_result = response.json() if response.content else {}

        error_code = int(command_result.get("error") or 0)
        if error_code == 0:
            return OfficeProviderForceSaveResult(
                accepted=True,
                state="queued",
                save_id=requested_save_id,
            )
        if error_code == 4:
            return OfficeProviderForceSaveResult(
                accepted=True,
                state="noop",
                detail="Kaydedilecek yeni Excel değişikliği bulunamadı.",
                save_id=requested_save_id,
            )
        return OfficeProviderForceSaveResult(
            accepted=False,
            state="rejected",
            detail=f"ONLYOFFICE forcesave hata kodu: {error_code}",
        )

    async def _check_health(self) -> bool:
        now = utc_now()
        if self._last_checked_at and now - self._last_checked_at < timedelta(seconds=30):
            if self._last_available:
                return True
            raise RuntimeError(self._last_reason or "ONLYOFFICE runtime ulaşılabilir değil")

        settings = get_settings()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{settings.onlyoffice_runtime_url.rstrip('/')}/healthcheck")
                response.raise_for_status()
        except Exception as exc:
            self._last_checked_at = now
            self._last_available = False
            self._last_reason = str(exc)
            raise
        self._last_checked_at = now
        self._last_available = True
        self._last_reason = None
        return True

    def _document_key(self, entry: OfficeSessionEntry) -> str:
        return entry.document_key


class OfficeHostService:
    def __init__(self) -> None:
        self._sessions: dict[str, OfficeSessionEntry] = {}
        self._callback_locks: dict[str, asyncio.Lock] = {}
        self._providers = self._build_providers()

    def _build_providers(self) -> dict[str, OfficeProvider]:
        return {
            "embedded": EmbeddedOfficeProvider(),
            "collabora": CollaboraOfficeProvider(),
            "onlyoffice": OnlyOfficeProvider(),
        }

    def _provider_name_for_kind(self, kind: str) -> str:
        settings = get_settings()
        if kind in {"alis-workspace", "alis-document"}:
            return settings.office_provider_afg.strip().lower() or settings.office_provider_default.strip().lower()
        if kind == "depolama":
            return settings.office_provider_depolama.strip().lower() or settings.office_provider_default.strip().lower()
        if kind == "log":
            return settings.office_provider_log.strip().lower() or settings.office_provider_default.strip().lower()
        return settings.office_provider_default.strip().lower()

    def _provider_for_kind(self, kind: str) -> OfficeProvider:
        provider_name = self._provider_name_for_kind(kind)
        provider = self._providers.get(provider_name)
        if provider is None:
            raise RuntimeError(f"Desteklenmeyen office provider: {provider_name}")
        return provider

    def _prune(self) -> None:
        now = utc_now()
        expired = [token for token, entry in self._sessions.items() if entry.expires_at <= now]
        for token in expired:
            self._sessions.pop(token, None)
            self._callback_locks.pop(token, None)

    def create_session(
        self,
        *,
        kind: str,
        key: str,
        preview: DocumentArtifactPreviewOut,
        can_write: bool,
    ) -> OfficeSessionEntry:
        self._prune()
        settings = get_settings()
        provider = self._provider_for_kind(kind)
        token = secrets.token_urlsafe(24)
        artifact = preview.artifact
        workspace_revision = getattr(preview, "workspace_revision", None)
        workspace_revision = int(workspace_revision) if workspace_revision is not None else None
        file_name = artifact.file_name if artifact else f"{kind}-{key}{Path(preview.download_path).suffix or '.xlsx'}"
        mime_type = artifact.mime_type if artifact else "application/octet-stream"
        entry = OfficeSessionEntry(
            access_token=token,
            document_key=secrets.token_hex(20),
            kind=kind,
            key=key,
            provider=provider.provider,
            provider_label=provider.provider_label,
            provider_branding_level=provider.provider_branding_level,
            title=preview.title,
            subtitle=preview.subtitle,
            module_route=preview.module_route,
            fallback_route=f"/excel-preview/{kind}/{key}",
            download_path=preview.download_path,
            artifact_key=artifact.artifact_key if artifact else None,
            file_name=file_name,
            mime_type=mime_type,
            can_write=can_write,
            import_supported=can_write and preview.import_supported,
            updated_at=artifact.updated_at if artifact else utc_now(),
            expires_at=utc_now() + timedelta(seconds=settings.office_session_ttl_seconds),
            artifact_revision=int(getattr(artifact, "revision", 0) or 0),
            launch_revision=int(getattr(artifact, "revision", 0) or 0),
            workspace_launch_revision=workspace_revision,
            workspace_applied_revision=workspace_revision,
        )
        self._sessions[token] = entry
        return entry

    def get_session(self, access_token: str | None) -> OfficeSessionEntry | None:
        if not access_token:
            return None
        self._prune()
        entry = self._sessions.get(access_token)
        if entry is None:
            return None
        entry.expires_at = utc_now() + timedelta(seconds=get_settings().office_session_ttl_seconds)
        return entry

    def update_after_save(
        self,
        access_token: str,
        *,
        updated_at: datetime | None = None,
        revision: int | None = None,
        save_id: int | None = None,
        workspace_revision: int | None = None,
    ) -> OfficeSessionEntry | None:
        entry = self.get_session(access_token)
        if entry is None:
            return None
        now = updated_at or utc_now()
        entry.updated_at = now
        entry.last_saved_at = now
        entry.last_applied_artifact_updated_at = now
        if revision is not None:
            entry.artifact_revision = int(revision)
        if save_id is not None:
            entry.last_applied_save_id = max(entry.last_applied_save_id, int(save_id))
        if workspace_revision is not None:
            entry.workspace_applied_revision = int(workspace_revision)
        entry.live_sync_state = "applied"
        entry.last_sync_error = None
        return entry

    def mark_forcesave_requested(self, access_token: str) -> OfficeSessionEntry | None:
        entry = self.get_session(access_token)
        if entry is None:
            return None
        entry.last_forcesave_requested_at = utc_now()
        entry.last_requested_save_id += 1
        entry.live_sync_state = "syncing"
        entry.last_sync_error = None
        return entry

    def mark_callback_received(self, access_token: str) -> OfficeSessionEntry | None:
        entry = self.get_session(access_token)
        if entry is None:
            return None
        entry.last_callback_received_at = utc_now()
        return entry

    def callback_lock(self, access_token: str) -> asyncio.Lock:
        """Serialize callbacks for one OnlyOffice document session.

        OnlyOffice can deliver force-save callbacks out of order.  Keeping the
        lock in the host service makes the apply/check/update sequence one
        critical section without sharing a database transaction across HTTP
        requests.
        """
        self._prune()
        return self._callback_locks.setdefault(access_token, asyncio.Lock())

    def mark_sync_rejected(self, access_token: str, detail: str | None) -> OfficeSessionEntry | None:
        entry = self.get_session(access_token)
        if entry is None:
            return None
        entry.live_sync_state = "rejected"
        entry.last_sync_error = detail
        return entry

    def mark_sync_error(self, access_token: str, detail: str | None) -> OfficeSessionEntry | None:
        entry = self.get_session(access_token)
        if entry is None:
            return None
        entry.live_sync_state = "error"
        entry.last_sync_error = detail
        return entry

    def mark_sync_noop(self, access_token: str, detail: str | None = None) -> OfficeSessionEntry | None:
        entry = self.get_session(access_token)
        if entry is None:
            return None
        entry.live_sync_state = "applied"
        entry.last_sync_error = detail
        return entry

    def live_sync_status(self, access_token: str | None, *, kind: str, key: str) -> tuple[str, str | None, datetime | None]:
        entry = self.get_session(access_token)
        if entry is None or entry.kind != kind or entry.key != key:
            return "idle", None, None
        return entry.live_sync_state, entry.last_sync_error, entry.last_callback_received_at

    def handle_lock(self, access_token: str, *, override: str, lock_value: str | None) -> tuple[bool, str | None]:
        entry = self.get_session(access_token)
        if entry is None or not entry.can_write:
            return False, None

        current_lock = entry.lock_value
        action = override.upper()
        if action == "LOCK":
            if current_lock and current_lock != lock_value:
                return False, current_lock
            entry.lock_value = lock_value or ""
            entry.lock_expires_at = utc_now() + timedelta(minutes=30)
            return True, entry.lock_value
        if action == "REFRESH_LOCK":
            if current_lock != (lock_value or ""):
                return False, current_lock
            entry.lock_expires_at = utc_now() + timedelta(minutes=30)
            return True, current_lock
        if action == "UNLOCK":
            if current_lock != (lock_value or ""):
                return False, current_lock
            entry.lock_value = None
            entry.lock_expires_at = None
            return True, None
        if action == "GET_LOCK":
            return True, current_lock
        return False, current_lock

    async def build_launch(self, entry: OfficeSessionEntry) -> OfficeProviderLaunch:
        provider = self._providers.get(entry.provider)
        if provider is None:
            raise RuntimeError(f"Desteklenmeyen office provider: {entry.provider}")
        return await provider.build_launch(entry=entry)

    async def is_available(self, kind: str) -> bool:
        return await self._provider_for_kind(kind).is_available()

    async def runtime_status(self, kind: str | None = None) -> OfficeRuntimeStatusOut:
        provider = self._provider_for_kind(kind or "alis-workspace")
        provider_status = await provider.runtime_status()
        return OfficeRuntimeStatusOut(
            provider=provider_status.provider,
            provider_label=provider_status.provider_label,
            provider_branding_level=provider_status.provider_branding_level,
            runtime_available=provider_status.runtime_available,
            discovery_cached=provider_status.discovery_cached,
            last_discovery_checked_at=provider_status.last_discovery_checked_at,
            runtime_url=provider_status.runtime_url,
            wopi_base_url=provider_status.wopi_base_url,
            callback_base_url=provider_status.callback_base_url,
            reason=provider_status.reason,
        )

    async def force_save(
        self,
        entry: OfficeSessionEntry,
        *,
        save_id: int | None = None,
    ) -> OfficeProviderForceSaveResult:
        provider = self._providers.get(entry.provider)
        if provider is None:
            raise RuntimeError(f"Desteklenmeyen office provider: {entry.provider}")
        if not isinstance(provider, OnlyOfficeProvider):
            raise RuntimeError("Bu office provider canlı forcesave desteklemiyor")
        return await provider.force_save(entry=entry, save_id=save_id)

    def provider_for_kind(self, kind: str) -> str:
        return self._provider_for_kind(kind).provider

    def provider_label_for_kind(self, kind: str) -> str:
        return self._provider_for_kind(kind).provider_label

    def provider_branding_level_for_kind(self, kind: str) -> str:
        return self._provider_for_kind(kind).provider_branding_level


office_host_service = OfficeHostService()
