from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from decimal import Decimal, InvalidOperation
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import require_admin
from app.config import get_settings
from app.schemas.base import AppBaseModel
from app.services.market_rate_profile import (
    GOLD_RATE_KEYS,
    SILVER_RATE_KEYS,
    WP_AUTO_PULL_MIN_MINUTES,
    current_live_fields,
    get_effective_market_rate_profile,
    get_manual_market_rate_profile,
    get_wp_auto_pull_settings,
    save_manual_market_rate_profile,
    save_wp_auto_pull_settings,
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
    # WP otomatik çekim: false = "Otomatik çekmeyi durdur" (tamamen manuel mod).
    # Verilmezse mevcut ayar korunur.
    wp_auto_pull_enabled: bool | None = None


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
    # WP otomatik çekim durumu + son başarılı çekim (WP_PRISER_LAST_FETCH).
    wp_auto_pull_enabled: bool = True
    last_wp_fetch_at: str | None = None


async def apply_wp_priser_rates(*, trigger: Literal["manual", "auto"]) -> dict:
    """R2-06 — WP "Priser" çekim + profile merge TEK yolu. Manuel buton
    (refresh-from-wp) ile zamanlanmış otomatik çekim (scheduler) AYNI
    fonksiyonu kullanır; davranış farkı yalnız 'trigger' etiketidir.

    Kaynak WP'dir; yalnız sayfada BULUNAN anahtarlar güncellenir, kalanlar
    mevcut değerinde korunur (AFG fiyatları asla sıfırlanmaz).

    22b savunması: WordPress'te "22b" (ikinci 22K alış seviyesi) satırı YOKTUR
    ve hiçbir zaman olmayacaktır. Kaynak yanıtı bu anahtarı taşırsa bile ASLA
    profile yazılmaz — 22b yalnız operatörün manuel değeridir.

    WP'den Pt/Pd değeri geldiyse o alanın canlı (Stooq) oto bayrağı kapatılır —
    işletmenin kendi sitesindeki değer Stooq default'unu maskılamasın. fx oto
    akışı ve diğer alan bayrakları değişmez.

    Hata sözleşmesi: ValueError = veri/istek kaynaklı (config eksik, sayfa
    yok, uygun fiyat çıkmadı) → endpoint 422; WPPriserUnavailable = ulaşım/
    çözümleme → 502. Scheduler her ikisini de loglayıp sessizce devam eder.
    """
    from app.services.wp_priser_service import fetch_wp_priser_rates

    fetched = await fetch_wp_priser_rates()

    current = get_manual_market_rate_profile()
    merged_gold = {**(current.get("gold_rates_dkk") or {})}
    applied_gold: dict[str, str] = {}
    for key, value in (fetched.get("gold_rates_dkk") or {}).items():
        if key == "22b":
            # 22b operatörel bir ayrımdır; otomatik akışa ASLA girmez.
            continue
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
        raise ValueError("WP sayfasından profil anahtarına oturan fiyat çıkmadı.")

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
    get_settings.cache_clear()
    return {
        "ok": True,
        "trigger": trigger,
        "applied_gold": applied_gold,
        "applied_silver": applied_silver,
        "applied_scalars": applied_scalars,
        "auto_fields_disabled": auto_fields_disabled,
        "fetched_at": fetched.get("fetched_at"),
        "page_title": fetched.get("page_title"),
    }


@router.post("/refresh-from-wp")
async def post_market_rates_refresh_from_wp(_: object = Depends(require_admin)) -> dict:
    """R2-06 — drawer'daki "WP'den çek" butonu: apply_wp_priser_rates(trigger=
    "manual") ile ZAMANLANMIŞ çekimle aynı merge yolunu koşar."""
    try:
        return await apply_wp_priser_rates(trigger="manual")
    except ValueError as exc:
        # Veri/istek kaynaklı: config eksik, sayfa yok, fiyat bulunamadı.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except WPPriserUnavailable as exc:
        # Ulaşım/çözümleme kaynaklı; mesajı servis temizler (URL sızdırmez).
        raise HTTPException(status_code=502, detail=f"WP Priser çekilemedi: {exc}") from exc
    except Exception as exc:  # beklenmeyen hata: detay istemciye sızmaz
        logger.warning("WP Priser refresh beklenmeyen hata", exc_info=True)
        raise HTTPException(status_code=502, detail="WP Priser çekilemedi (beklenmeyen sunucu hatası).") from exc


# Zamanlanmış çekim KAPALIYKEN ayar yeniden denetleme aralığı (saniye): drawer'daki
# "Otomatik çekmeyi durdur" onay kutusu uygulamayı yeniden başlatmadan etkili olsun.
WP_AUTO_PULL_IDLE_POLL_SECONDS = 60


async def run_wp_auto_pull_scheduler(
    *, sleep: Callable[[float], Awaitable[None]] | None = None
) -> None:
    """WP Priser zamanlanmış otomatik çekim döngüsü (FastAPI lifespan'de başlar).

    Ayar kapalıysa ağ çağrisi HİÇ yapılmaz; kısa aralıkla yeniden denetlenir.
    Ayar açıksa ilk çekimden ÖNCE interval kadar beklenir — uygulama açılışında
    gereksiz ağ atışı olmaz, test ortamında (lifespan çalışır) hiç tetiklenmez.
    Hata (WP'ye ulaşılamadı / uygun fiyat yok / beklenmeyen) loglanır ve sessizce
    devam edilir: AFG fiyatları sıfırlanmaz, WP_PRISER_LAST_FETCH ezilmez.
    """
    sleeper = sleep or asyncio.sleep
    while True:
        enabled, minutes = get_wp_auto_pull_settings()
        if not enabled:
            await sleeper(WP_AUTO_PULL_IDLE_POLL_SECONDS)
            continue
        interval = max(minutes, WP_AUTO_PULL_MIN_MINUTES) * 60
        await sleeper(interval)
        # Bekleme penceresinde "Otomatik çekmeyi durdur" işaretlenmiş olabilir:
        # uygulamadan hemen önce yeniden denetle — checkbox anında tam-manuel moda geçirir.
        enabled, _minutes = get_wp_auto_pull_settings()
        if not enabled:
            continue
        try:
            result = await apply_wp_priser_rates(trigger="auto")
        except asyncio.CancelledError:  # kapanış: sessizce çık
            raise
        except (WPPriserUnavailable, ValueError) as exc:
            logger.warning("WP otomatik çekim başarısız (%s dk sonra tekrar denenecek): %s", interval // 60, exc)
        except Exception:  # scheduler asla uygulamayı düşürmesin
            logger.warning("WP otomatik çekim beklenmeyen hata", exc_info=True)
        else:
            logger.info(
                "WP otomatik çekim uyguladı: %s karat + %s gümüş + %s skaler (%s).",
                len(result.get("applied_gold") or {}),
                len(result.get("applied_silver") or {}),
                len(result.get("applied_scalars") or {}),
                result.get("fetched_at"),
            )


def _with_wp_auto_pull_state(result: dict) -> dict:
    """GET/PUT /defaults yanıtına WP otomatik çekim durumunu ekler."""
    enabled, _minutes = get_wp_auto_pull_settings()
    result["wp_auto_pull_enabled"] = enabled
    result["last_wp_fetch_at"] = (get_settings().wp_priser_last_fetch or "").strip() or None
    return result


@router.get("/defaults", response_model=MarketRateProfileOut)
async def get_market_rate_defaults(_: object = Depends(require_admin)) -> dict:
    return _with_wp_auto_pull_state(await get_effective_market_rate_profile())


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
    # WP otomatik çekim ayrı env anahtarlarına yazılır; profil payload'ına
    # karışmasın (None = mevcut ayar korunur).
    wp_auto_pull_enabled = payload_dict.pop("wp_auto_pull_enabled", None)
    if wp_auto_pull_enabled is not None:
        save_wp_auto_pull_settings(enabled=bool(wp_auto_pull_enabled))
    warnings = _scalar_band_warnings(payload_dict)
    save_manual_market_rate_profile(payload_dict)
    # Kaydettikten sonra ETKİN profili döndür: oto işaretlenen alanlar (Pt/Pd/fx)
    # canlı değerleriyle gelir; drawer anında güncel durumu görür.
    result = await get_effective_market_rate_profile()
    result = _with_wp_auto_pull_state(result)
    result["warnings"] = warnings
    return result
