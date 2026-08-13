from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from app.schemas.inventory import InventoryGridRowOut, InventoryMarketPricesOut, InventoryWorkspaceOut, InventoryWorkspaceSummaryOut
from app.schemas.document_artifact import DocumentArtifactSheetPreviewOut
from app.services import document_artifact_preview
from app.services.document_artifact_edit import _inventory_editable_cell_map
from app.services.document_artifact_preview import build_inventory_preview


def _workspace() -> InventoryWorkspaceOut:
    return InventoryWorkspaceOut(
        market_prices=InventoryMarketPricesOut(
            gold=Decimal("2850"),
            silver=Decimal("8.5"),
            platinum=Decimal("900"),
            palladium=Decimal("950"),
        ),
        summary=InventoryWorkspaceSummaryOut(total_items=1),
        rows=[
            InventoryGridRowOut(
                id=uuid4(),
                product_number="SG-000001",
                main_category="jewelry",
                product_type="jewelry",
                metal_type="gold",
                status="active",
                lager_dato="2026-08-12",
                urun="Ring",
                saflik_label="18K",
                birim_gram=Decimal("2.50"),
                adet=1,
                toplam_gram=Decimal("2.50"),
                has_metal_grams=Decimal("1.88"),
                alis_fiyati_dkk=Decimal("1000"),
                spot_degeri_dkk=Decimal("1200"),
                length_cm="2",
                width_mm=Decimal("3"),
                thickness_mm=Decimal("1"),
                producer="Sero",
            )
        ],
    )


def test_live_inventory_preview_advertises_only_safe_editable_cells() -> None:
    workspace = _workspace()
    preview = build_inventory_preview(workspace)
    preview_keys = {(cell.sheet, cell.cell_ref) for cell in preview.editable_cells}
    map_keys = {(cell["sheet"], cell["cell_ref"]) for cell in _inventory_editable_cell_map(workspace).values()}

    assert preview.external_edit_supported is True
    assert preview.import_supported is True
    assert preview_keys == map_keys
    assert {"Lager!K4", "Lager!K5", "Lager!K6", "Lager!K7"} <= {
        f"{sheet}!{cell_ref}" for sheet, cell_ref in preview_keys
    }
    assert {"Lager!B11", "Lager!C11", "Lager!D11", "Lager!E11", "Lager!H11", "Lager!N11", "Lager!O11", "Lager!P11", "Lager!Q11"} <= {
        f"{sheet}!{cell_ref}" for sheet, cell_ref in preview_keys
    }
    # Product identity and formula/derived columns remain server-owned.
    assert not {"Lager!F11", "Lager!G11", "Lager!I11", "Lager!J11", "Lager!K11"} & {
        f"{sheet}!{cell_ref}" for sheet, cell_ref in preview_keys
    }


def test_live_afg_draft_preview_advertises_embedded_edit_surface(monkeypatch) -> None:
    sheet = DocumentArtifactSheetPreviewOut(name="Afregningsbilag")
    for name in (
        "_afg_preview_sheet_from_workspace",
        "_afg_factura_gold_preview_sheet_from_workspace",
        "_afg_factura_misc_preview_sheet_from_workspace",
        "_afg_variables_preview_sheet_from_workspace",
        "_afg_guide_sheet_preview",
    ):
        monkeypatch.setattr(document_artifact_preview, name, lambda _workspace=None, _sheet=sheet: _sheet)
    workspace = SimpleNamespace(
        numbering_preview=SimpleNamespace(afregnings_number_next="AFG-DRAFT-1"),
        session=SimpleNamespace(
            id=uuid4(),
            session_code="DRAFT-1",
            updated_at=datetime.now(timezone.utc),
        ),
        customer=SimpleNamespace(name="Draft Customer"),
        workspace_revision=3,
    )

    preview = document_artifact_preview.build_afg_workspace_preview(workspace)

    assert preview.external_edit_supported is True
    assert preview.import_supported is True
    assert preview.editable_cells
