from __future__ import annotations

import os
from pathlib import Path
import re


ENV_ASSIGNMENT_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")


def _quote_env_value(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def upsert_env_values(path: Path, updates: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig: BOM'lu dosyada ilk anahtarın "\ufeffKEY" okunup dosya sonuna
    # ikinci kez eklenmesini önler (Notepad/PS 5.1 Set-Content -Encoding UTF8
    # BOM'lu yazar).
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []

    key_to_idx: dict[str, int] = {}
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        matched = ENV_ASSIGNMENT_RE.match(line)
        if matched:
            key_to_idx[matched.group(1)] = idx

    for key, value in updates.items():
        rendered = f"{key}={_quote_env_value(value)}"
        if key in key_to_idx:
            lines[key_to_idx[key]] = rendered
        else:
            lines.append(rendered)

    content = "\n".join(lines).rstrip() + "\n"
    # Runtime configuration is a single-file store.  Publish a complete
    # replacement atomically so a concurrent settings read never sees a
    # truncated or half-updated credential/configuration file.
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8")
    try:
        with temporary.open("r+b") as handle:
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

    # Paketli çalışmada runtime.env açılışta os.environ'a kopyalanır ve
    # pydantic-settings'te env-var > dosya önceliği vardır: yalnız dosyayı
    # güncellemek, süreç yeniden başlatılana kadar ESKİ değerin görünmesine
    # yol açıyordu (hedefte firma adı mojibake'inin "yapışkan" kalma nedeni).
    # Yazılan anahtarlar süreç ortamına da uygulanır.
    for key, value in updates.items():
        os.environ[key] = value
