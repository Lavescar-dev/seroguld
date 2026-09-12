"""0.3.43: AIService token tavanı — openai_max_tokens ayarı artık giden
payload'a girer (ölü ayar düzeltmesi) ve YALNIZ reasoning_effort BOŞKEN
gönderilir; parametre adı model ailesine göre seçilir (openai_compat).

HTTP katmanı sahtelenir: _FakeClient payload'ı yakalayıp özel istisna
fırlatır — yanıt ayrıştırma zincirine girmeden istek gövdesi denetlenir.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from app.services.ai_service import AIService
from app.services.openai_compat import max_tokens_param


class _Captured(Exception):
    def __init__(self, payload: dict[str, Any]) -> None:
        super().__init__("captured")
        self.payload = payload


def _capture_client(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def __aenter__(self) -> "_FakeClient":
            return self

        async def __aexit__(self, *args: Any) -> bool:
            return False

        async def post(self, url: str, json: dict[str, Any] | None = None, headers: Any = None) -> None:
            raise _Captured(json or {})

    monkeypatch.setattr("app.services.ai_service.httpx.AsyncClient", _FakeClient)


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        ("gpt-5-mini", {"max_completion_tokens": 1024}),
        ("openai/gpt-5-mini", {"max_completion_tokens": 1024}),
        ("gpt-5.6-luna", {"max_completion_tokens": 1024}),
        ("gpt-4.1-mini", {"max_tokens": 1024}),
        ("llama-4-maverick", {"max_tokens": 1024}),
        ("", {"max_tokens": 1024}),
    ],
)
def test_max_tokens_param_selects_by_model_family(model: str, expected: dict[str, int]) -> None:
    assert max_tokens_param(model, 1024) == expected


def _patch_user_content(monkeypatch: pytest.MonkeyPatch, service: AIService) -> None:
    async def fake_build_user_content(product: Any) -> tuple[list[dict[str, Any]], int]:
        return [{"type": "text", "text": "test"}], 0

    monkeypatch.setattr(service, "_build_user_content", fake_build_user_content)


@pytest.mark.asyncio
async def test_ai_service_payload_carries_cap_without_reasoning(monkeypatch) -> None:
    """reasoning_effort BOŞ → temperature + tavan gönderilir (parametre adı
    model ailesine göre); ayar değeri payload'a birebir taşınır."""
    _capture_client(monkeypatch)
    service = AIService()
    service.api_key = "test-key"
    service.model = "gpt-4.1-mini"
    service.reasoning_effort = ""
    _patch_user_content(monkeypatch, service)

    with pytest.raises(HTTPException) as exc_info:
        await service.generate_description_with_usage(product=object())
    captured = exc_info.value.__cause__
    assert isinstance(captured, _Captured)
    payload = captured.payload
    assert payload["max_tokens"] == service.max_tokens
    assert "max_completion_tokens" not in payload
    assert payload["temperature"] == 0.4


@pytest.mark.asyncio
async def test_ai_service_payload_omits_cap_with_reasoning(monkeypatch) -> None:
    """reasoning_effort DOLU → tavan GÖNDERİLMEZ: max_completion_tokens
    muhakeme tokenlarını da kapsar, effort=high + tavan strict-JSON'u
    yarıda kesebilir (bilinçli karar, 0.3.43)."""
    _capture_client(monkeypatch)
    service = AIService()
    service.api_key = "test-key"
    service.model = "gpt-5.6-luna"
    service.reasoning_effort = "high"
    _patch_user_content(monkeypatch, service)

    with pytest.raises(HTTPException) as exc_info:
        await service.generate_description_with_usage(product=object())
    captured = exc_info.value.__cause__
    assert isinstance(captured, _Captured)
    payload = captured.payload
    assert payload["reasoning_effort"] == "high"
    assert "max_tokens" not in payload
    assert "max_completion_tokens" not in payload
