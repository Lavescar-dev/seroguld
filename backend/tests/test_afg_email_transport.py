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
