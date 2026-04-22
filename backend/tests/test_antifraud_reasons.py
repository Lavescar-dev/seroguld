from app.api.antifraud import (
    _build_human_meta_fields,
    _build_risk_reasons,
    _extract_failed_rules,
    _translate_known_note_tr,
)
from app.schemas.antifraud import AntiFraudRiskMetaOut


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
    assert any("manuel inceleme kuyruğuna" in text for text in texts)
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
    assert rows[2].value == "100"
