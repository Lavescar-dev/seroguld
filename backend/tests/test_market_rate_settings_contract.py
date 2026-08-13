from __future__ import annotations

from decimal import Decimal

import pytest

from app.config import Settings
from app.services import market_rate_profile


def _settings(*, live: bool) -> Settings:
    return Settings(
        _env_file=None,
        database_url="sqlite+aiosqlite:///test.db",
        market_rates_live_enabled=live,
        gold_price_live_enabled=not live,
        inventory_market_gold_dkk=Decimal("2850"),
        inventory_market_silver_dkk=Decimal("8.5"),
        inventory_market_platinum_dkk=Decimal("280"),
        inventory_market_palladium_dkk=Decimal("335"),
    )


@pytest.mark.asyncio
async def test_manual_toggle_is_the_single_source_for_market_rate_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=False))

    profile = await market_rate_profile.get_effective_market_rate_profile()

    assert profile["live_enabled"] is False
    assert profile["source"] == "manual"
    assert profile["gold_24k_dkk"] == "2850.00"
    assert profile["silver_dkk"] == "8.50"


@pytest.mark.asyncio
async def test_live_toggle_does_not_fall_back_to_the_legacy_gold_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    class LiveRates:
        async def get_rates(self) -> dict[str, Decimal]:
            return {
                "gold": Decimal("615.50"),
                "silver": Decimal("7.80"),
                "platinum": Decimal("255"),
                "palladium": Decimal("268"),
            }

    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: _settings(live=True))
    monkeypatch.setattr(market_rate_profile, "GoldPriceService", LiveRates)

    profile = await market_rate_profile.get_effective_market_rate_profile()

    assert profile["live_enabled"] is True
    assert profile["source"] == "live"
    assert profile["gold_24k_dkk"] == "615.50"
