from __future__ import annotations

from app.models.document_artifact import DocumentArtifact
from app.schemas.afg import AfgLogWorkspaceOut
from app.schemas.document_artifact import DocumentArtifactPreviewOut, DocumentArtifactSheetPreviewOut
from app.schemas.inventory import InventoryWorkspaceOut
from app.schemas.pos import PosDocumentDetailOut, PosWorkspaceOut
from app.services.document_artifact_service import (
    AFG_EDITABLE_CELLS,
    AFG_CONTRACT_VERSION,
    AFG_GUIDE_SHEET,
    INVENTORY_CONTRACT_VERSION,
    INVENTORY_SHEET,
    LOG_CONTRACT_VERSION,
    LOG_CONTROL_SHEET,
    LOG_SHEET,
    _afg_contract_sheet,
    _editable_cell_out,
    _afg_factura_gold_preview_sheet_from_detail,
    _afg_factura_gold_preview_sheet_from_workspace,
    _afg_factura_misc_preview_sheet_from_detail,
    _afg_factura_misc_preview_sheet_from_workspace,
    _afg_preview_sheet_from_detail,
    _afg_preview_sheet_from_workspace,
    _afg_variables_preview_sheet_from_detail,
    _afg_variables_preview_sheet_from_workspace,
    _fmt_date,
    _log_lot_rows,
    _log_route_line_rows,
    _normalized_customer_name,
    _record_out,
    _stringify,
)
from app.utils.helpers import utc_now


def _afg_guide_sheet_preview() -> DocumentArtifactSheetPreviewOut:
    return _afg_contract_sheet(
        AFG_GUIDE_SHEET,
        mode="static",
        system_sync=False,
        note="Template kullanım notlarıdır; domain verisine yazılmaz.",
        columns=["Bölüm", "Talimat"],
        rows=[
            ["Generelt", "Bitirdiğinizde workbook’u kaydedin; manuel numara override için Variable værdier C14 / D14 kullanılır."],
            ["Afregningsbilag", "Kolon A kod, B opsiyonel avance, D karat/finhed, F gram. Hızlı grid bunun CRM shortcut yüzeyidir."],
            ["Faktura guld og sølv", "Kolon A kod, C karat/finhed, E gram. Alttaki üç satır serbest metindir."],
            ["Faktura diverse", "Kolon C tekst, E antal, F enhedspris. Antal boşsa 1 kabul edilir."],
            ["Variable værdier", "Kontrollü piyasa değerleri ve draft numaraları burada tutulur."],
        ],
    )


def _inventory_preview_sheet(workspace: InventoryWorkspaceOut) -> DocumentArtifactSheetPreviewOut:
    rows = [
        [
            item.product_number,
            item.lager_dato,
            item.urun,
            _stringify(item.birim_gram),
            str(item.adet),
            _stringify(item.toplam_gram),
            _stringify(item.has_metal_grams),
            _stringify(item.alis_fiyati_dkk),
            _stringify(item.spot_degeri_dkk),
            item.status,
        ]
        for item in workspace.rows
    ]
    return DocumentArtifactSheetPreviewOut(
        name=INVENTORY_SHEET,
        mode="editable",
        system_sync=True,
        columns=["Ürün No", "Lager Dato", "Ürün", "Birim Gram", "Adet", "Toplam Gram", "Has Metal", "Alış (DKK)", "Spot (DKK)", "Durum"],
        rows=rows,
        note="Canlı envanter sheet’i. Market prices ve mevcut ürün satırlarının temel alanları sisteme anında uygulanır; toplam/spot kimlik kolonları derived kalır.",
    )


def _log_documents_preview_sheet(workspace: AfgLogWorkspaceOut) -> DocumentArtifactSheetPreviewOut:
    rows = [
        [
            row["metal_bucket"],
            row["document_number"],
            str(row["line_no"]),
            row["customer_name"],
            _stringify(row["weight_grams"]),
            _stringify(row["line_total_dkk"]),
            _stringify(row["pure_gold_grams"]),
            row["route_code"],
        ]
        for row in _log_route_line_rows(workspace)
    ]
    return DocumentArtifactSheetPreviewOut(
        name=LOG_SHEET,
        mode="editable",
        system_sync=True,
        columns=["Metal", "AFG", "Satır", "Müşteri", "Gram", "Kr.", "Has", "Rota"],
        rows=rows,
        note="Ark1 canlı operasyon sheet’i. G kolonu route code, alt melt/payout hücreleri ise çift yönlü sistem sync girişleridir.",
    )


def _log_control_preview_sheet(workspace: AfgLogWorkspaceOut) -> DocumentArtifactSheetPreviewOut:
    rows: list[list[str]] = []
    for row in _log_route_line_rows(workspace):
        rows.append(
            [
                "route",
                row["metal_bucket"],
                row["document_number"],
                str(row["line_no"]),
                row["customer_name"],
                _stringify(row["weight_grams"]),
                row["destination"],
                row["classification"],
                row["note"] or "—",
            ]
        )
    rows.append(["—", "MELT LOTS", "", "", "", "", "", "", ""])
    for row in _log_lot_rows(workspace):
        rows.append(
            [
                row["mode"],
                row["metal_bucket"],
                row["label"],
                row["sent_date"] or "—",
                row["purchased_from_date"] or "—",
                _stringify(row["after_pure_gold_grams"]),
                _stringify(row["insurance_dkk"]),
                _stringify(row["shipping_dkk"]),
                row["notes"] or "—",
            ]
        )
    return DocumentArtifactSheetPreviewOut(
        name=LOG_CONTROL_SHEET,
        mode="editable",
        system_sync=True,
        columns=["Tür", "Metal", "Belge/Lot", "Satır/Tarih", "Müşteri/From", "Gram", "Destination/Insurance", "Classification/Shipping", "Note"],
        rows=rows,
        note="Route destination/classification/note ve melt lot alanları bu control sheet üzerinden anında sisteme uygulanır. Ark1 raporu derived/read-only kalır.",
    )


def build_afg_workspace_preview(workspace: PosWorkspaceOut, artifact: DocumentArtifact | None = None) -> DocumentArtifactPreviewOut:
    return DocumentArtifactPreviewOut(
        title=f"AFG Taslak — {workspace.numbering_preview.afregnings_number_next or workspace.session.session_code}",
        subtitle=f"{_normalized_customer_name(workspace.customer.name)} · {_fmt_date(workspace.session.updated_at)}",
        contract_version=AFG_CONTRACT_VERSION,
        artifact=(_record_out(artifact) if artifact is not None else None),
        download_path=f"/api/v2/alis/workspace/{workspace.session.id}/artifact",
        module_route="/",
        import_supported=True,
        external_edit_supported=False,
        editable_cells=[_editable_cell_out(cell) for cell in AFG_EDITABLE_CELLS],
        sheets=[
            _afg_preview_sheet_from_workspace(workspace),
            _afg_factura_gold_preview_sheet_from_workspace(workspace),
            _afg_factura_misc_preview_sheet_from_workspace(workspace),
            _afg_variables_preview_sheet_from_workspace(workspace),
            _afg_guide_sheet_preview(),
        ],
    )


def build_afg_document_preview(detail: PosDocumentDetailOut, artifact: DocumentArtifact | None = None) -> DocumentArtifactPreviewOut:
    return DocumentArtifactPreviewOut(
        title=f"AFG Belgesi — {detail.document_number}",
        subtitle=f"{_normalized_customer_name(detail.customer_name)} · {_fmt_date(detail.issued_at)}",
        contract_version=AFG_CONTRACT_VERSION,
        artifact=(_record_out(artifact) if artifact is not None else None),
        download_path=f"/api/v2/alis/documents/{detail.sequence_no}/artifact",
        module_route="/",
        import_supported=False,
        external_edit_supported=False,
        editable_cells=[],
        sheets=[
            _afg_preview_sheet_from_detail(detail),
            _afg_factura_gold_preview_sheet_from_detail(detail),
            _afg_factura_misc_preview_sheet_from_detail(detail),
            _afg_variables_preview_sheet_from_detail(detail),
            _afg_guide_sheet_preview(),
        ],
    )


def build_inventory_preview(workspace: InventoryWorkspaceOut, artifact: DocumentArtifact | None = None) -> DocumentArtifactPreviewOut:
    return DocumentArtifactPreviewOut(
        title="Depolama.xlsx",
        subtitle=f"Canlı envanter · {_fmt_date(utc_now())}",
        contract_version=INVENTORY_CONTRACT_VERSION,
        artifact=(_record_out(artifact) if artifact is not None else None),
        download_path="/api/v2/depolama/workbook",
        module_route="/depolama",
        import_supported=True,
        external_edit_supported=True,
        editable_cells=[],
        sheets=[_inventory_preview_sheet(workspace)],
    )


def build_log_preview(workspace: AfgLogWorkspaceOut, *, year: int, artifact: DocumentArtifact | None = None) -> DocumentArtifactPreviewOut:
    return DocumentArtifactPreviewOut(
        title=f"Log-{year}.xlsx",
        subtitle=f"AFG operasyon logu · {year}",
        contract_version=LOG_CONTRACT_VERSION,
        artifact=(_record_out(artifact) if artifact is not None else None),
        download_path=f"/api/v2/log/workbook?year={year}",
        module_route="/log",
        import_supported=True,
        external_edit_supported=True,
        editable_cells=[],
        sheets=[_log_documents_preview_sheet(workspace)],
    )
