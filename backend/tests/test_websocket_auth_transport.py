from __future__ import annotations

from app.api.pos import _clerk_websocket_token


class _FakeWebSocket:
    def __init__(self, protocols: list[str], query: dict[str, str] | None = None) -> None:
        self.scope = {"subprotocols": protocols}
        self.query_params = query or {}


def test_clerk_websocket_reads_jwt_from_subprotocol_without_url_secret() -> None:
    token, accepted = _clerk_websocket_token(
        _FakeWebSocket(["seroguld-auth", "header.payload.signature"])
    )

    assert token == "header.payload.signature"
    assert accepted == "seroguld-auth"


def test_clerk_websocket_rejects_legacy_query_token() -> None:
    token, accepted = _clerk_websocket_token(
        _FakeWebSocket([], {"token": "must-not-be-read"})
    )

    assert token is None
    assert accepted is None
