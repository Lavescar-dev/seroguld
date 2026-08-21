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
