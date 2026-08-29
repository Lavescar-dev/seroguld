from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from app.config import ROOT_ENV_FILE, get_settings
from app.services.gold_price import GoldPriceService
from app.utils.env_file import upsert_env_values

# Kanonik operatör birimi DKK/g'dir.  EUR alanları yalnız eski kayıtları
# okurken (env profili, session note payload'ları) çevrim için tanınır.
# R2-10: "22b" = ikinci 22K fiyat seviyesi (ayni 916 safligi, farkli alis
# kategorisi — orn. hurda vs sikke). Sayisal islemlerde 22'ye esdegerdir.
GOLD_RATE_KEYS = ("8", "14", "18", "21", "21.6", "22", "22b", "24")
KARAT_NUMERIC_ALIAS = {"22b": "22"}


def karat_numeric_key(key: str) -> str:
    return KARAT_NUMERIC_ALIAS.get(str(key), str(key))
SILVER_RATE_KEYS = ("999", "925", "830")
LEGACY_SILVER_EUR_KEYS = ("999", "925", "830", "800")
DEFAULT_EUR_DKK_FX = Decimal("7.45")
DEFAULT_GOLD_DKK = Decimal("615.50")
DEFAULT_SILVER_DKK = Decimal("7.80")
DEFAULT_PLATINUM_DKK = Decimal("280")
DEFAULT_PALLADIUM_DKK = Decimal("335")
DEFAULT_PLET_DKK = Decimal("0.02")


def _decimal(value: Any, fallback: Decimal = Decimal("0")) -> Decimal:
    try:
        parsed = Decimal(str(value).replace(",", ".").strip())
    except (InvalidOperation, TypeError, ValueError):
        return fallback
    return parsed if parsed.is_finite() else fallback


def _positive(value: Any, fallback: Decimal) -> Decimal:
    parsed = _decimal(value, fallback)
    return parsed if parsed > 0 else fallback


def _q(value: Any, places: int = 2) -> Decimal:
    quantum = Decimal("1") if places == 0 else Decimal(f"0.{'0' * (places - 1)}1")
    return _decimal(value).quantize(quantum, rounding=ROUND_HALF_UP)


def _gold_purity_factor(key: str) -> Decimal:
    return _decimal(karat_numeric_key(key)) / Decimal("24")


def _silver_purity_factor(key: str) -> Decimal:
    return _decimal(key) / Decimal("999")


def _manual_meta() -> dict[str, Any]:
    return {"source": "manual", "observed_at": None, "stale": False}


def _legacy_profile() -> dict[str, Any]:
    settings = get_settings()
    gold_dkk = _positive(getattr(settings, "inventory_market_gold_dkk", None), DEFAULT_GOLD_DKK)
    silver_dkk = _positive(getattr(settings, "inventory_market_silver_dkk", None), DEFAULT_SILVER_DKK)
    return _build_profile(
        eur_dkk_fx=DEFAULT_EUR_DKK_FX,
        gold_rates_dkk={key: gold_dkk * _gold_purity_factor(key) for key in GOLD_RATE_KEYS},
        silver_rates_dkk={key: silver_dkk * _silver_purity_factor(key) for key in SILVER_RATE_KEYS},
        platinum_dkk=getattr(settings, "inventory_market_platinum_dkk", None),
        palladium_dkk=getattr(settings, "inventory_market_palladium_dkk", None),
        gold_bar_dkk=getattr(settings, "inventory_market_gold_bar_dkk", None),
        silver_bar_dkk=getattr(settings, "inventory_market_silver_bar_dkk", None),
        plet_dkk=getattr(settings, "inventory_market_plet_dkk", None),
    )


def _build_profile(
    *,
    eur_dkk_fx: Any,
    gold_rates_dkk: dict[str, Any],
    silver_rates_dkk: dict[str, Any],
    platinum_dkk: Any,
    palladium_dkk: Any,
    gold_bar_dkk: Any,
    silver_bar_dkk: Any,
    plet_dkk: Any,
    fallback_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fx = _positive(eur_dkk_fx, DEFAULT_EUR_DKK_FX)
    gold_fallbacks = fallback_profile["gold_rates_dkk"] if fallback_profile else {}
    silver_fallbacks = fallback_profile["silver_rates_dkk"] if fallback_profile else {}
    gold = {
        key: _q(_positive(gold_rates_dkk.get(key), _decimal(gold_fallbacks.get(key), Decimal("0.01"))))
        for key in GOLD_RATE_KEYS
    }
    silver = {
        key: _q(_positive(silver_rates_dkk.get(key), _decimal(silver_fallbacks.get(key), Decimal("0.01"))))
        for key in SILVER_RATE_KEYS
    }
    return {
        "eur_dkk_fx": str(_q(fx)),
        "gold_rates_dkk": {key: str(value) for key, value in gold.items()},
        "silver_rates_dkk": {key: str(value) for key, value in silver.items()},
        "gold_24k_dkk": str(gold["24"]),
        "silver_dkk": str(silver["999"]),
        "platinum_dkk": str(_q(_positive(platinum_dkk, DEFAULT_PLATINUM_DKK))),
        "palladium_dkk": str(_q(_positive(palladium_dkk, DEFAULT_PALLADIUM_DKK))),
        "gold_bar_dkk": str(_q(_positive(gold_bar_dkk, DEFAULT_GOLD_DKK))),
        "silver_bar_dkk": str(_q(_positive(silver_bar_dkk, DEFAULT_SILVER_DKK))),
        "plet_dkk": str(_q(_positive(plet_dkk, DEFAULT_PLET_DKK))),
    }


def _dkk_rates_from_legacy_eur(raw_eur: dict[str, Any], fx: Decimal, keys: tuple[str, ...]) -> dict[str, Decimal]:
    return {key: _q(_positive(raw_eur.get(key), Decimal("0")) * fx) for key in keys if raw_eur.get(key) is not None}


def _profile_from_payload(payload: Any) -> dict[str, Any]:
    legacy = _legacy_profile()
    if not isinstance(payload, dict):
        return legacy
    fx = _positive(payload.get("eur_dkk_fx", legacy["eur_dkk_fx"]), DEFAULT_EUR_DKK_FX)

    raw_gold_dkk = payload.get("gold_rates_dkk") if isinstance(payload.get("gold_rates_dkk"), dict) else None
    raw_silver_dkk = payload.get("silver_rates_dkk") if isinstance(payload.get("silver_rates_dkk"), dict) else None
    plet_dkk = payload.get("plet_dkk")

    if raw_gold_dkk is None:
        # 0.3.5 ve öncesi env profilleri EUR matrisi taşır: okurken DKK'ya çevir.
        raw_gold_eur = payload.get("gold_rates_eur") if isinstance(payload.get("gold_rates_eur"), dict) else {}
        raw_gold_dkk = _dkk_rates_from_legacy_eur(raw_gold_eur, fx, GOLD_RATE_KEYS)
    if raw_silver_dkk is None:
        raw_silver_eur = payload.get("silver_rates_eur") if isinstance(payload.get("silver_rates_eur"), dict) else {}
        raw_silver_dkk = _dkk_rates_from_legacy_eur(raw_silver_eur, fx, SILVER_RATE_KEYS)
        if plet_dkk is None and raw_silver_eur.get("800") is not None:
            plet_dkk = _q(_positive(raw_silver_eur.get("800"), Decimal("0")) * fx)

    gold = {key: raw_gold_dkk.get(key, legacy["gold_rates_dkk"].get(key)) for key in GOLD_RATE_KEYS}
    silver = {key: raw_silver_dkk.get(key, legacy["silver_rates_dkk"].get(key)) for key in SILVER_RATE_KEYS}
    return _build_profile(
        eur_dkk_fx=fx,
        gold_rates_dkk=gold,
        silver_rates_dkk=silver,
        platinum_dkk=payload.get("platinum_dkk", legacy["platinum_dkk"]),
        palladium_dkk=payload.get("palladium_dkk", legacy["palladium_dkk"]),
        gold_bar_dkk=payload.get("gold_bar_dkk", legacy["gold_bar_dkk"]),
        silver_bar_dkk=payload.get("silver_bar_dkk", legacy["silver_bar_dkk"]),
        plet_dkk=plet_dkk if plet_dkk is not None else legacy["plet_dkk"],
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


# Otomatik beslenebilen alanlar; altın/gümüş matrisleri her zaman manueldir.
AUTO_FIELD_KEYS = ("eur_dkk_fx", "platinum_dkk", "palladium_dkk")


def _enabled_auto_keys(settings: Any) -> tuple[str, ...]:
    """Master + alan bazlı bayraklardan etkin oto anahtarlarını türetir."""
    if not bool(settings.market_rates_live_enabled):
        return ()
    field_flags = {
        "eur_dkk_fx": bool(getattr(settings, "market_rates_live_fx_enabled", True)),
        "platinum_dkk": bool(getattr(settings, "market_rates_live_platinum_enabled", True)),
        "palladium_dkk": bool(getattr(settings, "market_rates_live_palladium_enabled", True)),
    }
    return tuple(key for key in AUTO_FIELD_KEYS if field_flags[key])


def _auto_overlay(
    profile: dict[str, Any],
    auto: dict[str, dict[str, Any]],
    enabled_keys: tuple[str, ...] = AUTO_FIELD_KEYS,
) -> dict[str, Any]:
    """Canlı mod yalnız SEÇİLİ oto değerleri (fx, Pt, Pd) günceller.

    Manuel altın/gümüş alış matrisleri ve bar/Plet fiyatları işletmenin kendi
    değerleridir; canlı mod bunları ASLA ezmez. Alan bazlı kapatılan anahtarlar
    da manuel değerinde kalır.
    """
    merged = dict(profile)
    meta = {key: _manual_meta() for key in AUTO_FIELD_KEYS}
    for key in AUTO_FIELD_KEYS:
        if key not in enabled_keys:
            continue
        entry = auto.get(key)
        if entry is None:
            continue
        value = entry.get("value")
        if value is not None and _decimal(value) > 0:
            merged[key] = str(_q(value))
        meta[key] = {
            "source": str(entry.get("source") or "fallback"),
            "observed_at": entry.get("observed_at"),
            "stale": bool(entry.get("stale", False)),
        }
    merged["rate_meta"] = meta
    return merged


def _with_runtime(
    profile: dict[str, Any],
    *,
    live_enabled: bool,
    source: str,
    live_fields: dict[str, bool] | None = None,
) -> dict[str, Any]:
    result = {
        **profile,
        "live_enabled": live_enabled,
        "source": source,
        "live_fields": live_fields if live_fields is not None else {key: False for key in AUTO_FIELD_KEYS},
    }
    result.setdefault(
        "rate_meta",
        {key: _manual_meta() for key in AUTO_FIELD_KEYS},
    )
    return result


def _resolve_source(enabled_keys: tuple[str, ...]) -> str:
    if not enabled_keys:
        return "manual"
    return "live" if len(enabled_keys) == len(AUTO_FIELD_KEYS) else "mixed"


async def get_effective_market_rate_profile() -> dict[str, Any]:
    settings = get_settings()
    manual = get_manual_market_rate_profile()
    enabled = _enabled_auto_keys(settings)
    live_fields = {key: key in enabled for key in AUTO_FIELD_KEYS}
    if not enabled:
        return _with_runtime(
            manual,
            live_enabled=bool(settings.market_rates_live_enabled),
            source="manual",
            live_fields=live_fields,
        )
    auto = await GoldPriceService().get_auto_values()
    return _with_runtime(
        _auto_overlay(manual, auto, enabled),
        live_enabled=True,
        source=_resolve_source(enabled),
        live_fields=live_fields,
    )


def get_effective_market_rate_profile_cached() -> dict[str, Any]:
    settings = get_settings()
    manual = get_manual_market_rate_profile()
    enabled = _enabled_auto_keys(settings)
    live_fields = {key: key in enabled for key in AUTO_FIELD_KEYS}
    if not enabled:
        return _with_runtime(
            manual,
            live_enabled=bool(settings.market_rates_live_enabled),
            source="manual",
            live_fields=live_fields,
        )
    auto = GoldPriceService.cached_auto_values_or_fallback()
    return _with_runtime(
        _auto_overlay(manual, auto, enabled),
        live_enabled=True,
        source=_resolve_source(enabled),
        live_fields=live_fields,
    )


# Oto alan bayrağı (drawer'daki manuel/oto geçişi) -> env anahtarı.
_LIVE_FIELD_ENV = {
    "eur_dkk_fx": "MARKET_RATES_LIVE_FX_ENABLED",
    "platinum_dkk": "MARKET_RATES_LIVE_PLATINUM_ENABLED",
    "palladium_dkk": "MARKET_RATES_LIVE_PALLADIUM_ENABLED",
}


def save_manual_market_rate_profile(payload: dict[str, Any]) -> dict[str, Any]:
    profile = _profile_from_payload(payload)
    updates = {
        "INVENTORY_MARKET_RATE_PROFILE_JSON": json.dumps(profile, ensure_ascii=True, separators=(",", ":")),
        "INVENTORY_MARKET_GOLD_DKK": profile["gold_24k_dkk"],
        "INVENTORY_MARKET_SILVER_DKK": profile["silver_dkk"],
        "INVENTORY_MARKET_PLATINUM_DKK": profile["platinum_dkk"],
        "INVENTORY_MARKET_PALLADIUM_DKK": profile["palladium_dkk"],
        "INVENTORY_MARKET_GOLD_BAR_DKK": profile["gold_bar_dkk"],
        "INVENTORY_MARKET_SILVER_BAR_DKK": profile["silver_bar_dkk"],
        "INVENTORY_MARKET_PLET_DKK": profile["plet_dkk"],
    }
    # Drawer'daki manuel/oto geçişi: verildiyse alan-bazlı canlı bayrakları da
    # burada kalıcılaştır (ayrı Ayarlar ekranına gitmeye gerek kalmadan).
    live_fields = payload.get("live_fields")
    if isinstance(live_fields, dict):
        any_auto = False
        for field, env_key in _LIVE_FIELD_ENV.items():
            enabled = bool(live_fields.get(field, False))
            updates[env_key] = "true" if enabled else "false"
            any_auto = any_auto or enabled
        # Master bayrak: en az bir alan otomatikse açık.
        updates["MARKET_RATES_LIVE_ENABLED"] = "true" if any_auto else "false"
    upsert_env_values(ROOT_ENV_FILE, updates)
    get_settings.cache_clear()
    return _with_runtime(profile, live_enabled=False, source="manual")
