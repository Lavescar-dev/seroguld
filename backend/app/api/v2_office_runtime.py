from __future__ import annotations

import logging
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.afg import build_log_workspace
from app.api.deps import require_admin
from app.api.inventory import get_inventory_workspace as get_legacy_inventory_workspace
from app.api.pos import get_pos_document_detail as get_legacy_pos_document_detail
from app.api.v2 import (
    _apply_office_session_content,
    _default_artifact_year,
    _office_artifact_record_or_404,
    _office_launch_sheet_meta,
    _office_preview_for_kind,
    _office_status_for_kind,
    _resolve_office_access_token,
    _verify_onlyoffice_callback_token,
)
from app.config import get_settings
from app.database import get_db
from app.models.enums import PosSessionStatusEnum
from app.models.user import User
from app.schemas.document_artifact import (
    DocumentArtifactPreviewOut,
    OfficeDocumentLaunchOut,
    OfficeDocumentStatusOut,
    OfficeForceSaveOut,
    OfficeRuntimeStatusOut,
)
from app.schemas.pos import PosSessionDisplayOut
from app.services.document_artifact_edit import artifact_mutation_lock
from app.services.document_artifact_service import (
    artifact_absolute_path,
    build_afg_document_preview,
    build_afg_workspace_preview,
    build_inventory_preview,
    build_log_preview,
    get_artifact_record,
)
from app.services.office_host_service import office_host_service
from app.services.pos_service import (
    build_purchase_workspace,
    display_snapshot,
    get_pos_session_by_display_token_or_404,
    get_pos_session_or_404,
)
from app.utils.helpers import utc_now

router = APIRouter()

_logger = logging.getLogger(__name__)

# ONLYOFFICE Document Server geri çağrısıyla indirilebilecek en büyük workbook.
_MAX_CALLBACK_DOWNLOAD_BYTES = 64 * 1024 * 1024


def _onlyoffice_download_host_allowed(url: str) -> bool:
    """Callback indirme URL'sini yalnız yapılandırılmış ONLYOFFICE sunucusuyla sınırla.

    Document Server, callback gövdesindeki ``url`` alanını kendisi üretir; ama
    alan imzalı claim ile eşleşse bile savunma katmanı olarak kaynağın ONLYOFFICE
    kurulumunun kendisi olduğunu zorluyoruz (SSRF: apply akışına keyfi URL
    verilemez).  Yapılandırma boşsa (yalnız geliştirme ortamı) şema+host
    kontrolü ile yetinulur; asıl savunma zorunlu JWT doğrulamasıdır.
    """

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    settings = get_settings()
    allowed_hosts = {
        host.lower()
        for host in (
            urlparse(settings.onlyoffice_runtime_url).hostname,
            urlparse(settings.onlyoffice_callback_base_url).hostname,
        )
        if host
    }
    if not allowed_hosts:
        return True
    return parsed.hostname.lower() in allowed_hosts


@router.get("/office-documents/{kind}/{key}/launch", response_model=OfficeDocumentLaunchOut)
async def get_office_document_launch_v2(
    kind: str,
    key: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> OfficeDocumentLaunchOut:
    preview, can_write = await _office_preview_for_kind(db, kind=kind, key=key, admin=admin)
    entry = office_host_service.create_session(kind=kind, key=key, preview=preview, can_write=can_write)
    try:
        provider_launch = await office_host_service.build_launch(entry)
    except Exception as exc:
        provider_launch = None
        office_reason = str(exc)
        _logger.warning("Office provider launch başarısız, fallback yüzeyine düşüldü", exc_info=True)
    else:
        office_reason = provider_launch.office_reason

    return OfficeDocumentLaunchOut(
        kind=kind,
        key=key,
        launch_mode=provider_launch.launch_mode if provider_launch else "wopi-iframe",
        provider=entry.provider,
        provider_label=entry.provider_label,
        provider_branding_level=entry.provider_branding_level,
        title=preview.title,
        subtitle=preview.subtitle,
        contract_version=preview.contract_version,
        module_route=preview.module_route,
        fallback_route=entry.fallback_route,
        download_path=preview.download_path,
        artifact=preview.artifact,
        can_write=entry.can_write,
        import_supported=entry.import_supported,
        sheets=[_office_launch_sheet_meta(sheet) for sheet in preview.sheets],
        office_available=provider_launch.office_available if provider_launch else False,
        office_reason=office_reason,
        editor_url=provider_launch.editor_url if provider_launch else None,
        access_token=entry.access_token,
        access_token_ttl=int(entry.expires_at.timestamp() * 1000),
        onlyoffice_api_js_url=provider_launch.onlyoffice_api_js_url if provider_launch else None,
        onlyoffice_document_server_url=provider_launch.onlyoffice_document_server_url if provider_launch else None,
        onlyoffice_config=provider_launch.onlyoffice_config if provider_launch else None,
    )


@router.get("/office-documents/{kind}/{key}/status", response_model=OfficeDocumentStatusOut)
async def get_office_document_status_v2(
    kind: str,
    key: str,
    access_token: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> OfficeDocumentStatusOut:
    return await _office_status_for_kind(db, kind=kind, key=key, admin=admin, access_token=access_token)


@router.get("/office-runtime/status", response_model=OfficeRuntimeStatusOut)
async def get_office_runtime_status_v2(
    kind: str | None = Query(default=None),
    _: User = Depends(require_admin),
) -> OfficeRuntimeStatusOut:
    return await office_host_service.runtime_status(kind)


@router.get("/office/wopi/files/{access_token}")
async def get_office_wopi_file_info_v2(
    access_token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    provided_token = _resolve_office_access_token(request)
    if provided_token not in {None, access_token}:
        raise HTTPException(status_code=401, detail="Office access token geçersiz")
    entry, record = await _office_artifact_record_or_404(db, access_token)
    return {
        "BaseFileName": entry.file_name,
        "Size": record.size_bytes,
        "OwnerId": "seroguld",
        "UserId": "admin",
        "UserFriendlyName": "Sero Guld Admin",
        "Version": entry.version,
        "UserCanWrite": entry.can_write,
        "ReadOnly": not entry.can_write,
        "SupportsLocks": entry.can_write,
        "SupportsUpdate": entry.can_write,
        "SupportsRename": False,
        "DisablePrint": False,
        "DisableExport": False,
    }


@router.post("/office/wopi/files/{access_token}")
async def post_office_wopi_file_operation_v2(
    access_token: str,
    request: Request,
) -> Response:
    provided_token = _resolve_office_access_token(request)
    if provided_token not in {None, access_token}:
        raise HTTPException(status_code=401, detail="Office access token geçersiz")
    override = request.headers.get("X-WOPI-Override", "").strip().upper()
    if not override:
        return Response(status_code=200)
    lock_value = request.headers.get("X-WOPI-Lock")
    success, current_lock = office_host_service.handle_lock(access_token, override=override, lock_value=lock_value)
    if success:
        headers = {"X-WOPI-Lock": current_lock} if current_lock is not None else {}
        return Response(status_code=200, headers=headers)
    headers = {"X-WOPI-Lock": current_lock} if current_lock else {}
    return Response(status_code=409, headers=headers)


@router.get("/office/wopi/files/{access_token}/contents")
async def get_office_wopi_file_contents_v2(
    access_token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    provided_token = _resolve_office_access_token(request)
    if provided_token not in {None, access_token}:
        raise HTTPException(status_code=401, detail="Office access token geçersiz")
    _, record = await _office_artifact_record_or_404(db, access_token)
    return Response(content=artifact_absolute_path(record).read_bytes(), media_type=record.mime_type)


@router.api_route("/office/wopi/files/{access_token}/contents", methods=["POST", "PUT"])
async def put_office_wopi_file_contents_v2(
    access_token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response:
    provided_token = _resolve_office_access_token(request)
    if provided_token not in {None, access_token}:
        raise HTTPException(status_code=401, detail="Office access token geçersiz")
    entry, record = await _office_artifact_record_or_404(db, access_token)
    if not entry.can_write:
        return Response(status_code=409)

    override = request.headers.get("X-WOPI-Override", "").strip().upper()
    if request.method == "POST" and override and override != "PUT":
        return Response(status_code=200)

    if entry.lock_value:
        request_lock = request.headers.get("X-WOPI-Lock")
        if request_lock != entry.lock_value:
            return Response(status_code=409, headers={"X-WOPI-Lock": entry.lock_value})

    current_version = str(getattr(record, "revision", 1))
    if current_version != entry.version:
        return Response(status_code=409)

    content = await request.body()
    # Grid PATCH ile aynı sözleşmeyi paylaş: revision kontrolü ve apply tek
    # artifact kilidi altında, yoksa WOPI yazması grid düzenlemesini ezebilir.
    async with artifact_mutation_lock(entry.kind, entry.key):
        workspace = await _apply_office_session_content(db, entry=entry, workbook_bytes=content)
        await db.commit()

    record = await get_artifact_record(db, entry.artifact_key or "")
    office_host_service.update_after_save(
        access_token,
        updated_at=record.updated_at if record else utc_now(),
        revision=getattr(record, "revision", None) if record else None,
        workspace_revision=getattr(workspace, "workspace_revision", None),
    )
    return Response(status_code=200)


@router.get("/office/onlyoffice/files/{access_token}/download")
async def get_onlyoffice_file_download_v2(
    access_token: str,
    db: AsyncSession = Depends(get_db),
) -> Response:
    _, record = await _office_artifact_record_or_404(db, access_token)
    return Response(content=artifact_absolute_path(record).read_bytes(), media_type=record.mime_type)


@router.post("/office/onlyoffice/callback/{access_token}")
async def post_onlyoffice_callback_v2(
    access_token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    entry, _ = await _office_artifact_record_or_404(db, access_token)
    try:
        payload = await request.json()
    except Exception:
        # Bozuk gövde 500 değil, Document Server'ın anladığı hata sözleşmesi.
        _logger.warning("ONLYOFFICE callback gövdesi ayrıştırılamadı", exc_info=True)
        return {"error": 1}
    _verify_onlyoffice_callback_token(request, payload)
    save_id: int | None = None
    raw_userdata = str(payload.get("userdata") or "").strip()
    if raw_userdata:
        try:
            save_id = int(raw_userdata.rsplit(":", 1)[-1])
        except (TypeError, ValueError):
            save_id = None

    try:
        status = int(payload.get("status") or 0)
    except (TypeError, ValueError):
        # Kayıt olayı taşımayan/bozuk status yalnız onaylanır; apply denenmez.
        _logger.warning("ONLYOFFICE callback status alanı geçersiz; apply atlandı")
        return {"error": 0}
    if not entry.can_write or status not in {2, 6}:
        return {"error": 0}

    async with office_host_service.callback_lock(access_token):
        entry = office_host_service.get_session(access_token)
        if entry is None:
            return {"error": 1}
        office_host_service.mark_callback_received(access_token)
        if save_id is not None and save_id <= entry.last_applied_save_id:
            # An older callback arrived after a newer snapshot was already
            # applied.  Acknowledge it without applying its stale bytes.
            return {"error": 0}

        download_url = str(payload.get("url") or "").strip()
        if not download_url:
            office_host_service.mark_sync_error(access_token, "ONLYOFFICE callback URL eksik")
            return {"error": 1}
        if not _onlyoffice_download_host_allowed(download_url):
            # SSRF savunması: apply akışına yalnız ONLYOFFICE sunucusunun
            # kendisi kaynak olabilir (bkz. _onlyoffice_download_host_allowed).
            _logger.warning("ONLYOFFICE callback allowlist dışı indirme URL'si reddedildi")
            office_host_service.mark_sync_error(
                access_token,
                "ONLYOFFICE callback URL yalnız yapılandırılmış ONLYOFFICE sunucusuna izin verir",
            )
            return {"error": 1}

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.get(download_url)
                response.raise_for_status()
                declared_length = response.headers.get("content-length")
                if declared_length and declared_length.isdigit() and int(declared_length) > _MAX_CALLBACK_DOWNLOAD_BYTES:
                    raise ValueError("ONLYOFFICE indirmesi boyut sınırını aşıyor")
                workbook_bytes = response.content
                if len(workbook_bytes) > _MAX_CALLBACK_DOWNLOAD_BYTES:
                    raise ValueError("ONLYOFFICE indirmesi boyut sınırını aşıyor")

            async with artifact_mutation_lock(entry.kind, entry.key):
                workspace = await _apply_office_session_content(db, entry=entry, workbook_bytes=workbook_bytes)
                await db.commit()

                record = await get_artifact_record(db, entry.artifact_key or "")
                office_host_service.update_after_save(
                    access_token,
                    updated_at=record.updated_at if record else utc_now(),
                    revision=getattr(record, "revision", None) if record else None,
                    save_id=save_id,
                    workspace_revision=getattr(workspace, "workspace_revision", None),
                )
            return {"error": 0}
        except HTTPException as exc:
            await db.rollback()
            detail = str(exc.detail) if exc.detail is not None else "ONLYOFFICE callback reddedildi"
            office_host_service.mark_sync_rejected(access_token, detail)
            _logger.warning("ONLYOFFICE callback apply reddedildi: %s", detail)
            # A rejected domain apply must be visible to OnlyOffice; returning
            # success here made a stale deletion look saved until the next reload.
            return {"error": 1}
        except Exception:
            await db.rollback()
            office_host_service.mark_sync_error(access_token, "ONLYOFFICE callback apply başarısız oldu")
            _logger.exception("ONLYOFFICE callback apply başarısız oldu")
            return {"error": 1}


@router.post("/office/onlyoffice/forcesave/{access_token}", response_model=OfficeForceSaveOut)
async def post_onlyoffice_forcesave_v2(
    access_token: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> OfficeForceSaveOut:
    entry = office_host_service.get_session(access_token)
    if entry is None:
        raise HTTPException(status_code=404, detail="Office session bulunamadı")
    if entry.provider != "onlyoffice":
        raise HTTPException(status_code=400, detail="Bu session ONLYOFFICE değil")
    if entry.kind != "alis-workspace":
        raise HTTPException(status_code=400, detail="Canlı önizleme sync yalnız AFG draft workspace için açık")
    if not entry.can_write:
        raise HTTPException(status_code=403, detail="Salt okunur session için forcesave kullanılamaz")

    try:
        requested_entry = office_host_service.mark_forcesave_requested(access_token)
        if requested_entry is None:
            raise RuntimeError("Office session bulunamadı")
        requested_save_id = requested_entry.last_requested_save_id
        result = await office_host_service.force_save(entry, save_id=requested_save_id)
    except RuntimeError as exc:
        office_host_service.mark_sync_error(access_token, str(exc))
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        office_host_service.mark_sync_error(access_token, "ONLYOFFICE forcesave çağrısı başarısız oldu")
        raise HTTPException(status_code=503, detail="ONLYOFFICE forcesave çağrısı başarısız oldu") from exc

    if result.accepted and result.state == "noop":
        office_host_service.mark_sync_noop(access_token, None)
    elif not result.accepted:
        office_host_service.mark_sync_rejected(access_token, result.detail)

    return OfficeForceSaveOut(
        accepted=result.accepted,
        state=result.state,
        detail=result.detail,
        save_id=result.save_id,
    )


@router.get("/excel-preview/{kind}/{key}", response_model=DocumentArtifactPreviewOut)
async def get_excel_preview_v2(
    kind: str,
    key: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> DocumentArtifactPreviewOut:
    # Yalnız anahtar dönüşümleri 400 "geçersiz anahtar" sözleşmesine girer;
    # derin iş mantığından kaçan ValueError istemci hatası değil sunucu
    # hatasıdır ve geniş except ile maskelenmemelidir.
    resolved_key: UUID | int
    try:
        if kind == "alis-workspace":
            resolved_key = UUID(key)
        elif kind == "alis-document":
            resolved_key = int(key)
        elif kind == "log":
            resolved_key = _default_artifact_year(int(key))
        elif kind != "depolama":
            raise HTTPException(status_code=404, detail="Excel preview bulunamadı")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Geçersiz Excel preview anahtarı") from exc

    if kind == "alis-workspace":
        pos_session = await get_pos_session_or_404(db, resolved_key)
        workspace = await build_purchase_workspace(db, pos_session=pos_session)
        artifact = await get_artifact_record(db, f"alis.workspace.{resolved_key}")
        preview = build_afg_workspace_preview(workspace, artifact=artifact)
        if pos_session.status != PosSessionStatusEnum.DRAFT:
            preview = preview.model_copy(
                update={
                    "import_supported": False,
                    "external_edit_supported": False,
                    "editable_cells": [],
                }
            )
        return preview
    if kind == "alis-document":
        detail = await get_legacy_pos_document_detail(sequence_no=resolved_key, db=db, _=admin)
        artifact = await get_artifact_record(db, f"alis.document.{resolved_key}")
        return build_afg_document_preview(detail, artifact=artifact)
    if kind == "depolama":
        workspace = await get_legacy_inventory_workspace(q=None, db=db, _=admin)
        artifact = await get_artifact_record(db, "depolama.live")
        return build_inventory_preview(workspace, artifact=artifact)
    workspace = await build_log_workspace(db, q=None, limit=200)
    artifact = await get_artifact_record(db, f"log.live.{resolved_key}")
    return build_log_preview(workspace, year=resolved_key, artifact=artifact)


@router.get("/display/{display_token}", response_model=PosSessionDisplayOut)
async def get_display_snapshot_v2(
    display_token: str,
    db: AsyncSession = Depends(get_db),
) -> PosSessionDisplayOut:
    pos_session = await get_pos_session_by_display_token_or_404(db, display_token)
    return await display_snapshot(db, pos_session)
