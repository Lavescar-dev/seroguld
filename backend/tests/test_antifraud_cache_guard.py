"""M2 — OPMC cache/hata-yolu sertleştirmesi regresyon testleri.

Kapsam:
- _orders_cache LRU sınırı ve per_page'den bağımsız normalize anahtar,
- TTL doluşunda single-flight (stampede koruması),
- boş Woo taramasının önbelleklenmemesi + anahtar başına tek uyarı,
- kalıcı 503/401/403'ün retry edilmeden korunması,
- istemciye dönen 502'de ham exception gövdesinin sızmaması,
- override_reasons zincirinde kim/zaman/gerekçe denetim bilgisi.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
from fastapi import HTTPException

from app.services import antifraud_service
from app.services.antifraud_helpers import (
    AntiFraudRiskMetaOut,
    _resolve_effective_risk,
)


def _order(customer_id: int, order_id: int = 9001) -> dict[str, object]:
    return {
        "id": order_id,
        "number": str(order_id),
        "status": "processing",
        "customer_id": customer_id,
    }


class _CountingWoo:
    def __init__(self, rows: list[dict[str, object]] | None = None, delay: float = 0.0) -> None:
        self.rows = rows if rows is not None else [_order(1)]
        self.delay = delay
        self.calls = 0

    async def fetch_recent_orders(self, *, days: int, per_page: int, statuses: str) -> list[dict[str, object]]:
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        return list(self.rows)


def _reset_cache_state() -> None:
    antifraud_service._orders_cache.clear()
    antifraud_service._orders_inflight.clear()
    antifraud_service._orders_empty_warned.clear()


def test_cache_key_ignores_per_page() -> None:
    assert antifraud_service._orders_cache_key(30, 40) == antifraud_service._orders_cache_key(30, 100)
    assert antifraud_service._orders_cache_key(30, 40) != antifraud_service._orders_cache_key(31, 40)


def test_cache_is_lru_bounded() -> None:
    _reset_cache_state()
    try:
        for day in range(100):
            antifraud_service._orders_cache_set(
                antifraud_service._orders_cache_key(day, 40), [{"id": day}]
            )
        assert len(antifraud_service._orders_cache) <= antifraud_service._ORDERS_CACHE_MAX_ENTRIES
        # En yeni giriş yaşatılır; en eskiler tek tek dışarı atılır.
        assert antifraud_service._orders_cache_get(antifraud_service._orders_cache_key(99, 40)) is not None
    finally:
        _reset_cache_state()


def test_concurrent_misses_share_single_upstream_scan(monkeypatch) -> None:
    _reset_cache_state()
    monkeypatch.setattr(antifraud_service, "_RETRY_BASE_DELAY", 0)
    fake = _CountingWoo(delay=0.05)

    async def _scenario() -> list[list[dict[str, object]]]:
        # per_page farklı olsa da normalize anahtar aynı olduğundan tek tarama.
        return list(
            await asyncio.gather(
                antifraud_service._fetch_recent_orders_with_retry(fake, days=30, per_page=40),
                antifraud_service._fetch_recent_orders_with_retry(fake, days=30, per_page=100),
            )
        )

    results = asyncio.run(_scenario())
    assert fake.calls == 1
    assert results[0] == results[1]


def test_empty_scan_is_not_cached_and_warns_once(caplog) -> None:
    _reset_cache_state()
    fake = _CountingWoo(rows=[])

    with caplog.at_level(logging.WARNING, logger="app.services.antifraud_service"):
        asyncio.run(antifraud_service._fetch_recent_orders_with_retry(fake, days=30, per_page=40))
        asyncio.run(antifraud_service._fetch_recent_orders_with_retry(fake, days=30, per_page=40))

    # Boş küme önbelleklenmedi: ikinci istek de Woo'ya gider (bayat '0 riskli
    # sipariş' kilidi yok) ama uyarı anahtar başına yalnız bir kez basılır.
    assert fake.calls == 2
    assert antifraud_service._orders_cache_get(antifraud_service._orders_cache_key(30, 40)) is None
    assert len([r for r in caplog.records if "boş döndü" in r.getMessage()]) == 1


def test_persistent_config_error_keeps_503_without_retry(monkeypatch) -> None:
    _reset_cache_state()
    monkeypatch.setattr(antifraud_service, "_RETRY_BASE_DELAY", 0)

    class _ConfigBrokenWoo:
        def __init__(self) -> None:
            self.calls = 0

        async def fetch_recent_orders(self, *, days: int, per_page: int, statuses: str) -> list[dict[str, object]]:
            self.calls += 1
            raise HTTPException(status_code=503, detail="UPSTREAM-SECRET-BODY")

    fake = _ConfigBrokenWoo()
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(antifraud_service._fetch_recent_orders_with_retry(fake, days=30, per_page=40))

    assert exc_info.value.status_code == 503  # 502'ye çevrilmez
    assert "UPSTREAM-SECRET-BODY" not in str(exc_info.value.detail)  # gövde sızmaz
    assert fake.calls == 1  # kalıcı hata üç kez denenmez


def test_transient_failure_returns_502_without_raw_detail(monkeypatch) -> None:
    _reset_cache_state()
    monkeypatch.setattr(antifraud_service, "_RETRY_BASE_DELAY", 0)

    class _BrokenWoo:
        def __init__(self) -> None:
            self.calls = 0

        async def fetch_recent_orders(self, *, days: int, per_page: int, statuses: str) -> list[dict[str, object]]:
            self.calls += 1
            raise RuntimeError("SENSITIVE-RAW-REPR")

    fake = _BrokenWoo()
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(antifraud_service._fetch_recent_orders_with_retry(fake, days=30, per_page=40))

    assert exc_info.value.status_code == 502
    assert "SENSITIVE-RAW-REPR" not in str(exc_info.value.detail)
    assert fake.calls == 3  # geçici hata retry kapsamında kalır


def test_override_reasons_carry_audit_fields() -> None:
    meta = [
        AntiFraudRiskMetaOut(key="wc_af_score", value="90"),
        AntiFraudRiskMetaOut(
            key="_wc_af_manual_override",
            value={
                "level": "low",
                "by": "op@example.com",
                "at": "2026-09-05T10:30:00+00:00",
                "reason": "yanlış alarm",
            },
        ),
    ]

    level, score, reasons = _resolve_effective_risk(score=90, risk_meta=meta)

    assert level == "low"
    assert score == 10
    joined = " ".join(reasons)
    assert "op@example.com" in joined
    assert "05.09.2026 10:30" in joined
    assert "yanlış alarm" in joined
