from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import AppBaseModel
from app.schemas.customer import CustomerOut
from app.schemas.runtime import RuntimeReadinessCheckOut


class GdprOverviewOut(AppBaseModel):
    open_request_count: int
    due_soon_count: int
    overdue_count: int
    completed_30d_count: int
    eligible_pseudonymize_count: int
    locked_product_count: int
    processor_warning_count: int
    queued_job_count: int
    failed_job_count: int
    last_scan_at: datetime | None = None
    last_run_at: datetime | None = None
    readiness_checks: list[RuntimeReadinessCheckOut] = Field(default_factory=list)


class GdprRequestListItemOut(AppBaseModel):
    id: UUID
    reference_number: str
    request_type: str
    status: str
    channel: str
    subject_name: str | None = None
    subject_email: str | None = None
    subject_phone: str | None = None
    verified_customer_id: UUID | None = None
    verified_customer_name: str | None = None
    due_at: datetime | None = None
    submitted_at: datetime
    completed_at: datetime | None = None


class GdprRequestEventOut(AppBaseModel):
    id: UUID
    event_type: str
    actor_type: str
    actor_user_id: UUID | None = None
    message: str | None = None
    payload_json: dict = Field(default_factory=dict)
    created_at: datetime


class GdprJobOut(AppBaseModel):
    id: UUID
    request_id: UUID | None = None
    request_reference_number: str | None = None
    job_type: str
    status: str
    payload_json: dict = Field(default_factory=dict)
    result_json: dict = Field(default_factory=dict)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime


class GdprCopyTaskOut(AppBaseModel):
    id: UUID
    request_id: UUID
    task_key: str
    system_name: str
    copy_scope: str
    applicable: bool
    status: str
    is_terminal: bool
    completion_eligible: bool
    reason: str | None = None
    metadata_json: dict = Field(default_factory=dict)
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class GdprCopyTaskUpdateIn(AppBaseModel):
    status: str = Field(max_length=40)
    reason: str | None = Field(default=None, max_length=2000)


class GdprRequestDetailOut(GdprRequestListItemOut):
    message: str | None = None
    decision_reason: str | None = None
    request_meta: dict = Field(default_factory=dict)
    match_candidates: list[CustomerOut] = Field(default_factory=list)
    events: list[GdprRequestEventOut] = Field(default_factory=list)
    latest_job: GdprJobOut | None = None
    export_download_path: str | None = None
    copy_tasks: list[GdprCopyTaskOut] = Field(default_factory=list)


class GdprRequestVerifyIn(AppBaseModel):
    customer_id: UUID


class GdprRequestDecisionIn(AppBaseModel):
    reason: str | None = Field(default=None, max_length=2000)


class GdprRetentionPolicyOut(AppBaseModel):
    id: UUID
    policy_key: str
    title: str
    description: str | None = None
    applies_to: str
    action: str
    retention_days: int
    is_enabled: bool
    updated_at: datetime


class GdprRetentionPolicyUpdateIn(AppBaseModel):
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    action: str | None = Field(default=None, max_length=40)
    retention_days: int | None = Field(default=None, ge=1, le=3650)
    is_enabled: bool | None = None


class GdprProcessorOut(AppBaseModel):
    id: UUID
    processor_key: str
    title: str
    category: str
    system_name: str
    status: str
    configured: bool
    endpoint_url: str | None = None
    detail: str | None = None
    notes: str | None = None
    last_checked_at: datetime | None = None


class GdprPublicSiteConfigOut(AppBaseModel):
    company_name: str
    company_email: str | None = None
    company_phone: str | None = None
    company_address: str | None = None
    company_cvr: str | None = None
    website_url: str | None = None
    wordpress_url: str | None = None
    privacy_email: str | None = None
    privacy_request_url: str
    privacy_policy_url: str
    cookies_url: str


class GdprPublicCookieCategoryOut(AppBaseModel):
    key: str
    title: str
    required: bool
    description: str


class GdprPublicCookieConfigOut(AppBaseModel):
    categories: list[GdprPublicCookieCategoryOut] = Field(default_factory=list)


class GdprPublicBridgeConfigOut(AppBaseModel):
    version: str
    updated_at: datetime
    company_name: str
    company_email: str | None = None
    company_phone: str | None = None
    company_address: str | None = None
    company_cvr: str | None = None
    website_url: str | None = None
    wordpress_url: str | None = None
    privacy_request_url: str
    privacy_policy_url: str
    cookies_url: str
    cookie_config_url: str
    cookie_categories: list[GdprPublicCookieCategoryOut] = Field(default_factory=list)


class GdprPublicRequestCreateIn(AppBaseModel):
    request_type: str = Field(max_length=40)
    subject_name: str = Field(min_length=2, max_length=200)
    subject_email: str | None = Field(default=None, max_length=200)
    subject_phone: str | None = Field(default=None, max_length=30)
    message: str | None = Field(default=None, max_length=4000)
    accepted_privacy: bool = True


class GdprPublicRequestCreateOut(AppBaseModel):
    reference_number: str
    tracking_token: str
    status: str
    due_at: datetime


class GdprPublicRequestStatusOut(AppBaseModel):
    reference_number: str
    request_type: str
    status: str
    submitted_at: datetime
    due_at: datetime | None = None
    completed_at: datetime | None = None
    last_message: str | None = None
