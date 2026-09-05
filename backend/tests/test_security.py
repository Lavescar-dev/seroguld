from passlib.hash import bcrypt

from app.utils.security import (
    decrypt_field,
    encrypt_field,
    get_password_hash,
    mask_cpr,
    verify_password,
)


def test_encrypt_decrypt_roundtrip():
    source = "test-secret"
    encrypted = encrypt_field(source)
    assert encrypted is not None
    assert decrypt_field(encrypted) == source


def test_decrypt_field_returns_none_instead_of_raising_on_corrupt_values():
    """Bozuk/legacy şifreli değer tek müşteri kaydında her workspace, display
    ve login akışını 500'e düşürmemeli — None + log (uygulama konvansiyonu:
    verify_password ile aynı güvenli hata semantiği)."""

    import base64
    import json

    encrypted = encrypt_field("secret-cpr")

    # base64 kırığı
    assert decrypt_field("not-base64-!!!") is None
    # base64 geçerli ama JSON değil
    assert decrypt_field(base64.urlsafe_b64encode(b"not-json").decode()) is None
    # JSON ama payload anahtarları eksik
    assert decrypt_field(base64.urlsafe_b64encode(b"{}").decode()) is None
    # şifreli gövde bozulmuş (AES-GCM InvalidTag)
    payload = json.loads(base64.urlsafe_b64decode(encrypted.encode()))
    payload["c"] = ("B" if payload["c"][0] != "B" else "C") + payload["c"][1:]
    tampered = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    assert decrypt_field(tampered) is None
    # None/boş değerler aynen None kalır
    assert decrypt_field(None) is None
    assert decrypt_field("") is None
    # sağlam değer etkilenmez
    assert decrypt_field(encrypted) == "secret-cpr"


def test_mask_cpr():
    assert mask_cpr("1234567890") == "******7890"


def test_new_password_hash_uses_bcrypt_sha256_and_verifies_long_unicode() -> None:
    password = "Parola-" + "ü密码安全" * 80

    hashed = get_password_hash(password)

    assert hashed.startswith("$bcrypt-sha256$")
    assert verify_password(password, hashed)
    assert not verify_password(password + "-wrong", hashed)


def test_password_verification_keeps_legacy_bcrypt_rows_working() -> None:
    legacy_hash = bcrypt.hash("legacy-password")

    assert verify_password("legacy-password", legacy_hash)
    assert not verify_password("wrong-password", legacy_hash)


def test_unknown_or_malformed_password_hash_is_a_safe_auth_failure() -> None:
    for malformed in ("x", "", "$unknown$broken", "$2b$not-a-valid-bcrypt-hash"):
        assert verify_password("admin", malformed) is False
