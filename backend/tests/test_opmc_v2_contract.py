from __future__ import annotations

from fastapi.routing import APIRoute

from app.main import app


def _route_paths() -> set[tuple[str, frozenset[str]]]:
    return {
        (route.path, frozenset(route.methods or ()))
        for route in app.routes
        if isinstance(route, APIRoute)
    }


def test_opmc_v2_routes_registered() -> None:
    """Frontend /api/v2/opmc/* sözleşmesi — override ucu eksikken OPMC
    detayındaki onay/red butonları 404 alıyordu (0.3.9 P0)."""
    paths = _route_paths()
    assert ("/api/v2/opmc/orders", frozenset({"GET"})) in paths
    assert ("/api/v2/opmc/orders/{order_id}", frozenset({"GET"})) in paths
    assert ("/api/v2/opmc/orders/{order_id}/override", frozenset({"POST"})) in paths
