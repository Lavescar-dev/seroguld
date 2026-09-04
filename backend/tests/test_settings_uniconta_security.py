from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi import HTTPException

from app.api import v2
from app.config import Settings
from app.schemas.desktop_views import SettingsScreenUpdateIn, UnicontaConnectIn


SECRET_FIELDS = {
    "openai_api_key",
    "opmc_api_key",
    "opmc_webhook_secret",
    "woo_consumer_key",
    "woo_consumer_secret",
    "woo_webhook_secret",
    "wp_app_password",
    "uniconta_password",
    "uniconta_api_key",
    "metals_dev_api_key",
    "wp_bridge_secret",
}


def _settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "database_url": "sqlite+aiosqlite:///test.db",
        "openai_api_key": "openai-secret",
        "opmc_api_key": "opmc-secret",
        "opmc_webhook_secret": "opmc-webhook-secret",
        "woocommerce_consumer_key": "woo-key",
        "woocommerce_consumer_secret": "woo-secret",
        "woocommerce_webhook_secret": "woo-webhook-secret",
        "wp_app_password": "wordpress-secret",
        "uniconta_api_url": "https://unexpected.example.test",
        "uniconta_username": "existing-user",
        "uniconta_password": "existing-password",
        "uniconta_company_id": "55606",
        "uniconta_api_key": "existing-api-key",
        "uniconta_purchase_vat_code_25": "Købsmoms",
        "uniconta_purchase_vat_code_0": "KøbBrugtmoms",
        "market_rates_live_enabled": False,
        "metals_dev_api_key": "metals-secret",
        "email_transport": "smtp",
        "wp_bridge_url": "",
        "wp_bridge_secret": "wp-bridge-secret",
        "afg_email_enabled": False,
    }
    defaults.update(overrides)
    return Settings(_env_file=None, **defaults)


@dataclass
class _SettingsProvider:
    settings: Settings
    clear_count: int = 0

    def __call__(self) -> Settings:
        return self.settings

    def cache_clear(self) -> None:
        self.clear_count += 1


class _HealthClient:
    def __init__(self, *, ok: bool | None = None, has_token: bool = False) -> None:
        self.ok = ok
        self.has_token = has_token

    def get_health_snapshot(self) -> dict[str, object]:
        return {"last_call_ok": self.ok, "has_token": self.has_token}


def _settings_update_payload(**overrides: object) -> SettingsScreenUpdateIn:
    values = v2._build_settings_screen_out().model_dump()
    values.update(overrides)
    return SettingsScreenUpdateIn(**values)


def test_settings_response_never_serializes_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _SettingsProvider(_settings())
    monkeypatch.setattr(v2, "get_settings", provider)

    response = v2._build_settings_screen_out()
    serialized = response.model_dump()

    assert set(response.secret_fields_configured) == SECRET_FIELDS
    assert all(serialized[field] == "" for field in SECRET_FIELDS)
    assert "openai-secret" not in response.model_dump_json()
    assert response.uniconta_api_url == v2.UNICONTA_WEB_API_BASE
    assert response.uniconta_purchase_vat_code_25 == "Købsmoms"
    assert response.uniconta_purchase_vat_code_0 == "KøbBrugtmoms"
    assert response.market_rates_live_enabled is False


@pytest.mark.asyncio
async def test_blank_and_null_settings_secrets_preserve_existing_values(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _SettingsProvider(_settings())
    writes: list[dict[str, str]] = []
    resets: list[bool] = []
    monkeypatch.setattr(v2, "get_settings", provider)
    monkeypatch.setattr(v2, "upsert_env_values", lambda _path, updates: writes.append(updates))
    monkeypatch.setattr(v2, "reset_uniconta_client", lambda: resets.append(True))

    payload = _settings_update_payload(
        openai_api_key=None,
        opmc_api_key="  ",
        opmc_webhook_secret=None,
        woo_consumer_key="",
        woo_consumer_secret=None,
        woo_webhook_secret=" ",
        wp_app_password=None,
        uniconta_password="",
        uniconta_api_key=None,
        uniconta_api_url="https://attacker.example.test",
        uniconta_purchase_vat_code_25=" PurchaseVat25 ",
        uniconta_purchase_vat_code_0=" PurchaseVat0 ",
        market_rates_live_enabled=True,
        market_rates_live_platinum_enabled=False,
        metals_dev_api_key="  ",
    )
    response = await v2.put_settings_v2(payload=payload, _=None)  # type: ignore[arg-type]

    assert len(writes) == 1
    assert not (set(writes[0]) & {
        "OPENAI_API_KEY",
        "OPMC_API_KEY",
        "OPMC_WEBHOOK_SECRET",
        "WOOCOMMERCE_CONSUMER_KEY",
        "WOOCOMMERCE_CONSUMER_SECRET",
        "WOOCOMMERCE_WEBHOOK_SECRET",
        "WP_APP_PASSWORD",
        "UNICONTA_PASSWORD",
        "UNICONTA_API_KEY",
        "METALS_DEV_API_KEY",
    })
    assert writes[0]["UNICONTA_API_URL"] == v2.UNICONTA_WEB_API_BASE
    assert writes[0]["UNICONTA_PURCHASE_VAT_CODE_25"] == "PurchaseVat25"
    assert writes[0]["UNICONTA_PURCHASE_VAT_CODE_0"] == "PurchaseVat0"
    assert writes[0]["MARKET_RATES_LIVE_ENABLED"] == "true"
    # 0.3.8 alan bazlı oto bayrakları round-trip eder.
    assert writes[0]["MARKET_RATES_LIVE_FX_ENABLED"] == "true"
    assert writes[0]["MARKET_RATES_LIVE_PLATINUM_ENABLED"] == "false"
    assert writes[0]["MARKET_RATES_LIVE_PALLADIUM_ENABLED"] == "true"
    assert response.openai_api_key == ""
    assert provider.clear_count == 1
    assert resets == [True]


@pytest.mark.asyncio
async def test_afg_email_settings_round_trip_and_secret_preservation(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _SettingsProvider(_settings())
    writes: list[dict[str, str]] = []
    monkeypatch.setattr(v2, "get_settings", provider)
    monkeypatch.setattr(v2, "upsert_env_values", lambda _path, updates: writes.append(updates))
    monkeypatch.setattr(v2, "reset_uniconta_client", lambda: None)

    payload = _settings_update_payload(
        email_transport=" WP-Bridge ",
        wp_bridge_url=" https://seroguld.dk/wp-json/seroguld/v1/send-afg-email ",
        wp_bridge_secret=None,
        afg_email_enabled=True,
    )
    response = await v2.put_settings_v2(payload=payload, _=None)  # type: ignore[arg-type]

    assert len(writes) == 1
    assert writes[0]["EMAIL_TRANSPORT"] == "wp-bridge"
    assert writes[0]["WP_BRIDGE_URL"] == "https://seroguld.dk/wp-json/seroguld/v1/send-afg-email"
    assert writes[0]["AFG_EMAIL_ENABLED"] == "true"
    # Gönderilmeyen köprü secret'ı mevcut değeri korur, .env'e dokunulmaz.
    assert "WP_BRIDGE_SECRET" not in writes[0]
    assert response.wp_bridge_secret == ""
    assert "wp_bridge_secret" in response.secret_fields_configured
    # Yanıt fake provider'ın (değişmemiş) settings'inden üretilir.
    assert response.email_transport == "smtp"


@pytest.mark.asyncio
async def test_afg_email_transport_validation_rejects_unknown_values(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _SettingsProvider(_settings())
    writes: list[dict[str, str]] = []
    monkeypatch.setattr(v2, "get_settings", provider)
    monkeypatch.setattr(v2, "upsert_env_values", lambda _path, updates: writes.append(updates))

    payload = _settings_update_payload(email_transport="sendgrid")
    with pytest.raises(HTTPException) as excinfo:
        await v2.put_settings_v2(payload=payload, _=None)  # type: ignore[arg-type]

    assert excinfo.value.status_code == 422
    # Doğrulama yazmadan önce düşer.
    assert writes == []


@pytest.mark.asyncio
async def test_afg_email_bridge_url_requires_http_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _SettingsProvider(_settings())
    writes: list[dict[str, str]] = []
    monkeypatch.setattr(v2, "get_settings", provider)
    monkeypatch.setattr(v2, "upsert_env_values", lambda _path, updates: writes.append(updates))

    payload = _settings_update_payload(wp_bridge_url="ftp://seroguld.dk/bridge")
    with pytest.raises(HTTPException) as excinfo:
        await v2.put_settings_v2(payload=payload, _=None)  # type: ignore[arg-type]

    assert excinfo.value.status_code == 422
    assert writes == []


def test_uniconta_config_uses_real_health_and_never_returns_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _SettingsProvider(_settings())
    monkeypatch.setattr(v2, "get_settings", provider)
    monkeypatch.setattr(v2, "get_uniconta_client", lambda: _HealthClient(ok=True, has_token=True))

    response = v2._build_uniconta_config_out()
    serialized = response.model_dump()

    assert response.connectionStatus == "bagli"
    assert response.configured is True
    assert response.passwordConfigured is True
    assert response.apiKeyConfigured is True
    assert response.apiUrl == v2.UNICONTA_WEB_API_BASE
    assert "password" not in serialized
    assert "apiKey" not in serialized


@pytest.mark.asyncio
async def test_uniconta_failed_candidate_is_tested_before_any_config_change(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _SettingsProvider(_settings())
    writes: list[dict[str, str]] = []
    resets: list[bool] = []
    candidate_args: list[dict[str, object]] = []

    class FailedCandidate:
        def __init__(self, **kwargs: object) -> None:
            candidate_args.append(kwargs)

        async def test_connection(self) -> dict[str, object]:
            return {"ok": False, "message": "invalid", "company": None}

    monkeypatch.setattr(v2, "get_settings", provider)
    monkeypatch.setattr(v2, "get_uniconta_client", lambda: _HealthClient())
    monkeypatch.setattr(v2, "UnicontaClient", FailedCandidate)
    monkeypatch.setattr(v2, "upsert_env_values", lambda _path, updates: writes.append(updates))
    monkeypatch.setattr(v2, "reset_uniconta_client", lambda: resets.append(True))

    response = await v2.post_uniconta_connect_v2(
        payload=UnicontaConnectIn(
            companyId="new-company",
            username="new-user",
            password="wrong-password",
            apiUrl=None,
            apiKey=None,
        ),
        _=None,  # type: ignore[arg-type]
    )

    assert response.connectionStatus == "hata"
    assert candidate_args[0]["base_url"] == v2.UNICONTA_WEB_API_BASE
    assert writes == []
    assert resets == []
    assert provider.clear_count == 0


@pytest.mark.asyncio
async def test_uniconta_blank_password_reuses_saved_password_and_persists_only_after_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = _SettingsProvider(_settings())
    writes: list[dict[str, str]] = []
    resets: list[bool] = []
    candidate_args: list[dict[str, object]] = []

    class SuccessfulCandidate:
        def __init__(self, **kwargs: object) -> None:
            candidate_args.append(kwargs)

        async def test_connection(self) -> dict[str, object]:
            return {"ok": True, "message": "ok", "company": {"CompanyName": "Sero Guld"}}

    monkeypatch.setattr(v2, "get_settings", provider)
    monkeypatch.setattr(v2, "get_uniconta_client", lambda: _HealthClient())
    monkeypatch.setattr(v2, "UnicontaClient", SuccessfulCandidate)
    monkeypatch.setattr(v2, "upsert_env_values", lambda _path, updates: writes.append(updates))
    monkeypatch.setattr(v2, "reset_uniconta_client", lambda: resets.append(True))

    response = await v2.post_uniconta_connect_v2(
        payload=UnicontaConnectIn(
            companyId="",
            username="",
            password=None,
            apiUrl=None,
            apiKey=None,
            sendEmailOnFinalize=True,
        ),
        _=None,  # type: ignore[arg-type]
    )

    assert response.connectionStatus == "bagli"
    assert candidate_args[0]["password"] == "existing-password"
    assert len(writes) == 1
    assert writes[0]["UNICONTA_API_URL"] == v2.UNICONTA_WEB_API_BASE
    assert writes[0]["UNICONTA_PASSWORD"] == "existing-password"
    assert writes[0]["UNICONTA_API_KEY"] == "existing-api-key"
    assert writes[0]["UNICONTA_SEND_EMAIL_ON_FINALIZE"] == "true"
    assert provider.clear_count == 1
    assert resets == [True]


@pytest.mark.asyncio
async def test_uniconta_api_key_without_password_is_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = _SettingsProvider(
        _settings(
            uniconta_username="",
            uniconta_password="",
            uniconta_company_id="",
            uniconta_api_key="",
        )
    )
    writes: list[dict[str, str]] = []
    monkeypatch.setattr(v2, "get_settings", provider)
    monkeypatch.setattr(v2, "get_uniconta_client", lambda: _HealthClient())
    monkeypatch.setattr(v2, "upsert_env_values", lambda _path, updates: writes.append(updates))

    response = await v2.post_uniconta_connect_v2(
        payload=UnicontaConnectIn(
            companyId="55606",
            username="user",
            password=None,
            apiKey="api-key-is-not-a-password",
        ),
        _=None,  # type: ignore[arg-type]
    )

    assert response.connectionStatus == "bagli_degil"
    assert response.configured is False
    assert writes == []
