from __future__ import annotations

from decimal import Decimal

import pytest

from app.services import pos_workspace_state


@pytest.fixture()
def profile_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        pos_workspace_state,
        "get_effective_market_rate_profile_cached",
        lambda: {
            "plet_dkk": "0.02",
            "gold_bar_dkk": "600.00",
            "silver_bar_dkk": "7.50",
            "platinum_dkk": "298.00",
            "palladium_dkk": "241.00",
        },
    )


def test_ptpd_rates_roundtrip_and_serialize(profile_stub: None) -> None:
    payload = {
        "rates_unit": "dkk",
        "eur_dkk_fx": "7.45",
        "gold_rates_dkk": {"24": "615.50"},
        "silver_rates_dkk": {"999": "7.80"},
        "platinum_dkk": "310.00",
        "palladium_dkk": "255.00",
    }
    rates = pos_workspace_state._market_rate_payload_to_workspace(
        payload, fallback_gold_24k_dkk=Decimal("615.50"), fallback_silver_dkk=Decimal("7.80")
    )
    assert rates.platinum_dkk == Decimal("310.00")
    assert rates.palladium_dkk == Decimal("255.00")

    serialized = pos_workspace_state._serialize_workspace_market_rates_payload(rates)
    assert serialized["platinum_dkk"] == "310.00"
    assert serialized["palladium_dkk"] == "255.00"

    # Satır oran çözümü: ptpd anahtarları global skalerlerden beslenir.
    assert pos_workspace_state._workspace_market_rate_dkk(rates, "ptpd:platinum") == Decimal("310.00")
    assert pos_workspace_state._workspace_market_rate_dkk(rates, "ptpd:palladium") == Decimal("255.00")


def test_ptpd_rates_fall_back_to_profile_when_payload_lacks_them(profile_stub: None) -> None:
    """0.3.6 ve öncesi note payload'larında Pt/Pd yok — profil değerine düşer."""
    payload = {
        "rates_unit": "dkk",
        "eur_dkk_fx": "7.45",
        "gold_rates_dkk": {"24": "615.50"},
        "silver_rates_dkk": {"999": "7.80"},
    }
    rates = pos_workspace_state._market_rate_payload_to_workspace(
        payload, fallback_gold_24k_dkk=Decimal("615.50"), fallback_silver_dkk=Decimal("7.80")
    )
    assert rates.platinum_dkk == Decimal("298.00")
    assert rates.palladium_dkk == Decimal("241.00")


def test_infer_workspace_row_key_routes_ptpd_before_karat_parse() -> None:
    from types import SimpleNamespace

    from app.models.enums import MetalTypeEnum, ProductTypeEnum
    from app.services.pos_service import _infer_workspace_row_key

    platinum_line = SimpleNamespace(
        product_type=ProductTypeEnum.JEWELRY,
        metal_type=MetalTypeEnum.PLATINUM,
        purity_percentage=Decimal("95.00"),
        purity_karat=None,
    )
    palladium_line = SimpleNamespace(
        product_type=ProductTypeEnum.JEWELRY,
        metal_type=MetalTypeEnum.PALLADIUM,
        purity_percentage=Decimal("50.00"),
        purity_karat=None,
    )
    assert _infer_workspace_row_key(platinum_line) == "ptpd:platinum"
    assert _infer_workspace_row_key(palladium_line) == "ptpd:palladium"


def test_invoice_gold_auto_sheet_includes_bar_and_ptpd_rows() -> None:
    """Faktura Guld auto sheet'i 0.3.7'de bar/ptpd satırlarını hiç yazmıyordu."""
    from decimal import Decimal as D

    from app.schemas.pos import (
        PosWorkspaceBarRowOut,
        PosWorkspaceGoldRowOut,
        PosWorkspaceMarketRates,
        PosWorkspacePtPdRowOut,
    )
    from app.services.pos_workspace_state import _invoice_gold_auto_sheet_from_workspace_rows

    market_rates = PosWorkspaceMarketRates(
        eur_dkk_fx=D("7.45"),
        gold_rates_dkk={"14": D("359.04")},
        silver_rates_dkk={"999": D("7.80")},
        gold_24k_dkk=D("615.50"),
        silver_dkk=D("7.80"),
    )
    gold = [PosWorkspaceGoldRowOut(
        row_key="gold:14", karat=D("14.0"), label="14k", lodighed="585",
        purity_percentage=D("58.50"), gram=D("44.00"), avance_percent=D("0"),
        rate_dkk=D("1662.50"), unit_price_dkk=D("1662.50"), line_total_dkk=D("73150.00"),
    )]
    bars = [PosWorkspaceBarRowOut(
        row_key="bar:gold", bar_type="gold", label="Guldbarre", lodighed="999.9",
        purity_percentage=D("99.99"), gram=D("22.00"), avance_percent=D("0"),
        rate_dkk=D("615.50"), unit_price_dkk=D("615.50"), line_total_dkk=D("13541.00"),
    )]
    ptpd = [PosWorkspacePtPdRowOut(
        row_key="ptpd:platinum", metal="platinum", label="Platin", lodighed="950",
        purity_percentage=D("95.00"), gram=D("33.00"), avance_percent=D("0"),
        rate_dkk=D("280.00"), unit_price_dkk=D("280.00"), line_total_dkk=D("9240.00"),
    )]

    sheet = _invoice_gold_auto_sheet_from_workspace_rows(
        gold_rows=gold, silver_rows=[], bar_rows=bars, ptpd_rows=ptpd, market_rates=market_rates,
    )
    filled = [row for row in sheet.rows if row.gram and row.gram > 0]
    assert [(row.code, row.label) for row in filled] == [
        ("1", "Guld"),
        ("6", "Guldbarre"),
        ("8", "Platin"),
    ]
    assert sheet.total_grams == D("99.00")
    assert sheet.total_amount_dkk == D("95931.00")
