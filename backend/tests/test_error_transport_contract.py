from __future__ import annotations

import logging

import pytest
from fastapi.middleware.cors import CORSMiddleware

from app.main import _RequestIdErrorMiddleware, _SecretRedactionFilter


@pytest.mark.asyncio
async def test_unhandled_http_error_is_safe_json_with_cors_and_request_id() -> None:
    async def crashing_app(scope, receive, send) -> None:
        raise RuntimeError("private database detail")

    app = CORSMiddleware(
        _RequestIdErrorMiddleware(crashing_app),
        allow_origins=["tauri://localhost"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    messages: list[dict] = []

    async def receive() -> dict:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict) -> None:
        messages.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/example",
            "raw_path": b"/api/example",
            "query_string": b"",
            "headers": [
                (b"origin", b"tauri://localhost"),
                (b"x-request-id", b"desktop-test-1"),
            ],
            "client": ("127.0.0.1", 12345),
            "server": ("127.0.0.1", 8100),
        },
        receive,
        send,
    )

    start = next(message for message in messages if message["type"] == "http.response.start")
    body = next(message for message in messages if message["type"] == "http.response.body")
    headers = dict(start["headers"])
    assert start["status"] == 500
    assert headers[b"access-control-allow-origin"] == b"tauri://localhost"
    assert headers[b"x-request-id"] == b"desktop-test-1"
    assert b"desktop-test-1" in body["body"]
    assert b"private database detail" not in body["body"]


def test_access_log_filter_masks_query_secrets() -> None:
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "WebSocket %s" [accepted]',
        ("127.0.0.1", "/api/ws?token=secret.jwt&api_key=secret-key"),
        None,
    )

    assert _SecretRedactionFilter().filter(record)
    rendered = record.getMessage()
    assert "secret.jwt" not in rendered
    assert "secret-key" not in rendered
    assert "token=[REDACTED]" in rendered
    assert "api_key=[REDACTED]" in rendered
