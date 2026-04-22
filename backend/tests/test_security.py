from app.utils.security import decrypt_field, encrypt_field, mask_cpr


def test_encrypt_decrypt_roundtrip():
    source = "test-secret"
    encrypted = encrypt_field(source)
    assert encrypted is not None
    assert decrypt_field(encrypted) == source


def test_mask_cpr():
    assert mask_cpr("1234567890") == "******7890"
