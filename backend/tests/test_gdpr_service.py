from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.customer_identity import CustomerIdentityDocument
from app.models.enums import IdentityDocTypeEnum, RoleEnum
from app.models.gdpr_request import GdprRequest
from app.models.gdpr_request_event import GdprRequestEvent
from app.models.user import User
from app.schemas.gdpr import GdprPublicRequestCreateIn
from app.services.gdpr_service import execute_gdpr_request, get_public_gdpr_request_status, submit_public_gdpr_request
from app.utils.helpers import utc_now
from app.utils.security import encrypt_field


def test_submit_public_gdpr_request_and_status_tracking() -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            created = await submit_public_gdpr_request(
                session,
                GdprPublicRequestCreateIn(
                    request_type="access_export",
                    subject_name="Efe Aras",
                    subject_email="efe@example.com",
                    subject_phone="+45 12345678",
                    message="Kayıtlarımı görmek istiyorum.",
                    accepted_privacy=True,
                ),
            )
            await session.commit()

            status_payload = await get_public_gdpr_request_status(session, created.tracking_token)

            assert created.reference_number.startswith("GDPR-")
            assert created.status == "identity_pending"
            assert status_payload.reference_number == created.reference_number
            assert status_payload.status == "identity_pending"
            assert status_payload.request_type == "access_export"

        await engine.dispose()

    asyncio.run(run())


def test_execute_gdpr_pseudonymize_redacts_customer_master_and_identity() -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            admin = User(
                email="admin@test.local",
                password_hash="x",
                name="Admin",
                role=RoleEnum.ADMIN,
            )
            customer = User(
                email="customer@test.local",
                password_hash="x",
                name="Denis Thor",
                role=RoleEnum.CUSTOMER,
                phone="+45 22223333",
                postal_code="2500",
                address_encrypted=encrypt_field("Valby Langgade 84"),
                cpr_number_encrypted=encrypt_field("0101011234"),
                cpr_last4="1234",
            )
            session.add_all([admin, customer])
            await session.flush()

            session.add(
                CustomerIdentityDocument(
                    user_id=customer.id,
                    identity_doc_type=IdentityDocTypeEnum.PASSPORT,
                    identity_doc_number_encrypted=encrypt_field("P1234567"),
                    identity_doc_country="DK",
                    identity_photo_refs=["front.jpg", "back.jpg"],
                )
            )

            request = GdprRequest(
                reference_number="GDPR-TEST-0001",
                request_type="erasure_pseudonymize",
                status="approved",
                channel="admin_created",
                subject_name=customer.name,
                subject_email=customer.email,
                subject_phone=customer.phone,
                verified_customer_id=customer.id,
                public_tracking_token="tracking-token",
                due_at=utc_now(),
                request_meta={},
            )
            session.add(request)
            await session.flush()

            await execute_gdpr_request(session, request, actor=admin)

            identity = await session.scalar(
                select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer.id)
            )
            events = (
                await session.scalars(
                    select(GdprRequestEvent).where(GdprRequestEvent.request_id == request.id)
                )
            ).all()

            assert request.status in {"completed", "completed_with_warnings"}
            assert customer.gdpr_status == "pseudonymized"
            assert customer.gdpr_pseudonymized_at is not None
            assert customer.email != "customer@test.local"
            assert customer.address_encrypted is None
            assert customer.cpr_number_encrypted is None
            assert customer.cpr_last4 is None
            assert customer.phone is None
            assert identity is not None
            assert identity.identity_doc_number_encrypted is None
            assert identity.identity_photo_refs == []
            assert any(event.event_type == "executed" for event in events)

        await engine.dispose()

    asyncio.run(run())
