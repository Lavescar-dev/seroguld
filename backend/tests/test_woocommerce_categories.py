from __future__ import annotations

import asyncio
from typing import Any

import pytest

# v2 <-> v2_woocommerce döngüsel import'u üretimde app.main sırası çözer;
# testte de aynı sırayla önce v2 yüklenir.
import app.api.v2  # noqa: F401
from app.api import v2_woocommerce
from app.api.v2_woocommerce import _flatten_category_tree, get_woocommerce_categories_v2


RAW = [
    {"id": 10, "name": "Smykker", "slug": "smykker", "parent": 0, "count": 40},
    {"id": 11, "name": "Ringe", "slug": "ringe", "parent": 10, "count": 12},
    {"id": 12, "name": "Armbånd", "slug": "armbaand", "parent": 10, "count": 8},
    {"id": 20, "name": "Barrer", "slug": "barrer", "parent": 0, "count": 5},
    {"id": 99, "name": "Yetim", "slug": "yetim", "parent": 777, "count": 1},
]


def test_flatten_orders_parents_first_with_depth() -> None:
    flat = _flatten_category_tree(RAW)
    names = [(item.name, item.depth) for item in flat]
    # Kökler alfabetik, çocuklar ebeveyninin hemen altında girintili.
    assert names == [
        ("Barrer", 0),
        ("Smykker", 0),
        ("Armbånd", 1),
        ("Ringe", 1),
        ("Yetim", 0),  # ebeveyni listede yok — kaybolmaz, kökte listelenir
    ]
    assert flat[1].id == 10 and flat[2].parent == 10


def _reset_cache() -> None:
    v2_woocommerce._category_cache.update({"flat": None, "fetched_at": None, "expires_at": 0.0})


def test_categories_endpoint_caches_and_refreshes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"count": 0}

    class _FakeService:
        async def list_categories(self) -> list[dict[str, Any]]:
            calls["count"] += 1
            return RAW

    monkeypatch.setattr(v2_woocommerce, "WooCommerceService", _FakeService)
    _reset_cache()
    try:
        first = asyncio.run(get_woocommerce_categories_v2(refresh=False, admin=None))
        second = asyncio.run(get_woocommerce_categories_v2(refresh=False, admin=None))
        assert calls["count"] == 1
        assert first.cached is False and second.cached is True
        assert [item.id for item in second.items] == [20, 10, 12, 11, 99]

        refreshed = asyncio.run(get_woocommerce_categories_v2(refresh=True, admin=None))
        assert calls["count"] == 2
        assert refreshed.cached is False
    finally:
        _reset_cache()
