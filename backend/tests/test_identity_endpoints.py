"""R1-B uç testleri — /alis/identity/capabilities + /alis/identity/extract.

Uçlar incedir (servis çağır + AIUsageLog yaz); servis mantığı
test_identity_extract.py'da kapsanır. Burada doğrudan uç fonksiyonları
çağırıyoruz (mevcut v2_alis test deseni).
"""

from __future__ import annotations

import pytest

import app.api.v2  # noqa: F401  # dairesel import sırası
import app.api.v2_alis as v2_alis
from app.schemas.identity import (
    AIUsageOut,
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
    monkeypatch.setattr(
        v2_alis,
        "identity_capabilities",
        lambda: {"extract_enabled": False, "model": None, "barcode_available": True},
    )
    out = await v2_alis.get_alis_identity_capabilities_v2(_=None)
    assert out.extract_enabled is False
    assert out.barcode_available is True


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
