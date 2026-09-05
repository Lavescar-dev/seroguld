"""M2-gdpr medium bulgu düzeltmelerinin regresyon testleri.

Kapsam: karar durum makinesi (409 matrisi), enqueue idempotensi, failed event
mesaj sızıntısı, bozuk şifreli alanda export dayanıklılığı, CSV formül
enjeksiyonu, rıza zorunluluğu, OPMC processor dürüstlüğü, retention
kör-noktası ve completed_30d metriği.
"""

from __future__ import annotations

import csv
import io
from datetime import timedelta
from typing import Any

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings
from app.database import Base
from app.models.enums import RoleEnum
from app.models.gdpr_job import GdprJob
from app.models.gdpr_request import GdprRequest
from app.models.gdpr_request_event import GdprRequestEvent
from app.models.user import User
from app.schemas.gdpr import GdprPublicRequestCreateIn
from app.services import gdpr_service
from app.services.gdpr_service import (
    approve_gdpr_request,
    enqueue_gdpr_request,
    execute_gdpr_request,
    get_gdpr_overview,
    reject_gdpr_request,
    run_queued_gdpr_jobs,
    run_retention_scan,
    submit_public_gdpr_request,
    verify_gdpr_request,
)
from app.utils.helpers import utc_now


GENERIC_FAILED_MESSAGE = "GDPR request execution failed"


async def _session_factory() -> tuple[async_sessionmaker[AsyncSession], Any]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession), engine


async def _mk_admin_customer(session: AsyncSession, *, suffix: str = "0001") -> tuple[User, User]:
    admin = User(email=f"admin-{suffix}@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
    customer = User(email=f"customer-{suffix}@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
    session.add_all([admin, customer])
    await session.flush()
    return admin, customer


def _mk_request(customer: User, *, reference: str, status: str, request_type: str = "access_export") -> GdprRequest:
    return GdprRequest(
        reference_number=reference,
        request_type=request_type,
        status=status,
        channel="admin_created",
        subject_name=customer.name,
        subject_email=customer.email,
        verified_customer_id=customer.id,
        public_tracking_token=f"m2-token-{reference}",
        public_tracking_token_expires_at=utc_now() + timedelta(days=30),
        due_at=utc_now() + timedelta(days=30),
        request_meta={},
    )


# ---------------------------------------------------------------------------
# Bulgu: verify/approve/reject durum makinesi korumasıztı
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_decision_state_machine_blocks_illegal_transitions() -> None:
    Session, engine = await _session_factory()
    async with Session() as session:
        admin, customer = await _mk_admin_customer(session)

        completed = _mk_request(customer, reference="GDPR-M2-COMP-1", status="completed")
        rejected = _mk_request(customer, reference="GDPR-M2-REJ-1", status="rejected")
        executing = _mk_request(customer, reference="GDPR-M2-EXEC-1", status="executing")
        session.add_all([completed, rejected, executing])
        await session.flush()

        with pytest.raises(HTTPException) as excinfo:
            await verify_gdpr_request(session, completed, customer_id=customer.id, actor=admin)
        assert excinfo.value.status_code == 409

        with pytest.raises(HTTPException) as excinfo:
            await approve_gdpr_request(session, rejected, actor=admin)
        assert excinfo.value.status_code == 409

        with pytest.raises(HTTPException) as excinfo:
            await verify_gdpr_request(session, rejected, customer_id=customer.id, actor=admin)
        assert excinfo.value.status_code == 409

        with pytest.raises(HTTPException) as excinfo:
            await reject_gdpr_request(session, executing, actor=admin)
        assert excinfo.value.status_code == 409

        # Yeniden açılış: verify/approve tamamlanma damgalarını sıfırlar.
        stuck = _mk_request(customer, reference="GDPR-M2-STUCK-1", status="manual_action_required")
        stuck.completed_at = utc_now()
        stuck.executed_at = utc_now()
        session.add(stuck)
        await session.flush()
        await verify_gdpr_request(session, stuck, customer_id=customer.id, actor=admin)
        assert stuck.status == "verified"
        assert stuck.completed_at is None

        stuck.executed_at = utc_now()
        await approve_gdpr_request(session, stuck, actor=admin, reason="retry")
        assert stuck.status == "approved"
        assert stuck.completed_at is None
        assert stuck.executed_at is None

        # queued reddedilebilir (runner skip eder), executing reddedilemez.
        queued = _mk_request(customer, reference="GDPR-M2-QUEUED-1", status="queued")
        session.add(queued)
        await session.flush()
        await reject_gdpr_request(session, queued, actor=admin, reason="withdrawn")
        assert queued.status == "rejected"
        assert queued.completed_at is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_enqueue_is_idempotent_and_blocks_after_completion() -> None:
    Session, engine = await _session_factory()
    async with Session() as session:
        admin, customer = await _mk_admin_customer(session, suffix="0002")
        request = _mk_request(
            customer,
            reference="GDPR-M2-IDEM-1",
            status="approved",
            request_type="objection_restriction",
        )
        session.add(request)
        await session.flush()

        await enqueue_gdpr_request(session, request, actor=admin)
        await enqueue_gdpr_request(session, request, actor=admin)

        job_count = int(
            await session.scalar(
                select(func.count(GdprJob.id)).where(
                    GdprJob.request_id == request.id,
                    GdprJob.job_type == "objection_restriction",
                )
            )
            or 0
        )
        assert job_count == 1

        await session.commit()
        await execute_gdpr_request(session, request, actor=admin)
        assert request.status == "manual_action_required"

        # Tamamlanan (aksiyon bekleyen) talep üzerine ikinci execute 422 döner;
        # koşulsuz yeniden kuyruğa alma yok.
        with pytest.raises(HTTPException) as excinfo:
            await execute_gdpr_request(session, request, actor=admin)
        assert excinfo.value.status_code == 422

        job_count = int(
            await session.scalar(
                select(func.count(GdprJob.id)).where(
                    GdprJob.request_id == request.id,
                    GdprJob.job_type == "objection_restriction",
                )
            )
            or 0
        )
        assert job_count == 1

    await engine.dispose()


# ---------------------------------------------------------------------------
# Bulgu: public takip ucu failed event mesajını auth'suz döndürüyordu
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_failed_event_message_is_generic_and_detail_stays_admin_only(monkeypatch) -> None:
    Session, engine = await _session_factory()
    async with Session() as session:
        admin, customer = await _mk_admin_customer(session, suffix="0003")
        request = _mk_request(customer, reference="GDPR-M2-LEAK-1", status="approved")
        session.add(request)
        await session.flush()

        async def boom(*args, **kwargs):
            raise ValueError("binascii Error: SECRET-CPR-DETAIL")

        monkeypatch.setattr(gdpr_service, "_build_export_archive", boom)

        await enqueue_gdpr_request(session, request, actor=admin)
        audit_job = await run_queued_gdpr_jobs(session, request_id=request.id)
        assert audit_job.status == "completed_with_warnings"

        events = (
            await session.scalars(
                select(GdprRequestEvent)
                .where(GdprRequestEvent.request_id == request.id)
                .order_by(GdprRequestEvent.created_at.asc())
            )
        ).all()
        failed_events = [event for event in events if event.event_type == "failed"]
        assert failed_events, "failed event yazılmalı"
        message = failed_events[-1].message or ""
        assert message.startswith(GENERIC_FAILED_MESSAGE)
        assert "SECRET-CPR-DETAIL" not in message
        assert failed_events[-1].payload_json.get("error") == "binascii Error: SECRET-CPR-DETAIL"

        job = (
            await session.scalars(
                select(GdprJob).where(GdprJob.request_id == request.id, GdprJob.status == "failed")
            )
        ).first()
        assert job is not None
        assert (job.result_json or {}).get("error") == "binascii Error: SECRET-CPR-DETAIL"
        assert request.status == "failed"

    await engine.dispose()


@pytest.mark.asyncio
async def test_export_survives_corrupt_encrypted_field() -> None:
    Session, engine = await _session_factory()
    async with Session() as session:
        admin = User(email="admin-0004@test.local", password_hash="x", name="Admin", role=RoleEnum.ADMIN)
        customer = User(
            email="customer-0004@test.local",
            password_hash="x",
            name="Corrupt Cpr",
            role=RoleEnum.CUSTOMER,
            # decrypt_field bozuk değeri None'a düşürür; export komple fail
            # etmemeli ve hata metni public yüze taşınmamalı.
            cpr_number_encrypted="definitely-not-a-valid-cipher",
        )
        session.add_all([admin, customer])
        await session.flush()
        request = _mk_request(customer, reference="GDPR-M2-CORRUPT-1", status="approved")
        session.add(request)
        await session.flush()

        await execute_gdpr_request(session, request, actor=admin)

        job = (
            await session.scalars(
                select(GdprJob).where(GdprJob.request_id == request.id, GdprJob.job_type == "access_export")
            )
        ).one()
        assert job.status != "failed"
        assert "error" not in (job.result_json or {})
        assert (job.result_json or {}).get("file_path")

    await engine.dispose()


# ---------------------------------------------------------------------------
# Bulgu: CSV formül enjeksiyonu
# ---------------------------------------------------------------------------


def test_csv_formula_injection_guard() -> None:
    text = gdpr_service._csv_text(
        ["name", "email", "amount", "note"],
        [
            {
                "name": "=HYPERLINK(\"http://evil\")",
                "email": "+4512345678",
                "amount": "-123.45",
                "note": "@SUM(1)",
            }
        ],
    )
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[1] == [
        "'=HYPERLINK(\"http://evil\")",
        "'+4512345678",
        "-123.45",  # düz negatif sayı → veri sadakati korunur
        "'@SUM(1)",
    ]


# ---------------------------------------------------------------------------
# Bulgu: rıza kaydı zayıf (accepted_privacy default True, hardcoded meta)
# ---------------------------------------------------------------------------


def test_public_consent_schema_requires_explicit_acceptance() -> None:
    with pytest.raises(ValidationError):
        GdprPublicRequestCreateIn(
            request_type="access_export",
            subject_name="Test Subject",
        )


@pytest.mark.asyncio
async def test_public_consent_is_rejected_without_flag_and_audited_with_flag() -> None:
    Session, engine = await _session_factory()
    async with Session() as session:
        with pytest.raises(HTTPException) as excinfo:
            await submit_public_gdpr_request(
                session,
                GdprPublicRequestCreateIn(
                    request_type="access_export",
                    subject_name="No Consent",
                    accepted_privacy=False,
                ),
            )
        assert excinfo.value.status_code == 422

        created = await submit_public_gdpr_request(
            session,
            GdprPublicRequestCreateIn(
                request_type="access_export",
                subject_name="Consenting User",
                subject_email="consent@example.com",
                accepted_privacy=True,
            ),
        )
        await session.commit()
        row = await session.scalar(
            select(GdprRequest).where(GdprRequest.reference_number == created.reference_number)
        )
        assert row is not None
        assert row.request_meta.get("accepted_privacy") is True
        assert row.request_meta.get("consented_at")

    await engine.dispose()


# ---------------------------------------------------------------------------
# Bulgu: OPMC processor çalışmadığı halde healthy görünüyordu
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_opmc_processor_is_planned_not_healthy(monkeypatch) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    monkeypatch.setattr(gdpr_service, "get_settings", lambda: Settings())
    monkeypatch.setattr(gdpr_service, "collect_runtime_readiness", lambda: _empty_readiness())

    async with Session() as session:
        processors = await gdpr_service._sync_processors(session)
        opmc = next(item for item in processors if item.processor_key == "opmc")
        # Default opmc_api_url dolu olsa bile modül canlı değil → planned.
        assert opmc.status == "planned"
        assert opmc.configured is False
        assert opmc.endpoint_url is None

    await engine.dispose()


async def _empty_readiness():
    from types import SimpleNamespace

    return SimpleNamespace(checks=[])


# ---------------------------------------------------------------------------
# Bulgu: under_review/manual_action_required/failed retention + sayaç kör noktası
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retention_scan_skips_customers_with_stuck_requests() -> None:
    Session, engine = await _session_factory()
    async with Session() as session:
        old = utc_now() - timedelta(days=365 * 6)
        customer = User(
            email="stuck@test.local",
            password_hash="x",
            name="Stuck Customer",
            role=RoleEnum.CUSTOMER,
            created_at=old,
            updated_at=old,
        )
        session.add(customer)
        await session.flush()
        # failed istek artık OPEN sayılıyor → retention aynı müşteriye paralel
        # review açmamalı.
        session.add(
            GdprRequest(
                reference_number="GDPR-M2-STUCKREQ-1",
                request_type="erasure_pseudonymize",
                status="failed",
                channel="admin_created",
                subject_name=customer.name,
                subject_email=customer.email,
                verified_customer_id=customer.id,
                public_tracking_token="m2-token-stuckreq",
                request_meta={},
            )
        )
        await session.flush()

        scan = await run_retention_scan(session)
        assert (scan.result_json or {}).get("created_request_count") == 0

    await engine.dispose()


@pytest.mark.asyncio
async def test_completed_30d_counts_by_completed_at() -> None:
    Session, engine = await _session_factory()
    async with Session() as session:
        recent_completion_old_creation = GdprRequest(
            reference_number="GDPR-M2-30D-1",
            request_type="access_export",
            status="completed",
            channel="admin_created",
            subject_name="A",
            public_tracking_token="m2-token-30d-1",
            created_at=utc_now() - timedelta(days=100),
            completed_at=utc_now() - timedelta(days=2),
            request_meta={},
        )
        old_completion_recent_creation = GdprRequest(
            reference_number="GDPR-M2-30D-2",
            request_type="access_export",
            status="completed",
            channel="admin_created",
            subject_name="B",
            public_tracking_token="m2-token-30d-2",
            created_at=utc_now() - timedelta(days=2),
            completed_at=utc_now() - timedelta(days=40),
            request_meta={},
        )
        session.add_all([recent_completion_old_creation, old_completion_recent_creation])
        await session.commit()

        overview = await get_gdpr_overview(session)
        # completed_at bazlı: yeni tamamlanan 1, creation'ı yeni olan ama 40 gün
        # önce tamamlanan sayılmaz.
        assert overview.completed_30d_count == 1

    await engine.dispose()
