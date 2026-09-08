from __future__ import annotations

import asyncio
import os
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.services import market_rate_profile, wp_priser_service


def _settings(*, live: bool = False) -> Settings:
    return Settings(
        _env_file=None,
        database_url="sqlite+aiosqlite:///test.db",
        market_rates_live_enabled=live,
        gold_price_live_enabled=not live,
        inventory_market_gold_dkk=Decimal("615.50"),
        inventory_market_silver_dkk=Decimal("7.80"),
        inventory_market_platinum_dkk=Decimal("280"),
        inventory_market_palladium_dkk=Decimal("335"),
    )


def _stub_settings(last_fetch: str):
    """market_rates.get_settings taklidi: yalnız WP damgası taşır; merge'in
    çağırdığı cache_clear'a da sahip olmalıdır."""

    def _get() -> SimpleNamespace:
        return SimpleNamespace(wp_priser_last_fetch=last_fetch)

    _get.cache_clear = lambda: None
    return _get


def _fetched_wp_payload(**overrides: object) -> dict:
    """WP fetch yanıtı (sentetik değerler); test_market_rate_settings_contract
    ile aynı düzen."""
    payload: dict = {
        "gold_rates_dkk": {"24": "867.00"},
        "silver_rates_dkk": {"999": "12.80"},
        "gold_bar_dkk": "873.00",
        "silver_bar_dkk": "13.10",
        "platinum_dkk": "290.00",
        "palladium_dkk": "220.00",
        "plet_dkk": "0.0200",
        "fetched_at": "2026-09-08T10:00:00",
        "page_title": "Guldpriser",
    }
    payload.update(overrides)
    return payload


def _manual_profile_with_22b() -> dict:
    """Operatörün kendi 22b değerini taşıyan manuel profil."""
    return {
        "eur_dkk_fx": "7.45",
        "gold_rates_dkk": {
            "8": "205.00", "14": "359.04", "18": "461.63", "21": "538.56",
            "21.6": "553.95", "22": "564.21", "22b": "731.00", "24": "615.50",
        },
        "silver_rates_dkk": {"999": "7.80", "925": "7.22", "830": "6.48"},
        "plet_dkk": "0.0200",
        "gold_bar_dkk": "615.50",
        "silver_bar_dkk": "7.80",
        "platinum_dkk": "280.00",
        "palladium_dkk": "335.00",
    }


# ---------------------------------------------------------------------------
# Ortak merge: 22b ASLA yazılmaz + trigger etiketi
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_wp_merge_never_writes_22b(monkeypatch: pytest.MonkeyPatch) -> None:
    """22b WordPress'te hiç yoktur; kaynak yanıtı bu anahtarı taşırsa bile
    operatörün manuel değeri AYNEN korunur (otomatik akışa girmez)."""
    from app.api import market_rates as api_module

    saved_payloads: list[dict] = []

    async def fake_fetch() -> dict:
        # 22b kasıtlı olarak eklenir — merge'in savunma hattı burada sınanır.
        return _fetched_wp_payload(gold_rates_dkk={"24": "867.00", "22b": "999.00"})

    def fake_save(payload: dict) -> dict:
        saved_payloads.append(payload)
        return payload

    monkeypatch.setattr(wp_priser_service, "fetch_wp_priser_rates", fake_fetch)
    monkeypatch.setattr(api_module, "get_manual_market_rate_profile", _manual_profile_with_22b)
    monkeypatch.setattr(api_module, "save_manual_market_rate_profile", fake_save)
    monkeypatch.setattr(api_module, "get_settings", _stub_settings("2026-09-08T10:00:00"))
    monkeypatch.setattr("app.utils.env_file.upsert_env_values", lambda *_a, **_k: None)
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))
    monkeypatch.setattr(market_rate_profile.get_settings, "cache_clear", lambda: None, raising=False)

    response = await api_module.apply_wp_priser_rates(trigger="auto")

    assert response["ok"] is True
    assert response["trigger"] == "auto"
    # Uygulanan listesinde 22b yoktur.
    assert response["applied_gold"] == {"24": "867.00"}
    # Profildeki operatör değeri (731.00) ezilmez; 24 güncellenir.
    assert saved_payloads[0]["gold_rates_dkk"]["22b"] == "731.00"
    assert saved_payloads[0]["gold_rates_dkk"]["24"] == "867.00"


# ---------------------------------------------------------------------------
# Scheduler: kapalıyken fetch YOK, açıksa önce interval kadar bekle
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_scheduler_disabled_makes_no_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import market_rates as api_module

    monkeypatch.setattr(api_module, "get_wp_auto_pull_settings", lambda: (False, 60))
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        raise asyncio.CancelledError()

    async def fail_apply(*, trigger: str) -> dict:
        raise AssertionError("kapalıyken fetch çağrılmamalı")

    monkeypatch.setattr(api_module, "apply_wp_priser_rates", fail_apply)

    with pytest.raises(asyncio.CancelledError):
        await api_module.run_wp_auto_pull_scheduler(sleep=fake_sleep)

    # Kısa yeniden-denetleme aralığında bekler, ağ çağrısı yapmaz.
    assert sleeps == [api_module.WP_AUTO_PULL_IDLE_POLL_SECONDS]


@pytest.mark.asyncio
async def test_scheduler_enabled_sleeps_interval_then_fetches(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import market_rates as api_module

    monkeypatch.setattr(api_module, "get_wp_auto_pull_settings", lambda: (True, 30))
    sleeps: list[float] = []
    apply_triggers: list[str] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) > 1:
            raise asyncio.CancelledError()

    async def fake_apply(*, trigger: str) -> dict:
        apply_triggers.append(trigger)
        return {"applied_gold": {"24": "867.00"}, "applied_silver": {}, "applied_scalars": {}, "fetched_at": "t"}

    monkeypatch.setattr(api_module, "apply_wp_priser_rates", fake_apply)

    with pytest.raises(asyncio.CancelledError):
        await api_module.run_wp_auto_pull_scheduler(sleep=fake_sleep)

    # İlk tick'ten ÖNCE interval kadar beklenir (testlerde lifespan çalışsa da
    # ağ atışı olmaz); sonra her turda tekrar aynı interval.
    assert sleeps == [30 * 60, 30 * 60]
    assert apply_triggers == ["auto"]


@pytest.mark.asyncio
async def test_scheduler_rechecks_enabled_after_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bekleme penceresinde 'Otomatik çekmeyi durdur' işaretlenirse o turdaki
    otomatik çekim iptal edilir — checkbox anında tam-manuel moda geçirir ve
    bu arada girilen manuel fiyatlar WP ile ezilmez."""
    from app.api import market_rates as api_module

    states = [(True, 15), (False, 15)]
    reads: list[int] = []

    def fake_settings() -> tuple[bool, int]:
        idx = min(len(reads), len(states) - 1)
        reads.append(idx)
        return states[idx]

    monkeypatch.setattr(api_module, "get_wp_auto_pull_settings", fake_settings)
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) > 2:
            raise asyncio.CancelledError()

    async def fail_apply(*, trigger: str) -> dict:
        raise AssertionError("uyku sırasında kapatılan otomatik çekim yine de çalıştı")

    monkeypatch.setattr(api_module, "apply_wp_priser_rates", fail_apply)

    with pytest.raises(asyncio.CancelledError):
        await api_module.run_wp_auto_pull_scheduler(sleep=fake_sleep)

    # İlk tur: interval uykusu, ardından (kapalı görüp) uygulamadan devam.
    assert sleeps[0] == 15 * 60
    # Sonraki turlar kısa idle yeniden-denetleme aralığında bekler.
    assert sleeps[1:] == [api_module.WP_AUTO_PULL_IDLE_POLL_SECONDS, api_module.WP_AUTO_PULL_IDLE_POLL_SECONDS]


@pytest.mark.asyncio
async def test_scheduler_clamps_interval_to_minimum(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import market_rates as api_module

    monkeypatch.setattr(api_module, "get_wp_auto_pull_settings", lambda: (True, 5))
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        raise asyncio.CancelledError()

    async def fail_apply(*, trigger: str) -> dict:
        raise AssertionError("beklemeden fetch yapılmamalı")

    monkeypatch.setattr(api_module, "apply_wp_priser_rates", fail_apply)

    with pytest.raises(asyncio.CancelledError):
        await api_module.run_wp_auto_pull_scheduler(sleep=fake_sleep)

    assert sleeps == [market_rate_profile.WP_AUTO_PULL_MIN_MINUTES * 60]


@pytest.mark.asyncio
async def test_scheduler_survives_fetch_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """WPPriserUnavailable → log + sessiz devam (AFG sıfırlanmaz, döngü ölmez)."""
    from app.api import market_rates as api_module
    from app.services.wp_priser_service import WPPriserUnavailable

    monkeypatch.setattr(api_module, "get_wp_auto_pull_settings", lambda: (True, 60))
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) > 1:
            raise asyncio.CancelledError()

    async def failing_apply(*, trigger: str) -> dict:
        raise WPPriserUnavailable("WP'ye ulaşılamadı (ağ/HTTP hatası: ConnectTimeout).")

    monkeypatch.setattr(api_module, "apply_wp_priser_rates", failing_apply)

    with pytest.raises(asyncio.CancelledError):
        await api_module.run_wp_auto_pull_scheduler(sleep=fake_sleep)

    assert len(sleeps) == 2  # hata sonrası döngü devam etti


# ---------------------------------------------------------------------------
# Ayar okuma/yazma: varsayılan açık, dakika min 15'e sabitlenir
# ---------------------------------------------------------------------------

def test_wp_auto_pull_settings_default_and_clamp(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    env_file = tmp_path / "runtime.env"
    env_file.write_text("", encoding="utf-8")
    monkeypatch.setattr(market_rate_profile, "ROOT_ENV_FILE", env_file)
    for key in (market_rate_profile.WP_AUTO_PULL_ENABLED_ENV, market_rate_profile.WP_AUTO_PULL_MINUTES_ENV):
        monkeypatch.delenv(key, raising=False)

    # Ayar hiç yazılmamışsa: açık + 60 dakika.
    assert market_rate_profile.get_wp_auto_pull_settings() == (True, 60)

    enabled, minutes = market_rate_profile.save_wp_auto_pull_settings(enabled=False, minutes=5)
    assert (enabled, minutes) == (False, 15)  # min 15 clamp

    # Süreç ortamı pin'i düşürülünce değer dosyadan (tırnaklı) okunmalı.
    monkeypatch.delenv(market_rate_profile.WP_AUTO_PULL_ENABLED_ENV)
    monkeypatch.delenv(market_rate_profile.WP_AUTO_PULL_MINUTES_ENV)
    assert market_rate_profile.get_wp_auto_pull_settings() == (False, 15)
    assert 'MARKET_RATES_WP_AUTO_PULL_ENABLED="false"' in env_file.read_text(encoding="utf-8")
    assert 'MARKET_RATES_WP_AUTO_PULL_MINUTES="15"' in env_file.read_text(encoding="utf-8")

    # Testler arası sızıntıyı kapat (upsert_env_values os.environ'a pin'ler).
    for key in (market_rate_profile.WP_AUTO_PULL_ENABLED_ENV, market_rate_profile.WP_AUTO_PULL_MINUTES_ENV):
        os.environ.pop(key, None)


def test_wp_auto_pull_settings_invalid_minutes_falls_back(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    env_file = tmp_path / "runtime.env"
    env_file.write_text(
        'MARKET_RATES_WP_AUTO_PULL_MINUTES="abc"\n'
        'MARKET_RATES_WP_AUTO_PULL_ENABLED="false"\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(market_rate_profile, "ROOT_ENV_FILE", env_file)
    monkeypatch.delenv(market_rate_profile.WP_AUTO_PULL_ENABLED_ENV, raising=False)
    monkeypatch.delenv(market_rate_profile.WP_AUTO_PULL_MINUTES_ENV, raising=False)

    assert market_rate_profile.get_wp_auto_pull_settings() == (False, 60)


# ---------------------------------------------------------------------------
# GET/PUT /defaults: wp_auto_pull_enabled + last_wp_fetch_at
# ---------------------------------------------------------------------------

def _put_payload(**overrides: object) -> dict:
    base: dict = {
        "eur_dkk_fx": "7.45",
        "gold_rates_dkk": {"8": "130", "14": "382", "18": "470", "21": "540", "21.6": "555", "22": "565", "22b": "565", "24": "612"},
        "silver_rates_dkk": {"999": "8.10", "925": "7.40", "830": "6.60"},
        "plet_dkk": "0.02", "gold_bar_dkk": "620", "silver_bar_dkk": "8.30",
        "platinum_dkk": "300", "palladium_dkk": "340",
        "live_fields": None,
    }
    base.update(overrides)
    return base


def _update_in(payload: dict):
    from app.api.market_rates import MarketRateProfileUpdateIn

    return MarketRateProfileUpdateIn(**payload)


@pytest.mark.asyncio
async def test_put_persists_wp_auto_pull_flag_and_echoes_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import market_rates as api_module

    saved: dict[str, str] = []
    profile_payloads: list[dict] = []

    def fake_upsert(_path: object, values: dict) -> None:
        saved.append(dict(values))

    def fake_profile_save(payload: dict) -> dict:
        profile_payloads.append(payload)
        return payload

    monkeypatch.setattr(market_rate_profile, "upsert_env_values", fake_upsert)
    monkeypatch.setattr("app.utils.env_file.upsert_env_values", fake_upsert)
    monkeypatch.setattr(api_module, "save_manual_market_rate_profile", fake_profile_save)
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))
    monkeypatch.setattr(market_rate_profile.get_settings, "cache_clear", lambda: None, raising=False)
    monkeypatch.setattr(api_module, "get_settings", _stub_settings("2026-09-08T10:00:00"))
    monkeypatch.setattr(api_module, "get_wp_auto_pull_settings", lambda: (False, 60))

    response = await api_module.put_market_rate_defaults(
        _update_in(_put_payload(wp_auto_pull_enabled=False)), None,
    )

    assert saved[0][market_rate_profile.WP_AUTO_PULL_ENABLED_ENV] == "false"
    # Dakika anahtarına dokunulmaz (yalnız verilen alan yazılır).
    assert market_rate_profile.WP_AUTO_PULL_MINUTES_ENV not in saved[0]
    assert response["wp_auto_pull_enabled"] is False
    assert response["last_wp_fetch_at"] == "2026-09-08T10:00:00"
    # Profil payload'ı yeni anahtarı taşımaz (ayrı env alanı).
    assert profile_payloads and "wp_auto_pull_enabled" not in profile_payloads[0]


@pytest.mark.asyncio
async def test_put_without_wp_flag_keeps_current_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import market_rates as api_module

    saved: list[dict] = []

    def fake_upsert(_path: object, values: dict) -> None:
        saved.append(dict(values))

    monkeypatch.setattr(market_rate_profile, "upsert_env_values", fake_upsert)
    monkeypatch.setattr("app.utils.env_file.upsert_env_values", fake_upsert)
    monkeypatch.setattr(api_module, "save_manual_market_rate_profile", lambda payload: payload)
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))
    monkeypatch.setattr(market_rate_profile.get_settings, "cache_clear", lambda: None, raising=False)
    monkeypatch.setattr(api_module, "get_settings", _stub_settings(""))
    monkeypatch.setattr(api_module, "get_wp_auto_pull_settings", lambda: (True, 60))

    response = await api_module.put_market_rate_defaults(_update_in(_put_payload()), None)

    # Verilmezse WP çekim anahtarları hiç yazılmaz (mevcut ayar korunur).
    assert all(market_rate_profile.WP_AUTO_PULL_ENABLED_ENV not in entry for entry in saved)
    assert response["wp_auto_pull_enabled"] is True
    assert response["last_wp_fetch_at"] is None


@pytest.mark.asyncio
async def test_get_defaults_exposes_wp_auto_pull_state(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api import market_rates as api_module

    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))
    monkeypatch.setattr(api_module, "get_settings", _stub_settings("2026-09-07T09:30:00"))
    monkeypatch.setattr(api_module, "get_wp_auto_pull_settings", lambda: (True, 45))

    response = await api_module.get_market_rate_defaults(None)

    assert response["wp_auto_pull_enabled"] is True
    assert response["last_wp_fetch_at"] == "2026-09-07T09:30:00"
