"""0.3.35 print hazirligi: @page A4 kurallari + workspace auto_print kosullu.

E1: fiş ve workspace print HTML'i @page { size: A4 } + satır bölme
kuralları içerir (desen: afg_document_renderer). E2: workspace print
endpoint'i auto_print parametresine bağlandı — Tauri (default) çağrısında
inline script GÖMÜLMEZ, auto_print=true ile window.print() gömülür.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.pos_service import render_pos_receipt_html
from app.services.pos_workspace_exports import render_purchase_workspace_print_html

from tests.test_pos_receipt_render import _sample_context


def test_receipt_print_html_contains_page_a4():
    html = render_pos_receipt_html(_sample_context("admin"))
    assert "@page { size: A4; margin: 14mm; }" in html
    assert "tr { page-break-inside: avoid; }" in html
    assert "thead { display: table-header-group; }" in html


def _fake_workspace() -> SimpleNamespace:
    return SimpleNamespace(
        numbering_preview=SimpleNamespace(afregnings_number_next="AFG-2026/0001"),
        session=SimpleNamespace(session_code="B501EBC0", updated_at=datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)),
        customer=SimpleNamespace(
            name="Mock Musteri",
            cpr_number="010190-1234",
            phone="+45 11 22 33 44",
            email="mock@example.com",
            address="Testgade 1",
            postal_code="8000",
            identity_doc_number="P1234567",
        ),
        bank_info=SimpleNamespace(reg_number="1234", account_number="5678901"),
        summary=SimpleNamespace(
            net_amount_dkk="1000.00",
            vat_rate_percent="25.00",
            vat_amount_dkk="250.00",
            gross_amount_dkk="1250.00",
        ),
        afg_note="",
    )


def _render_workspace(auto_print: bool) -> str:
    return render_purchase_workspace_print_html(
        workspace=_fake_workspace(),  # type: ignore[arg-type]
        payment_method="cash",
        lines=[{"type": "ring", "fineness": "750", "lodighed": "75.0", "gram": "10.00", "avance": "10.0", "unit_price": "100.00", "line_total": "1000.00"}],
        auto_print=auto_print,
    )


def test_workspace_print_html_contains_page_a4():
    html = _render_workspace(auto_print=False)
    assert "@page { size: A4; margin: 14mm; }" in html
    assert "tr { page-break-inside: avoid; }" in html
    assert "thead { display: table-header-group; }" in html


def test_workspace_print_default_has_no_inline_script():
    # Tauri: CSP inline script zaten engeller; default çağrıda script gömülmez
    # (çift baskı diyaloğu imkânsız olmalı).
    assert "<script" not in _render_workspace(auto_print=False)


def test_workspace_print_auto_print_embeds_window_print():
    # Tarayıcı modunda opt-in: ?auto_print=true ile tek diyalog açılır.
    assert "window.print()" in _render_workspace(auto_print=True)
