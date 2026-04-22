from __future__ import annotations

import csv
import io
import json
import secrets
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.customer_identity import CustomerIdentityDocument
from app.models.enums import RoleEnum
from app.models.gdpr_job import GdprJob
from app.models.gdpr_processor import GdprProcessor
from app.models.gdpr_request import GdprRequest
from app.models.gdpr_request_event import GdprRequestEvent
from app.models.gdpr_retention_policy import GdprRetentionPolicy
from app.models.pos_document import PosDocument
from app.models.product import Product
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.customer import CustomerOut
from app.schemas.gdpr import (
    GdprJobOut,
    GdprOverviewOut,
    GdprProcessorOut,
    GdprPublicBridgeConfigOut,
    GdprPublicCookieCategoryOut,
    GdprPublicCookieConfigOut,
    GdprPublicRequestCreateIn,
    GdprPublicRequestCreateOut,
    GdprPublicRequestStatusOut,
    GdprPublicSiteConfigOut,
    GdprRequestDetailOut,
    GdprRequestEventOut,
    GdprRequestListItemOut,
    GdprRetentionPolicyOut,
)
from app.services.customer_service import to_customer_out
from app.services.runtime_readiness import collect_runtime_readiness
from app.services.woocommerce import WooCommerceService
from app.utils.helpers import utc_now
from app.utils.security import decrypt_field


OPEN_REQUEST_STATUSES = {"submitted", "identity_pending", "verified", "under_review", "approved", "queued", "executing"}
COMPLETED_REQUEST_STATUSES = {"completed", "completed_with_warnings"}
REQUEST_EXECUTABLE_STATUSES = {"approved", "queued"}
AUTOMATIC_JOB_TYPES = {"retention_scan", "gdpr_runner"}
EXPORT_ARCHIVE_RETENTION_DAYS = 30
TRACKING_TOKEN_RETENTION_DAYS = 90
DEFAULT_RETENTION_POLICIES = (
    {
        "policy_key": "financial_ledger",
        "title": "Financial ledger",
        "description": "Muhasebe ve belge kayıtları en az 5 yıl tutulur; silinmez, erişim kısıtlanır.",
        "applies_to": "transactions,pos_documents,purchase_receipts,woo_orders",
        "action": "keep_restrict",
        "retention_days": 365 * 5,
    },
    {
        "policy_key": "customer_master",
        "title": "Customer master",
        "description": "Müşteri ana veri kaydı yasal pencere sonrası pseudonymize edilir.",
        "applies_to": "users,customer_identity_documents",
        "action": "pseudonymize",
        "retention_days": 365 * 5,
    },
    {
        "policy_key": "gdpr_audit",
        "title": "GDPR audit trail",
        "description": "GDPR request olayları ve karar logları 5 yıl korunur.",
        "applies_to": "gdpr_requests,gdpr_request_events,gdpr_jobs",
        "action": "keep_restrict",
        "retention_days": 365 * 5,
    },
    {
        "policy_key": "operational_logs",
        "title": "Operational logs",
        "description": "Webhooks ve operasyonel loglar 90 gün tutulur.",
        "applies_to": "webhooks,operational_logs",
        "action": "delete",
        "retention_days": 90,
    },
    {
        "policy_key": "local_backups",
        "title": "Local backups",
        "description": "Yerel yedekler 35 gün döngüsel tutulur.",
        "applies_to": "local_backups",
        "action": "delete",
        "retention_days": 35,
    },
    {
        "policy_key": "offsite_backups",
        "title": "Offsite backups",
        "description": "Offsite yedekler 90 gün döngüsel tutulur.",
        "applies_to": "offsite_backups",
        "action": "delete",
        "retention_days": 90,
    },
)
DEFAULT_PROCESSORS = (
    ("crm", "CRM Runtime", "core", "Sero Guld CRM"),
    ("wordpress", "WordPress Public Site", "public", "WordPress"),
    ("woocommerce", "WooCommerce Store", "public", "WooCommerce"),
    ("onlyoffice", "Office Runtime", "processor", "ONLYOFFICE"),
    ("openai", "OpenAI", "processor", "OpenAI"),
    ("opmc", "OPMC", "processor", "OPMC"),
    ("uniconta", "Uniconta", "processor", "Uniconta"),
    ("local_backups", "Local Backups", "storage", "Local Backup Store"),
    ("offsite_backups", "Offsite Backups", "storage", "Offsite Backup Store"),
)


def _request_reference() -> str:
    now = utc_now()
    return f"GDPR-{now:%Y%m%d}-{secrets.token_hex(3).upper()}"


def _tracking_token() -> str:
    return secrets.token_urlsafe(24)


def _export_root() -> Path:
    root = get_settings().document_root_path() / "gdpr_exports"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _customer_placeholder_email(user: User) -> str:
    return f"gdpr-{str(user.id).replace('-', '')[:12]}@redacted.seroguld"


def _customer_placeholder_name(user: User) -> str:
    suffix = str(user.id).replace("-", "")[-4:].upper()
    return f"GDPR Redacted {suffix}"


def _build_public_url(path: str) -> str:
    base = get_settings().app_url.rstrip("/")
    return f"{base}/#/{path.lstrip('/')}"


def _coerce_utc_datetime(value: Any) -> Any:
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=utc_now().tzinfo)
    return value


async def ensure_gdpr_seed_data(session: AsyncSession) -> None:
    existing_policy_keys = set((await session.scalars(select(GdprRetentionPolicy.policy_key))).all())
    for policy in DEFAULT_RETENTION_POLICIES:
        if policy["policy_key"] in existing_policy_keys:
            continue
        session.add(GdprRetentionPolicy(**policy))

    existing_processor_keys = set((await session.scalars(select(GdprProcessor.processor_key))).all())
    for key, title, category, system_name in DEFAULT_PROCESSORS:
        if key in existing_processor_keys:
            continue
        session.add(
            GdprProcessor(
                processor_key=key,
                title=title,
                category=category,
                system_name=system_name,
                status="configured" if key == "crm" else "missing",
                configured=(key == "crm"),
            )
        )
    await session.flush()


async def _append_request_event(
    session: AsyncSession,
    *,
    request_id: UUID,
    event_type: str,
    actor_type: str,
    actor_user_id: UUID | None,
    message: str | None,
    payload_json: dict[str, Any] | None = None,
) -> None:
    session.add(
        GdprRequestEvent(
            request_id=request_id,
            event_type=event_type,
            actor_type=actor_type,
            actor_user_id=actor_user_id,
            message=message,
            payload_json=payload_json or {},
        )
    )
    await session.flush()


async def _latest_job_for_request(session: AsyncSession, request_id: UUID) -> GdprJob | None:
    return await session.scalar(
        select(GdprJob).where(GdprJob.request_id == request_id).order_by(GdprJob.created_at.desc())
    )


def _job_out(job: GdprJob | None, *, request_reference_number: str | None = None) -> GdprJobOut | None:
    if job is None:
        return None
    return GdprJobOut(
        id=job.id,
        request_id=job.request_id,
        request_reference_number=request_reference_number,
        job_type=job.job_type,
        status=job.status,
        payload_json=job.payload_json or {},
        result_json=job.result_json or {},
        started_at=job.started_at,
        completed_at=job.completed_at,
        created_at=job.created_at,
    )


async def _job_request_map(session: AsyncSession, jobs: list[GdprJob]) -> dict[UUID, str]:
    request_ids = [job.request_id for job in jobs if job.request_id]
    if not request_ids:
        return {}
    requests = (
        await session.scalars(select(GdprRequest).where(GdprRequest.id.in_(request_ids)))
    ).all()
    return {request.id: request.reference_number for request in requests}


async def _candidate_customers(session: AsyncSession, request: GdprRequest) -> list[CustomerOut]:
    predicates = [User.role == RoleEnum.CUSTOMER]
    name = (request.subject_name or "").strip()
    email = (request.subject_email or "").strip().lower()
    phone = "".join(ch for ch in (request.subject_phone or "") if ch.isdigit())

    match_clauses = []
    if email:
        match_clauses.append(func.lower(User.email) == email)
    if phone:
        match_clauses.append(func.replace(func.replace(func.coalesce(User.phone, ""), " ", ""), "+", "") == phone)
    if name:
        match_clauses.append(User.name.ilike(f"%{name}%"))
    if not match_clauses:
        return []

    rows = (
        await session.scalars(
            select(User)
            .where(*predicates, or_(*match_clauses))
            .order_by(User.updated_at.desc(), User.created_at.desc())
            .limit(5)
        )
    ).all()
    return [await to_customer_out(session, user) for user in rows]


async def _request_list_item(session: AsyncSession, request: GdprRequest) -> GdprRequestListItemOut:
    verified_customer_name = None
    if request.verified_customer_id:
        verified_customer = await session.get(User, request.verified_customer_id)
        verified_customer_name = verified_customer.name if verified_customer else None
    return GdprRequestListItemOut(
        id=request.id,
        reference_number=request.reference_number,
        request_type=request.request_type,
        status=request.status,
        channel=request.channel,
        subject_name=request.subject_name,
        subject_email=request.subject_email,
        subject_phone=request.subject_phone,
        verified_customer_id=request.verified_customer_id,
        verified_customer_name=verified_customer_name,
        due_at=request.due_at,
        submitted_at=request.created_at,
        completed_at=request.completed_at,
    )


async def serialize_gdpr_request_detail(session: AsyncSession, request: GdprRequest) -> GdprRequestDetailOut:
    item = await _request_list_item(session, request)
    events = (
        await session.scalars(
            select(GdprRequestEvent)
            .where(GdprRequestEvent.request_id == request.id)
            .order_by(GdprRequestEvent.created_at.asc())
        )
    ).all()
    latest_job = await _latest_job_for_request(session, request.id)
    export_download_path = None
    if latest_job and latest_job.status in {"completed", "completed_with_warnings"}:
        file_path = str((latest_job.result_json or {}).get("file_path") or "").strip()
        if file_path:
            export_download_path = f"/api/v2/gdpr/exports/{request.id}/download"
    return GdprRequestDetailOut(
        **item.model_dump(),
        message=request.message,
        decision_reason=request.decision_reason,
        request_meta=request.request_meta or {},
        match_candidates=await _candidate_customers(session, request),
        events=[
            GdprRequestEventOut(
                id=event.id,
                event_type=event.event_type,
                actor_type=event.actor_type,
                actor_user_id=event.actor_user_id,
                message=event.message,
                payload_json=event.payload_json or {},
                created_at=event.created_at,
            )
            for event in events
        ],
        latest_job=_job_out(latest_job, request_reference_number=request.reference_number),
        export_download_path=export_download_path,
    )


async def get_gdpr_request_or_404(session: AsyncSession, request_id: UUID) -> GdprRequest:
    request = await session.get(GdprRequest, request_id)
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GDPR isteği bulunamadı.")
    return request


async def list_gdpr_requests(
    session: AsyncSession,
    *,
    status_filter: str | None = None,
    customer_id: UUID | None = None,
) -> list[GdprRequestListItemOut]:
    await ensure_gdpr_seed_data(session)
    stmt = select(GdprRequest).order_by(GdprRequest.created_at.desc())
    if status_filter:
        stmt = stmt.where(GdprRequest.status == status_filter)
    if customer_id:
        stmt = stmt.where(GdprRequest.verified_customer_id == customer_id)
    requests = (await session.scalars(stmt)).all()
    return [await _request_list_item(session, request) for request in requests]


async def list_gdpr_jobs(
    session: AsyncSession,
    *,
    status_filter: str | None = None,
    limit: int = 50,
) -> list[GdprJobOut]:
    stmt = select(GdprJob).order_by(GdprJob.created_at.desc()).limit(max(1, min(limit, 200)))
    if status_filter:
        stmt = stmt.where(GdprJob.status == status_filter)
    jobs = (await session.scalars(stmt)).all()
    request_map = await _job_request_map(session, jobs)
    results: list[GdprJobOut] = []
    for job in jobs:
        item = _job_out(job, request_reference_number=request_map.get(job.request_id))
        if item is not None:
            results.append(item)
    return results


async def list_gdpr_retention_policies(session: AsyncSession) -> list[GdprRetentionPolicyOut]:
    await ensure_gdpr_seed_data(session)
    policies = (
        await session.scalars(select(GdprRetentionPolicy).order_by(GdprRetentionPolicy.retention_days.asc()))
    ).all()
    return [
        GdprRetentionPolicyOut(
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
        for policy in policies
    ]


async def _sync_processors(session: AsyncSession) -> list[GdprProcessorOut]:
    await ensure_gdpr_seed_data(session)
    settings = get_settings()
    readiness = await collect_runtime_readiness()
    readiness_by_name = {check.name: check for check in readiness.checks}
    processors = (await session.scalars(select(GdprProcessor).order_by(GdprProcessor.title.asc()))).all()
    now = utc_now()

    for processor in processors:
        if processor.processor_key == "crm":
            processor.configured = True
            processor.status = "healthy"
            processor.endpoint_url = settings.app_url
            processor.detail = "CRM authoritative GDPR cockpit"
        elif processor.processor_key == "wordpress":
            processor.configured = bool(settings.wordpress_base_url.strip())
            processor.status = "healthy" if processor.configured else "missing"
            processor.endpoint_url = settings.wordpress_base_url or None
            processor.detail = "CRM public pages + snippet bridge"
        elif processor.processor_key == "woocommerce":
            processor.configured = bool(
                settings.woocommerce_base_url.strip()
                and settings.woocommerce_consumer_key.strip()
                and settings.woocommerce_consumer_secret.strip()
            )
            processor.status = "healthy" if processor.configured else "missing"
            processor.endpoint_url = settings.woocommerce_base_url or None
            processor.detail = "Customer privacy sync conservative matching"
        elif processor.processor_key == "onlyoffice":
            check = readiness_by_name.get("office_afg")
            processor.configured = bool(settings.onlyoffice_runtime_url.strip())
            processor.status = "healthy" if check and check.ok else ("missing" if not processor.configured else "degraded")
            processor.endpoint_url = settings.onlyoffice_runtime_url or None
            processor.detail = check.detail if check else "ONLYOFFICE runtime"
        elif processor.processor_key == "openai":
            processor.configured = bool(settings.openai_api_key.strip())
            processor.status = "healthy" if processor.configured else "missing"
            processor.endpoint_url = "https://api.openai.com/v1" if processor.configured else None
            processor.detail = "AI provider"
        elif processor.processor_key == "opmc":
            processor.configured = bool(settings.opmc_api_url.strip() and settings.opmc_api_key.strip())
            processor.status = "healthy" if processor.configured else "missing"
            processor.endpoint_url = settings.opmc_api_url or None
            processor.detail = "Anti-fraud/order data source"
        elif processor.processor_key == "uniconta":
            processor.configured = bool(
                settings.uniconta_api_url.strip()
                and settings.uniconta_company_id.strip()
                and (settings.uniconta_api_key.strip() or settings.uniconta_password.strip())
            )
            processor.status = "healthy" if processor.configured else "missing"
            processor.endpoint_url = settings.uniconta_api_url or None
            processor.detail = "ERP/accounting sync"
        elif processor.processor_key == "local_backups":
            check = readiness_by_name.get("backup_freshness")
            processor.configured = True
            processor.status = "healthy" if check and check.ok else "degraded"
            processor.endpoint_url = str(settings.backup_root_path())
            processor.detail = check.detail if check else "Local backup store"
        elif processor.processor_key == "offsite_backups":
            check = readiness_by_name.get("offsite_sync")
            processor.configured = settings.backup_offsite_enabled
            if not settings.backup_offsite_enabled:
                processor.status = "disabled"
                processor.detail = "Disabled"
            else:
                processor.status = "healthy" if check and check.ok else "degraded"
                processor.detail = check.detail if check else "Offsite backup sync"
            processor.endpoint_url = str(settings.backup_offsite_status_path())
        processor.last_checked_at = now

    await session.flush()
    return [
        GdprProcessorOut(
            id=processor.id,
            processor_key=processor.processor_key,
            title=processor.title,
            category=processor.category,
            system_name=processor.system_name,
            status=processor.status,
            configured=processor.configured,
            endpoint_url=processor.endpoint_url,
            detail=processor.detail,
            notes=processor.notes,
            last_checked_at=processor.last_checked_at,
        )
        for processor in processors
    ]


async def get_gdpr_processors(session: AsyncSession) -> list[GdprProcessorOut]:
    return await _sync_processors(session)


async def _latest_job_timestamp(session: AsyncSession, job_type: str) -> Any:
    return await session.scalar(
        select(func.max(func.coalesce(GdprJob.completed_at, GdprJob.created_at))).where(GdprJob.job_type == job_type)
    )


async def _customer_master_policy(session: AsyncSession) -> GdprRetentionPolicy | None:
    return await session.scalar(
        select(GdprRetentionPolicy).where(GdprRetentionPolicy.policy_key == "customer_master")
    )


async def _eligible_customer_master_retention_candidates(session: AsyncSession) -> list[tuple[User, Any]]:
    policy = await _customer_master_policy(session)
    if policy is None or not policy.is_enabled:
        return []

    now = utc_now()
    eligible_cutoff = now - timedelta(days=policy.retention_days)
    customers = (
        await session.scalars(
            select(User).where(
                User.role == RoleEnum.CUSTOMER,
                User.gdpr_status != "pseudonymized",
            )
        )
    ).all()
    if not customers:
        return []

    customer_ids = [customer.id for customer in customers]
    transaction_rows = (
        await session.execute(
            select(Transaction.customer_id, func.max(Transaction.created_at))
            .where(Transaction.customer_id.in_(customer_ids))
            .group_by(Transaction.customer_id)
        )
    ).all()
    last_transaction_map = {customer_id: last_created_at for customer_id, last_created_at in transaction_rows}
    open_request_customer_ids = {
        customer_id
        for customer_id in (
            await session.scalars(
                select(GdprRequest.verified_customer_id).where(
                    GdprRequest.verified_customer_id.is_not(None),
                    GdprRequest.status.in_(OPEN_REQUEST_STATUSES),
                )
            )
        ).all()
        if customer_id is not None
    }

    eligible: list[tuple[User, Any]] = []
    for customer in customers:
        if customer.id in open_request_customer_ids:
            continue
        anchor = max(
            _coerce_utc_datetime(item)
            for item in (
                last_transaction_map.get(customer.id),
                customer.updated_at,
                customer.last_gdpr_request_at,
                customer.created_at,
            )
            if item is not None
        )
        if anchor <= eligible_cutoff:
            eligible.append((customer, anchor))
    return eligible


async def _create_retention_review_request(
    session: AsyncSession,
    *,
    customer: User,
    retention_anchor_at: Any,
) -> GdprRequest:
    request = GdprRequest(
        reference_number=_request_reference(),
        request_type="erasure_pseudonymize",
        status="under_review",
        channel="retention_scan",
        subject_name=customer.name,
        subject_email=customer.email,
        subject_phone=customer.phone,
        verified_customer_id=customer.id,
        public_tracking_token=_tracking_token(),
        public_tracking_token_expires_at=utc_now() + timedelta(days=TRACKING_TOKEN_RETENTION_DAYS),
        due_at=utc_now() + timedelta(days=30),
        request_meta={
            "retention_policy_key": "customer_master",
            "retention_anchor_at": retention_anchor_at.isoformat() if retention_anchor_at else None,
            "source": "nightly_retention_scan",
        },
    )
    session.add(request)
    customer.last_gdpr_request_at = utc_now()
    await session.flush()
    await _append_request_event(
        session,
        request_id=request.id,
        event_type="retention_scan_queued",
        actor_type="system",
        actor_user_id=None,
        message="Retention scan created a review request.",
        payload_json={"customer_id": str(customer.id)},
    )
    return request


async def _create_runner_audit_job(
    session: AsyncSession,
    *,
    job_type: str,
    payload_json: dict[str, Any] | None = None,
) -> GdprJob:
    job = GdprJob(
        request_id=None,
        job_type=job_type,
        status="running",
        payload_json=payload_json or {},
        result_json={},
        started_at=utc_now(),
    )
    session.add(job)
    await session.flush()
    return job


async def run_retention_scan(session: AsyncSession) -> GdprJob:
    await ensure_gdpr_seed_data(session)
    audit_job = await _create_runner_audit_job(session, job_type="retention_scan")
    policy = await _customer_master_policy(session)
    if policy is None or not policy.is_enabled:
        audit_job.status = "skipped"
        audit_job.completed_at = utc_now()
        audit_job.result_json = {"created_request_ids": [], "reason": "customer_master policy disabled"}
        await session.flush()
        return audit_job

    candidates = await _eligible_customer_master_retention_candidates(session)
    created_request_ids: list[str] = []
    for customer, retention_anchor_at in candidates:
        request = await _create_retention_review_request(
            session,
            customer=customer,
            retention_anchor_at=retention_anchor_at,
        )
        created_request_ids.append(str(request.id))

    audit_job.status = "completed"
    audit_job.completed_at = utc_now()
    audit_job.result_json = {
        "policy_key": "customer_master",
        "eligible_count": len(candidates),
        "created_request_count": len(created_request_ids),
        "created_request_ids": created_request_ids,
    }
    await session.flush()
    return audit_job


async def _purge_old_export_archives(session: AsyncSession) -> dict[str, Any]:
    cutoff = utc_now() - timedelta(days=EXPORT_ARCHIVE_RETENTION_DAYS)
    removed_files: list[str] = []
    jobs = (
        await session.scalars(
            select(GdprJob).where(
                GdprJob.job_type == "access_export",
                GdprJob.status.in_(COMPLETED_REQUEST_STATUSES),
            )
        )
    ).all()
    for job in jobs:
        file_path = str((job.result_json or {}).get("file_path") or "").strip()
        if not file_path:
            continue
        path = Path(file_path)
        if not path.exists():
            continue
        modified_at = _coerce_utc_datetime(datetime.fromtimestamp(path.stat().st_mtime, tz=utc_now().tzinfo))
        if modified_at > cutoff:
            continue
        try:
            path.unlink()
        except Exception:
            continue
        removed_files.append(path.name)
        job.result_json = {**(job.result_json or {}), "file_purged": True, "file_path": "", "file_name": path.name}
    await session.flush()
    return {"purged_export_archives": len(removed_files), "purged_export_files": removed_files}


async def _cleanup_expired_tracking_tokens(session: AsyncSession) -> dict[str, Any]:
    now = utc_now()
    requests = (
        await session.scalars(
            select(GdprRequest).where(
                GdprRequest.public_tracking_token_expires_at.is_not(None),
                GdprRequest.public_tracking_token_expires_at < now,
            )
        )
    ).all()
    cleaned_count = 0
    for request in requests:
        expired_token = f"expired-{request.id}"
        if request.public_tracking_token == expired_token:
            continue
        request.public_tracking_token = expired_token
        cleaned_count += 1
    await session.flush()
    return {"cleaned_tracking_tokens": cleaned_count}


async def get_gdpr_overview(session: AsyncSession) -> GdprOverviewOut:
    await ensure_gdpr_seed_data(session)
    now = utc_now()
    completion_window = now - timedelta(days=30)
    due_soon = now + timedelta(days=7)

    open_request_count = int(
        await session.scalar(
            select(func.count(GdprRequest.id)).where(GdprRequest.status.in_(OPEN_REQUEST_STATUSES))
        )
        or 0
    )
    due_soon_count = int(
        await session.scalar(
            select(func.count(GdprRequest.id)).where(
                GdprRequest.status.in_(OPEN_REQUEST_STATUSES),
                GdprRequest.due_at.is_not(None),
                GdprRequest.due_at >= now,
                GdprRequest.due_at <= due_soon,
            )
        )
        or 0
    )
    overdue_count = int(
        await session.scalar(
            select(func.count(GdprRequest.id)).where(
                GdprRequest.status.in_(OPEN_REQUEST_STATUSES),
                GdprRequest.due_at.is_not(None),
                GdprRequest.due_at < now,
            )
        )
        or 0
    )
    completed_30d_count = int(
        await session.scalar(
            select(func.count(GdprRequest.id)).where(
                GdprRequest.status.in_(COMPLETED_REQUEST_STATUSES),
                GdprRequest.created_at >= completion_window,
            )
        )
        or 0
    )
    eligible_pseudonymize_count = len(await _eligible_customer_master_retention_candidates(session))
    locked_product_count = int(await session.scalar(select(func.count(Product.id)).where(Product.is_gdpr_locked.is_(True))) or 0)
    queued_job_count = int(await session.scalar(select(func.count(GdprJob.id)).where(GdprJob.status == "queued")) or 0)
    failed_job_count = int(await session.scalar(select(func.count(GdprJob.id)).where(GdprJob.status == "failed")) or 0)
    last_scan_at = await _latest_job_timestamp(session, "retention_scan")
    last_run_at = await _latest_job_timestamp(session, "gdpr_runner")

    processors = await _sync_processors(session)
    readiness = await collect_runtime_readiness()
    processor_warning_count = sum(1 for processor in processors if processor.status in {"degraded", "missing"})

    return GdprOverviewOut(
        open_request_count=open_request_count,
        due_soon_count=due_soon_count,
        overdue_count=overdue_count,
        completed_30d_count=completed_30d_count,
        eligible_pseudonymize_count=eligible_pseudonymize_count,
        locked_product_count=locked_product_count,
        processor_warning_count=processor_warning_count,
        queued_job_count=queued_job_count,
        failed_job_count=failed_job_count,
        last_scan_at=last_scan_at,
        last_run_at=last_run_at,
        readiness_checks=readiness.checks,
    )


def get_public_gdpr_site_config() -> GdprPublicSiteConfigOut:
    settings = get_settings()
    return GdprPublicSiteConfigOut(
        company_name=settings.invoice_seller_name,
        company_email=settings.invoice_seller_email or None,
        company_phone=settings.invoice_seller_phone or None,
        company_address=settings.invoice_seller_address_line1 or None,
        company_cvr=settings.invoice_seller_cvr or None,
        website_url=settings.wordpress_base_url or settings.app_url,
        wordpress_url=settings.wordpress_base_url or None,
        privacy_email=settings.invoice_seller_email or None,
        privacy_request_url=_build_public_url("/gdpr/request"),
        privacy_policy_url=_build_public_url("/gdpr/privacy"),
        cookies_url=_build_public_url("/gdpr/cookies"),
    )


def get_public_cookie_config() -> GdprPublicCookieConfigOut:
    return GdprPublicCookieConfigOut(
        categories=[
            GdprPublicCookieCategoryOut(
                key="necessary",
                title="Necessary",
                required=True,
                description="Login, session ve güvenlik için gereken zorunlu çerezler.",
            ),
            GdprPublicCookieCategoryOut(
                key="analytics",
                title="Analytics",
                required=False,
                description="Kullanım ölçümü ve performans izleme için isteğe bağlı analitik çerezleri.",
            ),
            GdprPublicCookieCategoryOut(
                key="marketing",
                title="Marketing",
                required=False,
                description="WordPress / WooCommerce kaynaklı pazarlama ve yeniden hedefleme çerezleri.",
            ),
            GdprPublicCookieCategoryOut(
                key="embedded",
                title="Embedded Content",
                required=False,
                description="Harici medya ve üçüncü taraf servis embedleri için isteğe bağlı çerezler.",
            ),
        ]
    )


def get_public_gdpr_bridge_config() -> GdprPublicBridgeConfigOut:
    site_config = get_public_gdpr_site_config()
    cookie_config = get_public_cookie_config()
    return GdprPublicBridgeConfigOut(
        version="1",
        updated_at=utc_now(),
        company_name=site_config.company_name,
        company_email=site_config.company_email,
        company_phone=site_config.company_phone,
        company_address=site_config.company_address,
        company_cvr=site_config.company_cvr,
        website_url=site_config.website_url,
        wordpress_url=site_config.wordpress_url,
        privacy_request_url=site_config.privacy_request_url,
        privacy_policy_url=site_config.privacy_policy_url,
        cookies_url=site_config.cookies_url,
        cookie_config_url="/api/v2/public/gdpr/cookie-config",
        cookie_categories=cookie_config.categories,
    )


async def submit_public_gdpr_request(session: AsyncSession, payload: GdprPublicRequestCreateIn) -> GdprPublicRequestCreateOut:
    if not payload.accepted_privacy:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Privacy kabulü zorunlu.")
    request = GdprRequest(
        reference_number=_request_reference(),
        request_type=payload.request_type.strip(),
        status="identity_pending",
        channel="public_page",
        subject_name=payload.subject_name.strip(),
        subject_email=(payload.subject_email or "").strip().lower() or None,
        subject_phone=(payload.subject_phone or "").strip() or None,
        message=(payload.message or "").strip() or None,
        public_tracking_token=_tracking_token(),
        public_tracking_token_expires_at=utc_now() + timedelta(days=90),
        due_at=utc_now() + timedelta(days=30),
        request_meta={"accepted_privacy": True},
    )
    session.add(request)
    await session.flush()
    await _append_request_event(
        session,
        request_id=request.id,
        event_type="submitted",
        actor_type="public",
        actor_user_id=None,
        message="Public GDPR request submitted.",
    )
    return GdprPublicRequestCreateOut(
        reference_number=request.reference_number,
        tracking_token=request.public_tracking_token,
        status=request.status,
        due_at=request.due_at or utc_now() + timedelta(days=30),
    )


async def get_public_gdpr_request_status(session: AsyncSession, tracking_token: str) -> GdprPublicRequestStatusOut:
    request = await session.scalar(
        select(GdprRequest).where(GdprRequest.public_tracking_token == tracking_token).limit(1)
    )
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GDPR takip kaydı bulunamadı.")
    expires_at = _coerce_utc_datetime(request.public_tracking_token_expires_at)
    if expires_at and expires_at < utc_now():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GDPR takip kaydı süresi dolmuş.")
    last_event = await session.scalar(
        select(GdprRequestEvent)
        .where(GdprRequestEvent.request_id == request.id)
        .order_by(GdprRequestEvent.created_at.desc())
    )
    return GdprPublicRequestStatusOut(
        reference_number=request.reference_number,
        request_type=request.request_type,
        status=request.status,
        submitted_at=request.created_at,
        due_at=request.due_at,
        completed_at=request.completed_at,
        last_message=last_event.message if last_event else None,
    )


async def verify_gdpr_request(session: AsyncSession, request: GdprRequest, *, customer_id: UUID, actor: User) -> GdprRequest:
    customer = await session.get(User, customer_id)
    if customer is None or customer.role != RoleEnum.CUSTOMER:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Müşteri bulunamadı.")
    request.verified_customer_id = customer.id
    request.status = "verified"
    customer.last_gdpr_request_at = utc_now()
    await _append_request_event(
        session,
        request_id=request.id,
        event_type="verified",
        actor_type="admin",
        actor_user_id=actor.id,
        message=f"Customer verified as {customer.name}.",
        payload_json={"customer_id": str(customer.id)},
    )
    await session.flush()
    return request


async def approve_gdpr_request(session: AsyncSession, request: GdprRequest, *, actor: User, reason: str | None = None) -> GdprRequest:
    if request.request_type in {"access_export", "erasure_pseudonymize", "marketing_opt_out", "objection_restriction", "rectification"} and not request.verified_customer_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Önce müşteri doğrulanmalı.")
    request.status = "approved"
    request.decision_reason = reason
    await _append_request_event(
        session,
        request_id=request.id,
        event_type="approved",
        actor_type="admin",
        actor_user_id=actor.id,
        message=reason or "Request approved.",
    )
    await session.flush()
    return request


async def reject_gdpr_request(session: AsyncSession, request: GdprRequest, *, actor: User, reason: str | None = None) -> GdprRequest:
    request.status = "rejected"
    request.decision_reason = reason
    request.completed_at = utc_now()
    await _append_request_event(
        session,
        request_id=request.id,
        event_type="rejected",
        actor_type="admin",
        actor_user_id=actor.id,
        message=reason or "Request rejected.",
    )
    await session.flush()
    return request


def _customer_subject_json(user: User, identity: CustomerIdentityDocument | None) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "address": decrypt_field(user.address_encrypted),
        "postal_code": user.postal_code,
        "cpr_number": decrypt_field(user.cpr_number_encrypted),
        "gdpr_status": user.gdpr_status,
        "identity": {
            "type": getattr(identity.identity_doc_type, "value", identity.identity_doc_type) if identity else None,
            "number": decrypt_field(identity.identity_doc_number_encrypted) if identity else None,
            "country": identity.identity_doc_country if identity else None,
            "photo_refs": identity.identity_photo_refs if identity else [],
        },
    }


def _csv_text(fieldnames: list[str], rows: list[dict[str, Any]]) -> str:
    payload = io.StringIO()
    writer = csv.DictWriter(payload, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return payload.getvalue()


async def _build_export_archive(session: AsyncSession, customer: User, request: GdprRequest) -> dict[str, Any]:
    identity = await session.scalar(
        select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer.id)
    )
    transactions = (
        await session.scalars(
            select(Transaction).where(Transaction.customer_id == customer.id).order_by(Transaction.created_at.desc())
        )
    ).all()
    documents = (
        await session.scalars(
            select(PosDocument)
            .join(Transaction, Transaction.pos_document_sequence_no == PosDocument.sequence_no)
            .where(Transaction.customer_id == customer.id)
            .order_by(PosDocument.issued_at.desc(), PosDocument.sequence_no.desc())
        )
    ).all()
    subject_json = _customer_subject_json(customer, identity)
    customer_csv = _csv_text(
        ["id", "name", "email", "phone", "address", "postal_code", "gdpr_status"],
        [
            {
                "id": subject_json["id"],
                "name": subject_json["name"],
                "email": subject_json["email"],
                "phone": subject_json["phone"],
                "address": subject_json["address"],
                "postal_code": subject_json["postal_code"],
                "gdpr_status": subject_json["gdpr_status"],
            }
        ],
    )
    transactions_csv = _csv_text(
        ["id", "trade_side", "status", "gross_amount_dkk", "net_amount_dkk", "created_at"],
        [
            {
                "id": str(item.id),
                "trade_side": item.trade_side,
                "status": item.status,
                "gross_amount_dkk": str(item.gross_amount_dkk),
                "net_amount_dkk": str(item.net_amount_dkk),
                "created_at": item.created_at.isoformat(),
            }
            for item in transactions
        ],
    )
    document_manifest_csv = _csv_text(
        ["sequence_no", "document_type", "issued_at", "gross_amount_dkk", "customer_name", "customer_email"],
        [
            {
                "sequence_no": item.sequence_no,
                "document_type": getattr(item.document_type, "value", item.document_type),
                "issued_at": item.issued_at.isoformat(),
                "gross_amount_dkk": str(item.gross_amount_dkk),
                "customer_name": item.customer_name or "",
                "customer_email": item.customer_email or "",
            }
            for item in documents
        ],
    )

    root = _export_root()
    filename = f"{request.reference_number.lower()}-{utc_now():%Y%m%d%H%M%S}.zip"
    path = root / filename
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("subject.json", json.dumps(subject_json, ensure_ascii=False, indent=2))
        archive.writestr("customer.csv", customer_csv)
        archive.writestr("transactions.csv", transactions_csv)
        archive.writestr("documents_manifest.csv", document_manifest_csv)
        archive.writestr(
            "processor_actions.json",
            json.dumps(
                {
                    "crm": "authoritative",
                    "wordpress": "crm_public_pages_bridge",
                    "woocommerce": "conservative_customer_sync",
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
    return {"file_name": filename, "file_path": str(path)}


async def _best_effort_sync_woo_privacy(
    *,
    woocommerce_customer_id: str | None,
    action: str,
    email: str | None,
    phone: str | None,
    placeholder_email: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    configured = bool(
        settings.woocommerce_base_url.strip()
        and settings.woocommerce_consumer_key.strip()
        and settings.woocommerce_consumer_secret.strip()
    )
    if not configured:
        return {"status": "skipped", "matched_by": None, "updated_ids": [], "warnings": []}
    try:
        service = WooCommerceService()
        if action == "pseudonymize":
            return await service.pseudonymize_customer(
                woocommerce_customer_id=woocommerce_customer_id,
                email=email,
                phone=phone,
                placeholder_email=placeholder_email,
            )
        if action == "marketing_opt_out":
            return await service.marketing_opt_out_customer(
                woocommerce_customer_id=woocommerce_customer_id,
                email=email,
                phone=phone,
            )
    except Exception as exc:  # pragma: no cover - network/runtime dependent
        return {
            "status": "remote_error",
            "matched_by": None,
            "updated_ids": [],
            "warnings": [str(exc)],
        }
    return {"status": "skipped", "matched_by": None, "updated_ids": [], "warnings": []}


async def _execute_pseudonymize(session: AsyncSession, customer: User) -> dict[str, Any]:
    identity = await session.scalar(
        select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer.id)
    )
    original_email = customer.email
    original_phone = customer.phone
    customer.name = _customer_placeholder_name(customer)
    customer.email = _customer_placeholder_email(customer)
    customer.phone = None
    customer.postal_code = None
    customer.address_encrypted = None
    customer.cpr_number_encrypted = None
    customer.cpr_last4 = None
    customer.gdpr_status = "pseudonymized"
    customer.gdpr_pseudonymized_at = utc_now()
    if identity is not None:
        identity.identity_doc_number_encrypted = None
        identity.identity_photo_refs = []
    await session.flush()
    sync_result = await _best_effort_sync_woo_privacy(
        woocommerce_customer_id=customer.woocommerce_customer_id,
        action="pseudonymize",
        email=original_email,
        phone=original_phone,
        placeholder_email=customer.email,
    )
    return {"warnings": list(sync_result.get("warnings") or []), "woo_sync": sync_result}


async def _execute_restriction(session: AsyncSession, customer: User) -> dict[str, Any]:
    customer.gdpr_status = "restricted"
    await session.flush()
    return {"warnings": [], "woo_sync": None}


async def _execute_marketing_opt_out(session: AsyncSession, customer: User) -> dict[str, Any]:
    original_email = customer.email
    original_phone = customer.phone
    customer.marketing_opt_out_at = utc_now()
    await session.flush()
    sync_result = await _best_effort_sync_woo_privacy(
        woocommerce_customer_id=customer.woocommerce_customer_id,
        action="marketing_opt_out",
        email=original_email,
        phone=original_phone,
    )
    return {"warnings": list(sync_result.get("warnings") or []), "woo_sync": sync_result}


async def enqueue_gdpr_request(session: AsyncSession, request: GdprRequest, *, actor: User) -> GdprRequest:
    if request.status not in {"approved", "queued"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="İstek önce approve edilmeli.")

    existing_job = await session.scalar(
        select(GdprJob).where(
            GdprJob.request_id == request.id,
            GdprJob.status.in_({"queued", "running"}),
        )
    )
    if existing_job is not None:
        request.status = "queued"
        await session.flush()
        return request

    request.status = "queued"
    session.add(
        GdprJob(
            request_id=request.id,
            job_type=request.request_type,
            status="queued",
            payload_json={"request_id": str(request.id), "queued_by": str(actor.id)},
            result_json={},
        )
    )
    await session.flush()
    await _append_request_event(
        session,
        request_id=request.id,
        event_type="queued",
        actor_type="admin",
        actor_user_id=actor.id,
        message="GDPR request queued for runner execution.",
    )
    return request


async def _execute_request_job(
    session: AsyncSession,
    *,
    request: GdprRequest,
    job: GdprJob,
    actor_type: str,
    actor_user_id: UUID | None,
) -> None:
    if request.status not in REQUEST_EXECUTABLE_STATUSES:
        job.status = "skipped"
        job.completed_at = utc_now()
        job.result_json = {**(job.result_json or {}), "reason": f"request_status={request.status}"}
        await _append_request_event(
            session,
            request_id=request.id,
            event_type="skipped",
            actor_type=actor_type,
            actor_user_id=actor_user_id,
            message=f"Runner skipped request because status is {request.status}.",
        )
        await session.flush()
        return

    request.status = "executing"
    request.executed_at = utc_now()
    job.status = "running"
    job.started_at = job.started_at or utc_now()
    await session.flush()

    warnings: list[str] = []
    result_json = dict(job.result_json or {})
    woo_sync: dict[str, Any] | None = None

    try:
        if request.request_type == "access_export":
            if not request.verified_customer_id:
                raise HTTPException(status_code=422, detail="Export için doğrulanmış müşteri gerekli.")
            customer = await session.get(User, request.verified_customer_id)
            if customer is None:
                raise HTTPException(status_code=404, detail="Müşteri bulunamadı.")
            result_json.update(await _build_export_archive(session, customer, request))
        elif request.request_type == "erasure_pseudonymize":
            if not request.verified_customer_id:
                raise HTTPException(status_code=422, detail="Pseudonymize için doğrulanmış müşteri gerekli.")
            customer = await session.get(User, request.verified_customer_id)
            if customer is None:
                raise HTTPException(status_code=404, detail="Müşteri bulunamadı.")
            execution = await _execute_pseudonymize(session, customer)
            warnings.extend(execution.get("warnings") or [])
            woo_sync = execution.get("woo_sync")
        elif request.request_type == "objection_restriction":
            if not request.verified_customer_id:
                raise HTTPException(status_code=422, detail="Restriction için doğrulanmış müşteri gerekli.")
            customer = await session.get(User, request.verified_customer_id)
            if customer is None:
                raise HTTPException(status_code=404, detail="Müşteri bulunamadı.")
            execution = await _execute_restriction(session, customer)
            warnings.extend(execution.get("warnings") or [])
            woo_sync = execution.get("woo_sync")
        elif request.request_type == "marketing_opt_out":
            if not request.verified_customer_id:
                raise HTTPException(status_code=422, detail="Opt-out için doğrulanmış müşteri gerekli.")
            customer = await session.get(User, request.verified_customer_id)
            if customer is None:
                raise HTTPException(status_code=404, detail="Müşteri bulunamadı.")
            execution = await _execute_marketing_opt_out(session, customer)
            warnings.extend(execution.get("warnings") or [])
            woo_sync = execution.get("woo_sync")
        else:
            warnings.append("Manual follow-up required.")

        request.status = "completed_with_warnings" if warnings else "completed"
        request.completed_at = utc_now()
        job.status = request.status
        job.completed_at = utc_now()
        if warnings:
            result_json["warnings"] = warnings
        if woo_sync is not None:
            result_json["woo_sync"] = woo_sync
        job.result_json = result_json
        await _append_request_event(
            session,
            request_id=request.id,
            event_type="executed",
            actor_type=actor_type,
            actor_user_id=actor_user_id,
            message="GDPR request executed.",
            payload_json={"warnings": warnings, "woo_sync": woo_sync},
        )
    except Exception as exc:
        job.status = "failed"
        job.completed_at = utc_now()
        job.result_json = {**result_json, "error": str(exc)}
        request.status = "failed"
        request.completed_at = utc_now()
        await _append_request_event(
            session,
            request_id=request.id,
            event_type="failed",
            actor_type=actor_type,
            actor_user_id=actor_user_id,
            message=str(exc),
        )
        raise

    await session.flush()


async def run_queued_gdpr_jobs(
    session: AsyncSession,
    *,
    actor: User | None = None,
    request_id: UUID | None = None,
) -> GdprJob:
    audit_job = await _create_runner_audit_job(
        session,
        job_type="gdpr_runner",
        payload_json={"request_id": str(request_id) if request_id else None},
    )
    warnings: list[str] = []
    processed_request_ids: list[str] = []
    queued_stmt = select(GdprJob).where(GdprJob.status == "queued").order_by(GdprJob.created_at.asc())
    if request_id:
        queued_stmt = queued_stmt.where(GdprJob.request_id == request_id)
    queued_jobs = (await session.scalars(queued_stmt)).all()

    for queued_job in queued_jobs:
        if queued_job.request_id is None:
            queued_job.status = "skipped"
            queued_job.completed_at = utc_now()
            queued_job.result_json = {**(queued_job.result_json or {}), "reason": "missing_request_id"}
            continue
        request = await session.get(GdprRequest, queued_job.request_id)
        if request is None:
            queued_job.status = "failed"
            queued_job.completed_at = utc_now()
            queued_job.result_json = {**(queued_job.result_json or {}), "error": "request_not_found"}
            warnings.append(f"request_not_found:{queued_job.request_id}")
            continue
        try:
            await _execute_request_job(
                session,
                request=request,
                job=queued_job,
                actor_type="admin" if actor else "system",
                actor_user_id=actor.id if actor else None,
            )
        except Exception as exc:
            warnings.append(str(exc))
        processed_request_ids.append(str(request.id))

    cleanup_result = await _purge_old_export_archives(session)
    cleanup_result.update(await _cleanup_expired_tracking_tokens(session))
    audit_job.status = "completed_with_warnings" if warnings else "completed"
    audit_job.completed_at = utc_now()
    audit_job.result_json = {
        "processed_count": len(processed_request_ids),
        "processed_request_ids": processed_request_ids,
        "warnings": warnings,
        **cleanup_result,
    }
    await session.flush()
    return audit_job


async def execute_gdpr_request(session: AsyncSession, request: GdprRequest, *, actor: User) -> GdprRequest:
    await enqueue_gdpr_request(session, request, actor=actor)
    await run_queued_gdpr_jobs(session, actor=actor, request_id=request.id)
    await session.refresh(request)
    return request


async def update_retention_policy(
    session: AsyncSession,
    policy_key: str,
    *,
    title: str | None = None,
    description: str | None = None,
    action: str | None = None,
    retention_days: int | None = None,
    is_enabled: bool | None = None,
) -> GdprRetentionPolicy:
    await ensure_gdpr_seed_data(session)
    policy = await session.scalar(select(GdprRetentionPolicy).where(GdprRetentionPolicy.policy_key == policy_key))
    if policy is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Retention policy bulunamadı.")
    if title is not None:
        policy.title = title
    if description is not None:
        policy.description = description
    if action is not None:
        policy.action = action
    if retention_days is not None:
        policy.retention_days = retention_days
    if is_enabled is not None:
        policy.is_enabled = is_enabled
    await session.flush()
    return policy


async def resolve_export_path(session: AsyncSession, request_id: UUID) -> Path:
    request = await get_gdpr_request_or_404(session, request_id)
    job = await _latest_job_for_request(session, request.id)
    file_path = Path(str((job.result_json or {}).get("file_path") or "")) if job else None
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export dosyası bulunamadı.")
    root = _export_root().resolve()
    resolved = file_path.resolve()
    if root not in resolved.parents and resolved != root:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Export yolu geçersiz.")
    return resolved
