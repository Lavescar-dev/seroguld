from __future__ import annotations

import json
from decimal import Decimal

import pytest

from app.config import Settings
from app.services import market_rate_profile


def _settings(
    *,
    live: bool,
    profile_json: str = "",
    fx_live: bool = True,
    platinum_live: bool = True,
    palladium_live: bool = True,
) -> Settings:
    return Settings(
        _env_file=None,
        database_url="sqlite+aiosqlite:///test.db",
        market_rates_live_enabled=live,
        market_rates_live_fx_enabled=fx_live,
        market_rates_live_platinum_enabled=platinum_live,
        market_rates_live_palladium_enabled=palladium_live,
        gold_price_live_enabled=not live,
        inventory_market_gold_dkk=Decimal("615.50"),
        inventory_market_silver_dkk=Decimal("7.80"),
        inventory_market_platinum_dkk=Decimal("280"),
        inventory_market_palladium_dkk=Decimal("335"),
        inventory_market_rate_profile_json=profile_json,
    )


@pytest.mark.asyncio
async def test_manual_toggle_is_the_single_source_for_market_rate_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))

    profile = await market_rate_profile.get_effective_market_rate_profile()

    assert profile["live_enabled"] is False
    assert profile["source"] == "manual"
    assert profile["gold_24k_dkk"] == "615.50"
    assert profile["silver_dkk"] == "7.80"
    # Kanonik birim DKK/g; türetilmiş 24K değeri matrisin kendisidir (fx çarpımı yok).
    assert profile["gold_rates_dkk"]["24"] == "615.50"
    assert profile["gold_rates_dkk"]["14"] == "359.04"
    assert profile["plet_dkk"] == "0.02"
    assert profile["rate_meta"]["platinum_dkk"]["source"] == "manual"


@pytest.mark.asyncio
async def test_live_mode_overlays_only_auto_values(monkeypatch: pytest.MonkeyPatch) -> None:
    """Canlı mod yalnız fx/Pt/Pd günceller; manuel altın/gümüş matrisi ezilmez."""

    class LiveAuto:
        async def get_auto_values(self):
            return {
                "eur_dkk_fx": {"value": Decimal("7.4759"), "source": "live", "observed_at": "2026-08-18", "stale": False},
                "platinum_dkk": {"value": Decimal("355.91"), "source": "live", "observed_at": "2026-08-19", "stale": False},
                "palladium_dkk": {"value": Decimal("266.31"), "source": "live", "observed_at": "2026-08-19", "stale": False},
            }

    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=True))
    monkeypatch.setattr(market_rate_profile, "GoldPriceService", LiveAuto)

    profile = await market_rate_profile.get_effective_market_rate_profile()

    assert profile["live_enabled"] is True
    assert profile["source"] == "live"
    assert profile["platinum_dkk"] == "355.91"
    assert profile["eur_dkk_fx"] == "7.48"
    assert profile["rate_meta"]["platinum_dkk"]["source"] == "live"
    # Manuel alış matrisi canlı moddan etkilenmez.
    assert profile["gold_24k_dkk"] == "615.50"
    assert profile["gold_rates_dkk"]["24"] == "615.50"


class _LiveAutoAll:
    async def get_auto_values(self):
        return {
            "eur_dkk_fx": {"value": Decimal("7.4759"), "source": "live", "observed_at": "2026-08-18", "stale": False},
            "platinum_dkk": {"value": Decimal("355.91"), "source": "live", "observed_at": "2026-08-19", "stale": False},
            "palladium_dkk": {"value": Decimal("266.31"), "source": "live", "observed_at": "2026-08-19", "stale": False},
        }


@pytest.mark.asyncio
async def test_field_level_flag_keeps_disabled_field_manual(monkeypatch: pytest.MonkeyPatch) -> None:
    """0.3.8: master açık + platin oto kapalı → platin manuel kalır, source 'mixed'."""
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=True, platinum_live=False))
    monkeypatch.setattr(market_rate_profile, "GoldPriceService", _LiveAutoAll)

    profile = await market_rate_profile.get_effective_market_rate_profile()

    assert profile["live_enabled"] is True
    assert profile["source"] == "mixed"
    assert profile["live_fields"] == {"eur_dkk_fx": True, "platinum_dkk": False, "palladium_dkk": True}
    # Kapalı alan canlı değerle EZİLMEZ; meta'sı manuel kalır.
    assert profile["platinum_dkk"] == "280.00"
    assert profile["rate_meta"]["platinum_dkk"]["source"] == "manual"
    # Açık alanlar canlı gelir.
    assert profile["eur_dkk_fx"] == "7.48"
    assert profile["palladium_dkk"] == "266.31"
    assert profile["rate_meta"]["palladium_dkk"]["source"] == "live"


@pytest.mark.asyncio
async def test_all_field_flags_off_behaves_manual_but_master_stays_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        market_rate_profile,
        "get_settings",
        lambda: _settings(live=True, fx_live=False, platinum_live=False, palladium_live=False),
    )

    called = {"count": 0}

    class NeverCalled:
        async def get_auto_values(self):
            called["count"] += 1
            return {}

    monkeypatch.setattr(market_rate_profile, "GoldPriceService", NeverCalled)

    profile = await market_rate_profile.get_effective_market_rate_profile()

    # Tüm alanlar kapalıysa canlı servis HİÇ çağrılmaz; her şey manuel.
    assert called["count"] == 0
    assert profile["live_enabled"] is True
    assert profile["source"] == "manual"
    assert profile["live_fields"] == {"eur_dkk_fx": False, "platinum_dkk": False, "palladium_dkk": False}
    assert profile["platinum_dkk"] == "280.00"


@pytest.mark.asyncio
async def test_master_off_ignores_field_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))

    profile = await market_rate_profile.get_effective_market_rate_profile()

    assert profile["live_enabled"] is False
    assert profile["source"] == "manual"
    assert profile["live_fields"] == {"eur_dkk_fx": False, "platinum_dkk": False, "palladium_dkk": False}


def test_cached_variant_respects_field_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=True, fx_live=False))

    class CachedAuto:
        @staticmethod
        def cached_auto_values_or_fallback():
            return {
                "eur_dkk_fx": {"value": Decimal("7.4759"), "source": "live", "observed_at": "2026-08-18", "stale": False},
                "platinum_dkk": {"value": Decimal("355.91"), "source": "live", "observed_at": "2026-08-19", "stale": False},
                "palladium_dkk": {"value": Decimal("266.31"), "source": "live", "observed_at": "2026-08-19", "stale": False},
            }

    monkeypatch.setattr(market_rate_profile, "GoldPriceService", CachedAuto)

    profile = market_rate_profile.get_effective_market_rate_profile_cached()

    assert profile["source"] == "mixed"
    assert profile["live_fields"]["eur_dkk_fx"] is False
    # Kapalı fx manuel default'ta kalır; Pt/Pd canlı.
    assert profile["eur_dkk_fx"] == "7.45"
    assert profile["platinum_dkk"] == "355.91"
    assert profile["rate_meta"]["eur_dkk_fx"]["source"] == "manual"


def test_saved_profile_json_round_trips_through_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """0.3.5 hatası: kaydedilen karat matrisi Settings'te bildirilmediği için
    hiç okunmuyordu. Artık save→get birebir dönmeli."""
    saved: dict[str, str] = {}

    def fake_upsert(_path, values):
        saved.update(values)

    monkeypatch.setattr(market_rate_profile, "upsert_env_values", fake_upsert)
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))
    monkeypatch.setattr(market_rate_profile.get_settings, "cache_clear", lambda: None, raising=False)

    payload = {
        "eur_dkk_fx": "7.45",
        "gold_rates_dkk": {"8": "130", "14": "382", "18": "470", "21": "540", "21.6": "555", "22": "565", "22b": "565", "24": "612"},
        "silver_rates_dkk": {"999": "8.10", "925": "7.40", "830": "6.60"},
        "plet_dkk": "0.02",
        "gold_bar_dkk": "620",
        "silver_bar_dkk": "8.30",
        "platinum_dkk": "300",
        "palladium_dkk": "340",
    }
    result = market_rate_profile.save_manual_market_rate_profile(payload)
    assert result["gold_rates_dkk"]["14"] == "382.00"

    stored_json = saved["INVENTORY_MARKET_RATE_PROFILE_JSON"]
    monkeypatch.setattr(
        market_rate_profile,
        "get_settings",
        lambda: _settings(live=False, profile_json=stored_json),
    )
    reloaded = market_rate_profile.get_manual_market_rate_profile()
    # "382 girildi, eski değer kaldı" regresyonu: girilen değer aynen döner.
    assert reloaded["gold_rates_dkk"]["14"] == "382.00"
    assert reloaded["gold_bar_dkk"] == "620.00"
    assert reloaded["silver_bar_dkk"] == "8.30"
    assert reloaded["plet_dkk"] == "0.02"


def test_save_persists_per_field_auto_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    """Drawer'daki manuel/oto geçişi: live_fields verilince alan-bazlı canlı
    bayraklar + master bayrak env'e yazılmalı (Ayarlar ekranına gitmeye gerek yok)."""
    saved: dict[str, str] = {}
    monkeypatch.setattr(market_rate_profile, "upsert_env_values", lambda _p, v: saved.update(v))
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))
    monkeypatch.setattr(market_rate_profile.get_settings, "cache_clear", lambda: None, raising=False)

    base = {
        "eur_dkk_fx": "7.45",
        "gold_rates_dkk": {"8": "130", "14": "382", "18": "470", "21": "540", "21.6": "555", "22": "565", "22b": "565", "24": "612"},
        "silver_rates_dkk": {"999": "8.10", "925": "7.40", "830": "6.60"},
        "plet_dkk": "0.02", "gold_bar_dkk": "620", "silver_bar_dkk": "8.30",
        "platinum_dkk": "300", "palladium_dkk": "340",
    }

    # Platin oto, diğerleri manuel -> master açık.
    market_rate_profile.save_manual_market_rate_profile(
        {**base, "live_fields": {"eur_dkk_fx": False, "platinum_dkk": True, "palladium_dkk": False}}
    )
    assert saved["MARKET_RATES_LIVE_FX_ENABLED"] == "false"
    assert saved["MARKET_RATES_LIVE_PLATINUM_ENABLED"] == "true"
    assert saved["MARKET_RATES_LIVE_PALLADIUM_ENABLED"] == "false"
    assert saved["MARKET_RATES_LIVE_ENABLED"] == "true"  # en az bir alan oto

    # Hepsi manuel -> master kapalı.
    saved.clear()
    market_rate_profile.save_manual_market_rate_profile(
        {**base, "live_fields": {"eur_dkk_fx": False, "platinum_dkk": False, "palladium_dkk": False}}
    )
    assert saved["MARKET_RATES_LIVE_ENABLED"] == "false"

    # live_fields verilmezse canlı bayraklara DOKUNULMAZ.
    saved.clear()
    market_rate_profile.save_manual_market_rate_profile(base)
    assert "MARKET_RATES_LIVE_ENABLED" not in saved
    assert "MARKET_RATES_LIVE_PLATINUM_ENABLED" not in saved


def test_legacy_eur_profile_json_is_converted_on_read(monkeypatch: pytest.MonkeyPatch) -> None:
    legacy_json = json.dumps(
        {
            "eur_dkk_fx": "7.45",
            "gold_rates_eur": {"8": "27.5323", "14": "48.1815", "18": "61.9477", "21": "72.2723", "21.6": "74.3372", "22": "75.7136", "24": "82.6174"},
            "silver_rates_eur": {"999": "1.0470", "925": "0.9694", "830": "0.8698", "800": "0.8383"},
            "platinum_dkk": "280.00",
            "palladium_dkk": "335.00",
        }
    )
    monkeypatch.setattr(
        market_rate_profile,
        "get_settings",
        lambda: _settings(live=False, profile_json=legacy_json),
    )
    profile = market_rate_profile.get_manual_market_rate_profile()
    # 82.6174 EUR × 7.45 = 615.50 DKK
    assert profile["gold_rates_dkk"]["24"] == "615.50"
    assert profile["silver_rates_dkk"]["999"] == "7.80"
    # Eski "800" gümüş anahtarı Plet skalerine taşınır: 0.8383 × 7.45 = 6.25
    assert profile["plet_dkk"] == "6.25"
