"""R1-B Tier 2 — kimlik VLM çıkarma servisi + uç testleri.

_post_chat monkeypatch edilir (gerçek ağ YOK); görüntüler zxing-cpp ile
üretilen sentetik Code 128 PNG'lerdir (gerçek kart verisi repoya girmez).
"""

from __future__ import annotations

import base64
import io
from typing import Any

import pytest
from fastapi import HTTPException
from PIL import Image
import zxingcpp

from app.schemas.identity import IdentityExtractRequest
from app.services.identity_extract_service import (
    IdentityExtractError,
    IdentityExtractUnavailable,
    _loads_json,
    extract_identity,
    identity_capabilities,
)

VALID_CPR = "0101011119"  # mod-11 geçer
UNVERIFIED_CPR = "0101901234"


class _StubSettings:
    # 0.3.39: yerel katman ayarları da stub'da taşınır (extract_identity
    # artık VLM kapısı arkasına takılı değil).
    identity_extract_enabled = True
    identity_extract_model = "gpt-5-mini"
    identity_extract_base_url = "https://proxy.example/v1"
    identity_extract_api_key = ""
    identity_extract_timeout_seconds = 5
    identity_extract_max_retries = 1
    identity_extract_max_image_bytes = 8 * 1024 * 1024
    identity_extract_confidence_threshold = 0.62
    identity_local_ocr_enabled = False
    identity_local_ocr_model_label = "rapidocr test etiketi"
    identity_ocr_roi_overrides_json = ""
    openai_api_key = "test-key"
    openai_model = "gpt-5.6-luna"
    openai_base_url = "https://api.openai.com/v1"


def _code128_png_bytes(content: str) -> bytes:
    bc = zxingcpp.create_barcode(content, zxingcpp.BarcodeFormat.Code128)
    zx_img = zxingcpp.write_barcode_to_image(bc)
    pil = Image.frombuffer(
        "L",
        (zx_img.shape[1], zx_img.shape[0]),
        memoryview(zx_img),
        "raw",
        "L",
        0,
        1,
    ).convert("RGB")
    buf = io.BytesIO()
    pil.save(buf, "PNG")
    return buf.getvalue()


def _data_url(content: str) -> str:
    return "data:image/png;base64," + base64.b64encode(_code128_png_bytes(content)).decode("ascii")


def _vlm_payload(fields: dict[str, Any], document_type: str | None = "sundhedskort", model: str = "gpt-5-mini") -> dict[str, Any]:
    import json

    content = json.dumps(
        {
            "document_type": document_type,
            "fields": {
                name: {"value": value, "confidence": conf}
                for name, (value, conf) in fields.items()
            },
        }
    )
    return {
        "model": model,
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 900, "completion_tokens": 110, "total_tokens": 1010},
    }


@pytest.fixture()
def stub_settings(monkeypatch):
    monkeypatch.setattr(
        "app.services.identity_extract_service.get_settings",
        lambda: _StubSettings(),
    )
    return _StubSettings


@pytest.mark.asyncio
async def test_capabilities_local_engine_is_availability_not_flag(monkeypatch) -> None:
    """0.3.39: ``local_engine`` bayraktan BAĞIMSIZ uygunluk göstergesidir.

    Bayrak kapalıyken de motor sorgulanır: frontend bu alana bakarak extract
    isteğini atar — bayrak kapalıyken barkod katmanı yine koşabilsin diye
    (0.3.38'in "bayrak kapalı → istek hiç atılmaz → barkod hiç koşmaz"
    tuzağına dönülmez). Bayrak yalnız yerel OCR'ın kendisini yönetir ve
    ``local_enabled`` olarak AYRI döner.
    """

    class OffSettings(_StubSettings):
        identity_extract_enabled = False
        identity_local_ocr_enabled = False

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: OffSettings())
    monkeypatch.setattr("app.services.identity_local_ocr_service.engine_available", lambda: True)
    caps = await identity_capabilities()
    assert caps["extract_enabled"] is False
    assert caps["vlm_enabled"] is False
    assert caps["model"] is None
    # 0.3.39: barcode_available artık import probudur (hardcode değil).
    assert caps["barcode_available"] is True
    assert caps["local_engine"] is True  # bayrak kapalı AMA motor kurulu
    assert caps["local_enabled"] is False  # bayrak ayrı alanda dürüst döner
    assert caps["local_model"] == "rapidocr test etiketi"


@pytest.mark.asyncio
async def test_capabilities_local_engine_false_when_not_installed(monkeypatch) -> None:
    class OffSettings(_StubSettings):
        identity_extract_enabled = False

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: OffSettings())
    monkeypatch.setattr("app.services.identity_local_ocr_service.engine_available", lambda: False)
    caps = await identity_capabilities()
    assert caps["local_engine"] is False
    assert caps["local_enabled"] is False
    assert caps["local_model"] is None


@pytest.mark.asyncio
async def test_extract_flag_off_returns_barcode_result_without_503(monkeypatch) -> None:
    """0.3.39: VLM bayrağı kapalıyken 503 YOK — barkod sonucu döner.

    0.3.38'deki saha hatasıydı: bayrak kapalıyken zincir barkoda girmeden
    503 atıyordu ve tezgah Windows OCR'e düşüyordu.
    """
    class OffSettings(_StubSettings):
        identity_extract_enabled = False

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: OffSettings())
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert result.barcode is not None
    assert result.barcode.cpr == VALID_CPR
    assert result.source == "barcode"
    # VLM koşmadı → maliyet satırı YOK.
    assert result.usage is None
    assert result.model is None
    assert result.fields["cpr_number"].value == VALID_CPR
    assert result.engine.name == "none"


@pytest.mark.asyncio
async def test_extract_without_api_key_still_returns_barcode_result(monkeypatch) -> None:
    class NoKey(_StubSettings):
        openai_api_key = ""

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: NoKey())
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert result.barcode is not None
    assert result.source == "barcode"
    assert result.usage is None


@pytest.mark.asyncio
async def test_extract_barcode_cpr_wins_and_is_validated(monkeypatch, stub_settings) -> None:
    seen: dict[str, Any] = {}

    async def fake_post_chat(*, url: str, api_key: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
        seen["url"] = url
        seen["payload"] = payload
        # VLM CPR'ı YANLIŞ okudu; barkod onu ezecek.
        return _vlm_payload(
            {
                "full_name": ("Test Person", 0.95),
                "cpr_number": ("0101909999", 0.8),
                "birth_date": ("1901-01-01", 0.9),  # VALID_CPR'ın decode'uyla tutarlı
                "postal_code": ("1620", 0.8),
            }
        )

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")

    # strict json_schema gönderildi mi?
    sent_format = seen["payload"]["response_format"]
    assert sent_format["json_schema"]["strict"] is True
    assert seen["url"] == f"{stub_settings.identity_extract_base_url}/chat/completions"
    assert seen["payload"]["model"] == "gpt-5-mini"

    # Barkod CPR VLM CPR'INI EZER ve validated'dır.
    assert result.barcode is not None
    assert result.barcode.cpr == VALID_CPR
    assert result.barcode.verified is True
    assert result.fields["cpr_number"].value == VALID_CPR
    assert result.fields["cpr_number"].review == "validated"
    assert result.source == "merged"
    assert result.model == "gpt-5-mini"

    # Doğum tarihi barkod CPR ile tutarlı (0101011119 → 1901-01-01) → validated.
    assert result.fields["birth_date"].review == "validated"
    assert result.usage is not None
    assert result.usage.total_tokens == 1010


@pytest.mark.asyncio
async def test_extract_identity_key_overrides_global(monkeypatch, stub_settings) -> None:  # noqa: ARG001
    """0.3.39 sonrası (Azure): kimlik VLM'i KENDİ anahtarını kullanır.

    Global openai_api_key (genel sohbet/GLM ucu) kimlik isteğine ASLA
    karışmaz — kimlik görüntüsü yalnız identity anahtarının ucu görür.
    Azure v1 ucu Bearer ile OpenAI-uyumludur; taşıma kodu değişmez.
    """

    class AzureSettings(_StubSettings):
        identity_extract_enabled = True
        identity_extract_api_key = "azure-identity-key"
        identity_extract_base_url = "https://kaynak.example.openai.azure.com/openai/v1"

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: AzureSettings())
    seen: dict[str, Any] = {}

    async def fake_post_chat(*, url: str, api_key: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
        seen["url"] = url
        seen["api_key"] = api_key
        return _vlm_payload({"full_name": ("Test Person", 0.9)})

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")

    assert seen["api_key"] == "azure-identity-key"  # global "test-key" DEĞİL
    assert seen["url"] == "https://kaynak.example.openai.azure.com/openai/v1/chat/completions"
    assert result.model == "gpt-5-mini"


@pytest.mark.asyncio
async def test_capabilities_vlm_enabled_with_identity_key_only(monkeypatch) -> None:
    """Identity anahtarı TEK başına da VLM kapısını açar (global boş olsa bile)."""

    class KeyOnly(_StubSettings):
        identity_extract_enabled = True
        identity_extract_api_key = "azure-key"
        openai_api_key = ""

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: KeyOnly())
    monkeypatch.setattr("app.services.identity_local_ocr_service.engine_available", lambda: False)
    caps = await identity_capabilities()
    assert caps["vlm_enabled"] is True
    assert caps["extract_enabled"] is True

    class NoKeyAtAll(_StubSettings):
        identity_extract_enabled = True
        identity_extract_api_key = ""
        openai_api_key = ""

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: NoKeyAtAll())
    caps_off = await identity_capabilities()
    assert caps_off["vlm_enabled"] is False


@pytest.mark.asyncio
async def test_extract_low_confidence_falls_to_needs_review(monkeypatch, stub_settings) -> None:
    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload(
            {
                "full_name": ("Usual Name", 0.4),  # eşik 0.62 altı
                "cpr_number": (VALID_CPR, 0.97),
            }
        )

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url("9999999999"), side="front")
    assert result.fields["full_name"].review == "needs_review"
    assert result.fields["cpr_number"].review == "validated"


@pytest.mark.asyncio
async def test_extract_marks_birth_date_inconsistent_with_cpr(monkeypatch, stub_settings) -> None:
    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload(
            {
                "cpr_number": (VALID_CPR, 0.95),
                "birth_date": ("1985-05-05", 0.9),  # CPR ile çelişir
            }
        )

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url("9999999999"), side="front")
    assert result.fields["birth_date"].review == "needs_review"


@pytest.mark.asyncio
async def test_extract_vlm_failure_degrades_to_barcode_result(monkeypatch, stub_settings) -> None:
    """0.3.39 sözleşmesi: VLM hata verse bile barkod/yerel sonuç KAYBOLMAZ.

    Eski davranış (502 fırlat, her şeyi çöpe at) kalktı: sağlayıcı hatası
    uyarıya düşer, zincir barkod CPR'ıyla döner.
    """

    async def failing_post_chat(**kwargs: Any) -> dict[str, Any]:
        raise IdentityExtractError("Kimlik çıkarma servisi hata döndü (400): strict format reddedildi")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", failing_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert result.barcode is not None
    assert result.barcode.cpr == VALID_CPR
    assert result.fields["cpr_number"].value == VALID_CPR
    assert result.usage is None  # VLM sağlıklı dönmedi → maliyet satırı yok
    assert any(w.startswith("vlm_failed:") for w in result.warnings)
    assert result.source == "barcode"


@pytest.mark.asyncio
async def test_extract_oversized_image_is_413(monkeypatch, stub_settings) -> None:
    class TinyLimit(_StubSettings):
        identity_extract_max_image_bytes = 16

    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: TinyLimit())
    with pytest.raises(HTTPException) as raised:
        await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert raised.value.status_code == 413


@pytest.mark.asyncio
async def test_extract_invalid_data_url_is_422(stub_settings) -> None:  # noqa: ARG001
    with pytest.raises(HTTPException) as raised:
        await extract_identity(image_data_url="/local/path.png", side="front")
    assert raised.value.status_code == 422


def test_identity_extract_request_rejects_non_image_data_url() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        IdentityExtractRequest(image_data_url="data:application/pdf;base64,AAAA")


def test_loads_json_tolerates_code_fence() -> None:
    import json

    payload = {"document_type": None, "fields": {}}
    fenced = "```json\n" + json.dumps(payload) + "\n```"
    assert _loads_json(fenced) == payload
