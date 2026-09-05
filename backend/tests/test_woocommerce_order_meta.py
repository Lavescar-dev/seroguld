"""M3 — update_order_meta atomik upsert sözleşmesi.

Eski desen order'ı GET edip meta listesinin TAMAMINI PUT ile geri yazıyordu;
fetch ile PUT arasına giren yazımlar (Woo admin/eklenti/ikinci operatör)
eziliyordu. Yeni sözleşme: yalnız tek girdilik meta payload'ı gönderilir
(Woo REST key+value ile upsert eder), ön GET yapılmaz.
"""

import asyncio

from app.services.woocommerce import WooCommerceService


def _service() -> WooCommerceService:
    service = object.__new__(WooCommerceService)
    service._shared_client = None
    service._client_depth = 0
    return service


def test_update_order_meta_sends_single_entry_and_does_not_prefetch():
    service = _service()
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_wc_request(method, path, *, json_payload=None, params=None):
        calls.append((method, path, json_payload))
        return {"id": 55, "meta_data": [{"key": "_wc_af_manual_override", "value": {"level": "low"}}]}

    async def fail_fetch_order(*args, **kwargs):
        raise AssertionError("update_order_meta siparişi önden GET ETMEMELİ (upsert tek girdiyle yeterli).")

    service._wc_request = fake_wc_request
    service.fetch_order = fail_fetch_order

    payload = asyncio.run(
        service.update_order_meta(order_id=55, meta_key="_wc_af_manual_override", value={"level": "low"})
    )

    assert calls == [
        (
            "PUT",
            "/orders/55",
            {"meta_data": [{"key": "_wc_af_manual_override", "value": {"level": "low"}}]},
        )
    ]
    assert payload["id"] == 55


def test_update_order_meta_does_not_rewrite_sibling_meta_data():
    """Mevcut diğer meta'ların payload'a kopyalanip PUT ile ezilmediği
    doğrulanır — kilit yarışının ta kendisi buydu."""

    service = _service()
    sent: dict | None = None

    async def fake_wc_request(method, path, *, json_payload=None, params=None):
        nonlocal sent
        sent = json_payload
        return {"id": 7}

    service._wc_request = fake_wc_request

    asyncio.run(service.update_order_meta(order_id=7, meta_key="_sg_marker", value="1"))

    assert sent is not None
    assert list(sent["meta_data"][0].keys()) == ["key", "value"]
    assert len(sent["meta_data"]) == 1
