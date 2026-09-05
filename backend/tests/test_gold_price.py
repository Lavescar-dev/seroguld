from decimal import Decimal

import asyncio

import httpx
import pytest

from app.services.ecb_fx import EcbFxService
from app.services.gold_price import GoldPriceService


def _reset_class_cache() -> None:
    """Sınıf düzeyi cache'ler testler arasında sıfırlanır (izolasyon)."""
    GoldPriceService._cache_rates = None
    GoldPriceService._cache_meta = None
    GoldPriceService._cache_expires_at = None
    EcbFxService._cache_fx = None
    EcbFxService._cache_observed_at = None
    EcbFxService._cache_expires_at = None


@pytest.fixture(autouse=True)
def _isolated_class_cache():
    _reset_class_cache()
    yield
    _reset_class_cache()


def test_parse_stooq_close():
    csv_text = "Symbol,Date,Time,Open,High,Low,Close,Volume\nXAUUSD,2026-02-27,18:15:44,1,2,3,5231.615,\n"
    parsed = GoldPriceService._parse_stooq_close(csv_text)
    assert parsed == Decimal("5231.615")


def test_convert_usd_ounce_to_dkk_gram():
    result = GoldPriceService._convert_usd_ounce_to_dkk_gram(
        usd_per_ounce=Decimal("5231.615"),
        usd_dkk=Decimal("6.32095"),
    )
    assert result == Decimal("1063.19")


@pytest.mark.asyncio
async def test_get_rates_falls_back_per_metal_when_live_unavailable(monkeypatch):
    service = GoldPriceService()
    service.live_enabled = True

    async def fake_fetch_live_rates(_self):
        rates = dict(GoldPriceService._FALLBACK_RATES)
        meta = {
            key: {"source": "fallback", "observed_at": None, "stale": True}
            for key in rates
        }
        return rates, meta

    monkeypatch.setattr(GoldPriceService, "_fetch_live_rates", fake_fetch_live_rates)
    rates = await service.get_rates(force_refresh=True)

    assert rates["gold"] == Decimal("615.50")
    assert rates["silver"] == Decimal("7.80")
    # market_rate_profile.DEFAULT_PLATINUM/PALLADIUM_DKK ile aynı (üç yüzey tek sabit).
    assert rates["platinum"] == Decimal("280.00")
    assert rates["palladium"] == Decimal("335.00")
    meta = GoldPriceService.cached_meta_or_fallback()
    assert meta["gold"]["source"] == "fallback"
    assert meta["gold"]["stale"] is True


@pytest.mark.asyncio
async def test_get_rates_prefers_live(monkeypatch):
    service = GoldPriceService()
    service.live_enabled = True

    async def fake_fetch_live_rates(_self):
        rates = {
            "gold": Decimal("1000.00"),
            "silver": Decimal("20.00"),
            "platinum": Decimal("500.00"),
            "palladium": Decimal("450.00"),
        }
        meta = {
            key: {"source": "live", "observed_at": "2026-08-19T06:00:00Z", "stale": False}
            for key in rates
        }
        return rates, meta

    monkeypatch.setattr(GoldPriceService, "_fetch_live_rates", fake_fetch_live_rates)
    rates = await service.get_rates(force_refresh=True)

    assert rates["gold"] == Decimal("1000.00")
    assert rates["silver"] == Decimal("20.00")
    assert rates["platinum"] == Decimal("500.00")
    assert rates["palladium"] == Decimal("450.00")
    meta = GoldPriceService.cached_meta_or_fallback()
    assert meta["platinum"]["source"] == "live"
    assert meta["platinum"]["stale"] is False


@pytest.mark.asyncio
async def test_one_failed_metal_does_not_break_the_others(monkeypatch):
    """Metal başına bağımsızlık: Pt kaynağı düşse bile altın canlı kalır."""
    service = GoldPriceService()
    service.live_enabled = True

    async def fake_stooq(self, client, symbol):
        values = {
            "usddkk": Decimal("6.50"),
            "xauusd": Decimal("3000"),
            "xagusd": Decimal("40"),
            "xpdusd": Decimal("1200"),
            # xptusd bilinçli olarak başarısız
        }
        return values.get(symbol)

    monkeypatch.setattr(GoldPriceService, "_fetch_stooq_close", fake_stooq)

    rates = await service.get_rates(force_refresh=True)
    meta = GoldPriceService.cached_meta_or_fallback()

    assert rates["gold"] == GoldPriceService._convert_usd_ounce_to_dkk_gram(Decimal("3000"), Decimal("6.50"))
    assert meta["gold"]["source"] == "live"
    assert rates["platinum"] == Decimal("280.00")
    assert meta["platinum"]["source"] == "fallback"
    assert meta["platinum"]["stale"] is True


@pytest.mark.asyncio
async def test_stooq_failure_logs_and_returns_none(caplog):
    """Stooq düşüşü sessiz fallback'e inmez — sembolle birlikte iz kalır."""

    class FailingClient:
        async def get(self, *_args, **_kwargs):
            raise httpx.ConnectError("stooq yok")

    service = GoldPriceService()
    with caplog.at_level("WARNING", logger="app.services.gold_price"):
        assert await service._fetch_stooq_close(FailingClient(), "xauusd") is None

    records = [record for record in caplog.records if "Stooq xauusd kapanışı çekilemedi" in record.message]
    assert records


# ---------------------------------------------------------------------------
# cached_auto_values_or_fallback: fallback girişlerde value=None (manuel korunur)
# ---------------------------------------------------------------------------


def test_cached_auto_values_return_none_for_fallback_entries():
    """Önbellek miss'inde fallback sabitleri oto değeri EZMEZ: value=None döner.

    _auto_overlay None değeri profile yazmaz, operatörün kaydettiği manuel
    değeri korur (yalnız meta fallback/bayat işaretlenir). Sabit fallback
    döndürmek çekmecede canlı, alış/dashboard/stok/woo/portal'da sabit — iki
    farklı Pt/Pd değeri ve sahte matchesCurrentRates uyuşmazlığı üretirdi.
    """
    values = GoldPriceService.cached_auto_values_or_fallback()

    assert values["platinum_dkk"]["value"] is None
    assert values["platinum_dkk"]["source"] == "fallback"
    assert values["platinum_dkk"]["stale"] is True
    assert values["palladium_dkk"]["value"] is None
    assert values["palladium_dkk"]["stale"] is True
    assert values["eur_dkk_fx"]["value"] is None
    assert values["eur_dkk_fx"]["stale"] is True


def test_cached_auto_values_pass_live_rates_through():
    """Geçerli cache + canlı meta: değerler aynen döner (None'a düşmez)."""
    GoldPriceService._set_cache(
        {
            "gold": Decimal("1000.00"),
            "silver": Decimal("20.00"),
            "platinum": Decimal("355.91"),
            "palladium": Decimal("266.31"),
        },
        {
            key: {"source": "live", "observed_at": "2026-09-05T06:00:00Z", "stale": False}
            for key in ("gold", "silver", "platinum", "palladium")
        },
        20,
    )
    values = GoldPriceService.cached_auto_values_or_fallback()

    assert values["platinum_dkk"]["value"] == Decimal("355.91")
    assert values["platinum_dkk"]["source"] == "live"
    assert values["platinum_dkk"]["stale"] is False
    assert values["palladium_dkk"]["value"] == Decimal("266.31")


# ---------------------------------------------------------------------------
# Paralel çekim + tek-uçuş (stampede) koruması
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_live_rates_pulls_symbols_in_parallel(monkeypatch):
    """Sıralı zincir 5 × timeout'a (≈36 sn) uzıyordu; semboller paralel turda
    çekilir — en az iki istek aynı anda havadadır."""
    service = GoldPriceService()
    service.live_enabled = True

    in_flight = {"now": 0, "max": 0}

    async def fake_stooq(self, client, symbol):
        in_flight["now"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["now"])
        await asyncio.sleep(0.02)
        in_flight["now"] -= 1
        return Decimal("100")

    monkeypatch.setattr(GoldPriceService, "_fetch_stooq_close", fake_stooq)

    rates = await service.get_rates(force_refresh=True)

    assert in_flight["max"] >= 2
    expected = service._convert_usd_ounce_to_dkk_gram(Decimal("100"), Decimal("100"))
    assert all(value == expected for value in rates.values())


@pytest.mark.asyncio
async def test_concurrent_get_rates_share_one_fetch(monkeypatch):
    """Tek-uçuş kilidi: cache miss anında eşzamanlı get_rates çağrıları upstream
    zincirini tek turda paylaşır (stampede yok)."""
    calls = {"count": 0}

    async def slow_fetch(_self):
        calls["count"] += 1
        await asyncio.sleep(0.05)
        rates = dict(GoldPriceService._FALLBACK_RATES)
        meta = {
            key: {"source": "live", "observed_at": None, "stale": False}
            for key in rates
        }
        return rates, meta

    monkeypatch.setattr(GoldPriceService, "_fetch_live_rates", slow_fetch)
    service = GoldPriceService()
    service.live_enabled = True

    results = await asyncio.gather(*(service.get_rates() for _ in range(3)))

    assert calls["count"] == 1
    assert all(result == results[0] for result in results)
