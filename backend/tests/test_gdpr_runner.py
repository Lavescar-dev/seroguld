from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import RoleEnum
from app.models.gdpr_request import GdprRequest
from app.models.user import User
from app.services import gdpr_service
from app.services.gdpr_service import (
    enqueue_gdpr_request,
    execute_gdpr_request,
    get_gdpr_overview,
    get_public_gdpr_bridge_config,
    list_gdpr_jobs,
    run_queued_gdpr_jobs,
    run_retention_scan,
)
from app.utils.helpers import utc_now


async def _session_factory() -> async_sessionmaker[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.mark.asyncio
async def test_retention_scan_creates_single_review_request_and_updates_overview() -> None:
    Session = await _session_factory()
    async with Session() as session:
        customer = User(
            email="retention@test.local",
            password_hash="x",
            name="Retention Customer",
            role=RoleEnum.CUSTOMER,
            created_at=utc_now() - timedelta(days=365 * 6),
            updated_at=utc_now() - timedelta(days=365 * 6),
        )
        session.add(customer)
        await session.flush()

        first_scan = await run_retention_scan(session)
        second_scan = await run_retention_scan(session)
        overview = await get_gdpr_overview(session)

        requests = (await session.scalars(select(GdprRequest).order_by(GdprRequest.created_at.asc()))).all()

        assert first_scan.status == "completed"
        assert (first_scan.result_json or {}).get("created_request_count") == 1
        assert second_scan.status == "completed"
        assert (second_scan.result_json or {}).get("created_request_count") == 0
        assert len(requests) == 1
        assert requests[0].channel == "retention_scan"
        assert requests[0].status == "under_review"
        assert overview.eligible_pseudonymize_count == 0
        assert overview.last_scan_at is not None


@pytest.mark.asyncio
async def test_enqueue_and_runner_process_restriction_request_and_list_jobs() -> None:
    Session = await _session_factory()
    async with Session() as session:
        admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
        customer = User(email="customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
        session.add_all([admin, customer])
        await session.flush()

        request = GdprRequest(
            reference_number="GDPR-RUNNER-0001",
            request_type="objection_restriction",
            status="approved",
            channel="admin_created",
            subject_name=customer.name,
            subject_email=customer.email,
            verified_customer_id=customer.id,
            public_tracking_token="runner-token",
            public_tracking_token_expires_at=utc_now() + timedelta(days=30),
            due_at=utc_now() + timedelta(days=30),
            request_meta={},
        )
        session.add(request)
        await session.flush()

        await enqueue_gdpr_request(session, request, actor=admin)
        runner_job = await run_queued_gdpr_jobs(session)
        jobs = await list_gdpr_jobs(session)

        assert request.status == "completed"
        assert customer.gdpr_status == "restricted"
        assert runner_job.status == "completed"
        assert any(job.job_type == "objection_restriction" for job in jobs)
        assert any(job.job_type == "gdpr_runner" for job in jobs)


@pytest.mark.asyncio
async def test_execute_pseudonymize_prefers_explicit_woocommerce_customer_id(monkeypatch) -> None:
    Session = await _session_factory()
    async with Session() as session:
        admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
        customer = User(
            email="customer@test.local",
            password_hash="x",
            name="Woo Customer",
            role=RoleEnum.CUSTOMER,
            woocommerce_customer_id="42",
        )
        session.add_all([admin, customer])
        await session.flush()

        captured: dict[str, object] = {}

        async def fake_pseudonymize_customer(self, *, woocommerce_customer_id, email, phone, placeholder_email):
            captured["woocommerce_customer_id"] = woocommerce_customer_id
            captured["email"] = email
            return {"status": "synced", "matched_by": "woocommerce_customer_id", "updated_ids": [42], "warnings": []}

        monkeypatch.setattr(
            gdpr_service.WooCommerceService,
            "pseudonymize_customer",
            fake_pseudonymize_customer,
        )

        request = GdprRequest(
            reference_number="GDPR-WOO-0001",
            request_type="erasure_pseudonymize",
            status="approved",
            channel="admin_created",
            subject_name=customer.name,
            subject_email=customer.email,
            verified_customer_id=customer.id,
            public_tracking_token="woo-token",
            public_tracking_token_expires_at=utc_now() + timedelta(days=30),
            due_at=utc_now() + timedelta(days=30),
            request_meta={},
        )
        session.add(request)
        await session.flush()

        await execute_gdpr_request(session, request, actor=admin)

        assert request.status == "manual_action_required"
        assert request.completed_at is None
        assert captured["woocommerce_customer_id"] == "42"


def test_public_bridge_config_exposes_cookie_endpoint_and_urls() -> None:
    payload = get_public_gdpr_bridge_config()

    assert payload.privacy_policy_url.endswith("/gdpr/privacy")
    assert payload.cookies_url.endswith("/gdpr/cookies")
    assert payload.privacy_request_url.endswith("/gdpr/request")
    assert payload.cookie_config_url == "/api/v2/public/gdpr/cookie-config"
    assert payload.cookie_categories
