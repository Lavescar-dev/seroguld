from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import require_admin
from app.schemas.base import AppBaseModel
from app.services.market_rate_profile import (
    GOLD_RATE_KEYS,
    SILVER_RATE_KEYS,
    current_live_fields,
    get_effective_market_rate_profile,
    save_manual_market_rate_profile,
)
from app.services.wp_priser_service import SCALAR_BANDS, WPPriserUnavailable

logger = logging.getLogger(__name__)

router = APIRouter()

# WP priser tablosundan çekilebilen skaler metal alanları.
SCALAR_PROFILE_KEYS = ("gold_bar_dkk", "silver_bar_dkk", "platinum_dkk", "palladium_dkk", "plet_dkk")

# PUT'ta dolu-değeri doğrulanan opsiyonel skalerler (boş = profil default'u).
_SCALAR_OPTIONAL_FIELDS = (
    "eur_dkk_fx",
    "gold_bar_dkk",
    "silver_bar_dkk",
    "platinum_dkk",
    "palladium_dkk",
    "plet_dkk",
)


def _parse_positive_decimal(raw: str) -> Decimal | None:
    """market_rate_profile._positive çözümleyicisiyle aynı semantik."""
    try:
        value = Decimal(str(raw).replace(",", ".").strip())
    except (InvalidOperation, TypeError, ValueError):
        return None
    return value if value.is_finite() and value > 0 else None


def _scalar_band_warnings(payload: dict) -> list[str]:
    """Bant-dışı skaler değerler için engelleyici olmayan uyarı listesi.

    Bantlar wp_priser_service._SCALAR_BANDS ile tek kaynaktan gelir; kayıt
    ENGELLENMEZ (frontend onay akışıyla uyumlu), yalnız operatör bilgilendirilir.
    """
    warnings: list[str] = []
    for field, (low, high) in SCALAR_BANDS.items():
        raw = str(payload.get(field) or "").strip()
        if not raw:
            continue
        value = _parse_positive_decimal(raw)
        if value is not None and not (low <= value <= high):
            warnings.append(
                f"{field}: beklenen aralık {low}–{high} DKK/g, girilen '{raw}' — birim (ons/10g/kr-kg) karışıklığı olabilir."
            )
    return warnings


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
    # Kaydı engellemeyen bant-dışı uyarıları (yalnız PUT yanıtında dolu gelir).
    warnings: list[str] = []


@router.post("/refresh-from-wp")
async def post_market_rates_refresh_from_wp(_: object = Depends(require_admin)) -> dict:
    """R2-06 — karat/gümüş/bar/Pt/Pd/plet fiyatlarını WP "Priser" sayfasından
    çekip global profile uygular. Kaynak WP'dir; yalnız sayfada BULUNAN
    anahtarlar güncellenir, kalanlar mevcut değerinde korunur.

    WP'den Pt/Pd değeri geldiyse o alanın canlı (Stooq) oto bayrağı kapatılır —
    işletmenin kendi sitesindeki değer Stooq default'unu maskılamasın. fx oto
    akışı ve diğer alan bayrakları değişmez.
    """
    from app.services.market_rate_profile import get_manual_market_rate_profile
    from app.services.wp_priser_service import fetch_wp_priser_rates

    try:
        fetched = await fetch_wp_priser_rates()
    except ValueError as exc:
        # Veri/istek kaynaklı: config eksik, sayfa yok, fiyat bulunamadı.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except WPPriserUnavailable as exc:
        # Ulaşım/çözümleme kaynaklı; mesajı servis temizler (URL sızdırmez).
        raise HTTPException(status_code=502, detail=f"WP Priser çekilemedi: {exc}") from exc
    except Exception as exc:  # beklenmeyen hata: detay istemciye sızmaz
        logger.warning("WP Priser refresh beklenmeyen hata", exc_info=True)
        raise HTTPException(status_code=502, detail="WP Priser çekilemedi (beklenmeyen sunucu hatası).") from exc

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
    applied_scalars: dict[str, str] = {}
    for key in SCALAR_PROFILE_KEYS:
        value = fetched.get(key)
        if value:
            applied_scalars[key] = str(value)
    if not applied_gold and not applied_silver and not applied_scalars:
        raise HTTPException(status_code=422, detail="WP sayfasından profil anahtarına oturan fiyat çıkmadı.")

    payload = {**current, "gold_rates_dkk": merged_gold, "silver_rates_dkk": merged_silver}
    payload.update(applied_scalars)
    # Pt/Pd Stooq ezmesi: alan WP'den geldiyse canlı bayrağını kapat. fx dahil
    # diğer alanlar anlık durumlarında korunur (tek save çağrısıyla kalıcılaşır).
    live_fields = current_live_fields()
    auto_fields_disabled: list[str] = []
    for key in ("platinum_dkk", "palladium_dkk"):
        if key in applied_scalars and live_fields.get(key):
            live_fields[key] = False
            auto_fields_disabled.append(key)
    if auto_fields_disabled:
        payload["live_fields"] = live_fields

    save_manual_market_rate_profile(payload)
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
        "applied_scalars": applied_scalars,
        "auto_fields_disabled": auto_fields_disabled,
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
    payload_dict = payload.model_dump()
    # Dolu ama çözümlenemez/0/negatif skaler ('abc' gibi) sessizce profil
    # default'una düşüyordu; operatör çekmeceyi yeniden açtığında kendi değeri
    # yerine default'u görüyordu (para üstüne doğrudan etki). Doluysa 422 —
    # boş bırakmak serbesttir (opsiyonel alan → profil default'u).
    for field in _SCALAR_OPTIONAL_FIELDS:
        raw = str(payload_dict.get(field) or "").strip()
        if raw and _parse_positive_decimal(raw) is None:
            raise HTTPException(
                status_code=422,
                detail=f"'{field}' alanı doluysa pozitif bir sayı olmalı (girilen: '{raw}').",
            )
    # Boş live_fields {} "değişiklik yok" sayılır — üç canlı bayrağını da
    # kapatıp canlı modu sessizce söndürmesin (drawer live_fields yüklemeden
    # kaydedersen bayraklar ezilmesin; None = mevcut ayar korunur).
    if payload_dict.get("live_fields") == {}:
        payload_dict["live_fields"] = None
    warnings = _scalar_band_warnings(payload_dict)
    save_manual_market_rate_profile(payload_dict)
    # Kaydettikten sonra ETKİN profili döndür: oto işaretlenen alanlar (Pt/Pd/fx)
    # canlı değerleriyle gelir; drawer anında güncel durumu görür.
    result = await get_effective_market_rate_profile()
    result["warnings"] = warnings
    return result
