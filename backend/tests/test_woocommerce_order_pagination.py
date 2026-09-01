import asyncio

from app.services.woocommerce import WooCommerceService


def test_fetch_recent_orders_reads_all_available_pages():
    service = object.__new__(WooCommerceService)
    requested_pages: list[int] = []

    async def fake_wc_request(method, path, *, params=None, **kwargs):
        assert method == "GET"
        assert path == "/orders"
        page = int(params["page"])
        requested_pages.append(page)
        if page == 1:
            return [{"id": 1}, {"id": 2}]
        if page == 2:
            return [{"id": 3}]
        return []

    service._wc_request = fake_wc_request
    rows = asyncio.run(service.fetch_recent_orders(days=0, per_page=2))

    assert [row["id"] for row in rows] == [1, 2, 3]
    assert requested_pages == [1, 2]


def test_fetch_recent_orders_is_not_truncated_after_ten_pages():
    service = object.__new__(WooCommerceService)
    requested_pages: list[int] = []

    async def fake_wc_request(method, path, *, params=None, **kwargs):
        assert method == "GET"
        assert path == "/orders"
        page = int(params["page"])
        requested_pages.append(page)
        return [{"id": page}] if page <= 12 else []

    service._wc_request = fake_wc_request
    rows = asyncio.run(service.fetch_recent_orders(days=0, per_page=1))

    assert [row["id"] for row in rows] == list(range(1, 13))
    assert requested_pages == list(range(1, 14))


def test_fetch_recent_orders_stops_if_woo_repeats_a_full_page():
    service = object.__new__(WooCommerceService)
    requested_pages: list[int] = []

    async def fake_wc_request(method, path, *, params=None, **kwargs):
        page = int(params["page"])
        requested_pages.append(page)
        return [{"id": 1}, {"id": 2}]

    service._wc_request = fake_wc_request
    rows = asyncio.run(service.fetch_recent_orders(days=0, per_page=2))

    assert [row["id"] for row in rows] == [1, 2]
    assert requested_pages == [1, 2]
