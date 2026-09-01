import asyncio

from app.api.antifraud import (
    _build_human_meta_fields,
    _build_risk_reasons,
    _extract_failed_rules,
    _translate_known_note_tr,
)
from app.schemas.antifraud import AntiFraudRiskMetaOut
from app.services.antifraud_helpers import (
    _extract_failed_rule_points,
    _extract_score_from_value,
    _normalize_opmc_score,
    _resolve_effective_risk,
    _resolve_risk_level,
)
from app.services.antifraud_service import _build_order_item, _resolve_review_queue_status


def test_extract_failed_rules_from_json_string_list():
    risk_meta = [
        AntiFraudRiskMetaOut(
            key="wc_af_failed_rules",
            value=[
                '{"id":"free_email","label":"E-mail er en kendt gratis e-mail-adresse."}',
                '{"id":"Billing_Phone_Matches_Billing_Country","label":"Telefon matcher ikke land"}',
            ],
        )
    ]

    rules = _extract_failed_rules(risk_meta)

    assert ("free_email", "E-mail er en kendt gratis e-mail-adresse.") in rules
    assert ("Billing_Phone_Matches_Billing_Country", "Telefon matcher ikke land") in rules


def test_build_risk_reasons_contains_rule_labels_and_manual_queue():
    risk_meta = [
        AntiFraudRiskMetaOut(key="_wc_af_waiting", value="1"),
        AntiFraudRiskMetaOut(
            key="wc_af_failed_rules",
            value=['{"id":"Billing_Phone_Matches_Billing_Country","label":"raw-label"}'],
        ),
        AntiFraudRiskMetaOut(key="whitelist_action", value="user_payment_method_whitelisted"),
    ]

    reasons = _build_risk_reasons(
        risk_meta=risk_meta,
        risk_level="high",
        risk_score=80,
        notes=["fraud note example"],
        billing_country="DK",
        shipping_country="SE",
    )
    texts = [item.reason for item in reasons]

    assert any("Toplam risk skoru: 80" in text for text in texts)
    assert any("whitelist nedeniyle atlandı" in text.lower() for text in texts)
    assert any("telefon numarası ülke ile uyuşmuyor" in text.lower() for text in texts)
    assert any("Beyaz liste eylemi" in text for text in texts)
    assert any("fatura ülkesi (dk) ve teslimat ülkesi (se) farklı" in text.lower() for text in texts)
    assert any("Risk notu:" in text for text in texts)


def test_translate_known_note_to_turkish():
    note = "Order fraud checks skipped due to whitelisted payment method: mobilepay"
    translated = _translate_known_note_tr(note)
    assert "dolandırıcılık kontrolleri atlandı" in translated.lower()
    assert "mobilepay" in translated.lower()


def test_build_human_meta_fields_formats_known_values():
    risk_meta = [
        AntiFraudRiskMetaOut(key="_wc_af_waiting", value="1"),
        AntiFraudRiskMetaOut(key="whitelist_action", value="user_payment_method_whitelisted"),
        AntiFraudRiskMetaOut(key="wc_af_score", value="100"),
    ]
    rows = _build_human_meta_fields(risk_meta, ai_explanations_human=["örnek"])
    assert rows[0].label == "Manuel İnceleme Kuyruğu"
    assert "Evet" in rows[0].value
    assert rows[1].label == "Beyaz Liste Eylemi"
    assert "Ödeme yöntemi beyaz listede" in rows[1].value
    assert rows[2].value == "100 güven / 0 risk"


def test_extract_score_accepts_truncated_explicit_json_key_only():
    assert _extract_score_from_value('```json\n{\n  "risk_score": 20') == 20
    assert _extract_score_from_value('{\n  "wc_af_score": "72"') == 72
    assert _extract_score_from_value("Risk düşük (%100 güvenli kullanıcı)") is None


def test_waiting_without_whitelist_stays_in_manual_queue():
    risk_meta = [AntiFraudRiskMetaOut(key="_wc_af_waiting", value="1")]
    reasons = _build_risk_reasons(
        risk_meta=risk_meta,
        risk_level="medium",
        risk_score=25,
        notes=[],
        billing_country=None,
        shipping_country=None,
    )
    assert any("manuel inceleme kuyruğuna" in item.reason for item in reasons)


def test_official_opmc_threshold_bands():
    assert _resolve_risk_level(24) == "low"
    assert _resolve_risk_level(25) == "medium"
    assert _resolve_risk_level(75) == "medium"
    assert _resolve_risk_level(76) == "high"


def test_whitelist_is_skipped_not_low_risk():
    risk_meta = [
        AntiFraudRiskMetaOut(key="whitelist_action", value="user_email_whitelisted"),
        AntiFraudRiskMetaOut(key="_wc_af_waiting", value="1"),
    ]
    level, score, reasons = _resolve_effective_risk(score=80, risk_meta=risk_meta)
    assert level == "unknown"
    assert score is None
    assert any("atlandı" in reason for reason in reasons)


def test_malformed_rule_payload_keeps_rule_id_and_label():
    raw = '{"id":"free_email","label":"Free e-mail","risk_points":10,"detail":"bad "quote""}'
    rules = _extract_failed_rules([AntiFraudRiskMetaOut(key="wc_af_failed_rules", value=[raw])])
    assert ("free_email", "Free e-mail") in rules


def test_opmc_722_trust_score_normalizes_to_risk():
    assert _normalize_opmc_score(90, "trust") == (10, 90)
    assert _normalize_opmc_score(77, "trust") == (23, 77)
    assert _normalize_opmc_score(82, "trust") == (18, 82)
    assert _normalize_opmc_score(100, "trust") == (0, 100)
    assert _normalize_opmc_score(90, "risk") == (90, 10)


def test_malformed_rule_payload_keeps_risk_points():
    raw = (
        '{"id":"free_email","label":"Free e-mail","risk_points":"10",'
        '"reason":"Email domain "hotmail" is free"}'
    )
    risk_meta = [AntiFraudRiskMetaOut(key="wc_af_failed_rules", value=[raw])]
    assert _extract_failed_rule_points(risk_meta) == [10]


def test_stringified_multiple_rules_keep_all_risk_points():
    raw = '[{"risk_points":"10"},{"risk_points":20},{"risk_points":"5"}]'
    risk_meta = [AntiFraudRiskMetaOut(key="wc_af_failed_rules", value=raw)]
    assert _extract_failed_rule_points(risk_meta) == [10, 20, 5]


def test_review_queue_separates_terminal_orders():
    assert _resolve_review_queue_status("processing", True) == "active"
    assert _resolve_review_queue_status("pending", True) == "active"
    assert _resolve_review_queue_status("custom-review", True) == "active"
    for status in ("completed", "cancelled", "refunded", "failed"):
        assert _resolve_review_queue_status(status, True) == "historical"
    assert _resolve_review_queue_status("completed", False) == "none"


def test_order_37863_fixture_is_low_and_consistent():
    order = {
        "id": 37863,
        "number": "37863",
        "status": "completed",
        "total": "10032.62",
        "currency": "DKK",
        "meta_data": [
            {"key": "wc_af_score", "value": "90"},
            {
                "key": "wc_af_failed_rules",
                "value": [
                    '{"id":"free_email","label":"Free e-mail","risk_points":"10",'
                    '"reason":"Email domain "hotmail" is free"}'
                ],
            },
            {"key": "_ai_risk_score", "value": '```json\n{\n  "risk_score": 25'},
        ],
    }

    item = asyncio.run(
        _build_order_item(
            object(),
            order=order,
            include_notes=False,
            notes_per_order=5,
            detail_mode=True,
        )
    )

    assert item.opmc_source_score == 90
    assert item.opmc_trust_score == 90
    assert item.opmc_risk_score == 10
    assert item.risk_score == 10
    assert item.risk_level == "low"
    assert item.failed_rule_points_total == 10
    assert item.score_consistency == "consistent"
    assert item.requires_manual_review is False
    assert item.review_queue_status == "none"


def test_completed_high_risk_is_historical_not_active():
    order = {
        "id": 999,
        "number": "999",
        "status": "completed",
        "meta_data": [
            {"key": "wc_af_score", "value": "10"},
            {"key": "wc_af_failed_rules", "value": [{"id": "high", "risk_points": "90"}]},
        ],
    }

    item = asyncio.run(
        _build_order_item(
            object(),
            order=order,
            include_notes=False,
            notes_per_order=5,
            detail_mode=False,
        )
    )

    assert item.risk_score == 90
    assert item.requires_manual_review is True
    assert item.review_queue_status == "historical"
