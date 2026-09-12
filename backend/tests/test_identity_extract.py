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
from app.services.identity_local_ocr_service import LocalOcrOutcome
from app.services.identity_local_parse import LocalField, LocalParseResult

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
    # 0.3.42: kalite tetikleyici ayarları — service bu attribute'ları okur;
    # stub'a eklenmezse mevcut extract testleri AttributeError düşer.
    identity_vlm_trigger_mode = "quality"
    identity_vlm_local_slow_seconds = 5.0
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


@pytest.fixture()
def local_settings(monkeypatch):
    """quality kipi + YEREL KATMAN AÇIK — tetikleyici testleri gerçek zincir
    şekliyle koşar (stub'in local_enabled=False'u tetik testlerini bozar)."""
    monkeypatch.setattr(
        "app.services.identity_extract_service.get_settings",
        lambda: LocalSettings(),
    )
    return LocalSettings


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


# ---------------------------------------------------------------------------
# 0.3.42 — kalite tetikleyici + fill-only-empty merge hiyerarşisi
# ---------------------------------------------------------------------------


class AlwaysSettings(_StubSettings):
    """always kipi + yerel katman: merge davranışını VLM tetik sıklığından
    ayriştıran testler bu sınıfla koşar — merge politikası iki kipte ortaktır."""

    identity_vlm_trigger_mode = "always"
    identity_local_ocr_enabled = True


class LocalSettings(_StubSettings):
    """quality kipi + yerel katman: tetikleyici testleri gerçek zincir
    şeklini taşır (stub'in local_enabled=False'u tetik testlerini bozar)."""

    identity_local_ocr_enabled = True


def _local_outcome(
    fields: dict[str, tuple[str, float]] | None = None,
    *,
    document_type: str | None = "driver_license",
    latency_ms: float = 800.0,
    warnings: list[str] | None = None,
) -> LocalOcrOutcome:
    """Sahte yerel zincir sonucu: run_local_ocr monkeypatch'ine beslenir."""
    local_fields = {
        name: LocalField(value=value, confidence=conf, roi_key=name, checksum_ok=True)
        for name, (value, conf) in (fields or {}).items()
    }
    return LocalOcrOutcome(
        engine_used=True,
        engine_name="local",
        latency_ms=latency_ms,
        document_type=document_type,
        parse=LocalParseResult(document_type=document_type, document_type_key=None, fields=local_fields),
        warnings=list(warnings or []),
    )


def _patch_local(monkeypatch, outcome: LocalOcrOutcome) -> None:
    monkeypatch.setattr(
        "app.services.identity_extract_service.run_local_ocr", lambda image_bytes, **kwargs: outcome
    )


@pytest.mark.asyncio
async def test_extract_quality_trigger_skips_vlm_when_local_clean(monkeypatch, local_settings) -> None:
    """Tetik 0: yerel dolu + uyarı yok + hızlı → VLM ÇAĞRILMAZ (maliyet yok)."""
    outcome = _local_outcome(
        {
            "full_name": ("Yerel Ad", 0.9),
            "doc_number": ("DK1000099", 0.9),
            "cpr_number": ("0101011119", 0.97),
        }
    )
    _patch_local(monkeypatch, outcome)
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({})

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen == {}
    assert result.usage is None
    assert result.source == "local+barcode"
    assert not any(w.startswith("vlm_triggered") for w in result.warnings)
    assert "local_slow" not in result.warnings


@pytest.mark.asyncio
async def test_extract_quality_trigger_nofields_calls_vlm_and_fills_empty(monkeypatch, local_settings) -> None:  # noqa: ARG001
    """Tetik 1: full_name boş → VLM çağrılır ve yalnız boş alanı doldurur."""
    outcome = _local_outcome({"doc_number": ("DK1000099", 0.9), "cpr_number": ("0101011119", 0.97)})
    _patch_local(monkeypatch, outcome)
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({"full_name": ("Vlm Ad", 0.9)}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen.get("called") is True
    assert result.fields["full_name"].value == "Vlm Ad"
    assert result.fields["doc_number"].value == "DK1000099"  # yerel bozulmadı
    assert "vlm_triggered:nofields" in result.warnings


@pytest.mark.asyncio
async def test_extract_quality_trigger_lowconf(monkeypatch, local_settings) -> None:  # noqa: ARG001
    """Tetik 2a: roi_low_confidence uyarısı → lowconf."""
    outcome = _local_outcome(
        {"full_name": ("Yerel Ad", 0.9), "doc_number": ("DK1000099", 0.9)},
        warnings=["roi_low_confidence"],
    )
    _patch_local(monkeypatch, outcome)
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen.get("called") is True
    assert "vlm_triggered:lowconf" in result.warnings


@pytest.mark.asyncio
async def test_extract_quality_trigger_core_field_low_confidence(monkeypatch, local_settings) -> None:  # noqa: ARG001
    """Tetik 2b: çekirdek alan güveni eşiğin (0.62) altında → lowconf."""
    outcome = _local_outcome(
        {
            "full_name": ("Yerel Ad", 0.4),
            "doc_number": ("DK1000099", 0.9),
            "cpr_number": ("0101011119", 0.97),
        }
    )
    _patch_local(monkeypatch, outcome)
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen.get("called") is True
    assert "vlm_triggered:lowconf" in result.warnings


@pytest.mark.asyncio
async def test_extract_quality_trigger_card_not_detected(monkeypatch, local_settings) -> None:  # noqa: ARG001
    """Tetik 3a: card_not_detected → ndet."""
    outcome = _local_outcome(
        {"full_name": ("Yerel Ad", 0.9), "doc_number": ("DK1000099", 0.9)},
        warnings=["card_not_detected"],
    )
    _patch_local(monkeypatch, outcome)
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen.get("called") is True
    assert "vlm_triggered:ndet" in result.warnings


@pytest.mark.asyncio
async def test_extract_local_slow_emits_warning_and_triggers_vlm(monkeypatch, local_settings, caplog) -> None:
    """Tetik 4: yerel gecikme > 5 sn → local_slow olayı + vlm_triggered:slow.

    logger.warning biçim argümanı da denetlenir — format hatası varsa
    logging çağrısının kendisi patlar.
    """
    outcome = _local_outcome(
        {
            "full_name": ("Yerel Ad", 0.9),
            "doc_number": ("DK1000099", 0.9),
            "cpr_number": ("0101011119", 0.97),
        },
        latency_ms=6200.0,
    )
    _patch_local(monkeypatch, outcome)
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    with caplog.at_level("WARNING", logger="app.services.identity_extract_service"):
        result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen.get("called") is True
    assert "local_slow" in result.warnings
    assert "vlm_triggered:slow" in result.warnings
    assert "çok uzun sürdü" in caplog.text


@pytest.mark.asyncio
async def test_extract_merge_conflict_keeps_local_and_needs_review(monkeypatch) -> None:
    """Çelişki: yerel doc_number korunur, alan needs_review + vlm_conflict."""
    outcome = _local_outcome(
        {"full_name": ("Yerel Ad", 0.9), "doc_number": ("DK1000099", 0.9)}
    )
    _patch_local(monkeypatch, outcome)
    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: AlwaysSettings())

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload({"doc_number": ("DK1234567", 0.9)}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert result.fields["doc_number"].value == "DK1000099"  # yerel tutuldu
    assert result.fields["doc_number"].review == "needs_review"
    assert "vlm_conflict:doc_number" in result.warnings


@pytest.mark.asyncio
async def test_extract_merge_canonical_equal_is_not_conflict(monkeypatch) -> None:
    """Kanonik eşitlik: '0101801234' ↔ '010180-1234' aynı CPR — çelişki YOK."""
    outcome = _local_outcome(
        {
            "full_name": ("Yerel Ad", 0.9),
            "doc_number": ("DK1000099", 0.9),
            "cpr_number": ("0101801234", 0.97),
        }
    )
    _patch_local(monkeypatch, outcome)
    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: AlwaysSettings())

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload({"cpr_number": ("010180-1234", 0.9)}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url("xxxx"), side="front")
    assert not any(w.startswith("vlm_conflict") for w in result.warnings)


@pytest.mark.asyncio
async def test_extract_merge_document_type_local_precedence(monkeypatch) -> None:
    """Türde yerel öncelik: VLM id_card dese bile yerel driver_license kalır."""
    outcome = _local_outcome(
        {"full_name": ("Yerel Ad", 0.9), "doc_number": ("DK1000099", 0.9)},
        document_type="driver_license",
    )
    _patch_local(monkeypatch, outcome)
    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: AlwaysSettings())

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload({}, document_type="id_card")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert result.document_type == "driver_license"


@pytest.mark.asyncio
async def test_extract_merge_conflict_review_survives_birth_reeval(monkeypatch) -> None:
    """Çelişki needs_review'ı doğum↔CPR yeniden-değerlendirmesi EZEMEZ.

    Yerel doğum tarihi CPR ile tutarlı → re-eval validated der; VLM farklı
    tarih okudu → çelişki işaretlemesi (re-eval SONRASI) needs_review'a
    döndürür. Sıra ters olsaydı VALIDATED ezardı.
    """
    outcome = _local_outcome(
        {
            "full_name": ("Yerel Ad", 0.9),
            "doc_number": ("DK1000099", 0.9),
            "cpr_number": (VALID_CPR, 0.97),
            "birth_date": ("01.01.1901", 0.9),  # VALID_CPR decode'u ile tutarlı
        }
    )
    _patch_local(monkeypatch, outcome)
    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: AlwaysSettings())

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload({"birth_date": ("1985-05-05", 0.9)}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert result.fields["birth_date"].review == "needs_review"
    assert result.fields["birth_date"].value == "01.01.1901"  # yerel değer korundu
    assert "vlm_conflict:birth_date" in result.warnings


@pytest.mark.asyncio
async def test_extract_merge_expiry_conflict_and_canonical_date(monkeypatch) -> None:
    """expiry_date: gerçek fark → needs_review; aynı tarih farklı biçim → dokunma."""
    outcome = _local_outcome(
        {"full_name": ("Yerel Ad", 0.9), "doc_number": ("DK1000099", 0.9), "expiry_date": ("01.01.2030", 0.9)}
    )
    _patch_local(monkeypatch, outcome)
    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: AlwaysSettings())

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload({"expiry_date": ("2030-01-01", 0.9)}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    same = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert same.fields["expiry_date"].review == "validated"
    assert not any(w.startswith("vlm_conflict") for w in same.warnings)

    async def conflicting_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload({"expiry_date": ("01.01.2031", 0.9)}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", conflicting_post_chat)
    different = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert different.fields["expiry_date"].value == "01.01.2030"
    assert different.fields["expiry_date"].review == "needs_review"
    assert "vlm_conflict:expiry_date" in different.warnings


@pytest.mark.asyncio
async def test_extract_merge_fill_only_empty_keeps_local_values(monkeypatch) -> None:
    """Fill-only-empty: VLM boş alanı doldurur, yerel dolu alanı BOZMAZ.

    Serbest metin alanları (şehir gibi) kanonik karşılaştırmaya girmez:
    yerel doluyken VLM değeri tamamen yok sayılır.
    """
    outcome = _local_outcome(
        {"full_name": ("Yerel Ad", 0.9), "doc_number": ("DK1000099", 0.9), "city": ("Aalborg", 0.8)}
    )
    _patch_local(monkeypatch, outcome)
    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: AlwaysSettings())

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        return _vlm_payload(
            {"full_name": ("Vlm Ad", 0.9), "city": ("Kobenhavn", 0.9), "address": ("Vesterbro 1", 0.9)},
            document_type="driver_license",
        )

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert result.fields["full_name"].value == "Yerel Ad"
    assert result.fields["city"].value == "Aalborg"
    assert result.fields["address"].value == "Vesterbro 1"  # boştu → VLM doldurdu


@pytest.mark.asyncio
async def test_extract_barcode_cpr_conflict_is_not_marked(monkeypatch, stub_settings) -> None:  # noqa: ARG001
    """Barkod CPR otoriterdir: VLM CPR çelişkisi vlm_conflict işareti ÜRETMEZ."""
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({"cpr_number": ("0101909999", 0.9)})

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen.get("called") is True
    assert result.fields["cpr_number"].value == VALID_CPR
    assert result.fields["cpr_number"].review == "validated"
    assert not any(w.startswith("vlm_conflict:cpr_number") for w in result.warnings)


@pytest.mark.asyncio
async def test_extract_always_mode_calls_vlm_on_clean_scan(monkeypatch) -> None:
    """always kipi: temiz taramada bile çağrılır; merge politikası aynıdır."""
    outcome = _local_outcome(
        {
            "full_name": ("Yerel Ad", 0.9),
            "doc_number": ("DK1000099", 0.9),
            "cpr_number": ("0101011119", 0.97),
        }
    )
    _patch_local(monkeypatch, outcome)
    monkeypatch.setattr("app.services.identity_extract_service.get_settings", lambda: AlwaysSettings())
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({}, document_type="driver_license")

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen.get("called") is True
    assert "vlm_triggered:always" in result.warnings
    assert result.fields["full_name"].value == "Yerel Ad"  # merge: yerel korunur


def test_identity_vlm_settings_read_from_env(monkeypatch) -> None:
    """Yeni ayarlar env'den okunur — doğrudan Settings() kurulur (get_settings
    lru_cache'lidir; cache'li örneği bozmak diğer testleri bozar)."""
    from app.config import Settings

    monkeypatch.setenv("IDENTITY_VLM_TRIGGER_MODE", "always")
    monkeypatch.setenv("IDENTITY_VLM_LOCAL_SLOW_SECONDS", "7.5")
    settings = Settings()
    assert settings.identity_vlm_trigger_mode == "always"
    assert settings.identity_vlm_local_slow_seconds == 7.5


@pytest.mark.asyncio
async def test_extract_sundhedskort_clean_scan_does_not_trigger(monkeypatch, local_settings) -> None:  # noqa: ARG001
    """Sundhedskort'ta basılı doc_number YOKTUR (composer üretmez): temiz yerel
    okuma tetik üretmez → VLM çağrılmaz. driver_license'ta doc_number boşsa
    tetiklenir (tip-farkındalıklı no_fields)."""
    sundhedskort_outcome = _local_outcome(
        {"full_name": ("Yerel Ad", 0.9), "cpr_number": ("0101011119", 0.97)},
        document_type="sundhedskort",
    )
    _patch_local(monkeypatch, sundhedskort_outcome)
    seen: dict[str, Any] = {}

    async def fake_post_chat(**kwargs: Any) -> dict[str, Any]:
        seen["called"] = True
        return _vlm_payload({})

    monkeypatch.setattr("app.services.identity_extract_service._post_chat", fake_post_chat)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen == {}

    licence_outcome = _local_outcome({"full_name": ("Yerel Ad", 0.9), "cpr_number": ("0101011119", 0.97)})
    _patch_local(monkeypatch, licence_outcome)
    result = await extract_identity(image_data_url=_data_url(VALID_CPR), side="front")
    assert seen.get("called") is True
    assert "vlm_triggered:nofields" in result.warnings
