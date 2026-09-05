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


def test_multiline_value_is_escaped_and_keeps_file_parseable(tmp_path, monkeypatch) -> None:
    """Serbest metin alanına (ör. satır adresi) giren \\n dosyada gerçek satır
    sonuna dönüşmemeli: sonraki upsert'te ENV_ASSIGNMENT_RE anahtarı bulamaz,
    indeksler kayar ve duplicate anahtarlar oluşurdu. python-dotenv çift
    tırnak içindeki \\n kaçışını yüklerken geriye çevirir — dosya tek satır
    kalır, bellekteki değer korunur."""
    env_path = tmp_path / "runtime.env"
    monkeypatch.delenv("INVOICE_SELLER_ADDRESS_LINE1", raising=False)
    monkeypatch.delenv("INVOICE_SELLER_NAME", raising=False)

    upsert_env_values(
        env_path,
        {"INVOICE_SELLER_ADDRESS_LINE1": "Linje 1\nLinje 2\r\nLinje 3"},
    )

    raw = env_path.read_bytes()
    assert b"Linje 1\\nLinje 2\\r\\nLinje 3" in raw  # kaçışlı, tek satır
    # Kaçışsız ikinci yazım: dosya bozulmadan güncellenir, duplicate yok.
    upsert_env_values(
        env_path,
        {"INVOICE_SELLER_ADDRESS_LINE1": "Ny linje", "INVOICE_SELLER_NAME": "Sero ApS"},
    )
    text = env_path.read_text(encoding="utf-8-sig")
    assert text.count("INVOICE_SELLER_ADDRESS_LINE1=") == 1
    assert text.count("INVOICE_SELLER_NAME=") == 1

    # python-dotenv (pydantic-settings env_file) çift tırnaklı \n'i newline'a çevirir
    from dotenv import dotenv_values

    values = dotenv_values(env_path)
    assert values["INVOICE_SELLER_ADDRESS_LINE1"] == "Ny linje"
    monkeypatch.delenv("INVOICE_SELLER_ADDRESS_LINE1", raising=False)
    monkeypatch.delenv("INVOICE_SELLER_NAME", raising=False)
