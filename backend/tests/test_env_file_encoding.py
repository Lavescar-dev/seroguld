from __future__ import annotations

import os

from app.utils.env_file import upsert_env_values


def test_danish_characters_roundtrip_and_environ_sync(tmp_path, monkeypatch) -> None:
    """Firma adı mojibake'inin iki bacağı: (1) UTF-8 round-trip bozulmamalı,
    (2) yazılan değer os.environ'a da uygulanmalı (env > dosya önceliği yüzünden
    aksi halde restart'a kadar eski değer görünür)."""
    env_path = tmp_path / "runtime.env"
    monkeypatch.delenv("INVOICE_SELLER_NAME", raising=False)

    upsert_env_values(env_path, {"INVOICE_SELLER_NAME": "Sero Guld og Sølv ApS"})

    raw = env_path.read_bytes()
    assert "Sølv".encode("utf-8") in raw
    assert os.environ["INVOICE_SELLER_NAME"] == "Sero Guld og Sølv ApS"

    # İkinci yazım: BOM'lu dosyayı da tolere eder, anahtar duplike olmaz.
    env_path.write_bytes(b"\xef\xbb\xbf" + raw)
    upsert_env_values(env_path, {"INVOICE_SELLER_NAME": "Sero Guld og S\u00f8lv ApS", "EXTRA": "x"})
    text = env_path.read_text(encoding="utf-8-sig")
    assert text.count("INVOICE_SELLER_NAME=") == 1
    assert "EXTRA=" in text
    monkeypatch.delenv("EXTRA", raising=False)


def test_settings_reflect_update_without_restart(tmp_path, monkeypatch) -> None:
    from app import config as config_module

    env_path = tmp_path / "runtime.env"
    monkeypatch.setattr(config_module, "ROOT_ENV_FILE", env_path)
    monkeypatch.delenv("INVOICE_SELLER_NAME", raising=False)

    upsert_env_values(env_path, {"INVOICE_SELLER_NAME": "Sero Guld og Sølv ApS"})
    config_module.get_settings.cache_clear()
    try:
        settings = config_module.get_settings()
        assert settings.invoice_seller_name == "Sero Guld og Sølv ApS"
    finally:
        monkeypatch.delenv("INVOICE_SELLER_NAME", raising=False)
        config_module.get_settings.cache_clear()
