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


class MarketRateProfileUpdateIn(AppBaseModel):
    eur_dkk_fx: str
    gold_rates_eur: dict[str, str]
    silver_rates_eur: dict[str, str]
    platinum_dkk: str
    palladium_dkk: str


class MarketRateProfileOut(MarketRateProfileUpdateIn):
    gold_24k_dkk: str
    silver_dkk: str
    live_enabled: bool
    source: Literal["manual", "live"]


@router.get("/defaults", response_model=MarketRateProfileOut)
async def get_market_rate_defaults(_: object = Depends(require_admin)) -> dict:
    return await get_effective_market_rate_profile()


@router.put("/defaults", response_model=MarketRateProfileOut)
async def put_market_rate_defaults(
    payload: MarketRateProfileUpdateIn,
    _: object = Depends(require_admin),
) -> dict:
    current = await get_effective_market_rate_profile()
    if current.get("live_enabled"):
        raise HTTPException(status_code=409, detail="Canlı piyasa oranları açık; manuel oran kaydetmek için Ayarlar'dan canlı modu kapatın.")
    if set(payload.gold_rates_eur) != set(GOLD_RATE_KEYS) or set(payload.silver_rates_eur) != set(SILVER_RATE_KEYS):
        raise HTTPException(status_code=422, detail="Altın ve gümüş oran matrisi eksik veya hatalı.")
    return save_manual_market_rate_profile(payload.model_dump())
