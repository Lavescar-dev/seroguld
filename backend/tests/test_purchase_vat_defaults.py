from __future__ import annotations

import json

from app.services.pos_workspace_state import _parse_workspace_note_payload


def test_new_purchases_default_to_zero_vat() -> None:
    parsed = _parse_workspace_note_payload(None)
    assert parsed["purchase_vat_enabled"] is False
    assert parsed["purchase_vat_rate_percent"] == "0.00"


def test_note_without_vat_key_means_no_vat() -> None:
    note = json.dumps({"kind": "purchase_workspace_v1"})
    parsed = _parse_workspace_note_payload(note)
    assert parsed["purchase_vat_enabled"] is False
    assert parsed["purchase_vat_rate_percent"] == "0.00"


def test_historical_vat_documents_keep_their_stored_vat() -> None:
    # Eski KDV'li belgeler anahtarı notlarında açıkça taşır; tutarlar
    # yeniden hesaplanmadan aynı KDV ile korunmalı.
    note = json.dumps(
        {
            "kind": "purchase_workspace_v1",
            "purchase_vat_enabled": True,
            "purchase_vat_rate_percent": "25.00",
        }
    )
    parsed = _parse_workspace_note_payload(note)
    assert parsed["purchase_vat_enabled"] is True
    assert parsed["purchase_vat_rate_percent"] == "25.00"
