"""R1-B uç testleri — /alis/identity/capabilities + /alis/identity/extract.

Uçlar incedir (servis çağır + AIUsageLog yaz); servis mantığı
test_identity_extract.py'da kapsanır. Burada doğrudan uç fonksiyonları
çağırıyoruz (mevcut v2_alis test deseni).

0.3.39 ekleri: capabilities'in yeni yetenek alanları (vlm_enabled/
local_engine/local_model), auth gevşetmesinin uç imzasında pinlenmesi
(D3) ve yerel katmanlı yanıtın şekli (engine + ocr_text, usage YOK).
"""

from __future__ import annotations

import inspect

import pytest

import app.api.v2  # noqa: F401  # dairesel import sırası
import app.api.v2_alis as v2_alis
from app.schemas.identity import (
    AIUsageOut,
    IdentityEngineOut,
    IdentityExtractOut,
    IdentityFieldOut,
)
from app.services.identity_extract_service import IdentityExtractUnavailable


class _FakeDb:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.commits = 0

    def add(self, obj: object) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.commits += 1


class _Admin:
    id = "00000000-0000-0000-0000-000000000001"


def _extract_out(*, with_usage: bool) -> IdentityExtractOut:
    return IdentityExtractOut(
        document_type="sundhedskort",
        fields={"cpr_number": IdentityFieldOut(value="0101011119", review="validated", confidence=1.0)},
        barcode=None,
        warnings=[],
        source="vlm",
        model="gpt-5-mini",
        usage=(
            AIUsageOut(
                model="gpt-5-mini",
                prompt_tokens=10,
                completion_tokens=5,
                total_tokens=15,
                total_cost_usd="0.00001200",
            )
            if with_usage
            else None
        ),
    )


@pytest.mark.asyncio
async def test_capabilities_endpoint_wires_service(monkeypatch) -> None:
    async def caps_plain() -> dict:
        return {"extract_enabled": False, "model": None, "barcode_available": True}

    monkeypatch.setattr(v2_alis, "identity_capabilities", caps_plain)
    out = await v2_alis.get_alis_identity_capabilities_v2(_=None)
    assert out.extract_enabled is False
    assert out.barcode_available is True


@pytest.mark.asyncio
async def test_capabilities_endpoint_exposes_local_tier_fields(monkeypatch) -> None:
    """0.3.39: yetenek gövdesi yerel katman alanlarını şemaya aynen taşır."""

    async def caps_with_local() -> dict:
        return {
            "extract_enabled": False,
            "vlm_enabled": False,
            "model": None,
            "barcode_available": True,
            "local_engine": True,
            "local_enabled": False,
            "local_model": "RapidOCR PP-OCRv6 (offline)",
        }

    monkeypatch.setattr(v2_alis, "identity_capabilities", caps_with_local)
    out = await v2_alis.get_alis_identity_capabilities_v2(_=None)
    assert out.vlm_enabled is False
    assert out.local_engine is True
    assert out.local_model == "RapidOCR PP-OCRv6 (offline)"
    assert out.local_enabled is False
    # Eski alan adı dip sabittir (frontend sözleşmesi).
    assert out.extract_enabled is False and out.barcode_available is True


def test_identity_endpoint_auth_contract_is_pinned() -> None:
    """D3: capabilities GET admin'den GEVŞETİLDİ, extract POST admin kalır.

    Yol: Dependant nesnesi default argümanın .dependency'sinde yaşar.
    """
    caps_default = inspect.signature(v2_alis.get_alis_identity_capabilities_v2).parameters["_"].default
    assert caps_default.dependency is v2_alis.require_password_change_complete
    extract_default = inspect.signature(v2_alis.post_alis_identity_extract_v2).parameters["admin"].default
    assert extract_default.dependency is v2_alis.require_admin


@pytest.mark.asyncio
async def test_extract_endpoint_records_ai_usage_log(monkeypatch) -> None:
    async def fake_extract(*, image_data_url: str, side: str = "front"):
        assert image_data_url.startswith("data:image/")
        assert side == "front"
        return _extract_out(with_usage=True)

    monkeypatch.setattr(v2_alis, "extract_identity", fake_extract)
    db = _FakeDb()
    out = await v2_alis.post_alis_identity_extract_v2(
        payload=type("P", (), {"image_data_url": "data:image/png;base64,AAAA", "side": "front"})(),
        db=db,  # type: ignore[arg-type]
        admin=_Admin(),  # type: ignore[arg-type]
    )
    assert out.fields["cpr_number"].value == "0101011119"
    assert db.commits == 1
    assert len(db.added) == 1
    log = db.added[0]
    assert log.model == "gpt-5-mini"
    assert log.total_tokens == 15
    assert log.product_id is None


@pytest.mark.asyncio
async def test_extract_endpoint_skips_usage_log_when_absent(monkeypatch) -> None:
    async def fake_extract(*, image_data_url: str, side: str = "front"):
        return _extract_out(with_usage=False)

    monkeypatch.setattr(v2_alis, "extract_identity", fake_extract)
    db = _FakeDb()
    await v2_alis.post_alis_identity_extract_v2(
        payload=type("P", (), {"image_data_url": "data:image/png;base64,AAAA", "side": "front"})(),
        db=db,  # type: ignore[arg-type]
        admin=_Admin(),  # type: ignore[arg-type]
    )
    assert db.added == []
    assert db.commits == 0


@pytest.mark.asyncio
async def test_extract_endpoint_propagates_503(monkeypatch) -> None:
    async def failing_extract(*, image_data_url: str, side: str = "front"):
        raise IdentityExtractUnavailable("Kimlik VLM cikarma kapali.")

    monkeypatch.setattr(v2_alis, "extract_identity", failing_extract)
    db = _FakeDb()
    with pytest.raises(IdentityExtractUnavailable):
        await v2_alis.post_alis_identity_extract_v2(
            payload=type("P", (), {"image_data_url": "data:image/png;base64,AAAA", "side": "front"})(),
            db=db,  # type: ignore[arg-type]
            admin=_Admin(),  # type: ignore[arg-type]
        )
    assert db.added == []


def _local_extract_out() -> IdentityExtractOut:
    """Yerel katman koştuğunda servisin döndürdüğü yanıt şekli (VLM'siz)."""
    return IdentityExtractOut(
        document_type="driver_license",
        fields={"full_name": IdentityFieldOut(value="ANDERS PRØVE TESTESEN", review="validated", confidence=0.97)},
        barcode=None,
        warnings=["Barkod okunamadı — CPR yalnız görüntüden okundu, kontrol edin."],
        source="local",
        model=None,
        usage=None,
        engine=IdentityEngineOut(
            name="local",
            latency_ms=812.3,
            warped=True,
            quad_detected=True,
            roi_fields=["1", "2", "3", "4b", "5"],
        ),
        ocr_text="1. TESTESEN\n2. ANDERS PRØVE",
    )


@pytest.mark.asyncio
async def test_extract_endpoint_local_tier_shape_without_usage_log(monkeypatch) -> None:
    """Yerel katman yanıtı: engine + ocr_text taşınır, usage YOK → log YOK."""
    async def fake_extract(*, image_data_url: str, side: str = "front"):
        return _local_extract_out()

    monkeypatch.setattr(v2_alis, "extract_identity", fake_extract)
    db = _FakeDb()
    out = await v2_alis.post_alis_identity_extract_v2(
        payload=type("P", (), {"image_data_url": "data:image/png;base64,AAAA", "side": "front"})(),
        db=db,  # type: ignore[arg-type]
        admin=_Admin(),  # type: ignore[arg-type]
    )
    assert out.source == "local"
    assert out.engine is not None and out.engine.name == "local"
    assert out.engine.latency_ms == 812.3
    assert out.engine.roi_fields == ["1", "2", "3", "4b", "5"]
    assert out.ocr_text == "1. TESTESEN\n2. ANDERS PRØVE"
    assert out.usage is None and out.model is None
    assert db.added == [] and db.commits == 0  # VLM koşmadı → maliyet satırı YOK
