from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.services.pos_service as pos_service_module
from app.database import Base
from app.models.enums import (
    MetalTypeEnum,
    PosDocumentTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.user import User
from app.schemas.pos import (
    PosQuoteUpdate,
    PosRealtimePreviewLine,
    PosSessionDisplayOut,
    PosSessionLineCreate,
    PosWorkspaceFinalizeRequest,
)
from app.services.pos_purchase_finalize import finalize_purchase_workspace
from app.services.pos_service import (
    _emit_session_state,
    find_latest_draft_pos_session,
    get_pos_session_by_display_token_or_404,
    revoke_display_token,
    sync_live_rate,
)
from app.services.pos_workspace_state import (
    _parse_workspace_note_payload,
    _serialize_workspace_note_payload,
)
from app.services.realtime import RealtimeHub


# ----------------------------------------------------------------yardımcılar


class _FakeWebSocket:
    def __init__(self, *, fail_send: bool = False) -> None:
        self.accepted = False
        self.closed: tuple[int, str] | None = None
        self.sent: list[str] = []
        self._fail_send = fail_send

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = (code, reason)

    async def send_text(self, text: str) -> None:
        if self._fail_send:
            raise RuntimeError("slow consumer")
        self.sent.append(text)

    async def send_json(self, payload: dict) -> None:  # pragma: no cover
        await self.send_text(json.dumps(payload))


def _make_session(
    clerk: User,
    *,
    code: str,
    token: str,
    status: PosSessionStatusEnum = PosSessionStatusEnum.DRAFT,
    customer_id=None,
    notes: str | None = None,
    updated_at: datetime | None = None,
) -> PosSession:
    return PosSession(
        session_code=code,
        display_token=token,
        clerk_user_id=clerk.id,
        customer_id=customer_id,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        margin_percent_internal=Decimal("8.00"),
        rate_source=PosRateSourceEnum.LIVE,
        status=status,
        visible_snapshot={},
        notes=notes,
        # expire_on_commit=False ile server_default geri yüklenmez; erişimde
        # lazy refresh (MissingGreenlet) olmasın diye explicit değer.
        updated_at=updated_at or datetime.now(timezone.utc),
    )


async def _setup_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    return engine, Session


# -------------------------------------------------------bulgu 1: PII snapshot


def test_workspace_note_stores_cpr_and_identity_encrypted_not_plaintext():
    """CPR/kimlik numarası notta DÜZ METİN taşınmaz: serialize şifreli yazar,
    parse transparan çözerek mevcut okuyucuları (shadow/mastersız roundtrip
    dahil) kırılmaz tutar."""
    payload = _parse_workspace_note_payload(None)
    payload["workspace_customer"] = {
        "customer_id": None,
        "name": "Shadow Kisilik",
        "phone": "+45 12345678",
        "cpr_number": "0102031234",
        "identity_doc_number": "P1234567",
        "identity_doc_type": "passport",
        "identity_doc_country": "DK",
    }
    serialized = _serialize_workspace_note_payload(payload)
    # At-rest: plaintext YOK, şifreli gövde VAR.
    assert "0102031234" not in serialized
    assert "P1234567" not in serialized
    raw = json.loads(serialized)
    assert raw["workspace_customer"]["cpr_number"] is None
    assert raw["workspace_customer"]["identity_doc_number"] is None
    assert raw["workspace_customer"]["cpr_number_encrypted"]
    assert raw["workspace_customer"]["cpr_number_encrypted"] != "0102031234"
    assert raw["workspace_customer"]["identity_doc_number_encrypted"]

    # Roundtrip: parse şifreliyi çözer, shadow müşteri akışı bozulmaz.
    reparsed = _parse_workspace_note_payload(serialized)
    assert reparsed["workspace_customer"]["cpr_number"] == "0102031234"
    assert reparsed["workspace_customer"]["identity_doc_number"] == "P1234567"
    assert reparsed["workspace_customer"]["name"] == "Shadow Kisilik"


def test_workspace_note_encryption_fail_closed():
    """Şifreleme kullanılamazsa değer plaintext YAZILMAZ, düşürülür."""
    import app.services.pos_workspace_state as state

    def _boom(value):
        raise RuntimeError("no key")

    saved = state.encrypt_field
    state.encrypt_field = _boom
    try:
        assert state._encrypt_note_value("0102031234") is None
    finally:
        state.encrypt_field = saved


# -------------------------------------------bulgu 6: legacy mer pris kısıtları


def test_legacy_line_schemas_accept_negative_mer_pris():
    """R2-07 sonrası mer pris kr/g additive ve negatif meşru; legacy yüzey
    aynı değeri 422 ile REDDETMEYİP workspace kanonuyla aynı davranır."""
    line = PosSessionLineCreate(
        product_type=ProductTypeEnum.BRACELET,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("1"),
        purity_percentage=Decimal("75.00"),
        margin_percent_internal=Decimal("-15"),
    )
    assert line.margin_percent_internal == Decimal("-15")
    assert PosQuoteUpdate(margin_percent_internal=Decimal("-0.5")).margin_percent_internal == Decimal("-0.5")
    preview_line = PosRealtimePreviewLine(
        product_type=ProductTypeEnum.BRACELET,
        metal_type=MetalTypeEnum.YELLOW_GOLD,
        weight_grams=Decimal("1"),
        purity_percentage=Decimal("75.00"),
        margin_percent_internal=Decimal("-15"),
    )
    assert preview_line.margin_percent_internal == Decimal("-15")


# ----------------------------------bulgu 2: edit taslağı yaşam döngüsü koruması


def test_find_latest_draft_skips_edit_source_drafts():
    """Kaynağı silinmiş olabilecek edit taslağı 'son taslak' olarak devam
    ettirilmez — diriltme yaratığının giriş kapısı kapanır."""

    async def run() -> None:
        engine, Session = await _setup_engine()
        async with Session() as session:
            clerk = User(email="m1-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            session.add(clerk)
            await session.flush()

            edit_note = _serialize_workspace_note_payload(
                {"edit_source_session_id": str(uuid4()), "edit_source_sequence_no": 42}
            )
            edit_draft = _make_session(
                clerk,
                code="M1EDIT1",
                token="m1-edit-token",
                notes=edit_note,
                updated_at=datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc),
            )
            session.add(edit_draft)
            await session.commit()

            # Yalnız edit taslağı varken open-draft akışı taslak DÖNMEZ.
            assert (
                await find_latest_draft_pos_session(session, clerk_user_id=clerk.id, trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER)
            ) is None

            plain_draft = _make_session(
                clerk,
                code="M1PLAIN1",
                token="m1-plain-token",
                updated_at=datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc),
            )
            session.add(plain_draft)
            await session.commit()

            latest = await find_latest_draft_pos_session(
                session, clerk_user_id=clerk.id, trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER
            )
            assert latest is not None
            assert latest.session_code == "M1PLAIN1"
        await engine.dispose()

    asyncio.run(run())


def test_finalize_rejects_cancelled_edit_source_and_closes_draft():
    """Taslak açıldıktan sonra kaynak belge silinmişse finalize onu
    diriltemez: 409 döner ve edit taslağı kapatılır."""

    async def run() -> None:
        engine, Session = await _setup_engine()
        async with Session() as session:
            clerk = User(email="m1-clerk2@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            customer = User(email="m1-cust@test.local", password_hash="x", name="Customer", role=RoleEnum.CUSTOMER)
            session.add_all([clerk, customer])
            await session.flush()

            source = _make_session(clerk, code="M1SRC1", token="m1-src-token", customer_id=customer.id)
            source.status = PosSessionStatusEnum.CONFIRMED
            session.add(source)
            await session.flush()
            document = PosDocument(
                pos_session_id=source.id,
                document_type=PosDocumentTypeEnum.PURCHASE_RECEIPT,
                gross_amount_dkk=Decimal("100.00"),
                net_amount_dkk=Decimal("100.00"),
            )
            session.add(document)
            await session.flush()

            edit_note = _serialize_workspace_note_payload(
                {
                    "edit_source_session_id": str(source.id),
                    "edit_source_sequence_no": document.sequence_no,
                    "workspace_customer": {"name": "Customer"},
                }
            )
            edit_draft = _make_session(clerk, code="M1EDIT2", token="m1-edit2-token", customer_id=customer.id, notes=edit_note)
            edit_draft.customer = customer  # API yolu selectinload ile yükler; test aynı ilişkiyi kurar
            session.add(edit_draft)
            await session.flush()
            session.add(
                PosSessionLine(
                    pos_session_id=edit_draft.id,
                    line_no=1,
                    product_type=ProductTypeEnum.BRACELET,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("10.00"),
                    purity_karat="24K",
                    purity_percentage=Decimal("99.90"),
                    margin_percent_internal=Decimal("0.00"),
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:24"}),
                )
            )
            await session.commit()
            edit_draft_id = edit_draft.id

            # Kaynak bu arada silindi: session CANCELLED + transaction cancelled.
            source.status = PosSessionStatusEnum.CANCELLED
            await session.commit()

            with pytest.raises(HTTPException) as excinfo:
                await finalize_purchase_workspace(
                    session,
                    pos_session=edit_draft,
                    payload=PosWorkspaceFinalizeRequest(notes="try resurrect"),
                )
            assert excinfo.value.status_code == 409

            reopened = await session.get(PosSession, edit_draft_id)
            assert reopened.status == PosSessionStatusEnum.CANCELLED
            # Kaynak diriltilmedi.
            assert (await session.get(PosSession, source.id)).status == PosSessionStatusEnum.CANCELLED
        await engine.dispose()

    asyncio.run(run())


# ----------------------------------------------bulgu 8: display token ömrü


def test_display_token_resolver_rejects_terminal_sessions():
    """Token yalnız AÇIK taslağı çözer; finalize edilmiş oturumun token'ı
    süresiz müşteri iletişim verisi döndüremez."""

    async def run() -> None:
        engine, Session = await _setup_engine()
        async with Session() as session:
            clerk = User(email="m1-clerk3@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            session.add(clerk)
            await session.flush()
            session.add(
                _make_session(clerk, code="M1DONE1", token="m1-terminal-token", status=PosSessionStatusEnum.CONFIRMED)
            )
            session.add(_make_session(clerk, code="M1LIVE1", token="m1-live-token"))
            await session.commit()

            with pytest.raises(HTTPException) as excinfo:
                await get_pos_session_by_display_token_or_404(session, "m1-terminal-token")
            assert excinfo.value.status_code == 404

            resolved = await get_pos_session_by_display_token_or_404(session, "m1-live-token")
            assert resolved.session_code == "M1LIVE1"
        await engine.dispose()

    asyncio.run(run())


def test_revoke_display_token_closes_old_connections_and_rotates():
    """Revoke eski token'ın WS bağlantılarını sunucu tarafında kapatır ve yeni
    token üretir; kiosk'un ölmesi probe davranışına borçlu olmaz."""

    async def run() -> None:
        engine, Session = await _setup_engine()
        async with Session() as session:
            clerk = User(email="m1-clerk4@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            session.add(clerk)
            await session.flush()
            pos_session = _make_session(clerk, code="M1REV1", token="m1-revoke-token")
            session.add(pos_session)
            await session.commit()

            hub = RealtimeHub()
            fake = _FakeWebSocket()
            await hub.connect_display("m1-revoke-token", fake)

            saved_hub = pos_service_module.realtime_hub
            pos_service_module.realtime_hub = hub
            try:
                revoked = await revoke_display_token(
                    session, clerk_user_id=clerk.id, display_token="m1-revoke-token"
                )
            finally:
                pos_service_module.realtime_hub = saved_hub

            assert revoked is not None
            assert revoked.display_token != "m1-revoke-token"
            assert fake.closed is not None  # close frame'i gönderildi
            assert hub.has_display_connections("m1-revoke-token") is False
        await engine.dispose()

    asyncio.run(run())


# -------------------------------------------bulgu 11/13: RealtimeHub davranışı


def _display_snapshot(session_code: str) -> PosSessionDisplayOut:
    return PosSessionDisplayOut(
        session_code=session_code,
        status=PosSessionStatusEnum.DRAFT,
        trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
        customer_name=None,
        product_type=None,
        metal_type=None,
        weight_grams=None,
        purity_karat=None,
        purity_percentage=None,
        rate_dkk=None,
        final_offer_dkk=None,
        updated_at=datetime.now(timezone.utc),
    )


def test_set_display_preview_counter_resets_on_session_change():
    """Oturum değişiminde preview sıra sayacı GERÇEKTEN 1'e döner (eski kod
    aynı değeri üstüne yazan no-op'tu)."""
    hub = RealtimeHub()
    first = hub.set_display_preview("tok", _display_snapshot("SESSA"))
    assert first.preview_sequence == 1
    second = hub.set_display_preview("tok", _display_snapshot("SESSA"))
    assert second.preview_sequence == 2
    switched = hub.set_display_preview("tok", _display_snapshot("SESSB"))
    assert switched.preview_sequence == 1


def test_broadcast_sends_once_and_disconnects_failed_consumer():
    """Payload tek serileştirilir, alıcılar paralel gönderilir; başarısız
    tüketici loglanıp hub'dan düşer, sağlıklı alıcı etkilenmez."""
    hub = RealtimeHub()
    healthy = _FakeWebSocket()
    broken = _FakeWebSocket(fail_send=True)

    async def run() -> None:
        await hub.connect_display("tok", healthy)
        await hub.connect_display("tok", broken)
        await hub.broadcast_display("tok", {"type": "display:update", "data": {"ok": True}})

        assert healthy.sent == ['{"type": "display:update", "data": {"ok": true}}']
        assert broken.sent == []
        # Başarısız bağlantı hub'dan temizlendi.
        assert hub.has_display_connections("tok") is True  # sağlıklı kaldı
        assert list(hub._display_connections.get("tok", set())) == [healthy]

        # Son görüntüleyici gittiğinde preview kopyası da ömürlendirilir.
        hub.set_display_preview("tok", _display_snapshot("SESSC"))
        await hub.disconnect_display("tok", healthy)
        assert hub.get_display_preview("tok") is None

    asyncio.run(run())


def test_emit_session_state_skips_snapshot_without_watchers(monkeypatch):
    """Bağlı görüntüleyici yokken _emit_session_state ağır snapshot zincirini
    hiç kurmaz — tuş başına çift katlı çalışma biter."""

    async def run() -> None:
        calls = {"count": 0}

        async def _fail_snapshot(*args, **kwargs):  # pragma: no cover
            calls["count"] += 1
            raise AssertionError("display_snapshot watcher yokken çağrılmamalı")

        saved = pos_service_module.realtime_hub
        hub = RealtimeHub()
        pos_service_module.realtime_hub = hub

        class _StubSession:
            session_code = "M1EMIT1"
            display_token = "m1-emit-token"
            id = uuid4()

        try:
            monkeypatch.setattr(pos_service_module, "display_snapshot", _fail_snapshot)
            await _emit_session_state(_StubSession())  # erken return; snapshot zinciri kurulmaz
            assert calls["count"] == 0
        finally:
            pos_service_module.realtime_hub = saved

    asyncio.run(run())


# ------------------------------------------bulgu 12: fallback kur provenance


def test_sync_live_rate_rejects_fallback_sourced_rates(monkeypatch):
    """Canlı besleme kapalıyken/ağda düşerken hard-coded fallback, LIVE
    mühürüyle snapshot'a yazılmaz — senkron 409 ile reddedilir."""

    async def run() -> None:
        engine, Session = await _setup_engine()
        async with Session() as session:
            clerk = User(email="m1-clerk5@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            session.add(clerk)
            await session.flush()
            pos_session = _make_session(clerk, code="M1RATE1", token="m1-rate-token")
            pos_session.metal_type = MetalTypeEnum.YELLOW_GOLD
            session.add(pos_session)
            await session.commit()

            class _StubPriceService:
                @classmethod
                def cached_meta_or_fallback(cls):
                    return {"gold": {"source": "fallback", "stale": True}}

                async def get_rates(self, *, force_refresh: bool = False):
                    return {"gold": Decimal("615.50"), "silver": Decimal("7.80")}

            monkeypatch.setattr(pos_service_module, "GoldPriceService", _StubPriceService)

            with pytest.raises(HTTPException) as excinfo:
                await sync_live_rate(session, pos_session=pos_session)
            assert excinfo.value.status_code == 409

            await session.refresh(pos_session)
            # Snapshot'a fallback değeri LIVE etiketiyle KALICILAŞMADI.
            assert pos_session.rate_source == PosRateSourceEnum.LIVE  # dokunulmadı
            assert pos_session.live_rate_dkk is None
        await engine.dispose()

    asyncio.run(run())
