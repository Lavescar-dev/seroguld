"""O13 — OPMC detay müşteri geçmişi fix'i.

Kayıtlı müşteride Woo /orders?customer= dar sorgusu kullanılır (365 günlük
TÜM siparişlerin sayfalanması yerine) ve ikinci çağrıda önbellek sayesinde
Woo'ya hiç gidilmez. Misafirde paylaşımlı 365 günlük önbellek SWR ile
servis edilir: bayat küme anında döner, tazeleme arka planda yapılır.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services import antifraud_service


def _order(customer_id: int, order_id: int = 9001) -> dict[str, Any]:
    return {
        "id": order_id,
        "number": str(order_id),
        "status": "processing",
        "total": "1250.00",
        "currency": "DKK",
        "customer_id": customer_id,
        "billing": {"email": f"musteri-{customer_id or 'guest'}@example.com", "country": "DK"},
        "meta_data": [{"key": "wc_af_score", "value": "10"}],
    }


class _FakeWooService:
    """Yalnız antifraud_service'in kullandığı yüzey — ağ yok."""

    def __init__(
        self,
        *,
        customer_pages: list[list[dict[str, Any]]] | None = None,
        recent_orders: list[dict[str, Any]] | None = None,
    ) -> None:
        self.customer_pages = customer_pages or []
        self.recent_orders = recent_orders or []
        self.wc_requests: list[dict[str, Any]] = []
        self.recent_fetches = 0

    async def fetch_order(self, *, order_id: int) -> dict[str, Any]:
        return dict(self._detail_order)

    async def fetch_recent_orders(self, *, days: int, per_page: int, statuses: str) -> list[dict[str, Any]]:
        self.recent_fetches += 1
        return [dict(row) for row in self.recent_orders]

    async def _wc_request(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        assert params is not None
        self.wc_requests.append({"method": method, "path": path, "params": dict(params)})
        page = int(params.get("page") or 1)
        if page <= len(self.customer_pages):
            return list(self.customer_pages[page - 1])
        return []

    def set_detail_order(self, order: dict[str, Any]) -> None:
        self._detail_order = order


def _install(monkeypatch, fake: _FakeWooService) -> None:
    fake.set_detail_order(_order(customer_id=0))
    monkeypatch.setattr(antifraud_service, "WooCommerceService", lambda: fake)
    antifraud_service._orders_cache.clear()
    antifraud_service._orders_refresh_inflight.clear()


def test_registered_customer_uses_narrow_customer_query(monkeypatch) -> None:
    fake = _FakeWooService(
        customer_pages=[
            [_order(customer_id=42, order_id=8001), _order(customer_id=42, order_id=8002)],
        ]
    )
    _install(monkeypatch, fake)
    fake.set_detail_order(_order(customer_id=42))

    item = asyncio.run(
        antifraud_service.get_antifraud_order_detail(
            order_id=9001, include_notes=False, notes_per_order=5
        )
    )

    # Dar sorgu: /orders?customer=42 — broad fetch hiç çağrılmaz.
    assert fake.recent_fetches == 0
    assert len(fake.wc_requests) == 1
    assert fake.wc_requests[0]["path"] == "/orders"
    assert fake.wc_requests[0]["params"]["customer"] == 42
    assert item.customer_history is not None
    assert item.customer_history.matched_by == "customer_id"
    assert item.customer_history.total_orders == 2


def test_second_detail_call_does_not_refetch_woo_history(monkeypatch) -> None:
    fake = _FakeWooService(
        customer_pages=[[_order(customer_id=42, order_id=8001)]],
    )
    _install(monkeypatch, fake)
    fake.set_detail_order(_order(customer_id=42))

    args = {"order_id": 9001, "include_notes": False, "notes_per_order": 5}
    first = asyncio.run(antifraud_service.get_antifraud_order_detail(**args))
    requests_after_first = len(fake.wc_requests)
    second = asyncio.run(antifraud_service.get_antifraud_order_detail(**args))

    # İkinci çağrıda geçmiş Woo'dan gelmez (önbellek); yalnız order fetch'i olur.
    assert len(fake.wc_requests) == requests_after_first
    assert first.customer_history and second.customer_history
    assert second.customer_history.total_orders == first.customer_history.total_orders


def test_guest_order_falls_back_to_shared_cache_and_skips_second_fetch(monkeypatch) -> None:
    history = [
        _order(customer_id=0, order_id=7001),
        _order(customer_id=7, order_id=7002),
    ]
    fake = _FakeWooService(recent_orders=history)
    _install(monkeypatch, fake)
    fake.set_detail_order(_order(customer_id=0))

    args = {"order_id": 9001, "include_notes": False, "notes_per_order": 5}
    first = asyncio.run(antifraud_service.get_antifraud_order_detail(**args))
    assert fake.recent_fetches == 1  # soğuk başlangıçta tek broad fetch

    second = asyncio.run(antifraud_service.get_antifraud_order_detail(**args))
    assert fake.recent_fetches == 1  # ikinci çağrı Woo'ya gitmez
    assert first.customer_history and second.customer_history
    assert second.customer_history.matched_by == "email"
    assert second.customer_history.total_orders == 1


def test_stale_history_is_served_and_refreshed_in_background(monkeypatch) -> None:
    fresh_history = [_order(customer_id=0, order_id=7001)]
    fake = _FakeWooService(recent_orders=fresh_history)
    _install(monkeypatch, fake)
    fake.set_detail_order(_order(customer_id=0))

    stale_rows = [_order(customer_id=0, order_id=6001)]
    cache_key = antifraud_service._orders_cache_key(365, 100)
    expired_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    antifraud_service._orders_cache[cache_key] = (stale_rows, expired_at)

    async def _scenario() -> list[dict[str, Any]]:
        rows = await antifraud_service._fetch_recent_orders_with_retry(
            fake, days=365, per_page=100, use_cache=True, allow_stale=True
        )
        pending = [t for t in antifraud_service._orders_refresh_background if not t.done()]
        assert pending, "SWR bayat küme döndürdü ama arka plan tazeleme kurmadı"
        await asyncio.gather(*pending)
        return rows

    rows = asyncio.run(_scenario())

    # Bayat küme anında servis edildi; senkron Woo çağrısı yapılmadı.
    assert [row["id"] for row in rows] == [6001]
    assert fake.recent_fetches == 1  # yalnız arka plan tazelemesi
    cached = antifraud_service._orders_cache_get(cache_key)
    assert cached is not None and [row["id"] for row in cached] == [7001]


def test_customer_cache_invalidated_on_manual_override(monkeypatch) -> None:
    fake = _FakeWooService(customer_pages=[[_order(customer_id=42, order_id=8001)]])
    _install(monkeypatch, fake)
    fake.set_detail_order(_order(customer_id=42))

    asyncio.run(
        antifraud_service.get_antifraud_order_detail(
            order_id=9001, include_notes=False, notes_per_order=5
        )
    )
    key = antifraud_service._customer_history_cache_key(42, 365, 100)
    assert antifraud_service._orders_cache_get(key) is not None

    antifraud_service._orders_cache_invalidate()
    assert antifraud_service._orders_cache_get(key) is None
