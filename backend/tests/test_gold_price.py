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
async def test_get_rates_falls_back_when_live_unavailable(monkeypatch):
    service = GoldPriceService()

    async def fake_fetch_live_rates(_self):
        return None

    monkeypatch.setattr(GoldPriceService, "_fetch_live_rates", fake_fetch_live_rates)
    rates = await service.get_rates(force_refresh=True)

    assert rates["gold"] == Decimal("615.50")
    assert rates["silver"] == Decimal("7.80")
    assert rates["platinum"] == Decimal("255.00")
    assert rates["palladium"] == Decimal("268.00")


@pytest.mark.asyncio
async def test_get_rates_prefers_live(monkeypatch):
    service = GoldPriceService()

    async def fake_fetch_live_rates(_self):
        return {
            "gold": Decimal("1000.00"),
            "silver": Decimal("20.00"),
            "platinum": Decimal("500.00"),
            "palladium": Decimal("450.00"),
        }

    monkeypatch.setattr(GoldPriceService, "_fetch_live_rates", fake_fetch_live_rates)
    rates = await service.get_rates(force_refresh=True)

    assert rates["gold"] == Decimal("1000.00")
    assert rates["silver"] == Decimal("20.00")
    assert rates["platinum"] == Decimal("500.00")
    assert rates["palladium"] == Decimal("450.00")
