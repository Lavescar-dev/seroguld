import base64
import hashlib
import hmac
from decimal import Decimal

from app.api.webhooks import _extract_order_sale_items, _parse_wc_datetime, _verify_wc_signature


def test_verify_wc_signature_matches():
    body = b'{"id":123,"status":"processing"}'
    secret = "super-secret"
    signature = base64.b64encode(hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()).decode("utf-8")

    assert _verify_wc_signature(body, signature, secret)
    assert not _verify_wc_signature(body, "bad-signature", secret)


def test_verify_wc_signature_is_optional_when_secret_missing():
    body = b'{"id":123}'
    assert _verify_wc_signature(body, None, "")
    assert _verify_wc_signature(body, None, None)


def test_extract_order_sale_items_processing_order():
    payload = {
        "id": 9876,
        "status": "processing",
        "date_paid": "2026-02-27T10:15:00",
        "line_items": [
            {"id": 1, "product_id": 111, "total": "4999.90", "quantity": 1},
            {"id": 2, "product_id": "222", "price": "100.00", "quantity": 1},
            {"id": 3, "product_id": None, "total": "50.00"},
        ],
    }

    items = _extract_order_sale_items(payload)

    assert len(items) == 2
    assert items[0]["wc_product_id"] == 111
    assert items[0]["sale_price_dkk"] == Decimal("4999.90")
    assert items[1]["wc_product_id"] == 222
    assert items[1]["sale_price_dkk"] == Decimal("100.00")
    assert items[0]["sale_date"] is not None


def test_extract_order_sale_items_ignores_non_sale_status():
    payload = {
        "id": 9876,
        "status": "pending",
        "line_items": [{"id": 1, "product_id": 111, "total": "4999.90", "quantity": 1}],
    }
    assert _extract_order_sale_items(payload) == []


def test_parse_wc_datetime_handles_invalid():
    assert _parse_wc_datetime("not-a-date") is None
