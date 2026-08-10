from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.kds_address_service import KdsAddressError, KdsAddressService


class FakeResponse:
    def __init__(self, payload: object, *, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code

    def json(self) -> object:
        return self.payload


class FakeClient:
    def __init__(self, response: FakeResponse, calls: list[tuple[str, dict[str, object], dict[str, str]]]) -> None:
        self.response = response
        self.calls = calls

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def get(self, url: str, *, params: dict[str, object], headers: dict[str, str]) -> FakeResponse:
        self.calls.append((url, params, headers))
        return self.response


class FakeClientFactory:
    def __init__(self, *responses: FakeResponse) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, dict[str, object], dict[str, str]]] = []

    def __call__(self, **kwargs) -> FakeClient:
        assert kwargs == {"timeout": 4.0, "follow_redirects": True}
        return FakeClient(self.responses.pop(0), self.calls)


def _clock() -> datetime:
    return datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_search_keeps_kds_token_server_side_and_hard_filters_postcode() -> None:
    factory = FakeClientFactory(
        FakeResponse(
            {
                "status": "ok",
                "fund": [
                    {"id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "type": "adresse", "titel": "Testvej 7, 2500 Valby"},
                    {"id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "type": "adresse", "titel": "Testvej 8, 2600 Glostrup"},
                    {"id": "cccccccc-cccc-cccc-cccc-cccccccccccc", "type": "vejnavn", "titel": "Testvej"},
                ],
            }
        )
    )
    service = KdsAddressService(
        base_url="https://adressevaelger.test",
        token="server-token-only",
        client_factory=factory,
        clock=_clock,
    )

    first = await service.search("Testvej", postal_code="2500", limit=10)
    second = await service.search("Testvej", postal_code="2500", limit=10)

    assert first.available is True
    assert [(item.id, item.title, item.postal_code, item.city) for item in first.results] == [
        ("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Testvej 7, 2500 Valby", "2500", "Valby")
    ]
    assert second == first
    assert len(factory.calls) == 1
    url, params, headers = factory.calls[0]
    assert url == "https://adressevaelger.test/adresser/soeg"
    assert params == {"token": "server-token-only", "tekst": "Testvej", "maksimum": 10, "postnummer": "2500"}
    assert headers == {"Accept": "application/json"}


@pytest.mark.asyncio
async def test_resolve_maps_kds_address_and_rejects_postcode_mismatch() -> None:
    factory = FakeClientFactory(
        FakeResponse(
            {
                "status": "ok",
                "adresse": {
                    "id_lokalid": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "adressebetegnelse": "Testvej 7, 1. tv., 2500 Valby",
                },
            }
        )
    )
    service = KdsAddressService(
        base_url="https://adressevaelger.test",
        token="server-token-only",
        client_factory=factory,
        clock=_clock,
    )

    resolved = await service.resolve("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", postal_code="2500")

    assert resolved.address == "Testvej 7, 1. tv."
    assert resolved.postal_code == "2500"
    assert resolved.city == "Valby"
    with pytest.raises(KdsAddressError) as raised:
        await service.resolve("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", postal_code="2600")
    assert raised.value.status_code == 409
    assert raised.value.code == "address_postal_code_mismatch"


@pytest.mark.asyncio
async def test_missing_token_returns_manual_entry_error_without_network() -> None:
    service = KdsAddressService(base_url="https://adressevaelger.test", token="", clock=_clock)

    with pytest.raises(KdsAddressError) as raised:
        await service.search("Testvej")

    assert raised.value.status_code == 503
    assert raised.value.code == "address_lookup_not_configured"
