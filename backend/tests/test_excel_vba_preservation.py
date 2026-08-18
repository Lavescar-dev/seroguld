from __future__ import annotations

import io
import zipfile
from pathlib import Path

from openpyxl import load_workbook

REFERENCE_ROOT = Path(__file__).resolve().parents[2] / "referans"
AFG_TEMPLATE = REFERENCE_ROOT / "Afregningsbilag ( alis frontumuz).xlsm"


def _zip_names(content: bytes) -> set[str]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return set(archive.namelist())


def test_xlsm_vba_project_survives_openpyxl_roundtrip() -> None:
    original = AFG_TEMPLATE.read_bytes()
    assert "xl/vbaProject.bin" in _zip_names(original)

    # AFG üretici/senkron yolu .xlsm'i keep_vba=True ile açıp kaydeder;
    # bu turda VBA projesi kaybolmamalı.
    workbook = load_workbook(io.BytesIO(original), keep_vba=True, data_only=False)
    buffer = io.BytesIO()
    workbook.save(buffer)
    workbook.close()

    assert "xl/vbaProject.bin" in _zip_names(buffer.getvalue())
