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
