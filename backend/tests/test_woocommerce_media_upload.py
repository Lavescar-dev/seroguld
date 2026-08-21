from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.config import Settings
from app.services import woocommerce as woocommerce_module
from app.services.woocommerce import WooCommerceService


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any] | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or str(payload)

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeAsyncClient:
    """httpx.AsyncClient yerine geçer; istekleri kaydeder."""

    calls: list[dict[str, Any]] = []
    next_response: _FakeResponse = _FakeResponse(201, {"id": 4242})
    # Sıralı yanıt kuyruğu (fallback testleri için); boşsa next_response döner.
    response_queue: list[_FakeResponse] = []

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        type(self).calls.append({"url": url, **kwargs})
        if type(self).response_queue:
            return type(self).response_queue.pop(0)
        return type(self).next_response


@pytest.fixture()
def service(monkeypatch: pytest.MonkeyPatch) -> WooCommerceService:
    monkeypatch.setattr(
        woocommerce_module,
        "get_settings",
        lambda: Settings(
            _env_file=None,
            database_url="sqlite+aiosqlite:///test.db",
            woocommerce_base_url="https://example.dk/wp-json/wc/v3",
            woocommerce_consumer_key="ck_test",
            woocommerce_consumer_secret="cs_test",
            wordpress_base_url="https://example.dk",
            wp_app_username="crm",
            wp_app_password="secret pass",
        ),
    )
    monkeypatch.setattr(woocommerce_module.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.next_response = _FakeResponse(201, {"id": 4242})
    _FakeAsyncClient.response_queue = []
    return WooCommerceService()


def test_upload_sends_avif_first(service: WooCommerceService, tmp_path: Path) -> None:
    """Siteye BİRİNCİL AVIF gönderilir (CRM yüklemede AVIF üretir)."""
    original = tmp_path / "abc123_orig.jpg"
    original.write_bytes(b"\xff\xd8\xff jpeg bytes")
    avif = tmp_path / "abc123.avif"
    avif.write_bytes(b"avif bytes")
    photo = {
        "id": "abc123",
        "filename": "IMG_1234.jpg",
        "avif_path": str(avif),
        "original_path": str(original),
        "url": "/media/abc123.avif",
    }

    media, warning = asyncio.run(service._upload_media(photo))

    assert warning is None
    assert media == {"id": 4242}
    call = _FakeAsyncClient.calls[0]
    # İlk deneme AVIF: filename + Content-Type AVIF kaynağından türetilir.
    assert 'filename="abc123.avif"' in call["headers"]["Content-Disposition"]
    assert call["headers"]["Content-Type"] == "image/avif"
    assert call["content"] == b"avif bytes"
    assert photo["wc_media_id"] == 4242
    assert photo["wc_media_uploaded_at"]


def test_upload_falls_back_to_original_when_avif_rejected(
    service: WooCommerceService, tmp_path: Path
) -> None:
    """WP AVIF'i reddederse (kurulum AVIF desteklemez) yedek formata düşülür."""
    avif = tmp_path / "abc_2.avif"
    avif.write_bytes(b"avif bytes")
    original = tmp_path / "abc_2_orig.jpg"
    original.write_bytes(b"\xff\xd8\xff jpeg")
    photo = {"id": "abc2", "filename": "x.jpg", "avif_path": str(avif), "original_path": str(original)}
    # 1. deneme (AVIF) 400, 2. deneme (jpg) 201.
    _FakeAsyncClient.response_queue = [
        _FakeResponse(400, {"message": "avif not allowed"}, text='{"message":"avif not allowed"}'),
        _FakeResponse(201, {"id": 9001}),
    ]

    media, warning = asyncio.run(service._upload_media(photo))

    assert warning is None
    assert media == {"id": 9001}
    assert len(_FakeAsyncClient.calls) == 2
    # İkinci (kabul edilen) çağrı orijinal jpg.
    assert 'filename="abc_2_orig.jpg"' in _FakeAsyncClient.calls[1]["headers"]["Content-Disposition"]
    assert _FakeAsyncClient.calls[1]["headers"]["Content-Type"] == "image/jpeg"
    assert photo["wc_media_id"] == 9001


def test_upload_skips_when_media_id_already_recorded(service: WooCommerceService) -> None:
    photo = {"id": "abc", "wc_media_id": 777}
    media, warning = asyncio.run(service._upload_media(photo))
    assert media == {"id": 777}
    assert warning is None
    assert _FakeAsyncClient.calls == []


def test_upload_http_error_returns_visible_warning(service: WooCommerceService, tmp_path: Path) -> None:
    original = tmp_path / "x_orig.png"
    original.write_bytes(b"png")
    _FakeAsyncClient.next_response = _FakeResponse(
        403, {"message": "Sorry, you are not allowed"}, text='{"message": "Sorry, you are not allowed"}'
    )
    photo = {"id": "x", "filename": "x.png", "original_path": str(original)}

    media, warning = asyncio.run(service._upload_media(photo))

    assert media is None
    assert warning is not None and "403" in warning and "not allowed" in warning
    assert "wc_media_id" not in photo


def test_upload_missing_file_returns_warning_not_silence(service: WooCommerceService) -> None:
    photo = {"id": "yok", "filename": "yok.jpg", "original_path": "C:/olmayan/yol/yok_orig.jpg"}
    media, warning = asyncio.run(service._upload_media(photo))
    assert media is None
    assert warning is not None and "okunamadı" in warning


def test_publish_orders_primary_photo_first_and_collects_warnings(
    service: WooCommerceService, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = tmp_path / "one_orig.jpg"
    first.write_bytes(b"one")
    primary = tmp_path / "two_orig.jpg"
    primary.write_bytes(b"two")
    product = SimpleNamespace(
        id="pid",
        product_number="0001",
        reference_number="xxxx",
        product_type=SimpleNamespace(value="bracelet"),
        metal_type=SimpleNamespace(value="yellow_gold"),
        purity_karat="22K",
        weight_grams="19.65",
        woocommerce_product_id=None,
        inventory_category="taki",
        inventory_subcategory=None,
        purity_percentage=None,
        length_cm=None,
        width_mm=None,
        thickness_mm=None,
        diameter_mm=None,
        producer=None,
        ai_description=(
            "SEO_TITLE: Guldarmbånd\nSHORT_DESCRIPTION: Kort\n"
            "LONG_DESCRIPTION_HTML: <p>Lang</p>\nMETA_DESCRIPTION: Meta\nURL_SLUG: guld-armbaand-test"
        ),
        photos=[
            {"id": "one", "filename": "one.jpg", "original_path": str(first), "uploaded_at": "2026-01-01"},
            {"id": "two", "filename": "two.jpg", "original_path": str(primary), "is_primary": True, "uploaded_at": "2026-01-02"},
            {"id": "broken", "filename": "broken.jpg", "original_path": "C:/olmayan/broken_orig.jpg", "uploaded_at": "2026-01-03"},
        ],
    )

    captured: dict[str, Any] = {}

    async def fake_wc_request(method: str, path: str, *, json_payload=None, params=None):
        captured["method"] = method
        captured["path"] = path
        captured["payload"] = json_payload
        return {"id": 999, "permalink": "https://example.dk/vare/x"}

    monkeypatch.setattr(service, "_wc_request", fake_wc_request)
    media_ids = iter([11, 22])

    async def fake_upload(photo_item):
        if "olmayan" in str(photo_item.get("original_path")):
            return None, "broken.jpg: dosya okunamadı (yok)."
        media_id = next(media_ids)
        photo_item["wc_media_id"] = media_id
        return {"id": media_id}, None

    monkeypatch.setattr(service, "_upload_media", fake_upload)

    result, warnings = asyncio.run(
        service.publish_product(product=product, regular_price_dkk=__import__("decimal").Decimal("100"))
    )

    assert result["id"] == 999
    # is_primary olan foto ('two') sıralamada başa geçer → images[0] öne çıkan
    # görsel olur (11 numaralı upload primary fotoya aittir).
    assert captured["payload"]["images"] == [{"id": 11}, {"id": 22}]
    assert product.photos[1]["wc_media_id"] == 11  # primary foto ('two')
    assert product.photos[0]["wc_media_id"] == 22
    assert any("broken.jpg" in warning for warning in warnings)
