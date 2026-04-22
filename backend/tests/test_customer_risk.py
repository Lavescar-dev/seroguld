from app.services.customer_service import _build_customer_risk


def test_customer_risk_low_when_no_signal():
    risk = _build_customer_risk(
        transactions_30d=2,
        distinct_addresses_30d=1,
        distinct_identity_docs_30d=1,
        melted_items_30d=0,
    )
    assert risk.level == "low"
    assert risk.score == 0
    assert risk.warnings == []


def test_customer_risk_high_when_multiple_signals():
    risk = _build_customer_risk(
        transactions_30d=14,
        distinct_addresses_30d=4,
        distinct_identity_docs_30d=3,
        melted_items_30d=4,
    )
    assert risk.level == "high"
    assert risk.score >= 60
    assert any("farklı adresten" in warning for warning in risk.warnings)
