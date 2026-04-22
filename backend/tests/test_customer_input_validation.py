from fastapi import HTTPException

from app.services.customer_service import (
    _normalize_cpr,
    _normalize_phone,
    _validate_customer_identity_inputs,
)


def test_normalize_phone_and_cpr() -> None:
    assert _normalize_phone("+45 22 33 44 55") == "+4522334455"
    assert _normalize_phone("22 33 44 55") == "22334455"
    assert _normalize_cpr("120485-1234") == "1204851234"


def test_validate_customer_identity_inputs_accepts_valid_values() -> None:
    _validate_customer_identity_inputs(
        phone="+4522334455",
        cpr="1204851234",
        identity_doc_number="ABCD1234",
    )


def test_validate_customer_identity_inputs_rejects_invalid_phone() -> None:
    try:
        _validate_customer_identity_inputs(phone="12", cpr="1204851234", identity_doc_number="ABCD1234")
    except HTTPException as exc:
        assert exc.status_code == 422
        assert "Telefon formatı geçersiz" in str(exc.detail)
    else:
        raise AssertionError("Telefon formatı invalid olmalıydı.")


def test_validate_customer_identity_inputs_rejects_invalid_cpr() -> None:
    try:
        _validate_customer_identity_inputs(phone="+4522334455", cpr="12345", identity_doc_number="ABCD1234")
    except HTTPException as exc:
        assert exc.status_code == 422
        assert "CPR formatı geçersiz" in str(exc.detail)
    else:
        raise AssertionError("CPR formatı invalid olmalıydı.")

