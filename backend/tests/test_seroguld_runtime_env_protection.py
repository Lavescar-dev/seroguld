from __future__ import annotations

import os
import types
from pathlib import Path

import pytest

import seroguld_runtime


def test_acl_command_matches_installer_contract() -> None:
    command = seroguld_runtime._runtime_env_acl_command(Path("runtime.env"), "S-1-5-21-1000")
    assert command[0] == "icacls.exe"
    assert "/inheritance:r" in command
    for broad in ("*S-1-1-0", "*S-1-5-11", "*S-1-5-32-545"):
        assert broad in command
    grants = [command[index + 1] for index, part in enumerate(command) if part == "/grant:r"]
    assert grants == ["*S-1-5-18:F", "*S-1-5-32-544:F", "*S-1-5-21-1000:F"]


def test_sid_parse_survives_degenerate_token(monkeypatch: pytest.MonkeyPatch) -> None:
    # Makine/hesap adı tam olarak "S" olan Windows'ta whoami çıktısı "S"
    # token'ı üretir; Rust parse_windows_sid None döner, Python da asla
    # IndexError fırlatmamalı (prepare_runtime_environment çökmesin).
    def fake_run(*args, **kwargs):
        return types.SimpleNamespace(returncode=0, stdout='"S","S-1-5-21-100"\r\n')

    monkeypatch.setattr(seroguld_runtime.subprocess, "run", fake_run)
    assert seroguld_runtime._current_interactive_user_sid() == "S-1-5-21-100"

    def empty_run(*args, **kwargs):
        return types.SimpleNamespace(returncode=0, stdout="")

    monkeypatch.setattr(seroguld_runtime.subprocess, "run", empty_run)
    assert seroguld_runtime._current_interactive_user_sid() is None


def test_protection_is_noop_on_posix(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    if os.name == "nt":
        pytest.skip("POSIX no-op davranışı yalnız POSIX'te anlamlı")
    calls: list[tuple] = []
    monkeypatch.setattr(seroguld_runtime.subprocess, "run", lambda *args, **kwargs: calls.append(args))
    target = tmp_path / "runtime.env"
    target.write_text("A=1", encoding="utf-8")

    seroguld_runtime._protect_runtime_env_file(target)

    assert calls == []


def test_protection_applies_installer_acl_on_windows(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorded: dict[str, list[str]] = {}

    def fake_run(command, **kwargs):
        recorded["command"] = list(command)
        return types.SimpleNamespace(returncode=0)

    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.setattr(seroguld_runtime, "_current_interactive_user_sid", lambda: "S-1-5-21-7")
    monkeypatch.setattr(seroguld_runtime.subprocess, "run", fake_run)
    target = tmp_path / "runtime.env"
    target.write_text("A=1", encoding="utf-8")

    seroguld_runtime._protect_runtime_env_file(target)

    assert recorded["command"][0] == "icacls.exe"
    assert str(target) in recorded["command"]
    assert "*S-1-5-21-7:F" in recorded["command"]


def test_protection_failure_never_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.setattr(seroguld_runtime, "_current_interactive_user_sid", lambda: "S-1-5-21-7")

    def boom(*args, **kwargs):
        raise OSError("icacls bulunamadi")

    monkeypatch.setattr(seroguld_runtime.subprocess, "run", boom)
    target = tmp_path / "runtime.env"
    target.write_text("A=1", encoding="utf-8")
    seroguld_runtime._protect_runtime_env_file(target)

    monkeypatch.setattr(seroguld_runtime, "_current_interactive_user_sid", lambda: None)
    seroguld_runtime._protect_runtime_env_file(target)


def test_prepare_runtime_environment_reapplies_file_protection(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    protected: list[Path] = []
    monkeypatch.setattr(
        seroguld_runtime, "_protect_runtime_env_file", lambda path: protected.append(path)
    )
    monkeypatch.setenv("SEROGULD_PROGRAM_DATA", str(tmp_path))
    snapshot = dict(os.environ)
    try:
        paths = seroguld_runtime.prepare_runtime_environment()
    finally:
        os.environ.clear()
        os.environ.update(snapshot)

    assert paths.env_file.exists()
    assert protected == [paths.env_file]
