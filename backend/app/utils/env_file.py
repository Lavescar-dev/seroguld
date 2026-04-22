from __future__ import annotations

from pathlib import Path
import re


ENV_ASSIGNMENT_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")


def _quote_env_value(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def upsert_env_values(path: Path, updates: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []

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
    path.write_text(content, encoding="utf-8")

