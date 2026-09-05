from __future__ import annotations

import asyncio
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi import Request as FastapiRequest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.testclient import TestClient

from app.api import gdpr as gdpr_api
from app.api.deps import require_admin
from app.config import Settings
from app.database import Base, get_db
from app.models.enums import RoleEnum
from app.models.gdpr_copy_task import GdprCopyTask
from app.models.gdpr_job import GdprJob
from app.models.gdpr_request import GdprRequest
from app.models.user import User
from app.schemas.gdpr import GdprPublicRequestCreateIn
from app.services import gdpr_service
from app.services.gdpr_service import (
    execute_gdpr_request,
    retry_gdpr_request,
    run_queued_gdpr_jobs,
    submit_public_gdpr_request,
    update_gdpr_copy_task,
)
from app.utils.helpers import utc_now


class _BoundFactory(async_sessionmaker[AsyncSession]):
    def __init__(self, engine) -> None:
        super().__init__(engine, expire_on_commit=False, class_=AsyncSession)
        self.engine = engine


async def _make_session() -> _BoundFactory:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return _BoundFactory(engine)


def _public_scope(ip: str) -> dict:
    return {
        "type": "http",
        "method": "POST",
        "path": "/api/v2/public/gdpr/request",
        "headers": [],
        "query_string": b"",
        "client": (ip, 44444),
        "server": ("testserver", 80),
        "scheme": "http",
    }


def _public_payload(**overrides) -> GdprPublicRequestCreateIn:
    values = {
        "request_type": "access_export",
        "subject_name": "Test Subject",
        "subject_email": "subject@example.com",
        "subject_phone": None,
        "message": None,
        "accepted_privacy": True,
        "honeypot": None,
    }
    values.update(overrides)
    return GdprPublicRequestCreateIn(**values)


@pytest.fixture(autouse=True)
def _reset_rate_bucket():
    gdpr_api._public_request_rate_bucket.clear()
    yield
    gdpr_api._public_request_rate_bucket.clear()


# ---------------------------------------------------------------------------
# Fix 1: public endpoint abuse guards
# ---------------------------------------------------------------------------


def test_public_request_dedupe_returns_existing_tracking_link() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            first = await submit_public_gdpr_request(session, _public_payload())
            await session.commit()
            second = await submit_public_gdpr_request(session, _public_payload())
            await session.commit()

            assert second.reference_number == first.reference_number
            assert second.tracking_token == first.tracking_token
            assert second.status == first.status
            count = await session.scalar(select(func.count(GdprRequest.id)))
            assert count == 1

        await factory.engine.dispose()

    asyncio.run(run())


def test_public_request_dedupe_is_scoped_to_email_and_type() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            first = await submit_public_gdpr_request(session, _public_payload())
            other_type = await submit_public_gdpr_request(
                session, _public_payload(request_type="erasure_pseudonymize")
            )
            other_email = await submit_public_gdpr_request(
                session, _public_payload(subject_email="other@example.com")
            )

            assert other_type.reference_number != first.reference_number
            assert other_email.reference_number != first.reference_number
            count = await session.scalar(select(func.count(GdprRequest.id)))
            assert count == 3

        await factory.engine.dispose()

    asyncio.run(run())


def test_public_request_dedupe_allows_resubmit_after_rejection() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            first = await submit_public_gdpr_request(session, _public_payload())
            await session.commit()
            row = await session.scalar(
                select(GdprRequest).where(GdprRequest.public_tracking_token == first.tracking_token)
            )
            assert row is not None
            row.status = "rejected"
            await session.commit()

            resubmitted = await submit_public_gdpr_request(session, _public_payload())
            await session.commit()
            assert resubmitted.reference_number != first.reference_number

        await factory.engine.dispose()

    asyncio.run(run())


async def _seed_reference(session: AsyncSession, reference: str) -> None:
    session.add(
        GdprRequest(
            reference_number=reference,
            request_type="access_export",
            status="identity_pending",
            channel="public_page",
            subject_name="Seeder",
            subject_email="seed@example.com",
            public_tracking_token=f"seed-token-{reference}",
            request_meta={},
        )
    )
    await session.flush()


def test_public_reference_collision_retries_then_creates_request() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            await _seed_reference(session, "GDPR-COLLIDE-01")
            calls = {"n": 0}

            def fake_reference() -> str:
                calls["n"] += 1
                if calls["n"] <= 2:
                    return "GDPR-COLLIDE-01"
                return "GDPR-FRESH-01"

            original = gdpr_service._request_reference
            gdpr_service._request_reference = fake_reference
            try:
                created = await submit_public_gdpr_request(session, _public_payload())
            finally:
                gdpr_service._request_reference = original
            await session.commit()
            assert created.reference_number == "GDPR-FRESH-01"
            assert calls["n"] == 3
            # No stale colliding candidate was re-flushed at commit time.
            count = await session.scalar(select(func.count(GdprRequest.id)))
            assert count == 2

        await factory.engine.dispose()

    asyncio.run(run())


def test_public_reference_collision_exhausts_to_409() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            await _seed_reference(session, "GDPR-COLLIDE-99")
            original = gdpr_service._request_reference
            gdpr_service._request_reference = lambda: "GDPR-COLLIDE-99"
            try:
                with pytest.raises(HTTPException) as excinfo:
                    await submit_public_gdpr_request(session, _public_payload())
            finally:
                gdpr_service._request_reference = original
            assert excinfo.value.status_code == 409

        await factory.engine.dispose()

    asyncio.run(run())


def test_public_rate_limit_blocks_sixth_submission_per_ip() -> None:
    for _ in range(5):
        gdpr_api._enforce_public_request_rate_limit("203.0.113.5")
    with pytest.raises(HTTPException) as excinfo:
        gdpr_api._enforce_public_request_rate_limit("203.0.113.5")
    assert excinfo.value.status_code == 429
    # A different IP is unaffected.
    gdpr_api._enforce_public_request_rate_limit("203.0.113.6")


def test_public_honeypot_rejects_without_db_write() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            request = FastapiRequest(_public_scope("198.51.100.7"))
            with pytest.raises(HTTPException) as excinfo:
                await gdpr_api.post_public_request(
                    payload=_public_payload(honeypot="http://spam.example"),
                    request=request,
                    db=session,
                )
            assert excinfo.value.status_code == 422
            count = await session.scalar(select(func.count(GdprRequest.id)))
            assert count == 0

            created = await gdpr_api.post_public_request(
                payload=_public_payload(),
                request=request,
                db=session,
            )
            await session.commit()
            assert created.tracking_token
            count = await session.scalar(select(func.count(GdprRequest.id)))
            assert count == 1

        await factory.engine.dispose()

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Fix 2: admin run triggers + read-only GET/execute semantics
# ---------------------------------------------------------------------------


def _admin_app(factory: async_sessionmaker[AsyncSession], admin_like) -> FastAPI:
    app = FastAPI()
    app.include_router(gdpr_api.admin_router, prefix="/api/v2/gdpr")

    async def override_get_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_admin] = lambda: admin_like
    return app


def test_admin_run_endpoints_require_auth() -> None:
    app = FastAPI()
    app.include_router(gdpr_api.admin_router, prefix="/api/v2/gdpr")
    client = TestClient(app)

    for path in ("/api/v2/gdpr/run", "/api/v2/gdpr/retention-scan"):
        response = client.post(path)
        assert response.status_code == 401, path


def test_admin_run_endpoint_executes_queue_with_cleanup_and_retention_scan() -> None:
    async def build():
        factory = await _make_session()
        async with factory() as session:
            admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            customer = User(email="customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            stale_customer = User(
                email="stale@test.local",
                password_hash="x",
                name="Stale Customer",
                role=RoleEnum.CUSTOMER,
                created_at=utc_now() - timedelta(days=365 * 6),
                updated_at=utc_now() - timedelta(days=365 * 6),
            )
            session.add_all([admin, customer, stale_customer])
            await session.flush()
            request = GdprRequest(
                reference_number="GDPR-RUNENDPOINT-0001",
                request_type="objection_restriction",
                status="approved",
                channel="admin_created",
                subject_name=customer.name,
                subject_email=customer.email,
                verified_customer_id=customer.id,
                public_tracking_token="run-endpoint-token",
                public_tracking_token_expires_at=utc_now() + timedelta(days=30),
                due_at=utc_now() + timedelta(days=30),
                request_meta={},
            )
            session.add(request)
            # Expired tracking token on a public request: batch runner cleans it.
            expired = GdprRequest(
                reference_number="GDPR-EXPTOKEN-0001",
                request_type="access_export",
                status="identity_pending",
                channel="public_page",
                subject_name="Expired",
                subject_email="expired@example.com",
                public_tracking_token="expired-token-value",
                public_tracking_token_expires_at=utc_now() - timedelta(days=1),
                request_meta={},
            )
            session.add(expired)
            await session.flush()
            await gdpr_service.enqueue_gdpr_request(session, request, actor=admin)
            await session.commit()
            return factory, admin, request, expired

    async def run() -> None:
        factory, admin, request, expired = await build()
        app = _admin_app(factory, SimpleNamespace(id=admin.id, role=admin.role))
        client = TestClient(app)

        response = client.post("/api/v2/gdpr/retention-scan")
        assert response.status_code == 200, response.text
        scan = response.json()
        assert scan["job_type"] == "retention_scan"
        assert scan["status"] == "completed"
        assert scan["result_json"]["created_request_count"] == 1

        response = client.post("/api/v2/gdpr/run")
        assert response.status_code == 200, response.text
        run_job = response.json()
        assert run_job["job_type"] == "gdpr_runner"
        assert run_job["status"] == "completed"
        assert run_job["result_json"]["cleaned_tracking_tokens"] == 1

        async with factory() as session:
            refreshed = await session.get(GdprRequest, request.id)
            assert refreshed.status == "completed"
            refreshed_expired = await session.get(GdprRequest, expired.id)
            assert refreshed_expired.public_tracking_token == f"expired-{expired.id}"

        await factory.engine.dispose()

    asyncio.run(run())


def test_single_execute_mode_skips_purge_and_token_cleanup() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            customer = User(email="customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([admin, customer])
            await session.flush()
            request = GdprRequest(
                reference_number="GDPR-SINGLEEXEC-0001",
                request_type="objection_restriction",
                status="approved",
                channel="admin_created",
                subject_name=customer.name,
                subject_email=customer.email,
                verified_customer_id=customer.id,
                public_tracking_token="single-exec-token",
                public_tracking_token_expires_at=utc_now() + timedelta(days=30),
                due_at=utc_now() + timedelta(days=30),
                request_meta={},
            )
            session.add(request)
            expired = GdprRequest(
                reference_number="GDPR-EXPTOKEN-0002",
                request_type="access_export",
                status="identity_pending",
                channel="public_page",
                subject_name="Expired",
                subject_email="expired2@example.com",
                public_tracking_token="expired-token-single",
                public_tracking_token_expires_at=utc_now() - timedelta(days=1),
                request_meta={},
            )
            session.add(expired)
            await session.flush()

            await execute_gdpr_request(session, request, actor=admin)

            refreshed_expired = await session.get(GdprRequest, expired.id)
            assert refreshed_expired.public_tracking_token == "expired-token-single"

            # Explicit batch mode still performs the maintenance cleanup.
            await run_queued_gdpr_jobs(session, actor=admin, include_cleanup=True)
            refreshed_expired = await session.get(GdprRequest, expired.id)
            assert refreshed_expired.public_tracking_token == f"expired-{expired.id}"

        await factory.engine.dispose()

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Fix 3: Woo-first atomic pseudonymize + retry/override
# ---------------------------------------------------------------------------


def _configure_woo(monkeypatch, *, behavior) -> None:
    monkeypatch.setattr(
        gdpr_service,
        "get_settings",
        lambda: Settings(
            woocommerce_base_url="https://woocommerce.test",
            woocommerce_consumer_key="ck_test",
            woocommerce_consumer_secret="cs_test",
        ),
    )

    async def fake_pseudonymize(self, **kwargs):
        return behavior(kwargs)

    monkeypatch.setattr(gdpr_service.WooCommerceService, "pseudonymize_customer", fake_pseudonymize)


async def _pseudonymize_fixture(session: AsyncSession) -> tuple[User, User, GdprRequest]:
    admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
    customer = User(
        email="customer@test.local",
        password_hash="x",
        name="Woo Customer",
        role=RoleEnum.CUSTOMER,
        phone="+45 22223333",
        postal_code="2500",
        address_encrypted="enc-address",
        cpr_number_encrypted="enc-cpr",
        cpr_last4="1234",
        woocommerce_customer_id="42",
    )
    session.add_all([admin, customer])
    await session.flush()
    request = GdprRequest(
        reference_number="GDPR-ATOMIC-0001",
        request_type="erasure_pseudonymize",
        status="approved",
        channel="admin_created",
        subject_name=customer.name,
        subject_email=customer.email,
        verified_customer_id=customer.id,
        public_tracking_token="atomic-token",
        public_tracking_token_expires_at=utc_now() + timedelta(days=30),
        due_at=utc_now() + timedelta(days=30),
        request_meta={},
    )
    session.add(request)
    await session.flush()
    return admin, customer, request


def test_woo_failure_preserves_crm_data_and_keeps_request_retryable(monkeypatch) -> None:
    _configure_woo(monkeypatch, behavior=lambda kwargs: (_ for _ in ()).throw(RuntimeError("woo down")))

    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            admin, customer, request = await _pseudonymize_fixture(session)

            await execute_gdpr_request(session, request, actor=admin)

            assert request.status == "pseudonymize_pending"
            assert request.completed_at is None
            # CRM authoritative data fully preserved.
            assert customer.email == "customer@test.local"
            assert customer.phone == "+45 22223333"
            assert customer.address_encrypted == "enc-address"
            assert customer.cpr_number_encrypted == "enc-cpr"
            assert customer.cpr_last4 == "1234"
            assert customer.gdpr_status != "pseudonymized"
            assert customer.gdpr_pseudonymized_at is None
            # Woo copy task stays non-terminal so a retry can re-run it.
            woo_task = await session.scalar(
                select(GdprCopyTask).where(
                    GdprCopyTask.request_id == request.id, GdprCopyTask.task_key == "woocommerce"
                )
            )
            assert woo_task is not None
            assert woo_task.status == "pending"
            latest_job = await session.scalar(
                select(GdprJob).where(GdprJob.request_id == request.id).order_by(GdprJob.created_at.desc())
            )
            assert latest_job is not None
            assert latest_job.status == "pseudonymize_pending"
            # The pending state counts as open, so the retention scan skips it.
            assert request.status in gdpr_service.OPEN_REQUEST_STATUSES

        await factory.engine.dispose()

    asyncio.run(run())


def test_retry_after_woo_recovery_applies_crm_pseudonymize(monkeypatch) -> None:
    _configure_woo(monkeypatch, behavior=lambda kwargs: (_ for _ in ()).throw(RuntimeError("woo down")))

    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            admin, customer, request = await _pseudonymize_fixture(session)
            await execute_gdpr_request(session, request, actor=admin)
            assert request.status == "pseudonymize_pending"

            _configure_woo(
                monkeypatch,
                behavior=lambda kwargs: {
                    "status": "synced",
                    "matched_by": "woocommerce_customer_id",
                    "updated_ids": [42],
                    "warnings": [],
                },
            )
            await retry_gdpr_request(session, request, actor=admin, reason="Woo bağlantısı geri geldi")

            # Woo succeeded, so the CRM mutation is now finalized.
            assert customer.gdpr_status == "pseudonymized"
            assert customer.gdpr_pseudonymized_at is not None
            assert customer.email != "customer@test.local"
            assert customer.address_encrypted is None
            assert customer.cpr_number_encrypted is None
            woo_task = await session.scalar(
                select(GdprCopyTask).where(
                    GdprCopyTask.request_id == request.id, GdprCopyTask.task_key == "woocommerce"
                )
            )
            assert woo_task.status == "pseudonymized"
            assert request.status in {"completed", "manual_action_required"}
            assert request.status != "failed"

        await factory.engine.dispose()

    asyncio.run(run())


def test_retry_rejects_non_retryable_request_and_requires_reason() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            session.add(admin)
            await session.flush()
            request = GdprRequest(
                reference_number="GDPR-RETRYGUARD-0001",
                request_type="access_export",
                status="approved",
                channel="admin_created",
                subject_name="Someone",
                public_tracking_token="retry-guard-token",
                request_meta={},
            )
            session.add(request)
            await session.flush()

            with pytest.raises(HTTPException) as status_error:
                await retry_gdpr_request(session, request, actor=admin, reason="not allowed here")
            assert status_error.value.status_code == 422

            request.status = "failed"
            with pytest.raises(HTTPException) as reason_error:
                await retry_gdpr_request(session, request, actor=admin, reason="  ")
            assert reason_error.value.status_code == 422

        await factory.engine.dispose()

    asyncio.run(run())


def test_patch_override_recovers_failed_copy_task() -> None:
    async def run() -> None:
        factory = await _make_session()
        async with factory() as session:
            admin = User(email="admin@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
            customer = User(email="customer@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([admin, customer])
            await session.flush()
            request = GdprRequest(
                reference_number="GDPR-OVERRIDE-0001",
                request_type="erasure_pseudonymize",
                status="failed",
                channel="admin_created",
                subject_name=customer.name,
                subject_email=customer.email,
                verified_customer_id=customer.id,
                public_tracking_token="override-token",
                request_meta={},
            )
            session.add(request)
            await session.flush()
            woo_task = GdprCopyTask(
                request_id=request.id,
                task_key="woocommerce",
                system_name="WooCommerce",
                copy_scope="store customer copy",
                applicable=True,
                status="failed",
                reason="WooCommerce privacy sync failed.",
                metadata_json={},
            )
            session.add(woo_task)
            await session.flush()

            # Without override a FAILED copy task is a dead end.
            with pytest.raises(HTTPException) as blocked:
                await update_gdpr_copy_task(
                    session,
                    request,
                    task_id=woo_task.id,
                    actor=admin,
                    status_value="pending",
                    reason="trying to recover",
                )
            assert blocked.value.status_code == 422

            # With override the FAILED task becomes retryable and the request
            # returns to an executable status.
            await update_gdpr_copy_task(
                session,
                request,
                task_id=woo_task.id,
                actor=admin,
                status_value="pending",
                reason="Woo restored; operator approved retry.",
                override_terminal=True,
            )
            assert woo_task.status == "pending"
            assert request.status == "approved"

        await factory.engine.dispose()

    asyncio.run(run())


def test_retry_endpoint_requires_admin() -> None:
    app = FastAPI()
    app.include_router(gdpr_api.admin_router, prefix="/api/v2/gdpr")
    client = TestClient(app)
    response = client.post(f"/api/v2/gdpr/requests/{uuid4()}/retry", json={"reason": "operator retry"})
    assert response.status_code == 401
