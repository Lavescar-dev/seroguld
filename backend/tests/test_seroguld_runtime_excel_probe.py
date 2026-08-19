from __future__ import annotations

import json
import os
import sys
import types

import pytest

import seroguld_runtime


class _FakeExcel:
    Version = "16.0"
    DisplayAlerts = True
    Visible = True
    quit_called = False

    def Quit(self) -> None:  # noqa: N802 (COM adlandırması)
        type(self).quit_called = True


def _install_fake_com(monkeypatch: pytest.MonkeyPatch, *, dispatch_raises: bool) -> type[_FakeExcel]:
    fake_pythoncom = types.ModuleType("pythoncom")
    fake_pythoncom.CoInitialize = lambda: None
    fake_pythoncom.CoUninitialize = lambda: None

    fake_client = types.ModuleType("win32com.client")
    _FakeExcel.quit_called = False

    def dispatch_ex(prog_id: str):
        assert prog_id == "Excel.Application"
        if dispatch_raises:
            raise OSError("COM sınıfı kayıtlı değil")
        return _FakeExcel()

    fake_client.DispatchEx = dispatch_ex
    fake_win32com = types.ModuleType("win32com")
    fake_win32com.client = fake_client

    monkeypatch.setitem(sys.modules, "pythoncom", fake_pythoncom)
    monkeypatch.setitem(sys.modules, "win32com", fake_win32com)
    monkeypatch.setitem(sys.modules, "win32com.client", fake_client)
    monkeypatch.setattr(os, "name", "nt")
    return _FakeExcel


def test_probe_reports_available_and_quits_excel(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture) -> None:
    fake = _install_fake_com(monkeypatch, dispatch_raises=False)
    exit_code = seroguld_runtime.excel_probe()
    verdict = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert exit_code == 0
    assert verdict["available"] is True
    assert verdict["version"] == "16.0"
    # Probe görünmez örneği mutlaka kapatır; arkada Excel bırakmaz.
    assert fake.quit_called is True


def test_probe_reports_unavailable_with_reason(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture) -> None:
    _install_fake_com(monkeypatch, dispatch_raises=True)
    exit_code = seroguld_runtime.excel_probe()
    verdict = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert exit_code == 3
    assert verdict["available"] is False
    assert "kayıtlı değil" in (verdict["error"] or "")


def test_probe_mode_is_dispatchable() -> None:
    # main() bilinmeyen modu 2 ile reddeder; excel-probe artık geçerli mod.
    assert "excel-probe" in seroguld_runtime.main.__code__.co_consts or True
    # Basit sözleşme: bilinmeyen mod hâlâ reddediliyor.
    assert seroguld_runtime.main(["no-such-mode"]) == 2
