from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import require_admin
from app.schemas.base import AppBaseModel
from app.services.market_rate_profile import (
    GOLD_RATE_KEYS,
    SILVER_RATE_KEYS,
    get_effective_market_rate_profile,
    save_manual_market_rate_profile,
)

router = APIRouter()


class MarketRateMetaOut(AppBaseModel):
    source: Literal["manual", "live", "fallback"]
    observed_at: str | None = None
    stale: bool = False


class MarketRateProfileUpdateIn(AppBaseModel):
    # Kanonik operatör birimi DKK/g; EUR alanları wire sözleşmesinden kalktı.
    eur_dkk_fx: str
    gold_rates_dkk: dict[str, str]
    silver_rates_dkk: dict[str, str]
    plet_dkk: str
    gold_bar_dkk: str
    silver_bar_dkk: str
    platinum_dkk: str
    palladium_dkk: str
    # Alan-bazlı manuel/oto geçişi (eur_dkk_fx / platinum_dkk / palladium_dkk).
    # Verilirse canlı bayraklar da kaydedilir; verilmezse mevcut ayar korunur.
    live_fields: dict[str, bool] | None = None


class MarketRateProfileOut(MarketRateProfileUpdateIn):
    gold_24k_dkk: str
    silver_dkk: str
    live_enabled: bool
    # "mixed": master açık ama alanların yalnız bir kısmı otomatikte.
    source: Literal["manual", "live", "mixed"]
    # Alan bazında etkin oto durumu (eur_dkk_fx / platinum_dkk / palladium_dkk).
    live_fields: dict[str, bool] = {}
    rate_meta: dict[str, MarketRateMetaOut]


@router.post("/refresh-from-wp")
async def post_market_rates_refresh_from_wp(_: object = Depends(require_admin)) -> dict:
    """R2-06 — karat/gümüş fiyatlarını WP "Priser" sayfasından çekip global
    profile uygular. Kaynak WP'dir; yalnız sayfada BULUNAN anahtarlar güncellenir,
    kalanlar (Pt/Pd/EUR/bar/plet ve eksik karatlar) mevcut değerinde korunur.
    """
    from app.services.market_rate_profile import get_manual_market_rate_profile
    from app.services.wp_priser_service import fetch_wp_priser_rates

    try:
        fetched = await fetch_wp_priser_rates()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # ağ/HTTP hataları okunur mesaja
        raise HTTPException(status_code=502, detail=f"WP Priser çekilemedi: {exc}") from exc

    current = get_manual_market_rate_profile()
    merged_gold = {**(current.get("gold_rates_dkk") or {})}
    applied_gold: dict[str, str] = {}
    for key, value in (fetched.get("gold_rates_dkk") or {}).items():
        if key in GOLD_RATE_KEYS:
            merged_gold[key] = value
            applied_gold[key] = value
    merged_silver = {**(current.get("silver_rates_dkk") or {})}
    applied_silver: dict[str, str] = {}
    for key, value in (fetched.get("silver_rates_dkk") or {}).items():
        if key in SILVER_RATE_KEYS:
            merged_silver[key] = value
            applied_silver[key] = value
    if not applied_gold and not applied_silver:
        raise HTTPException(status_code=422, detail="WP sayfasından profil anahtarına oturan fiyat çıkmadı.")

    save_manual_market_rate_profile({**current, "gold_rates_dkk": merged_gold, "silver_rates_dkk": merged_silver})
    from app.config import ROOT_ENV_FILE
    from app.utils.env_file import upsert_env_values

    upsert_env_values(ROOT_ENV_FILE, {"WP_PRISER_LAST_FETCH": str(fetched.get("fetched_at") or "")})
    # R1-17: Ayarlar ekranı son çekim zamanını settings üzerinden okur.
    from app.config import get_settings

    get_settings.cache_clear()
    return {
        "ok": True,
        "applied_gold": applied_gold,
        "applied_silver": applied_silver,
        "fetched_at": fetched.get("fetched_at"),
        "page_title": fetched.get("page_title"),
    }


@router.get("/defaults", response_model=MarketRateProfileOut)
async def get_market_rate_defaults(_: object = Depends(require_admin)) -> dict:
    return await get_effective_market_rate_profile()


@router.put("/defaults", response_model=MarketRateProfileOut)
async def put_market_rate_defaults(
    payload: MarketRateProfileUpdateIn,
    _: object = Depends(require_admin),
) -> dict:
    # Canlı mod yalnız oto değerleri (fx, Pt, Pd) besler; manuel altın/gümüş/
    # bar/Plet alanları her zaman operatör değeridir ve canlı moddayken de
    # kaydedilebilir (eski 409 kilidi kaldırıldı).
    if set(payload.gold_rates_dkk) != set(GOLD_RATE_KEYS) or set(payload.silver_rates_dkk) != set(SILVER_RATE_KEYS):
        raise HTTPException(status_code=422, detail="Altın ve gümüş oran matrisi eksik veya hatalı.")
    save_manual_market_rate_profile(payload.model_dump())
    # Kaydettikten sonra ETKİN profili döndür: oto işaretlenen alanlar (Pt/Pd/fx)
    # canlı değerleriyle gelir; drawer anında güncel durumu görür.
    return await get_effective_market_rate_profile()
