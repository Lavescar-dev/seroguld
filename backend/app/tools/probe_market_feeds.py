"""Piyasa veri kaynaklarını hedef makinede doğrulayan manuel probe.

Kullanım (Windows, backend venv):
    .\\.venv\\Scripts\\python.exe -m app.tools.probe_market_feeds

Ağ kısıtlı ortamlarda (ör. WSL) Stooq tamamen bloklu olabilir; bu araç
kararları hedef makinede vermek içindir. Hiçbir şey yazmaz, yalnız okur.
"""

from __future__ import annotations

import asyncio

import httpx

from app.config import get_settings
from app.services.ecb_fx import EcbFxService
from app.services.gold_price import GoldPriceService
from app.services.metals_dev import MetalsDevService

STOOQ_CANDIDATES = {
    "platinum": ("xptusd", "pl.f", "plt.v"),
    "palladium": ("xpdusd", "pa.f"),
    "gold": ("xauusd",),
    "silver": ("xagusd",),
    "usd_dkk": ("usddkk",),
}


async def _probe_stooq() -> None:
    service = GoldPriceService()
    headers = {"User-Agent": "SeroGuldCRM/1.0 (+local demo)"}
    async with httpx.AsyncClient(timeout=service.timeout_seconds, headers=headers) as client:
        for metal, symbols in STOOQ_CANDIDATES.items():
            for symbol in symbols:
                close = await service._fetch_stooq_close(client, symbol)
                verdict = f"OK close={close}" if close is not None else "FAIL"
                print(f"  stooq {metal:>10} {symbol:<8} {verdict}")


async def main() -> None:
    settings = get_settings()

    print("== ECB EUR/DKK ==")
    ecb = await EcbFxService().fetch_fx()
    if ecb is None:
        print("  FAIL — ECB'ye ulaşılamadı")
    else:
        print(f"  OK fx={ecb[0]} observed_at={ecb[1]}")

    print("== Metals.Dev ==")
    metals = MetalsDevService()
    if not metals.enabled:
        print("  SKIP — METALS_DEV_API_KEY tanımlı değil")
    else:
        fetched = await metals.fetch_rates()
        if fetched is None:
            print("  FAIL — istek/parse başarısız")
        else:
            rates, observed_at = fetched
            print(f"  OK observed_at={observed_at}")
            for key, value in rates.items():
                print(f"    {key:>10} = {value} DKK/g")

    print("== Stooq sembol adayları ==")
    await _probe_stooq()

    print("== Ayar önerisi ==")
    print(
        "  Çalışan Pt/Pd sembollerini STOOQ_SYMBOL_PLATINUM / STOOQ_SYMBOL_PALLADIUM "
        "olarak runtime.env'e yazın (boş = gömülü xptusd/xpdusd)."
    )
    print(f"  MARKET_RATES_LIVE_ENABLED = {settings.market_rates_live_enabled}")


if __name__ == "__main__":
    asyncio.run(main())
