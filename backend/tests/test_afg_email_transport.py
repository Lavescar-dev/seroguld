"""AFG-P2 — e-posta transport seçimi testleri (wp-bridge + SMTP fallback)."""

from __future__ import annotations

import base64

import httpx
import pytest

from app.services import email_service


@pytest.fixture()
def bridge_settings(monkeypatch: pytest.MonkeyPatch):
    """afg_email_enabled=true + wp-bridge transport — SMTP bilgileri boş."""
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "afg_email_enabled", True)
    monkeypatch.setattr(settings, "email_transport", "wp-bridge")
    monkeypatch.setattr(settings, "wp_bridge_url", "https://seroguld.dk/wp-json/seroguld/v1/send-afg-email")
    monkeypatch.setattr(settings, "wp_bridge_secret", "test-secret-32-hex")
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "smtp_from_address", "")
    return settings


@pytest.fixture()
def smtp_settings(monkeypatch: pytest.MonkeyPatch):
    """afg_email_enabled=true + SMTP yapılandırılmış, bridge boş."""
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "afg_email_enabled", True)
    monkeypatch.setattr(settings, "email_transport", "smtp")
    monkeypatch.setattr(settings, "smtp_host", "smtp.simply.com")
    monkeypatch.setattr(settings, "smtp_from_address", "info@seroguld.dk")
    monkeypatch.setattr(settings, "wp_bridge_url", "")
    monkeypatch.setattr(settings, "wp_bridge_secret", "")
    return settings


def test_afg_email_transport_ready_bridge(monkeypatch: pytest.MonkeyPatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "afg_email_enabled", True)
    monkeypatch.setattr(settings, "email_transport", "wp-bridge")
    monkeypatch.setattr(settings, "wp_bridge_url", "https://x.example")
    monkeypatch.setattr(settings, "wp_bridge_secret", "s")
    assert email_service.afg_email_transport_ready() is True

    # bridge kapalı + SMTP de boş → hazır değil
    monkeypatch.setattr(settings, "wp_bridge_url", "")
    monkeypatch.setattr(settings, "smtp_host", "")
    assert email_service.afg_email_transport_ready() is False


def test_afg_email_disabled_short_circuits(monkeypatch: pytest.MonkeyPatch):
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "afg_email_enabled", False)
    sent, note = email_service.send_afg_email(
        to_address="a@b.dk", customer_name="x", document_number="1", pdf_bytes=b"%PDF"
    )
    assert sent is False
    assert "kapalı" in note


def test_send_afg_email_wp_bridge_success(monkeypatch: pytest.MonkeyPatch, bridge_settings):
    captured: dict[str, object] = {}

    def fake_post(url, json=None, headers=None, timeout=None, **kwargs):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return httpx.Response(200, json={"sent": True}, request=httpx.Request("POST", url))

    monkeypatch.setattr(email_service.httpx, "post", fake_post)
    sent, note = email_service.send_afg_email(
        to_address="kunde@example.dk",
        customer_name="Test Kunde",
        document_number="42",
        pdf_bytes=b"%PDF-fake",
    )
    assert sent is True
    assert "wp-bridge" in note
    assert captured["url"] == bridge_settings.wp_bridge_url
    assert captured["headers"]["X-SeroGuld-Bridge-Token"] == "test-secret-32-hex"
    payload = captured["json"]
    assert payload["to"] == "kunde@example.dk"
    assert base64.b64decode(payload["pdf_base64"]) == b"%PDF-fake"
    assert payload["document_number"] == "42"


def test_send_afg_email_wp_bridge_falls_back_to_smtp(monkeypatch: pytest.MonkeyPatch, bridge_settings):
    # SMTP fallback için host ve from gerekiyor
    monkeypatch.setattr(bridge_settings, "smtp_host", "smtp.simply.com")
    monkeypatch.setattr(bridge_settings, "smtp_from_address", "info@seroguld.dk")

    def fake_post(url, json=None, headers=None, timeout=None):
        return httpx.Response(500, json={"error": "boom"}, request=httpx.Request("POST", url))

    called = {"smtp": False}

    def fake_smtp_send(**kwargs):
        called["smtp"] = True
        return True, "E-posta gönderildi (smtp): kunde@example.dk"

    monkeypatch.setattr(email_service.httpx, "post", fake_post)
    monkeypatch.setattr(email_service, "_send_via_smtp", lambda **kwargs: fake_smtp_send(**kwargs))
    sent, note = email_service.send_afg_email(
        to_address="kunde@example.dk",
        customer_name="Test Kunde",
        document_number="42",
        pdf_bytes=b"%PDF-fake",
    )
    assert sent is True
    assert called["smtp"] is True
    assert "smtp" in note


def test_send_afg_email_wp_bridge_fail_no_smtp(monkeypatch: pytest.MonkeyPatch, bridge_settings):
    def fake_post(url, json=None, headers=None, timeout=None, **kwargs):
        return httpx.Response(500, json={"error": "boom"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(email_service.httpx, "post", fake_post)
    sent, note = email_service.send_afg_email(
        to_address="kunde@example.dk", customer_name="x", document_number="42", pdf_bytes=None
    )
    assert sent is False
    assert "WP bridge HTTP 500" in note


def test_send_afg_email_empty_recipient(bridge_settings):
    sent, note = email_service.send_afg_email(
        to_address="  ", customer_name="x", document_number="42", pdf_bytes=None
    )
    assert sent is False
    assert "e-posta adresi yok" in note


def test_send_afg_email_smtp_transport_skips_bridge(monkeypatch: pytest.MonkeyPatch, smtp_settings):
    def fail_post(*args, **kwargs):  # pragma: no cover — çağrılmamalı
        raise AssertionError("wp-bridge çağrılmamalıydı")

    monkeypatch.setattr(email_service.httpx, "post", fail_post)
    monkeypatch.setattr(
        email_service,
        "_send_via_smtp",
        lambda **kwargs: (True, "E-posta gönderildi (smtp): a@b.dk"),
    )
    sent, note = email_service.send_afg_email(
        to_address="a@b.dk", customer_name="x", document_number="42", pdf_bytes=None
    )
    assert sent is True
    assert "smtp" in note


# ---------------------------------------------------------------------------
# R2-HIGH — finalize e-posta akışı event loop'u BLOKLAMAMALI
# ---------------------------------------------------------------------------


def test_finalize_email_offloads_blocking_work_off_event_loop(monkeypatch: pytest.MonkeyPatch):
    """_send_afg_email_best_effort senkron PDF render + transport'u worker
    thread'e taşır; blok çalışma sürerken event loop yanıt vermeye devam eder.

    Eski hata: httpx.post/smtplib (timeout=20) ve reportlab render loop'ta
    koştuğu için finalize commit'inden sonra POS dahil TÜM API istekleri
    20-40 sn donuyordu. DB işi (build_pos_receipt_context / audit commit)
    loop thread'de kalır; audit akışı (afg_email_sent) değişmez.
    """
    import asyncio
    import threading
    import time

    from app.config import get_settings
    from app.models.pos_document_audit import PosDocumentAudit
    from app.services import email_service
    from app.services import pos_purchase_finalize
    from app.services import pos_receipt_renderer
    from app.services import pos_service

    settings = get_settings()
    monkeypatch.setattr(settings, "afg_email_enabled", True)
    monkeypatch.setattr(settings, "email_transport", "smtp")
    monkeypatch.setattr(settings, "smtp_host", "smtp.simply.com")
    monkeypatch.setattr(settings, "smtp_from_address", "info@seroguld.dk")

    seen: dict[str, int] = {}

    async def fake_context(session, *, pos_session, audience):
        seen["context_thread"] = threading.get_ident()
        return {"audience": audience}

    def fake_render(context):
        seen["render_thread"] = threading.get_ident()
        time.sleep(0.25)  # senkron reportlab render'ın yerine
        return b"%PDF-fake"

    def fake_send(**kwargs):
        seen["send_thread"] = threading.get_ident()
        time.sleep(0.25)  # senkron httpx.post/smtplib'in yerine
        assert kwargs["pdf_bytes"] == b"%PDF-fake"
        assert kwargs["to_address"] == "kunde@example.dk"
        assert kwargs["document_number"] == "77"
        return True, "E-posta gönderildi (smtp): kunde@example.dk"

    monkeypatch.setattr(pos_service, "build_pos_receipt_context", fake_context)
    monkeypatch.setattr(pos_receipt_renderer, "render_pos_receipt_pdf", fake_render)
    monkeypatch.setattr(email_service, "send_afg_email", fake_send)

    class _FakeSession:
        def __init__(self) -> None:
            self.added: list[object] = []
            self.commits = 0

        def add(self, obj: object) -> None:
            self.added.append(obj)

        async def commit(self) -> None:
            self.commits += 1

    class _Doc:
        sequence_no = 77
        customer_email = "kunde@example.dk"
        customer_name = "Test Kunde"

    class _Pos:
        id = 1234

    session = _FakeSession()

    async def scenario() -> tuple[int, int]:
        loop_thread = threading.get_ident()
        beats = {"count": 0, "stop": asyncio.Event()}

        async def heartbeat() -> None:
            while not beats["stop"].is_set():
                beats["count"] += 1
                await asyncio.sleep(0.02)

        hb = asyncio.create_task(heartbeat())
        try:
            await pos_purchase_finalize._send_afg_email_best_effort(session, _Doc(), _Pos())
        finally:
            beats["stop"].set()
            await hb
        return loop_thread, beats["count"]

    loop_thread, heartbeat_ticks = asyncio.run(scenario())

    # DB/async işi loop thread'de kaldı; render + transport worker thread'e gitti.
    assert seen["context_thread"] == loop_thread
    assert seen["render_thread"] != loop_thread
    assert seen["send_thread"] != loop_thread
    # 0.5 sn'lik senkron blok boyunca loop canlı kaldı: heartbeat ~25 tık atar;
    # bloklanmış bir loop 0-1 tık üretirdi.
    assert heartbeat_ticks >= 5, f"event loop bloklandı (heartbeat={heartbeat_ticks})"
    # Exception/audit sözleşmesi aynen: sent → 'afg_email_sent' izi + commit.
    assert session.commits == 1
    audits = [a for a in session.added if isinstance(a, PosDocumentAudit)]
    assert len(audits) == 1
    assert audits[0].action == "afg_email_sent"
    assert "gönderildi" in (audits[0].note or "")
