from decimal import Decimal

import pytest

from app.services.gold_price import GoldPriceService


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
    assert rates["platinum"] == Decimal("255.00")
    assert rates["palladium"] == Decimal("268.00")
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
    assert rates["platinum"] == Decimal("255.00")
    assert meta["platinum"]["source"] == "fallback"
    assert meta["platinum"]["stale"] is True
