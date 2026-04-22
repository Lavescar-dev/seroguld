from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable
from uuid import UUID

from openpyxl.cell.cell import MergedCell
from openpyxl import load_workbook
from openpyxl.styles import Protection
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ROOT_DIR, get_settings
from app.models.document_artifact import DocumentArtifact
from app.schemas.afg import (
    AfgClassification,
    AfgLogWorkspaceOut,
    AfgMeltLotCreateRequest,
    AfgMeltLotUpdateRequest,
    AfgRouteRequest,
    AfgWorkspaceDocumentOut,
    AfgWorkspaceLineOut,
)
from app.schemas.document_artifact import (
    DocumentArtifactCellChangeOut,
    DocumentArtifactEditableCellOut,
    DocumentArtifactPreviewOut,
    DocumentArtifactReconcilePreviewOut,
    DocumentArtifactRecordOut,
    DocumentArtifactSheetPreviewOut,
)
from app.schemas.inventory import InventoryMarketPricesUpdate, InventoryWorkspaceOut
from app.schemas.pos import (
    PosWorkspaceCalculatorsUpdate,
    PosDocumentDetailOut,
    PosWorkspaceCustomerUpdate,
    PosWorkspaceRateMatrixEntry,
    PosWorkspaceGoldRowOut,
    PosWorkspaceGoldRowInput,
    PosWorkspaceInvoiceGoldSheetUpdate,
    PosWorkspaceInvoiceMiscSheetUpdate,
    PosWorkspaceMarketRates,
    PosWorkspaceNumberingUpdate,
    PosWorkspaceOut,
    PosWorkspaceSectionsUpdate,
    PosWorkspaceSilverRowOut,
    PosWorkspaceSilverRowInput,
)
from app.schemas.product import ProductUpdate
from app.services import document_artifact_inventory, document_artifact_log
from app.utils.helpers import quantize_2, to_decimal, utc_now

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
XLSM_MIME = "application/vnd.ms-excel.sheet.macroEnabled.12"

SYNC_SHEET_NAME = "__SERO_SYNC"
SYNC_MAGIC = "SERO_SYNC_V1"
SYNC_CONTRACT_VERSION = "1"

AFG_TEMPLATE_NAME = "Afregningsbilag ( alis frontumuz).xlsm"
DEPOLAMA_TEMPLATE_NAME = "Depolama.xlsx"
LOG_TEMPLATE_NAME = "Log sistemi- afg verileri buraya yazdiriyorum..xlsx"

AFG_CONTRACT_VERSION = "afg-v1"
INVENTORY_CONTRACT_VERSION = "inventory-v1"
LOG_CONTRACT_VERSION = "log-v2"

AFG_GOLD_ROW_START = 22
AFG_SILVER_ROW_START = 30
AFG_FACTURA_GOLD_ROW_START = 25
AFG_FACTURA_GOLD_ROW_END = 37
AFG_FACTURA_GOLD_FOOTER_START = 38
AFG_FACTURA_MISC_ROW_START = 25
AFG_FACTURA_MISC_ROW_END = 39
AFG_GOLD_ROW_KEYS = ("gold:8", "gold:14", "gold:18", "gold:21", "gold:21.6", "gold:22", "gold:24")
AFG_SILVER_ROW_KEYS = ("silver:2", "silver:3", "silver:4", "silver:5")
AFG_PRIMARY_SHEET = "Afregningsbilag"
AFG_FACTURA_GOLD_SHEET = "Faktura guld og sølv"
AFG_FACTURA_MISC_SHEET = "Faktura diverse"
AFG_VARIABLES_SHEET = "Variable værdier"
AFG_GUIDE_SHEET = "Brugsanvisning"
AFG_SYSTEM_INPUT_SHEETS = {AFG_PRIMARY_SHEET, AFG_VARIABLES_SHEET, AFG_FACTURA_GOLD_SHEET, AFG_FACTURA_MISC_SHEET}
AFG_DERIVED_SHEETS: tuple[str, ...] = ()
INVENTORY_SHEET = "Lager"
LOG_SHEET = "Ark1"
LOG_CONTROL_SHEET = "Sero Control"

LOG_GOLD_LEDGER_START = 10
LOG_GOLD_LEDGER_END = 33
LOG_SILVER_LEDGER_START = 58
LOG_SILVER_LEDGER_END = 87
LOG_ROUTE_CODE_OPTIONS = ("-", "S", "H", "D", "M")

AFG_CUSTOMER_EDITABLE_CELLS = (
    {"cell_ref": "C16", "label": "Müşteri Adı", "input_kind": "text", "field": "name"},
    {"cell_ref": "F16", "label": "CPR", "input_kind": "text", "field": "cpr_number"},
    {"cell_ref": "C17", "label": "Adres", "input_kind": "text", "field": "address"},
    {"cell_ref": "F17", "label": "Kimlik / Pas", "input_kind": "text", "field": "identity_doc_number"},
    {"cell_ref": "C18", "label": "Posta Kodu", "input_kind": "text", "field": "postal_code"},
    {"cell_ref": "F18", "label": "Telefon", "input_kind": "text", "field": "phone"},
    {"cell_ref": "F19", "label": "E-mail", "input_kind": "text", "field": "email"},
)

AFG_SUMMARY_EDITABLE_CELLS = (
    {"cell_ref": "C40", "label": "Ödeme Yöntemi", "input_kind": "payment_method", "field": "payment_method"},
    {"cell_ref": "D41", "label": "Reg. Nr.", "input_kind": "text", "field": "reg_number"},
    {"cell_ref": "D42", "label": "Kontonr.", "input_kind": "text", "field": "account_number"},
)

AFG_VARIABLE_EDITABLE_CELLS = (
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "C10", "label": "EUR / DKK FX", "input_kind": "decimal", "field": "market_rates:eur_dkk_fx"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "C4", "label": "Au 24K DKK", "input_kind": "decimal", "field": "market_rates:gold_24k_dkk"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "C5", "label": "Ag DKK", "input_kind": "decimal", "field": "market_rates:silver_dkk"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I4", "label": "Gold 8K EUR/g", "input_kind": "decimal", "field": "market_rates:gold_rates_eur:8"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I5", "label": "Gold 14K EUR/g", "input_kind": "decimal", "field": "market_rates:gold_rates_eur:14"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I6", "label": "Gold 18K EUR/g", "input_kind": "decimal", "field": "market_rates:gold_rates_eur:18"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I7", "label": "Gold 21K EUR/g", "input_kind": "decimal", "field": "market_rates:gold_rates_eur:21"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I8", "label": "Gold 21.6K EUR/g", "input_kind": "decimal", "field": "market_rates:gold_rates_eur:21.6"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I9", "label": "Gold 22K EUR/g", "input_kind": "decimal", "field": "market_rates:gold_rates_eur:22"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I10", "label": "Gold 24K EUR/g", "input_kind": "decimal", "field": "market_rates:gold_rates_eur:24"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I11", "label": "Silver 999 EUR/g", "input_kind": "decimal", "field": "market_rates:silver_rates_eur:999"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I12", "label": "Silver 925 EUR/g", "input_kind": "decimal", "field": "market_rates:silver_rates_eur:925"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I13", "label": "Silver 830 EUR/g", "input_kind": "decimal", "field": "market_rates:silver_rates_eur:830"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "I14", "label": "Silver 800 EUR/g", "input_kind": "decimal", "field": "market_rates:silver_rates_eur:800"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "C14", "label": "Afregningsnr.", "input_kind": "text", "field": "numbering:afregnings_number_next"},
    {"sheet": AFG_VARIABLES_SHEET, "cell_ref": "D14", "label": "Fakturanr.", "input_kind": "text", "field": "numbering:invoice_number_next"},
)

AFG_VARIABLE_MATRIX_ROWS = (
    ("I4", "J4", "K4", "Gold 8K", "333"),
    ("I5", "J5", "K5", "Gold 14K", "585"),
    ("I6", "J6", "K6", "Gold 18K", "750"),
    ("I7", "J7", "K7", "Gold 21K", "875"),
    ("I8", "J8", "K8", "Gold 21.6K", "900"),
    ("I9", "J9", "K9", "Gold 22K", "917"),
    ("I10", "J10", "K10", "Gold 24K", "999"),
    ("I11", "J11", "K11", "Finsølv", "999"),
    ("I12", "J12", "K12", "Sterling sølv", "925"),
    ("I13", "J13", "K13", "3 tårnet sølv", "830"),
    ("I14", "J14", "K14", "Sølv", "800"),
)

AFG_GOLD_CALCULATOR_ROWS = (
    ("calc_gold:1", "J22", "K22", "L22"),
    ("calc_gold:2", "J23", "K23", "L23"),
    ("calc_gold:3", "J24", "K24", "L24"),
    ("calc_gold:4", "J25", "K25", "L25"),
    ("calc_gold:5", "J26", "K26", "L26"),
)

AFG_SILVER_CALCULATOR_ROWS = (
    ("calc_silver:1", "J32", "K32", "L32"),
    ("calc_silver:2", "J33", "K33", "L33"),
    ("calc_silver:3", "J34", "K34", "L34"),
    ("calc_silver:4", "J35", "K35", "L35"),
    ("calc_silver:5", "J36", "K36", "L36"),
    ("calc_silver:6", "J37", "K37", "L37"),
)


def _afg_row_editable_cells() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for offset, row_key in enumerate(AFG_GOLD_ROW_KEYS, start=AFG_GOLD_ROW_START):
        karat = row_key.split(":", 1)[1]
        rows.append({"cell_ref": f"B{offset}", "label": f"Guld {karat}k Avance %", "input_kind": "percent", "field": f"{row_key}:avance"})
        rows.append({"cell_ref": f"F{offset}", "label": f"Guld {karat}k Gram", "input_kind": "decimal", "field": f"{row_key}:gram"})
    for offset, row_key in enumerate(AFG_SILVER_ROW_KEYS, start=AFG_SILVER_ROW_START):
        type_code = row_key.split(":", 1)[1]
        rows.append({"cell_ref": f"B{offset}", "label": f"Gümüş {type_code} Avance %", "input_kind": "percent", "field": f"{row_key}:avance"})
        rows.append({"cell_ref": f"F{offset}", "label": f"Gümüş {type_code} Gram", "input_kind": "decimal", "field": f"{row_key}:gram"})
    return rows


def _afg_factura_gold_editable_cells() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for index, row_idx in enumerate(range(AFG_FACTURA_GOLD_ROW_START, AFG_FACTURA_GOLD_ROW_END + 1), start=1):
        row_key = f"invoice_gold:{index}"
        rows.extend(
            [
                {"sheet": AFG_FACTURA_GOLD_SHEET, "cell_ref": f"A{row_idx}", "label": f"Faktura G/S satir {index} kod", "input_kind": "text", "field": f"{row_key}:code"},
                {"sheet": AFG_FACTURA_GOLD_SHEET, "cell_ref": f"C{row_idx}", "label": f"Faktura G/S satir {index} finhed", "input_kind": "text", "field": f"{row_key}:fineness"},
                {"sheet": AFG_FACTURA_GOLD_SHEET, "cell_ref": f"E{row_idx}", "label": f"Faktura G/S satir {index} gram", "input_kind": "decimal", "field": f"{row_key}:gram"},
            ]
        )
    for index, row_idx in enumerate(range(AFG_FACTURA_GOLD_FOOTER_START, AFG_FACTURA_GOLD_FOOTER_START + 3), start=1):
        rows.append(
            {
                "sheet": AFG_FACTURA_GOLD_SHEET,
                "cell_ref": f"B{row_idx}",
                "label": f"Faktura G/S serbest metin {index}",
                "input_kind": "text",
                "field": f"invoice_gold_footer:{index}",
            }
        )
    return rows


def _afg_factura_misc_editable_cells() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for index, row_idx in enumerate(range(AFG_FACTURA_MISC_ROW_START, AFG_FACTURA_MISC_ROW_END + 1), start=1):
        row_key = f"invoice_misc:{index}"
        rows.extend(
            [
                {"sheet": AFG_FACTURA_MISC_SHEET, "cell_ref": f"C{row_idx}", "label": f"Faktura diverse satir {index} metin", "input_kind": "text", "field": f"{row_key}:text"},
                {"sheet": AFG_FACTURA_MISC_SHEET, "cell_ref": f"E{row_idx}", "label": f"Faktura diverse satir {index} adet", "input_kind": "decimal", "field": f"{row_key}:quantity"},
                {"sheet": AFG_FACTURA_MISC_SHEET, "cell_ref": f"F{row_idx}", "label": f"Faktura diverse satir {index} birim fiyat", "input_kind": "decimal", "field": f"{row_key}:unit_price_dkk"},
            ]
        )
    return rows


def _afg_calculator_editable_cells() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for row_key, unit_cell, count_cell, _total_cell in AFG_GOLD_CALCULATOR_ROWS:
        rows.append({"cell_ref": unit_cell, "label": f"{row_key} birim agirlik", "input_kind": "decimal", "field": f"{row_key}:unit_weight"})
        rows.append({"cell_ref": count_cell, "label": f"{row_key} adet", "input_kind": "decimal", "field": f"{row_key}:count"})
    for row_key, unit_cell, count_cell, _total_cell in AFG_SILVER_CALCULATOR_ROWS:
        rows.append({"cell_ref": unit_cell, "label": f"{row_key} birim agirlik", "input_kind": "decimal", "field": f"{row_key}:unit_weight"})
        rows.append({"cell_ref": count_cell, "label": f"{row_key} adet", "input_kind": "decimal", "field": f"{row_key}:count"})
    return rows


AFG_EDITABLE_CELLS = (
    *AFG_CUSTOMER_EDITABLE_CELLS,
    *AFG_SUMMARY_EDITABLE_CELLS,
    *AFG_VARIABLE_EDITABLE_CELLS,
    *_afg_row_editable_cells(),
    *_afg_calculator_editable_cells(),
    *_afg_factura_gold_editable_cells(),
    *_afg_factura_misc_editable_cells(),
)
AFG_EDITABLE_CELL_MAP = {cell["cell_ref"]: cell for cell in AFG_EDITABLE_CELLS}


def office_contract_version_for_kind(kind: str) -> str:
    if kind in {"alis-workspace", "alis-document"}:
        return AFG_CONTRACT_VERSION
    if kind == "depolama":
        return INVENTORY_CONTRACT_VERSION
    if kind == "log":
        return LOG_CONTRACT_VERSION
    return SYNC_CONTRACT_VERSION


@dataclass(slots=True)
class AfgWorkspaceArtifactInputs:
    customer: PosWorkspaceCustomerUpdate
    sections: PosWorkspaceSectionsUpdate
    normalized_values: dict[str, str]
    base_version: str | None = None


@dataclass(slots=True)
class SyncSheetRowMapping:
    mapping_type: str
    sheet_name: str
    row_index: int
    entity_id: str
    entity_key: str | None = None
    extra: dict[str, Any] | None = None


@dataclass(slots=True)
class SyncSheetMetadata:
    kind: str
    key: str
    artifact_key: str
    base_version: str | None
    contract_version: str
    mappings: list[SyncSheetRowMapping]


@dataclass(slots=True)
class ArtifactSyncContext:
    kind: str
    key: str
    artifact_key: str
    base_version: str
    contract_version: str = SYNC_CONTRACT_VERSION
    mappings: list[SyncSheetRowMapping] | None = None


@dataclass(slots=True)
class InventoryWorkbookArtifactInputs:
    market_prices: InventoryMarketPricesUpdate
    product_updates: dict[UUID, ProductUpdate]
    base_version: str | None = None


@dataclass(slots=True)
class LogWorkbookRouteEdit:
    line_id: UUID
    payload: AfgRouteRequest


@dataclass(slots=True)
class LogWorkbookLotCreate:
    metal_bucket: str
    create_payload: AfgMeltLotCreateRequest
    update_payload: AfgMeltLotUpdateRequest


@dataclass(slots=True)
class LogWorkbookLotUpdate:
    lot_id: UUID
    payload: AfgMeltLotUpdateRequest


@dataclass(slots=True)
class LogWorkbookArtifactInputs:
    route_updates: list[LogWorkbookRouteEdit]
    lot_creates: list[LogWorkbookLotCreate]
    lot_updates: list[LogWorkbookLotUpdate]
    base_version: str | None = None


def _clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text in {"—", "–", "-"}:
        return None
    return text or None


def _decimal_from_excel(value: object) -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    return quantize_2(to_decimal(value))


def _decimal4_from_excel(value: object) -> Decimal:
    if value is None or value == "":
        return Decimal("0.0000")
    return _quantize_4(to_decimal(value))


def _percent_from_excel(value: object) -> Decimal:
    amount = _decimal_from_excel(value)
    if Decimal("0") <= amount <= Decimal("1"):
        return quantize_2(amount * Decimal("100"))
    return quantize_2(amount)


def _payment_method_from_excel(value: object) -> str:
    text = (str(value or "")).strip().lower()
    if "kontant" in text:
        return "cash"
    return "bank"


def _normalized_cell_value(value: object, *, input_kind: str) -> str:
    if input_kind == "percent":
        return _fmt_decimal(_percent_from_excel(value))
    if input_kind == "decimal":
        return _fmt_decimal(_decimal_from_excel(value))
    if input_kind == "payment_method":
        return "Kontant" if _payment_method_from_excel(value) == "cash" else "Overførsel"
    return _clean_text(value) or "—"


def _editable_cell_out(cell: dict[str, str]) -> DocumentArtifactEditableCellOut:
    return DocumentArtifactEditableCellOut(
        sheet=cell.get("sheet", AFG_PRIMARY_SHEET),
        cell_ref=cell["cell_ref"],
        label=cell["label"],
        input_kind=cell["input_kind"],
    )


def _afg_editable_cell_key(cell: dict[str, str]) -> str:
    return f"{cell.get('sheet', AFG_PRIMARY_SHEET)}!{cell['cell_ref']}"


@dataclass(slots=True)
class WorkbookArtifactBundle:
    artifact: DocumentArtifact
    content: bytes


def _document_root() -> Path:
    root = get_settings().document_root_path()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _reference_root() -> Path:
    return ROOT_DIR / "referans"


def _template_path(template_name: str) -> Path:
    path = _reference_root() / template_name
    if not path.exists():
        raise FileNotFoundError(f"Referans workbook bulunamadı: {template_name}")
    return path


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _fmt_decimal(value: Decimal | str | int | float | None, places: str = "0.00") -> str:
    amount = quantize_2(to_decimal(value or 0))
    if places == "0":
        return f"{amount.quantize(Decimal('1'))}"
    return f"{amount.quantize(Decimal(places))}"


def _quantize_4(value: Decimal | str | int | float | None) -> Decimal:
    return to_decimal(value or 0).quantize(Decimal("0.0001"))


def _fmt_optional_decimal(value: Decimal | str | int | float | None, places: str = "0.00") -> str:
    if value is None or value == "":
        return ""
    return _fmt_decimal(value, places=places)


def _fmt_date(value: datetime | str | None) -> str:
    if value is None:
        return "—"
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value.strftime("%d.%m.%Y")


def _excel_datetime(value: datetime | str | None):
    if value is None or isinstance(value, str):
        return value
    if value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


def _relative_storage_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(_document_root()).as_posix()
    except ValueError:
        return path.name


def _record_out(record: DocumentArtifact) -> DocumentArtifactRecordOut:
    return DocumentArtifactRecordOut(
        id=record.id,
        artifact_key=record.artifact_key,
        module_name=record.module_name,
        document_type=record.document_type,
        business_key=record.business_key,
        version_kind=record.version_kind,
        is_live=record.is_live,
        file_name=record.file_name,
        mime_type=record.mime_type,
        template_name=record.template_name,
        size_bytes=record.size_bytes,
        updated_at=record.updated_at,
    )


def _artifact_version_token(value: datetime | None) -> str:
    stamp = value or utc_now()
    return str(int(stamp.timestamp() * 1000))


def _set_cell_unlocked(sheet, cell_ref: str) -> None:
    cell = sheet[cell_ref]
    if isinstance(cell, MergedCell):
        return
    cell.protection = Protection(locked=False)


def _sync_sheet(workbook):
    if SYNC_SHEET_NAME in workbook.sheetnames:
        sheet = workbook[SYNC_SHEET_NAME]
        sheet.sheet_state = "hidden"
        return sheet
    sheet = workbook.create_sheet(SYNC_SHEET_NAME)
    sheet.sheet_state = "hidden"
    return sheet


def _write_sync_sheet(workbook, *, context: ArtifactSyncContext) -> None:
    sheet = _sync_sheet(workbook)
    for row_idx in range(1, max(sheet.max_row, 64) + 1):
        for col in ("A", "B", "C", "D", "E", "F"):
            _set_sheet_cell(sheet, f"{col}{row_idx}", None)
    _set_sheet_cell(sheet, "A1", "magic")
    _set_sheet_cell(sheet, "B1", SYNC_MAGIC)
    _set_sheet_cell(sheet, "A2", "kind")
    _set_sheet_cell(sheet, "B2", context.kind)
    _set_sheet_cell(sheet, "A3", "key")
    _set_sheet_cell(sheet, "B3", context.key)
    _set_sheet_cell(sheet, "A4", "artifact_key")
    _set_sheet_cell(sheet, "B4", context.artifact_key)
    _set_sheet_cell(sheet, "A5", "base_version")
    _set_sheet_cell(sheet, "B5", context.base_version)
    _set_sheet_cell(sheet, "A6", "contract_version")
    _set_sheet_cell(sheet, "B6", context.contract_version)
    _set_sheet_cell(sheet, "A8", "mapping_type")
    _set_sheet_cell(sheet, "B8", "sheet")
    _set_sheet_cell(sheet, "C8", "row_index")
    _set_sheet_cell(sheet, "D8", "entity_id")
    _set_sheet_cell(sheet, "E8", "entity_key")
    _set_sheet_cell(sheet, "F8", "extra_json")
    for offset, mapping in enumerate(context.mappings or [], start=9):
        _set_sheet_cell(sheet, f"A{offset}", mapping.mapping_type)
        _set_sheet_cell(sheet, f"B{offset}", mapping.sheet_name)
        _set_sheet_cell(sheet, f"C{offset}", mapping.row_index)
        _set_sheet_cell(sheet, f"D{offset}", mapping.entity_id)
        _set_sheet_cell(sheet, f"E{offset}", mapping.entity_key)
        _set_sheet_cell(sheet, f"F{offset}", json.dumps(mapping.extra or {}, ensure_ascii=True, sort_keys=True))


def _read_sync_sheet(workbook) -> SyncSheetMetadata:
    if SYNC_SHEET_NAME not in workbook.sheetnames:
        raise ValueError("Workbook sync metadata bulunamadı")
    sheet = workbook[SYNC_SHEET_NAME]
    magic = _clean_text(sheet["B1"].value)
    if magic != SYNC_MAGIC:
        raise ValueError("Workbook sync metadata geçersiz")
    mappings: list[SyncSheetRowMapping] = []
    row_idx = 9
    while True:
        mapping_type = _clean_text(sheet[f"A{row_idx}"].value)
        if mapping_type is None:
            break
        sheet_name = _clean_text(sheet[f"B{row_idx}"].value)
        row_value = sheet[f"C{row_idx}"].value
        entity_id = _clean_text(sheet[f"D{row_idx}"].value)
        entity_key = _clean_text(sheet[f"E{row_idx}"].value)
        extra_raw = _clean_text(sheet[f"F{row_idx}"].value)
        if sheet_name is None or row_value is None or entity_id is None:
            raise ValueError("Workbook sync satırı eksik")
        mappings.append(
            SyncSheetRowMapping(
                mapping_type=mapping_type,
                sheet_name=sheet_name,
                row_index=int(to_decimal(row_value)),
                entity_id=entity_id,
                entity_key=entity_key,
                extra=json.loads(extra_raw) if extra_raw else {},
            )
        )
        row_idx += 1
    return SyncSheetMetadata(
        kind=_clean_text(sheet["B2"].value) or "",
        key=_clean_text(sheet["B3"].value) or "",
        artifact_key=_clean_text(sheet["B4"].value) or "",
        base_version=_clean_text(sheet["B5"].value),
        contract_version=_clean_text(sheet["B6"].value) or SYNC_CONTRACT_VERSION,
        mappings=mappings,
    )


def _require_sync_metadata(workbook, *, expected_kind: str, expected_key: str) -> SyncSheetMetadata:
    metadata = _read_sync_sheet(workbook)
    if metadata.kind != expected_kind or metadata.key != expected_key:
        raise ValueError("Workbook farklı bir belgeye ait")
    return metadata


def _sync_metadata_if_present(workbook, *, expected_kind: str, expected_key: str) -> SyncSheetMetadata | None:
    if SYNC_SHEET_NAME not in workbook.sheetnames:
        return None
    return _require_sync_metadata(workbook, expected_kind=expected_kind, expected_key=expected_key)


async def _upsert_record(
    session: AsyncSession,
    *,
    artifact_key: str,
    module_name: str,
    document_type: str,
    business_key: str,
    version_kind: str,
    is_live: bool,
    file_name: str,
    file_path: Path,
    mime_type: str,
    template_name: str | None,
    content: bytes,
    updated_at: datetime | None = None,
) -> DocumentArtifact:
    checksum = _sha256(content)
    record = await session.scalar(select(DocumentArtifact).where(DocumentArtifact.artifact_key == artifact_key))
    if record is None:
        record = DocumentArtifact(
            artifact_key=artifact_key,
            module_name=module_name,
            document_type=document_type,
            business_key=business_key,
            version_kind=version_kind,
            is_live=is_live,
            file_name=file_name,
            file_path=_relative_storage_path(file_path),
            mime_type=mime_type,
            template_name=template_name,
            size_bytes=len(content),
            checksum_sha256=checksum,
        )
        if updated_at is not None:
            record.updated_at = updated_at
        session.add(record)
    else:
        next_file_path = _relative_storage_path(file_path)
        changed = any(
            (
                record.module_name != module_name,
                record.document_type != document_type,
                record.business_key != business_key,
                record.version_kind != version_kind,
                record.is_live != is_live,
                record.file_name != file_name,
                record.file_path != next_file_path,
                record.mime_type != mime_type,
                record.template_name != template_name,
                record.size_bytes != len(content),
                record.checksum_sha256 != checksum,
            )
        )
        record.module_name = module_name
        record.document_type = document_type
        record.business_key = business_key
        record.version_kind = version_kind
        record.is_live = is_live
        record.file_name = file_name
        record.file_path = next_file_path
        record.mime_type = mime_type
        record.template_name = template_name
        record.size_bytes = len(content)
        record.checksum_sha256 = checksum
        if changed and updated_at is not None:
            record.updated_at = updated_at
    await session.flush()
    await session.refresh(record)
    return record


async def _store_artifact(
    session: AsyncSession,
    *,
    artifact_key: str,
    module_name: str,
    document_type: str,
    business_key: str,
    version_kind: str,
    is_live: bool,
    file_name: str,
    relative_path: Path,
    mime_type: str,
    template_name: str | None,
    content: bytes,
    updated_at: datetime | None = None,
) -> WorkbookArtifactBundle:
    absolute_path = _document_root() / relative_path
    absolute_path.parent.mkdir(parents=True, exist_ok=True)
    absolute_path.write_bytes(content)
    record = await _upsert_record(
        session,
        artifact_key=artifact_key,
        module_name=module_name,
        document_type=document_type,
        business_key=business_key,
        version_kind=version_kind,
        is_live=is_live,
        file_name=file_name,
        file_path=absolute_path,
        mime_type=mime_type,
        template_name=template_name,
        content=content,
        updated_at=updated_at,
    )
    return WorkbookArtifactBundle(artifact=record, content=content)


async def list_artifact_records(
    session: AsyncSession,
    *,
    module_name: str,
    document_type: str,
    business_key: str | None = None,
    version_kind: str | None = None,
    limit: int = 20,
) -> list[DocumentArtifactRecordOut]:
    stmt = (
        select(DocumentArtifact)
        .where(DocumentArtifact.module_name == module_name, DocumentArtifact.document_type == document_type)
        .order_by(DocumentArtifact.updated_at.desc())
        .limit(limit)
    )
    if business_key is not None:
        stmt = stmt.where(DocumentArtifact.business_key == business_key)
    if version_kind is not None:
        stmt = stmt.where(DocumentArtifact.version_kind == version_kind)
    rows = (await session.scalars(stmt)).all()
    return [_record_out(row) for row in rows]


async def get_artifact_record(session: AsyncSession, artifact_key: str) -> DocumentArtifact | None:
    return await session.scalar(select(DocumentArtifact).where(DocumentArtifact.artifact_key == artifact_key))


def artifact_absolute_path(record: DocumentArtifact) -> Path:
    return _document_root() / record.file_path


def _open_template(template_name: str, *, keep_vba: bool = False):
    return load_workbook(_template_path(template_name), keep_vba=keep_vba, data_only=False)


def _touch_calc_flags(workbook) -> None:
    calculation = getattr(workbook, "calculation", None)
    if calculation is not None:
        setattr(calculation, "fullCalcOnLoad", True)
        setattr(calculation, "forceFullCalc", True)


def _save_workbook_bytes(workbook) -> bytes:
    payload = io.BytesIO()
    workbook.save(payload)
    return payload.getvalue()


def _sheet_row(label: str, value: str) -> list[str]:
    return [label, value]


def _set_sheet_cell(sheet, cell_ref: str, value) -> None:
    cell = sheet[cell_ref]
    if isinstance(cell, MergedCell):
        return
    cell.value = value


def _protect_sheet(sheet, *, editable_refs: Iterable[str] = ()) -> None:
    sheet.protection.sheet = True
    sheet.protection.enable()
    for cell_ref in editable_refs:
        _set_cell_unlocked(sheet, cell_ref)


def _stringify(value: object) -> str:
    if value is None:
        return "—"
    if isinstance(value, Decimal):
        return _fmt_decimal(value)
    return str(value)


def _normalized_customer_name(name: str | None) -> str:
    text = (name or "").strip()
    return text or "—"


def _afg_contract_sheet(
    name: str,
    *,
    mode: str,
    system_sync: bool,
    note: str,
    columns: list[str] | None = None,
    rows: list[list[str]] | None = None,
) -> DocumentArtifactSheetPreviewOut:
    return DocumentArtifactSheetPreviewOut(
        name=name,
        mode=mode,
        system_sync=system_sync,
        columns=columns or [],
        rows=rows or [],
        note=note,
    )


def _apply_afg_sheet_modes(workbook, *, can_write: bool) -> None:
    editable_by_sheet: dict[str, list[str]] = {}
    for cell in AFG_EDITABLE_CELLS:
        sheet_name = cell.get("sheet", AFG_PRIMARY_SHEET)
        editable_by_sheet.setdefault(sheet_name, []).append(cell["cell_ref"])
    for sheet_name in workbook.sheetnames:
        sheet = workbook[sheet_name]
        if sheet_name == SYNC_SHEET_NAME:
            sheet.sheet_state = "hidden"
            continue
        is_controlled = sheet_name in AFG_SYSTEM_INPUT_SHEETS
        if can_write and is_controlled:
            _protect_sheet(sheet, editable_refs=editable_by_sheet.get(sheet_name, ()))
        else:
            _protect_sheet(sheet)
    if AFG_PRIMARY_SHEET in workbook.sheetnames:
        workbook.active = workbook.sheetnames.index(AFG_PRIMARY_SHEET)


def _afg_gold_rows_from_workspace(workspace: PosWorkspaceOut) -> list[PosWorkspaceGoldRowOut]:
    ordered = {row.row_key: row for row in workspace.gold_rows}
    return [ordered[key] for key in AFG_GOLD_ROW_KEYS if key in ordered]


def _afg_silver_rows_from_workspace(workspace: PosWorkspaceOut) -> list[PosWorkspaceSilverRowOut]:
    ordered = {row.row_key: row for row in workspace.silver_rows}
    return [ordered[key] for key in AFG_SILVER_ROW_KEYS if key in ordered]


def _aggregate_detail_gold_rows(detail: PosDocumentDetailOut) -> list[dict[str, Decimal | str]]:
    rows: dict[str, dict[str, Decimal | str]] = {
        key: {
            "row_key": key,
            "label": f"Guld {key.split(':', 1)[1]}k" if key != "gold:21.6" else "Guld 21.6k",
            "karat": Decimal(key.split(":", 1)[1]),
            "lodighed": "—",
            "gram": Decimal("0.00"),
            "avance_percent": Decimal("0.00"),
            "unit_price_dkk": Decimal("0.00"),
            "line_total_dkk": Decimal("0.00"),
        }
        for key in AFG_GOLD_ROW_KEYS
    }
    purity_to_key = {
        Decimal("8"): "gold:8",
        Decimal("14"): "gold:14",
        Decimal("18"): "gold:18",
        Decimal("21"): "gold:21",
        Decimal("21.6"): "gold:21.6",
        Decimal("22"): "gold:22",
        Decimal("24"): "gold:24",
    }
    for line in detail.lines:
        if str(line.metal_type or "").lower() != "yellow_gold":
            continue
        karat = to_decimal(line.purity_karat.replace("K", "").replace("k", "")) if line.purity_karat else Decimal("0")
        row_key = purity_to_key.get(karat)
        if row_key is None:
            continue
        row = rows[row_key]
        gram = to_decimal(line.weight_grams or 0)
        line_total = to_decimal(line.line_total_dkk or 0)
        row["gram"] = quantize_2(to_decimal(row["gram"]) + gram)
        row["line_total_dkk"] = quantize_2(to_decimal(row["line_total_dkk"]) + line_total)
        row["unit_price_dkk"] = quantize_2(line_total / gram) if gram > 0 else to_decimal(row["unit_price_dkk"])
        row["lodighed"] = str(int(to_decimal(line.purity_percentage or 0) * Decimal("10")))
        row["avance_percent"] = quantize_2(to_decimal(line.margin_percent or 0))
    return [rows[key] for key in AFG_GOLD_ROW_KEYS]


def _aggregate_detail_silver_rows(detail: PosDocumentDetailOut) -> list[dict[str, Decimal | str]]:
    silver_defs = {
        "silver:2": ("2", "Finsølv999‰", "999", Decimal("99.90")),
        "silver:3": ("3", "Sterling sølv925‰", "925", Decimal("92.50")),
        "silver:4": ("4", "3 tårnet sølv830‰", "830", Decimal("83.00")),
        "silver:5": ("5", "Sølv800‰", "800", Decimal("80.00")),
    }
    rows: dict[str, dict[str, Decimal | str]] = {
        key: {
            "row_key": key,
            "type_code": type_code,
            "label": label,
            "lodighed": lodighed,
            "gram": Decimal("0.00"),
            "avance_percent": Decimal("0.00"),
            "unit_price_dkk": Decimal("0.00"),
            "line_total_dkk": Decimal("0.00"),
        }
        for key, (type_code, label, lodighed, _purity) in silver_defs.items()
    }
    purity_to_key = {
        Decimal("99.90"): "silver:2",
        Decimal("92.50"): "silver:3",
        Decimal("83.00"): "silver:4",
        Decimal("80.00"): "silver:5",
    }
    for line in detail.lines:
        if str(line.metal_type or "").lower() != "silver":
            continue
        key = purity_to_key.get(quantize_2(to_decimal(line.purity_percentage or 0)))
        if key is None:
            continue
        row = rows[key]
        gram = to_decimal(line.weight_grams or 0)
        line_total = to_decimal(line.line_total_dkk or 0)
        row["gram"] = quantize_2(to_decimal(row["gram"]) + gram)
        row["line_total_dkk"] = quantize_2(to_decimal(row["line_total_dkk"]) + line_total)
        row["unit_price_dkk"] = quantize_2(line_total / gram) if gram > 0 else to_decimal(row["unit_price_dkk"])
        row["avance_percent"] = quantize_2(to_decimal(line.margin_percent or 0))
    return [rows[key] for key in AFG_SILVER_ROW_KEYS]


def _apply_afg_customer_cells(
    sheet,
    *,
    name: str | None,
    cpr_number: str | None,
    address: str | None,
    city: str | None,
    postal_code: str | None,
    phone: str | None,
    email: str | None,
    identity_doc: str | None = None,
) -> None:
    address_line = _compose_afg_address_line(address, city)
    sheet["C16"] = name or "—"
    sheet["F16"] = cpr_number or "—"
    sheet["C17"] = address_line or "—"
    sheet["F17"] = identity_doc or "—"
    sheet["C18"] = postal_code or "—"
    sheet["F18"] = phone or "—"
    sheet["F19"] = email or "—"


def _compose_afg_address_line(address: str | None, city: str | None) -> str | None:
    address_text = str(address or "").strip()
    city_text = str(city or "").strip()
    if address_text and city_text:
        return f"{address_text} · {city_text}"
    return address_text or city_text or None


def _split_afg_address_line(value: object) -> tuple[str | None, str | None]:
    text = _clean_text(value)
    if text is None:
        return None, None
    if " · " in text:
        address, city = text.rsplit(" · ", 1)
        return str(address).strip() or None, str(city).strip() or None
    return text, None


def _build_afg_market_rates_from_workspace(market_rates: PosWorkspaceMarketRates) -> PosWorkspaceMarketRates:
    fx = quantize_2(to_decimal(market_rates.eur_dkk_fx))
    gold_rates_eur = {str(key): _quantize_4(to_decimal(value)) for key, value in (market_rates.gold_rates_eur or {}).items()}
    silver_rates_eur = {str(key): _quantize_4(to_decimal(value)) for key, value in (market_rates.silver_rates_eur or {}).items()}
    gold_24k_dkk = quantize_2(
        to_decimal(market_rates.gold_24k_dkk or (gold_rates_eur.get("24", Decimal("0.00")) * fx))
    )
    silver_dkk = quantize_2(
        to_decimal(market_rates.silver_dkk or (silver_rates_eur.get("999", Decimal("0.00")) * fx))
    )
    gold_matrix = [
        PosWorkspaceRateMatrixEntry(
            row_key=f"gold:{key}",
            label=f"{key}K",
            lodighed=lodighed,
            eur_per_gram=gold_rates_eur.get(key, Decimal("0.00")),
            dkk_per_gram=quantize_2(gold_rates_eur.get(key, Decimal("0.00")) * fx),
            karat=to_decimal(key),
            type_code="1",
        )
        for key, lodighed in (("8", "333"), ("14", "585"), ("18", "750"), ("21", "875"), ("21.6", "900"), ("22", "917"), ("24", "999"))
    ]
    silver_matrix = [
        PosWorkspaceRateMatrixEntry(
            row_key=f"silver:{type_code}",
            label=label,
            lodighed=lodighed,
            eur_per_gram=silver_rates_eur.get(lodighed, Decimal("0.00")),
            dkk_per_gram=quantize_2(silver_rates_eur.get(lodighed, Decimal("0.00")) * fx),
            karat=None,
            type_code=type_code,
        )
        for type_code, label, lodighed in (("2", "Finsølv", "999"), ("3", "Sterling sølv", "925"), ("4", "3 tårnet sølv", "830"), ("5", "Sølv", "800"))
    ]
    return PosWorkspaceMarketRates(
        eur_dkk_fx=fx,
        gold_rates_eur=gold_rates_eur,
        silver_rates_eur=silver_rates_eur,
        gold_24k_dkk=gold_24k_dkk,
        silver_dkk=silver_dkk,
        gold_matrix=gold_matrix,
        silver_matrix=silver_matrix,
    )


def _afg_calculator_rows_payload(calculators) -> dict[str, list[dict[str, Decimal | str | None]]]:
    raw = calculators.model_dump() if hasattr(calculators, "model_dump") else (calculators or {})
    return {
        "gold_rows": raw.get("gold_rows") if isinstance(raw.get("gold_rows"), list) else [],
        "silver_rows": raw.get("silver_rows") if isinstance(raw.get("silver_rows"), list) else [],
    }


def _apply_afg_market_rate_cells(vars_sheet, market_rates: PosWorkspaceMarketRates) -> None:
    fx = quantize_2(to_decimal(market_rates.eur_dkk_fx))
    vars_sheet["C10"] = fx
    vars_sheet["C4"] = quantize_2(to_decimal(market_rates.gold_24k_dkk))
    vars_sheet["C5"] = quantize_2(to_decimal(market_rates.silver_dkk))
    vars_sheet["C6"] = quantize_2(to_decimal(market_rates.silver_rates_eur.get("925", 0)) * fx)
    vars_sheet["C7"] = quantize_2(to_decimal(market_rates.silver_rates_eur.get("830", 0)) * fx)
    vars_sheet["G2"] = "Kategori"
    vars_sheet["H2"] = "Beskrivelse"
    vars_sheet["I2"] = "EUR/g"
    vars_sheet["J2"] = "DKK/g"
    vars_sheet["K2"] = "Lødighed / Karat"
    values = (
        ("gold", "Gold 8K", market_rates.gold_rates_eur.get("8"), "333"),
        ("gold", "Gold 14K", market_rates.gold_rates_eur.get("14"), "585"),
        ("gold", "Gold 18K", market_rates.gold_rates_eur.get("18"), "750"),
        ("gold", "Gold 21K", market_rates.gold_rates_eur.get("21"), "875"),
        ("gold", "Gold 21.6K", market_rates.gold_rates_eur.get("21.6"), "900"),
        ("gold", "Gold 22K", market_rates.gold_rates_eur.get("22"), "917"),
        ("gold", "Gold 24K", market_rates.gold_rates_eur.get("24"), "999"),
        ("silver", "Finsølv", market_rates.silver_rates_eur.get("999"), "999"),
        ("silver", "Sterling sølv", market_rates.silver_rates_eur.get("925"), "925"),
        ("silver", "3 tårnet sølv", market_rates.silver_rates_eur.get("830"), "830"),
        ("silver", "Sølv", market_rates.silver_rates_eur.get("800"), "800"),
    )
    for row, (kind, label, eur_value, lodighed) in zip(AFG_VARIABLE_MATRIX_ROWS, values, strict=False):
        eur_cell, dkk_cell, meta_cell, _legacy_label, _legacy_lodighed = row
        row_idx = int(eur_cell[1:])
        vars_sheet[f"G{row_idx}"] = kind
        vars_sheet[f"H{row_idx}"] = label
        vars_sheet[eur_cell] = _quantize_4(to_decimal(eur_value))
        vars_sheet[dkk_cell] = quantize_2(to_decimal(eur_value) * fx)
        vars_sheet[meta_cell] = lodighed


def _apply_afg_calculator_cells(sheet, calculators) -> None:
    payload = _afg_calculator_rows_payload(calculators)
    by_key = {
        str(row.get("row_key") or "").strip(): row
        for row in payload["gold_rows"] + payload["silver_rows"]
        if isinstance(row, dict) and str(row.get("row_key") or "").strip()
    }
    for row_key, unit_cell, count_cell, _total_cell in (*AFG_GOLD_CALCULATOR_ROWS, *AFG_SILVER_CALCULATOR_ROWS):
        row = by_key.get(row_key, {})
        sheet[unit_cell] = quantize_2(to_decimal(row.get("unit_weight") or 0))
        sheet[count_cell] = quantize_2(to_decimal(row.get("count") or 0))


def _parse_afg_calculators_from_sheet(sheet) -> PosWorkspaceCalculatorsUpdate:
    gold_rows = []
    for row_key, unit_cell, count_cell, _total_cell in AFG_GOLD_CALCULATOR_ROWS:
        gold_rows.append(
            {
                "row_key": row_key,
                "unit_weight": _decimal_from_excel(sheet[unit_cell].value),
                "count": _decimal_from_excel(sheet[count_cell].value),
                "target_row_key": None,
            }
        )
    silver_rows = []
    for row_key, unit_cell, count_cell, _total_cell in AFG_SILVER_CALCULATOR_ROWS:
        silver_rows.append(
            {
                "row_key": row_key,
                "unit_weight": _decimal_from_excel(sheet[unit_cell].value),
                "count": _decimal_from_excel(sheet[count_cell].value),
                "target_row_key": None,
            }
        )
    target_defaults = {
        "calc_gold:1": "gold:8",
        "calc_gold:2": "gold:14",
        "calc_gold:3": "gold:18",
        "calc_gold:4": "gold:21",
        "calc_gold:5": "gold:21.6",
        "calc_silver:1": "silver:2",
        "calc_silver:2": "silver:3",
        "calc_silver:3": "silver:4",
        "calc_silver:4": "silver:5",
    }
    for row in gold_rows + silver_rows:
        row["target_row_key"] = target_defaults.get(str(row["row_key"]))
    return PosWorkspaceCalculatorsUpdate(gold_rows=gold_rows, silver_rows=silver_rows)


def _apply_afg_summary_cells(sheet, *, total_amount_dkk: Decimal, payment_method: str, reg_number: str | None, account_number: str | None) -> None:
    payment_label = "Kontant" if payment_method == "cash" else "Overførsel"
    sheet["C40"] = payment_label
    sheet["D40"] = total_amount_dkk
    sheet["D41"] = "—" if payment_method == "cash" else (reg_number or "—")
    sheet["D42"] = "—" if payment_method == "cash" else (account_number or "—")
    sheet["H38"] = total_amount_dkk
    sheet["H40"] = total_amount_dkk
    sheet["H42"] = Decimal("0.00")
    sheet["H43"] = total_amount_dkk


def _apply_afg_workspace_rows(sheet, gold_rows: Iterable[PosWorkspaceGoldRowOut], silver_rows: Iterable[PosWorkspaceSilverRowOut]) -> None:
    total_gold_grams = Decimal("0.00")
    total_gold_amount = Decimal("0.00")
    total_gold_pure = Decimal("0.00")
    total_silver_grams = Decimal("0.00")
    total_silver_amount = Decimal("0.00")
    total_silver_pure = Decimal("0.00")

    for idx, row in enumerate(gold_rows, start=AFG_GOLD_ROW_START):
        gram = quantize_2(to_decimal(row.gram))
        unit_price = quantize_2(to_decimal(row.unit_price_dkk))
        line_total = quantize_2(to_decimal(row.line_total_dkk))
        pure = quantize_2(gram * (to_decimal(row.purity_percentage) / Decimal("100")))
        total_gold_grams += gram
        total_gold_amount += line_total
        total_gold_pure += pure
        sheet[f"A{idx}"] = 1
        sheet[f"B{idx}"] = quantize_2(to_decimal(row.avance_percent) / Decimal("100"))
        sheet[f"C{idx}"] = "Guld"
        sheet[f"D{idx}"] = to_decimal(row.karat)
        sheet[f"E{idx}"] = row.lodighed
        sheet[f"F{idx}"] = gram
        sheet[f"G{idx}"] = unit_price
        sheet[f"H{idx}"] = line_total

    for idx, row in enumerate(silver_rows, start=AFG_SILVER_ROW_START):
        gram = quantize_2(to_decimal(row.gram))
        unit_price = quantize_2(to_decimal(row.unit_price_dkk))
        line_total = quantize_2(to_decimal(row.line_total_dkk))
        pure = quantize_2(gram * (to_decimal(row.purity_percentage) / Decimal("100")))
        total_silver_grams += gram
        total_silver_amount += line_total
        total_silver_pure += pure
        sheet[f"A{idx}"] = row.type_code
        sheet[f"B{idx}"] = quantize_2(to_decimal(row.avance_percent) / Decimal("100"))
        sheet[f"C{idx}"] = row.label
        sheet[f"E{idx}"] = row.lodighed
        sheet[f"F{idx}"] = gram
        sheet[f"G{idx}"] = unit_price
        sheet[f"H{idx}"] = line_total

    sheet["D75"] = total_gold_grams
    sheet["E75"] = total_gold_amount
    sheet["F75"] = total_gold_pure
    sheet["G75"] = total_silver_grams
    sheet["H75"] = total_silver_amount
    sheet["I75"] = total_silver_pure


def _apply_afg_factura_gold_sheet(
    sheet,
    *,
    customer_name: str | None,
    issued_at: datetime | None,
    invoice_number: str | None,
    rows,
    footer_lines: list[str],
) -> None:
    sheet["C2"] = _excel_datetime(issued_at)
    sheet["B11"] = customer_name or "—"
    sheet["F15"] = invoice_number or "—"
    sheet["F16"] = _excel_datetime(issued_at)
    for row_idx in range(AFG_FACTURA_GOLD_ROW_START, AFG_FACTURA_GOLD_ROW_END + 1):
        sheet[f"A{row_idx}"] = None
        sheet[f"C{row_idx}"] = None
        sheet[f"E{row_idx}"] = None
    for row in rows:
        row_index = int(str(row.row_key).split(":", 1)[1]) + AFG_FACTURA_GOLD_ROW_START - 1
        if row_index < AFG_FACTURA_GOLD_ROW_START or row_index > AFG_FACTURA_GOLD_ROW_END:
            continue
        sheet[f"A{row_index}"] = row.code or None
        sheet[f"C{row_index}"] = row.fineness or None
        sheet[f"E{row_index}"] = quantize_2(to_decimal(row.gram)) if to_decimal(row.gram) > 0 else None
    for index, row_idx in enumerate(range(AFG_FACTURA_GOLD_FOOTER_START, AFG_FACTURA_GOLD_FOOTER_START + 3)):
        sheet[f"B{row_idx}"] = footer_lines[index] if index < len(footer_lines) and footer_lines[index] else None


def _apply_afg_factura_misc_sheet(
    sheet,
    *,
    issued_at: datetime | None,
    invoice_number: str | None,
    rows,
) -> None:
    sheet["C2"] = _excel_datetime(issued_at)
    sheet["F14"] = invoice_number or "—"
    sheet["F15"] = _excel_datetime(issued_at)
    for row_idx in range(AFG_FACTURA_MISC_ROW_START, AFG_FACTURA_MISC_ROW_END + 1):
        sheet[f"C{row_idx}"] = None
        sheet[f"E{row_idx}"] = None
        sheet[f"F{row_idx}"] = None
    for row in rows:
        row_index = int(str(row.row_key).split(":", 1)[1]) + AFG_FACTURA_MISC_ROW_START - 1
        if row_index < AFG_FACTURA_MISC_ROW_START or row_index > AFG_FACTURA_MISC_ROW_END:
            continue
        sheet[f"C{row_index}"] = row.text or None
        sheet[f"E{row_index}"] = quantize_2(to_decimal(row.quantity)) if row.quantity is not None else None
        sheet[f"F{row_index}"] = quantize_2(to_decimal(row.unit_price_dkk)) if to_decimal(row.unit_price_dkk) > 0 else None


def _apply_afg_detail_rows(sheet, gold_rows: Iterable[dict[str, Decimal | str]], silver_rows: Iterable[dict[str, Decimal | str]]) -> None:
    total_gold_grams = Decimal("0.00")
    total_gold_amount = Decimal("0.00")
    total_gold_pure = Decimal("0.00")
    total_silver_grams = Decimal("0.00")
    total_silver_amount = Decimal("0.00")
    total_silver_pure = Decimal("0.00")

    for idx, row in enumerate(gold_rows, start=AFG_GOLD_ROW_START):
        gram = quantize_2(to_decimal(row["gram"]))
        unit_price = quantize_2(to_decimal(row["unit_price_dkk"]))
        line_total = quantize_2(to_decimal(row["line_total_dkk"]))
        karat = to_decimal(row["karat"])
        pure = quantize_2(gram * (karat / Decimal("24")))
        total_gold_grams += gram
        total_gold_amount += line_total
        total_gold_pure += pure
        sheet[f"A{idx}"] = 1
        sheet[f"B{idx}"] = quantize_2(to_decimal(row["avance_percent"]) / Decimal("100"))
        sheet[f"C{idx}"] = "Guld"
        sheet[f"D{idx}"] = karat
        sheet[f"E{idx}"] = row["lodighed"]
        sheet[f"F{idx}"] = gram
        sheet[f"G{idx}"] = unit_price
        sheet[f"H{idx}"] = line_total

    for idx, row in enumerate(silver_rows, start=AFG_SILVER_ROW_START):
        gram = quantize_2(to_decimal(row["gram"]))
        unit_price = quantize_2(to_decimal(row["unit_price_dkk"]))
        line_total = quantize_2(to_decimal(row["line_total_dkk"]))
        pure = quantize_2(gram * (Decimal(str(row["lodighed"])) / Decimal("1000"))) if str(row["lodighed"]).isdigit() else Decimal("0.00")
        total_silver_grams += gram
        total_silver_amount += line_total
        total_silver_pure += pure
        sheet[f"A{idx}"] = row["type_code"]
        sheet[f"B{idx}"] = quantize_2(to_decimal(row["avance_percent"]) / Decimal("100"))
        sheet[f"C{idx}"] = row["label"]
        sheet[f"E{idx}"] = row["lodighed"]
        sheet[f"F{idx}"] = gram
        sheet[f"G{idx}"] = unit_price
        sheet[f"H{idx}"] = line_total

    sheet["D75"] = total_gold_grams
    sheet["E75"] = total_gold_amount
    sheet["F75"] = total_gold_pure
    sheet["G75"] = total_silver_grams
    sheet["H75"] = total_silver_amount
    sheet["I75"] = total_silver_pure


def _build_afg_workbook_bytes_from_workspace(workspace: PosWorkspaceOut, *, sync_context: ArtifactSyncContext) -> bytes:
    from app.services import document_artifact_afg

    return document_artifact_afg.build_afg_workbook_bytes_from_workspace(workspace, sync_context=sync_context)


def _build_afg_workbook_bytes_from_detail(detail: PosDocumentDetailOut, *, sync_context: ArtifactSyncContext) -> bytes:
    from app.services import document_artifact_afg

    return document_artifact_afg.build_afg_workbook_bytes_from_detail(detail, sync_context=sync_context)


def _workspace_normalized_afg_values(workspace: PosWorkspaceOut) -> dict[str, str]:
    from app.services import document_artifact_afg

    return document_artifact_afg.workspace_normalized_afg_values(workspace)


def parse_afg_workspace_inputs_from_workbook(content: bytes) -> AfgWorkspaceArtifactInputs:
    from app.services import document_artifact_afg

    return document_artifact_afg.parse_afg_workspace_inputs_from_workbook(content)


def build_afg_workspace_reconcile_preview(
    workspace: PosWorkspaceOut,
    parsed: AfgWorkspaceArtifactInputs,
) -> DocumentArtifactReconcilePreviewOut:
    from app.services import document_artifact_afg

    return document_artifact_afg.build_afg_workspace_reconcile_preview(workspace, parsed)


def build_inventory_reconcile_preview(
    workspace: InventoryWorkspaceOut,
    parsed: InventoryWorkbookArtifactInputs,
) -> DocumentArtifactReconcilePreviewOut:
    return document_artifact_inventory.build_inventory_reconcile_preview(workspace, parsed)


def _inventory_sync_mappings(workspace: InventoryWorkspaceOut) -> list[SyncSheetRowMapping]:
    return document_artifact_inventory._inventory_sync_mappings(workspace)


def _inventory_editable_refs(mappings: Iterable[SyncSheetRowMapping]) -> list[str]:
    return document_artifact_inventory._inventory_editable_refs(mappings)


def _inventory_raw_row_payload(sheet, row_idx: int) -> tuple[datetime | None, dict[str, str]]:
    return document_artifact_inventory._inventory_raw_row_payload(sheet, row_idx)


def _inventory_raw_product_updates(
    sheet,
    *,
    current_workspace: InventoryWorkspaceOut,
) -> dict[UUID, ProductUpdate]:
    return document_artifact_inventory._inventory_raw_product_updates(
        sheet,
        current_workspace=current_workspace,
    )


def _build_inventory_workbook_bytes(
    workspace: InventoryWorkspaceOut,
    *,
    sync_context: ArtifactSyncContext,
    display_updated_at: datetime,
) -> bytes:
    return document_artifact_inventory._build_inventory_workbook_bytes(
        workspace,
        sync_context=sync_context,
        display_updated_at=display_updated_at,
    )


def _log_default_classification(metal_type: str | None, classification: str | None) -> AfgClassification:
    return document_artifact_log._log_default_classification(metal_type, classification)


def _log_route_code(destination: str | None, classification: str | None, *, metal_type: str | None = None) -> str:
    return document_artifact_log._log_route_code(destination, classification, metal_type=metal_type)


def _normalize_log_route_code(value: object) -> str:
    return document_artifact_log._normalize_log_route_code(value)


def _log_route_request_from_code(
    *,
    route_code: str,
    current_classification: str | None,
    metal_type: str | None,
    note: str | None,
    line_id: UUID,
) -> AfgRouteRequest:
    return document_artifact_log._log_route_request_from_code(
        route_code=route_code,
        current_classification=current_classification,
        metal_type=metal_type,
        note=note,
        line_id=line_id,
    )


def _log_sheet_lines(workspace: AfgLogWorkspaceOut, metal_bucket: str) -> list[dict[str, Any]]:
    return document_artifact_log._log_sheet_lines(workspace, metal_bucket)


def _log_route_line_rows(workspace: AfgLogWorkspaceOut) -> list[dict[str, Any]]:
    return document_artifact_log._log_route_line_rows(workspace)


def _log_bucket_group_key(row: dict[str, Any]) -> str | None:
    return document_artifact_log._log_bucket_group_key(row)


def _log_active_lot_slot(workspace: AfgLogWorkspaceOut, metal_bucket: str) -> dict[str, Any]:
    return document_artifact_log._log_active_lot_slot(workspace, metal_bucket)


def _log_lot_rows(workspace: AfgLogWorkspaceOut) -> list[dict[str, Any]]:
    return document_artifact_log._log_lot_rows(workspace)


def _set_log_lot_section(sheet, *, metal_bucket: str, row: dict[str, Any], editable_refs: list[str], mappings: list[SyncSheetRowMapping]) -> None:
    document_artifact_log._set_log_lot_section(
        sheet,
        metal_bucket=metal_bucket,
        row=row,
        editable_refs=editable_refs,
        mappings=mappings,
    )


def _add_log_route_validation(sheet, refs: Iterable[str]) -> None:
    document_artifact_log._add_log_route_validation(sheet, refs)


def _build_log_workbook_bytes(workspace: AfgLogWorkspaceOut, *, year: int, sync_context: ArtifactSyncContext) -> bytes:
    return document_artifact_log._build_log_workbook_bytes(workspace, year=year, sync_context=sync_context)


def _datetime_from_excel(value: object) -> datetime | None:
    return document_artifact_log._datetime_from_excel(value)


def parse_inventory_workbook_inputs_from_workbook(
    content: bytes,
    *,
    current_workspace: InventoryWorkspaceOut | None = None,
) -> InventoryWorkbookArtifactInputs:
    return document_artifact_inventory.parse_inventory_workbook_inputs_from_workbook(
        content,
        current_workspace=current_workspace,
    )


def _parse_log_workbook_inputs_v1(workbook, metadata: SyncSheetMetadata) -> LogWorkbookArtifactInputs:
    return document_artifact_log._parse_log_workbook_inputs_v1(workbook, metadata)


def _parse_log_lot_section(sheet, *, metal_bucket: str, row_idx: int, extra: dict[str, Any]) -> tuple[LogWorkbookLotCreate | None, LogWorkbookLotUpdate | None]:
    return document_artifact_log._parse_log_lot_section(
        sheet,
        metal_bucket=metal_bucket,
        row_idx=row_idx,
        extra=extra,
    )


def _parse_log_workbook_inputs_v2(workbook, metadata: SyncSheetMetadata) -> LogWorkbookArtifactInputs:
    return document_artifact_log._parse_log_workbook_inputs_v2(workbook, metadata)


def _log_raw_reference_route_code(
    *,
    document: AfgWorkspaceDocumentOut,
    metal_bucket: str,
    inventory_marked: bool,
    separate_storage_refs: set[int],
) -> str:
    return document_artifact_log._log_raw_reference_route_code(
        document=document,
        metal_bucket=metal_bucket,
        inventory_marked=inventory_marked,
        separate_storage_refs=separate_storage_refs,
    )


def _raw_log_route_request_for_document(
    *,
    document: AfgWorkspaceDocumentOut,
    route_code: str,
    metal_bucket: str,
) -> AfgRouteRequest:
    return document_artifact_log._raw_log_route_request_for_document(
        document=document,
        route_code=route_code,
        metal_bucket=metal_bucket,
    )


def _parse_raw_log_reference_route_updates(
    sheet,
    *,
    current_workspace: AfgLogWorkspaceOut,
) -> list[LogWorkbookRouteEdit]:
    return document_artifact_log._parse_raw_log_reference_route_updates(
        sheet,
        current_workspace=current_workspace,
    )


def _parse_raw_log_lot_inputs(
    sheet,
    *,
    current_workspace: AfgLogWorkspaceOut,
) -> tuple[list[LogWorkbookLotCreate], list[LogWorkbookLotUpdate]]:
    return document_artifact_log._parse_raw_log_lot_inputs(
        sheet,
        current_workspace=current_workspace,
    )


def _parse_log_workbook_inputs_raw(
    workbook,
    *,
    current_workspace: AfgLogWorkspaceOut,
) -> LogWorkbookArtifactInputs:
    return document_artifact_log._parse_log_workbook_inputs_raw(
        workbook,
        current_workspace=current_workspace,
    )


def parse_log_workbook_inputs_from_workbook(
    content: bytes,
    *,
    year: int,
    current_workspace: AfgLogWorkspaceOut | None = None,
) -> LogWorkbookArtifactInputs:
    workbook = load_workbook(io.BytesIO(content), data_only=False)
    metadata = _sync_metadata_if_present(workbook, expected_kind="log", expected_key=str(year))
    if metadata is not None:
        if metadata.contract_version == "log-v1":
            return _parse_log_workbook_inputs_v1(workbook, metadata)
        return _parse_log_workbook_inputs_v2(workbook, metadata)
    if current_workspace is None:
        raise ValueError("Log raw import için mevcut workspace gerekir")
    values_workbook = load_workbook(io.BytesIO(content), data_only=True)
    return _parse_log_workbook_inputs_raw(values_workbook, current_workspace=current_workspace)


def _afg_preview_sheet_from_workspace(workspace: PosWorkspaceOut) -> DocumentArtifactSheetPreviewOut:
    rows: list[list[str]] = []
    for row in _afg_gold_rows_from_workspace(workspace):
        rows.append(
            [
                row.row_key,
                "Guld",
                row.label,
                _stringify(row.avance_percent),
                _stringify(row.karat),
                _stringify(row.lodighed),
                _stringify(row.gram),
                _stringify(row.unit_price_dkk),
                _stringify(row.line_total_dkk),
            ]
        )
    rows.append(["", "SØLV — GÜMÜŞ", "999 · 925 · 830 · 800", "", "", "", "", "", ""])
    for row in _afg_silver_rows_from_workspace(workspace):
        rows.append(
            [
                row.row_key,
                row.type_code,
                row.label,
                _stringify(row.avance_percent),
                "—",
                _stringify(row.lodighed),
                _stringify(row.gram),
                _stringify(row.unit_price_dkk),
                _stringify(row.line_total_dkk),
            ]
        )
    return DocumentArtifactSheetPreviewOut(
        name="Afregningsbilag",
        mode="editable",
        system_sync=True,
        columns=["#", "Type", "Açıklama", "Avance %", "Karat", "Lødighed", "Vægt i g", "Enhedspris/g", "I alt (DKK)"],
        rows=rows,
        note=f"Toplam: {_fmt_decimal(workspace.summary.total_amount_dkk)} DKK",
    )


def _afg_variables_preview_sheet_from_workspace(workspace: PosWorkspaceOut) -> DocumentArtifactSheetPreviewOut:
    return _afg_contract_sheet(
        AFG_VARIABLES_SHEET,
        mode="editable",
        system_sync=True,
        note="Kontrollü piyasa girdileri. Save/apply sırasında workspace market rate alanlarına yazılır.",
        columns=["Hücre", "Açıklama", "Değer"],
        rows=[
            ["C4", "Au 24K DKK", _fmt_decimal(workspace.market_rates.gold_24k_dkk)],
            ["C5", "Ag DKK", _fmt_decimal(workspace.market_rates.silver_dkk)],
            ["C6", "Ag 925", _fmt_decimal(to_decimal(workspace.market_rates.silver_dkk) * Decimal("0.925"))],
            ["C7", "Ag 830", _fmt_decimal(to_decimal(workspace.market_rates.silver_dkk) * Decimal("0.83"))],
            ["C14", "Afregningsnr.", workspace.numbering_preview.afregnings_number_next],
            ["D14", "Fakturanr.", workspace.numbering_preview.invoice_number_next],
        ],
    )


def _afg_factura_gold_preview_sheet_from_workspace(workspace: PosWorkspaceOut) -> DocumentArtifactSheetPreviewOut:
    rows = [
        [
            row.row_key,
            row.code or "—",
            row.label or "—",
            row.fineness or "—",
            row.lodighed or "—",
            _fmt_decimal(row.gram),
            _fmt_decimal(row.unit_price_dkk),
            _fmt_decimal(row.line_total_dkk),
        ]
        for row in workspace.invoice_gold.rows
    ]
    footer_rows = [[f"Metin {index}", line or "—", "", "", "", "", "", ""] for index, line in enumerate(workspace.invoice_gold.footer_lines, start=1)]
    return _afg_contract_sheet(
        AFG_FACTURA_GOLD_SHEET,
        mode="editable",
        system_sync=True,
        note=f"Companion invoice sheet. Fakturanr: {workspace.numbering_preview.invoice_number_next or '—'}",
        columns=["#", "Kod", "Type", "Finhed", "Lødighed", "Gram", "Enhedspris / g", "I alt"],
        rows=[*rows, *footer_rows],
    )


def _afg_factura_misc_preview_sheet_from_workspace(workspace: PosWorkspaceOut) -> DocumentArtifactSheetPreviewOut:
    return _afg_contract_sheet(
        AFG_FACTURA_MISC_SHEET,
        mode="editable",
        system_sync=True,
        note=f"Companion misc invoice sheet. Fakturanr: {workspace.numbering_preview.invoice_number_next or '—'}",
        columns=["#", "Tekst", "Antal", "Pris", "I alt"],
        rows=[
            [
                row.row_key,
                row.text or "—",
                (_fmt_decimal(row.quantity) if row.quantity is not None else "—"),
                _fmt_decimal(row.unit_price_dkk),
                _fmt_decimal(row.line_total_dkk),
            ]
            for row in workspace.invoice_misc.rows
        ],
    )


def _afg_preview_sheet_from_detail(detail: PosDocumentDetailOut) -> DocumentArtifactSheetPreviewOut:
    rows: list[list[str]] = []
    for row in _aggregate_detail_gold_rows(detail):
        rows.append(
            [
                str(row["row_key"]),
                "Guld",
                "Guld",
                _stringify(row["avance_percent"]),
                _stringify(row["karat"]),
                _stringify(row["lodighed"]),
                _stringify(row["gram"]),
                _stringify(row["unit_price_dkk"]),
                _stringify(row["line_total_dkk"]),
            ]
        )
    rows.append(["", "SØLV — GÜMÜŞ", "999 · 925 · 830 · 800", "", "", "", "", "", ""])
    for row in _aggregate_detail_silver_rows(detail):
        rows.append(
            [
                str(row["row_key"]),
                _stringify(row["type_code"]),
                _stringify(row["label"]),
                _stringify(row["avance_percent"]),
                "—",
                _stringify(row["lodighed"]),
                _stringify(row["gram"]),
                _stringify(row["unit_price_dkk"]),
                _stringify(row["line_total_dkk"]),
            ]
        )
    return DocumentArtifactSheetPreviewOut(
        name="Afregningsbilag",
        mode="readonly",
        system_sync=False,
        columns=["#", "Type", "Açıklama", "Avance %", "Karat", "Lødighed", "Vægt i g", "Enhedspris/g", "I alt (DKK)"],
        rows=rows,
        note=f"Toplam: {_fmt_decimal(detail.net_amount_dkk)} DKK",
    )


def _afg_variables_preview_sheet_from_detail(detail: PosDocumentDetailOut) -> DocumentArtifactSheetPreviewOut:
    gold_rate = max(
        (to_decimal(line.rate_dkk or 0) for line in detail.lines if str(line.metal_type or "").lower() != "silver"),
        default=Decimal("0"),
    )
    silver_rate = max(
        (to_decimal(line.rate_dkk or 0) for line in detail.lines if str(line.metal_type or "").lower() == "silver"),
        default=Decimal("0"),
    )
    return _afg_contract_sheet(
        AFG_VARIABLES_SHEET,
        mode="readonly",
        system_sync=False,
        note="Final belgede Variable værdier korunur ama sistem tarafında tekrar yazılamaz.",
        columns=["Hücre", "Açıklama", "Değer"],
        rows=[
            ["C4", "Au 24K DKK", _fmt_decimal(gold_rate)],
            ["C5", "Ag DKK", _fmt_decimal(silver_rate)],
            ["C6", "Ag 925", _fmt_decimal(silver_rate * Decimal("0.925"))],
            ["C7", "Ag 830", _fmt_decimal(silver_rate * Decimal("0.83"))],
            ["C14", "Afregningsnr.", detail.numbering_preview.afregnings_number_next or detail.document_number],
            ["D14", "Fakturanr.", detail.numbering_preview.invoice_number_next or "—"],
        ],
    )


def _afg_factura_gold_preview_sheet_from_detail(detail: PosDocumentDetailOut) -> DocumentArtifactSheetPreviewOut:
    rows = [
        [
            row.row_key,
            row.code or "—",
            row.label or "—",
            row.fineness or "—",
            row.lodighed or "—",
            _fmt_decimal(row.gram),
            _fmt_decimal(row.unit_price_dkk),
            _fmt_decimal(row.line_total_dkk),
        ]
        for row in detail.invoice_gold.rows
    ]
    footer_rows = [[f"Metin {index}", line or "—", "", "", "", "", "", ""] for index, line in enumerate(detail.invoice_gold.footer_lines, start=1)]
    return _afg_contract_sheet(
        AFG_FACTURA_GOLD_SHEET,
        mode="readonly",
        system_sync=False,
        note=f"Final companion invoice sheet. Fakturanr: {detail.numbering_preview.invoice_number_next or '—'}",
        columns=["#", "Kod", "Type", "Finhed", "Lødighed", "Gram", "Enhedspris / g", "I alt"],
        rows=[*rows, *footer_rows],
    )


def _afg_factura_misc_preview_sheet_from_detail(detail: PosDocumentDetailOut) -> DocumentArtifactSheetPreviewOut:
    return _afg_contract_sheet(
        AFG_FACTURA_MISC_SHEET,
        mode="readonly",
        system_sync=False,
        note=f"Final companion misc invoice sheet. Fakturanr: {detail.numbering_preview.invoice_number_next or '—'}",
        columns=["#", "Tekst", "Antal", "Pris", "I alt"],
        rows=[
            [
                row.row_key,
                row.text or "—",
                (_fmt_decimal(row.quantity) if row.quantity is not None else "—"),
                _fmt_decimal(row.unit_price_dkk),
                _fmt_decimal(row.line_total_dkk),
            ]
            for row in detail.invoice_misc.rows
        ],
    )


def build_afg_workspace_preview(workspace: PosWorkspaceOut, artifact: DocumentArtifact | None = None) -> DocumentArtifactPreviewOut:
    from app.services.document_artifact_preview import build_afg_workspace_preview as _impl

    return _impl(workspace, artifact)


def build_afg_document_preview(detail: PosDocumentDetailOut, artifact: DocumentArtifact | None = None) -> DocumentArtifactPreviewOut:
    from app.services.document_artifact_preview import build_afg_document_preview as _impl

    return _impl(detail, artifact)


def build_inventory_preview(workspace: InventoryWorkspaceOut, artifact: DocumentArtifact | None = None) -> DocumentArtifactPreviewOut:
    from app.services.document_artifact_preview import build_inventory_preview as _impl

    return _impl(workspace, artifact)


def build_log_preview(workspace: AfgLogWorkspaceOut, *, year: int, artifact: DocumentArtifact | None = None) -> DocumentArtifactPreviewOut:
    from app.services.document_artifact_preview import build_log_preview as _impl

    return _impl(workspace, year=year, artifact=artifact)

async def sync_afg_workspace_artifact(session: AsyncSession, workspace: PosWorkspaceOut) -> WorkbookArtifactBundle:
    session_code = workspace.session.session_code
    document_number = workspace.numbering_preview.afregnings_number_next or session_code
    artifact_key = f"alis.workspace.{workspace.session.id}"
    stamp = utc_now()
    content = _build_afg_workbook_bytes_from_workspace(
        workspace,
        sync_context=ArtifactSyncContext(
            kind="alis-workspace",
            key=str(workspace.session.id),
            artifact_key=artifact_key,
            base_version="",
        ),
    )
    return await _store_artifact(
        session,
        artifact_key=artifact_key,
        module_name="alis",
        document_type="afg_workdraft",
        business_key=session_code,
        version_kind="draft",
        is_live=True,
        file_name=f"{document_number}.xlsm",
        relative_path=Path("alis") / "afg" / "drafts" / f"{document_number}.xlsm",
        mime_type=XLSM_MIME,
        template_name=AFG_TEMPLATE_NAME,
        content=content,
        updated_at=stamp,
    )


async def sync_afg_document_artifact(session: AsyncSession, detail: PosDocumentDetailOut) -> WorkbookArtifactBundle:
    artifact_key = f"alis.document.{detail.sequence_no}"
    stamp = utc_now()
    content = _build_afg_workbook_bytes_from_detail(
        detail,
        sync_context=ArtifactSyncContext(
            kind="alis-document",
            key=str(detail.sequence_no),
            artifact_key=artifact_key,
            base_version="",
        ),
    )
    year = str(detail.issued_at.year)
    file_name = f"{detail.sequence_no}.xlsm"
    return await _store_artifact(
        session,
        artifact_key=artifact_key,
        module_name="alis",
        document_type="afg_document",
        business_key=str(detail.sequence_no),
        version_kind="final",
        is_live=True,
        file_name=file_name,
        relative_path=Path("alis") / "afg" / "final" / year / file_name,
        mime_type=XLSM_MIME,
        template_name=AFG_TEMPLATE_NAME,
        content=content,
        updated_at=stamp,
    )


async def sync_inventory_workbook_artifact(
    session: AsyncSession,
    workspace: InventoryWorkspaceOut,
    *,
    create_snapshot: bool,
) -> WorkbookArtifactBundle:
    stamp = utc_now()
    existing_record = await get_artifact_record(session, "depolama.live")
    content = _build_inventory_workbook_bytes(
        workspace,
        sync_context=ArtifactSyncContext(
            kind="depolama",
            key="live",
            artifact_key="depolama.live",
            base_version="",
            mappings=_inventory_sync_mappings(workspace),
        ),
        display_updated_at=stamp if create_snapshot or existing_record is None else existing_record.updated_at,
    )
    live_bundle = await _store_artifact(
        session,
        artifact_key="depolama.live",
        module_name="depolama",
        document_type="inventory_workbook",
        business_key="live",
        version_kind="live",
        is_live=True,
        file_name="Depolama.xlsx",
        relative_path=Path("depolama") / "live" / "Depolama.xlsx",
        mime_type=XLSX_MIME,
        template_name=DEPOLAMA_TEMPLATE_NAME,
        content=content,
        updated_at=stamp,
    )
    if create_snapshot:
        now = utc_now()
        stamp = now.strftime("%Y%m%d-%H%M%S")
        await _store_artifact(
            session,
            artifact_key=f"depolama.snapshot.{stamp}",
            module_name="depolama",
            document_type="inventory_workbook",
            business_key="live",
            version_kind="snapshot",
            is_live=False,
            file_name=f"{stamp}-Depolama.xlsx",
            relative_path=Path("depolama") / "snapshots" / now.strftime("%Y") / now.strftime("%m") / f"{stamp}-Depolama.xlsx",
            mime_type=XLSX_MIME,
            template_name=DEPOLAMA_TEMPLATE_NAME,
            content=content,
            updated_at=stamp,
        )
    return live_bundle


async def sync_log_workbook_artifact(
    session: AsyncSession,
    workspace: AfgLogWorkspaceOut,
    *,
    year: int,
    create_snapshot: bool,
) -> WorkbookArtifactBundle:
    stamp = utc_now()
    content = _build_log_workbook_bytes(
        workspace,
        year=year,
        sync_context=ArtifactSyncContext(
            kind="log",
            key=str(year),
            artifact_key=f"log.live.{year}",
            base_version="",
        ),
    )
    live_bundle = await _store_artifact(
        session,
        artifact_key=f"log.live.{year}",
        module_name="log",
        document_type="log_workbook",
        business_key=str(year),
        version_kind="live",
        is_live=True,
        file_name=f"Log-{year}.xlsx",
        relative_path=Path("log") / "live" / f"Log-{year}.xlsx",
        mime_type=XLSX_MIME,
        template_name=LOG_TEMPLATE_NAME,
        content=content,
        updated_at=stamp,
    )
    if create_snapshot:
        now = utc_now()
        stamp = now.strftime("%Y%m%d-%H%M%S")
        await _store_artifact(
            session,
            artifact_key=f"log.snapshot.{year}.{stamp}",
            module_name="log",
            document_type="log_workbook",
            business_key=str(year),
            version_kind="snapshot",
            is_live=False,
            file_name=f"{stamp}-Log-{year}.xlsx",
            relative_path=Path("log") / "snapshots" / now.strftime("%Y") / now.strftime("%m") / f"{stamp}-Log-{year}.xlsx",
            mime_type=XLSX_MIME,
            template_name=LOG_TEMPLATE_NAME,
            content=content,
            updated_at=stamp,
        )
    return live_bundle
