from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models.user import User
from app.schemas.gdpr import (
    GdprJobOut,
    GdprCopyTaskUpdateIn,
    GdprOverviewOut,
    GdprProcessorOut,
    GdprPublicBridgeConfigOut,
    GdprPublicCookieConfigOut,
    GdprPublicRequestCreateIn,
    GdprPublicRequestCreateOut,
    GdprPublicRequestStatusOut,
    GdprPublicSiteConfigOut,
    GdprRequestDecisionIn,
    GdprRequestDetailOut,
    GdprRequestListItemOut,
    GdprRequestVerifyIn,
    GdprRetentionPolicyOut,
    GdprRetentionPolicyUpdateIn,
)
from app.services.gdpr_service import (
    approve_gdpr_request,
    enqueue_gdpr_request,
    execute_gdpr_request,
    get_gdpr_overview,
    get_gdpr_processors,
    get_public_gdpr_bridge_config,
    get_gdpr_request_or_404,
    get_public_cookie_config,
    get_public_gdpr_request_status,
    get_public_gdpr_site_config,
    list_gdpr_jobs,
    list_gdpr_requests,
    list_gdpr_retention_policies,
    reject_gdpr_request,
    resolve_export_path,
    serialize_gdpr_request_detail,
    submit_public_gdpr_request,
    update_retention_policy,
    update_gdpr_copy_task,
    verify_gdpr_request,
)

admin_router = APIRouter()
public_router = APIRouter()


@admin_router.get("/overview", response_model=GdprOverviewOut)
async def get_overview(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> GdprOverviewOut:
    payload = await get_gdpr_overview(db)
    await db.commit()
    return payload


@admin_router.get("/requests", response_model=list[GdprRequestListItemOut])
async def get_requests(
    status_filter: str | None = Query(default=None, alias="status"),
    customer_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[GdprRequestListItemOut]:
    payload = await list_gdpr_requests(db, status_filter=status_filter, customer_id=customer_id)
    await db.commit()
    return payload


@admin_router.get("/jobs", response_model=list[GdprJobOut])
async def get_jobs(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[GdprJobOut]:
    payload = await list_gdpr_jobs(db, status_filter=status_filter, limit=limit)
    await db.commit()
    return payload


@admin_router.get("/requests/{request_id}", response_model=GdprRequestDetailOut)
async def get_request_detail(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> GdprRequestDetailOut:
    request = await get_gdpr_request_or_404(db, request_id)
    return await serialize_gdpr_request_detail(db, request)


@admin_router.patch("/requests/{request_id}/copy-tasks/{task_id}", response_model=GdprRequestDetailOut)
async def patch_copy_task(
    request_id: UUID,
    task_id: UUID,
    payload: GdprCopyTaskUpdateIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> GdprRequestDetailOut:
    request = await get_gdpr_request_or_404(db, request_id)
    await update_gdpr_copy_task(db, request, task_id=task_id, actor=admin, status_value=payload.status, reason=payload.reason)
    await db.commit()
    return await serialize_gdpr_request_detail(db, request)


@admin_router.post("/requests/{request_id}/verify", response_model=GdprRequestDetailOut)
async def post_verify_request(
    request_id: UUID,
    payload: GdprRequestVerifyIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> GdprRequestDetailOut:
    request = await get_gdpr_request_or_404(db, request_id)
    request = await verify_gdpr_request(db, request, customer_id=payload.customer_id, actor=admin)
    await db.commit()
    return await serialize_gdpr_request_detail(db, request)


@admin_router.post("/requests/{request_id}/approve", response_model=GdprRequestDetailOut)
async def post_approve_request(
    request_id: UUID,
    payload: GdprRequestDecisionIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> GdprRequestDetailOut:
    request = await get_gdpr_request_or_404(db, request_id)
    request = await approve_gdpr_request(db, request, actor=admin, reason=payload.reason)
    await db.commit()
    return await serialize_gdpr_request_detail(db, request)


@admin_router.post("/requests/{request_id}/reject", response_model=GdprRequestDetailOut)
async def post_reject_request(
    request_id: UUID,
    payload: GdprRequestDecisionIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> GdprRequestDetailOut:
    request = await get_gdpr_request_or_404(db, request_id)
    request = await reject_gdpr_request(db, request, actor=admin, reason=payload.reason)
    await db.commit()
    return await serialize_gdpr_request_detail(db, request)


@admin_router.post("/requests/{request_id}/execute", response_model=GdprRequestDetailOut)
async def post_execute_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> GdprRequestDetailOut:
    request = await get_gdpr_request_or_404(db, request_id)
    request = await execute_gdpr_request(db, request, actor=admin)
    await db.commit()
    return await serialize_gdpr_request_detail(db, request)


@admin_router.post("/requests/{request_id}/enqueue", response_model=GdprRequestDetailOut)
async def post_enqueue_request(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> GdprRequestDetailOut:
    request = await get_gdpr_request_or_404(db, request_id)
    request = await enqueue_gdpr_request(db, request, actor=admin)
    await db.commit()
    return await serialize_gdpr_request_detail(db, request)


@admin_router.get("/retention-policies", response_model=list[GdprRetentionPolicyOut])
async def get_retention_policies(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[GdprRetentionPolicyOut]:
    payload = await list_gdpr_retention_policies(db)
    await db.commit()
    return payload


@admin_router.put("/retention-policies/{policy_key}", response_model=GdprRetentionPolicyOut)
async def put_retention_policy(
    policy_key: str,
    payload: GdprRetentionPolicyUpdateIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> GdprRetentionPolicyOut:
    policy = await update_retention_policy(
        db,
        policy_key,
        title=payload.title,
        description=payload.description,
        action=payload.action,
        retention_days=payload.retention_days,
        is_enabled=payload.is_enabled,
    )
    await db.commit()
    return GdprRetentionPolicyOut(
        id=policy.id,
        policy_key=policy.policy_key,
        title=policy.title,
        description=policy.description,
        applies_to=policy.applies_to,
        action=policy.action,
        retention_days=policy.retention_days,
        is_enabled=policy.is_enabled,
        updated_at=policy.updated_at,
    )


@admin_router.get("/processors", response_model=list[GdprProcessorOut])
async def get_processors(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[GdprProcessorOut]:
    payload = await get_gdpr_processors(db)
    await db.commit()
    return payload


@admin_router.get("/exports/{request_id}/download")
async def download_export(
    request_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> FileResponse:
    file_path = await resolve_export_path(db, request_id)
    return FileResponse(
        path=file_path,
        media_type="application/zip",
        filename=file_path.name,
    )


@public_router.get("/site-config", response_model=GdprPublicSiteConfigOut)
async def get_site_config() -> GdprPublicSiteConfigOut:
    return get_public_gdpr_site_config()


@public_router.get("/cookie-config", response_model=GdprPublicCookieConfigOut)
async def get_cookie_config() -> GdprPublicCookieConfigOut:
    return get_public_cookie_config()


@public_router.get("/bridge-config", response_model=GdprPublicBridgeConfigOut)
async def get_bridge_config() -> GdprPublicBridgeConfigOut:
    return get_public_gdpr_bridge_config()


@public_router.post("/request", response_model=GdprPublicRequestCreateOut)
async def post_public_request(
    payload: GdprPublicRequestCreateIn,
    db: AsyncSession = Depends(get_db),
) -> GdprPublicRequestCreateOut:
    result = await submit_public_gdpr_request(db, payload)
    await db.commit()
    return result


@public_router.get("/request/{tracking_token}", response_model=GdprPublicRequestStatusOut)
async def get_public_request_status(
    tracking_token: str,
    db: AsyncSession = Depends(get_db),
) -> GdprPublicRequestStatusOut:
    return await get_public_gdpr_request_status(db, tracking_token)
