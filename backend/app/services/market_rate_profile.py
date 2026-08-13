from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from app.config import ROOT_ENV_FILE, get_settings
from app.services.gold_price import GoldPriceService
from app.utils.env_file import upsert_env_values

GOLD_RATE_KEYS = ("8", "14", "18", "21", "21.6", "22", "24")
SILVER_RATE_KEYS = ("999", "925", "830", "800")
DEFAULT_EUR_DKK_FX = Decimal("7.45")
DEFAULT_GOLD_DKK = Decimal("615.50")
DEFAULT_SILVER_DKK = Decimal("7.80")
DEFAULT_PLATINUM_DKK = Decimal("280")
DEFAULT_PALLADIUM_DKK = Decimal("335")


def _decimal(value: Any, fallback: Decimal = Decimal("0")) -> Decimal:
    try:
        parsed = Decimal(str(value).replace(",", ".").strip())
    except (InvalidOperation, TypeError, ValueError):
        return fallback
    return parsed if parsed.is_finite() else fallback


def _positive(value: Any, fallback: Decimal) -> Decimal:
    parsed = _decimal(value, fallback)
    return parsed if parsed > 0 else fallback


def _q(value: Any, places: int = 4) -> Decimal:
    quantum = Decimal("1") if places == 0 else Decimal(f"0.{'0' * (places - 1)}1")
    return _decimal(value).quantize(quantum, rounding=ROUND_HALF_UP)


def _legacy_profile() -> dict[str, Any]:
    settings = get_settings()
    fx = DEFAULT_EUR_DKK_FX
    gold_dkk = _positive(getattr(settings, "inventory_market_gold_dkk", None), DEFAULT_GOLD_DKK)
    silver_dkk = _positive(getattr(settings, "inventory_market_silver_dkk", None), DEFAULT_SILVER_DKK)
    platinum_dkk = _positive(getattr(settings, "inventory_market_platinum_dkk", None), DEFAULT_PLATINUM_DKK)
    palladium_dkk = _positive(getattr(settings, "inventory_market_palladium_dkk", None), DEFAULT_PALLADIUM_DKK)
    gold_24_eur = gold_dkk / fx
    silver_999_eur = silver_dkk / fx
    return _build_profile(
        eur_dkk_fx=fx,
        gold_rates_eur={key: gold_24_eur * _decimal(key) / Decimal("24") for key in GOLD_RATE_KEYS},
        silver_rates_eur={key: silver_999_eur * _decimal(key) / Decimal("999") for key in SILVER_RATE_KEYS},
        platinum_dkk=platinum_dkk,
        palladium_dkk=palladium_dkk,
    )


def _build_profile(
    *,
    eur_dkk_fx: Any,
    gold_rates_eur: dict[str, Any],
    silver_rates_eur: dict[str, Any],
    platinum_dkk: Any,
    palladium_dkk: Any,
    fallback_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fx = _positive(eur_dkk_fx, DEFAULT_EUR_DKK_FX)
    gold_fallbacks = fallback_profile["gold_rates_eur"] if fallback_profile else {}
    silver_fallbacks = fallback_profile["silver_rates_eur"] if fallback_profile else {}
    gold = {
        key: _q(_positive(gold_rates_eur.get(key), _decimal(gold_fallbacks.get(key), Decimal("0.01"))))
        for key in GOLD_RATE_KEYS
    }
    silver = {
        key: _q(_positive(silver_rates_eur.get(key), _decimal(silver_fallbacks.get(key), Decimal("0.01"))))
        for key in SILVER_RATE_KEYS
    }
    return {
        "eur_dkk_fx": str(_q(fx, 2)),
        "gold_rates_eur": {key: str(value) for key, value in gold.items()},
        "silver_rates_eur": {key: str(value) for key, value in silver.items()},
        "gold_24k_dkk": str(_q(gold["24"] * fx, 2)),
        "silver_dkk": str(_q(silver["999"] * fx, 2)),
        "platinum_dkk": str(_q(_positive(platinum_dkk, DEFAULT_PLATINUM_DKK), 2)),
        "palladium_dkk": str(_q(_positive(palladium_dkk, DEFAULT_PALLADIUM_DKK), 2)),
    }


def _profile_from_payload(payload: Any) -> dict[str, Any]:
    legacy = _legacy_profile()
    if not isinstance(payload, dict):
        return legacy
    raw_gold = payload.get("gold_rates_eur") if isinstance(payload.get("gold_rates_eur"), dict) else {}
    raw_silver = payload.get("silver_rates_eur") if isinstance(payload.get("silver_rates_eur"), dict) else {}
    gold = {key: raw_gold.get(key, legacy["gold_rates_eur"].get(key)) for key in GOLD_RATE_KEYS}
    silver = {key: raw_silver.get(key, legacy["silver_rates_eur"].get(key)) for key in SILVER_RATE_KEYS}
    return _build_profile(
        eur_dkk_fx=payload.get("eur_dkk_fx", legacy["eur_dkk_fx"]),
        gold_rates_eur=gold,
        silver_rates_eur=silver,
        platinum_dkk=payload.get("platinum_dkk", legacy["platinum_dkk"]),
        palladium_dkk=payload.get("palladium_dkk", legacy["palladium_dkk"]),
        fallback_profile=legacy,
    )


def get_manual_market_rate_profile() -> dict[str, Any]:
    settings = get_settings()
    raw = getattr(settings, "inventory_market_rate_profile_json", "")
    try:
        payload = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        payload = None
    return _profile_from_payload(payload)


def _live_profile(rates: dict[str, Any], *, fx: Decimal) -> dict[str, Any]:
    gold_dkk = _positive(rates.get("gold"), DEFAULT_GOLD_DKK)
    silver_dkk = _positive(rates.get("silver"), DEFAULT_SILVER_DKK)
    platinum_dkk = _positive(rates.get("platinum"), DEFAULT_PLATINUM_DKK)
    palladium_dkk = _positive(rates.get("palladium"), DEFAULT_PALLADIUM_DKK)
    gold_24_eur = gold_dkk / fx
    silver_999_eur = silver_dkk / fx
    return _build_profile(
        eur_dkk_fx=fx,
        gold_rates_eur={key: gold_24_eur * _decimal(key) / Decimal("24") for key in GOLD_RATE_KEYS},
        silver_rates_eur={key: silver_999_eur * _decimal(key) / Decimal("999") for key in SILVER_RATE_KEYS},
        platinum_dkk=platinum_dkk,
        palladium_dkk=palladium_dkk,
    )


def _with_runtime(profile: dict[str, Any], *, live_enabled: bool, source: str) -> dict[str, Any]:
    return {**profile, "live_enabled": live_enabled, "source": source}


async def get_effective_market_rate_profile() -> dict[str, Any]:
    settings = get_settings()
    manual = get_manual_market_rate_profile()
    live_enabled = bool(settings.market_rates_live_enabled)
    if not live_enabled:
        return _with_runtime(manual, live_enabled=False, source="manual")
    rates = await GoldPriceService().get_rates()
    return _with_runtime(_live_profile(rates, fx=_decimal(manual["eur_dkk_fx"], DEFAULT_EUR_DKK_FX)), live_enabled=True, source="live")


def get_effective_market_rate_profile_cached() -> dict[str, Any]:
    settings = get_settings()
    manual = get_manual_market_rate_profile()
    live_enabled = bool(settings.market_rates_live_enabled)
    if not live_enabled:
        return _with_runtime(manual, live_enabled=False, source="manual")
    rates = GoldPriceService.cached_rates_or_fallback()
    return _with_runtime(_live_profile(rates, fx=_decimal(manual["eur_dkk_fx"], DEFAULT_EUR_DKK_FX)), live_enabled=True, source="live")


def save_manual_market_rate_profile(payload: dict[str, Any]) -> dict[str, Any]:
    profile = _profile_from_payload(payload)
    upsert_env_values(
        ROOT_ENV_FILE,
        {
            "INVENTORY_MARKET_RATE_PROFILE_JSON": json.dumps(profile, ensure_ascii=True, separators=(",", ":")),
            "INVENTORY_MARKET_GOLD_DKK": profile["gold_24k_dkk"],
            "INVENTORY_MARKET_SILVER_DKK": profile["silver_dkk"],
            "INVENTORY_MARKET_PLATINUM_DKK": profile["platinum_dkk"],
            "INVENTORY_MARKET_PALLADIUM_DKK": profile["palladium_dkk"],
        },
    )
    get_settings.cache_clear()
    return _with_runtime(profile, live_enabled=False, source="manual")
