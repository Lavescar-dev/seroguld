from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.base import AppBaseModel


class DocumentArtifactRecordOut(AppBaseModel):
    id: UUID
    artifact_key: str
    module_name: str
    document_type: str
    business_key: str
    version_kind: str
    is_live: bool
    file_name: str
    mime_type: str
    template_name: str | None = None
    size_bytes: int = 0
    checksum_sha256: str | None = None
    revision: int = 1
    workbook_revision: str | None = None
    base_revision: str | None = None
    crm_revision: str | None = None
    conflict_state: str | None = None
    updated_at: datetime

    @model_validator(mode="after")
    def populate_workbook_revision(self):
        if not self.workbook_revision and self.checksum_sha256:
            self.workbook_revision = self.checksum_sha256
        return self


class DocumentArtifactSheetPreviewOut(AppBaseModel):
    name: str
    mode: str = "derived"
    system_sync: bool = False
    columns: list[str] = Field(default_factory=list)
    rows: list[list[str]] = Field(default_factory=list)
    note: str | None = None


class DocumentArtifactEditableCellOut(AppBaseModel):
    sheet: str
    cell_ref: str
    label: str
    input_kind: str


class DocumentArtifactCellEditIn(AppBaseModel):
    sheet: str
    cell_ref: str
    value: str | None = None


class DocumentArtifactCellChangeIn(AppBaseModel):
    sheet: str = Field(min_length=1, max_length=120)
    cell_ref: str = Field(min_length=2, max_length=16)
    value: str | None = None


class DocumentArtifactCellErrorOut(AppBaseModel):
    sheet: str
    cell_ref: str
    message: str


class DocumentArtifactAppliedCellOut(AppBaseModel):
    sheet: str
    cell_ref: str
    value: str


class DocumentArtifactCellsPatchIn(AppBaseModel):
    base_revision: int = Field(ge=0)
    source: str = "embedded"
    changes: list[DocumentArtifactCellChangeIn] = Field(default_factory=list, max_length=100)


class DocumentArtifactCellsPatchOut(AppBaseModel):
    revision: int
    status: str
    applied_changes: list[DocumentArtifactAppliedCellOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    cell_errors: list[DocumentArtifactCellErrorOut] = Field(default_factory=list)


class DocumentArtifactCellEditsIn(AppBaseModel):
    edits: list[DocumentArtifactCellEditIn] = Field(default_factory=list)


class DocumentArtifactCellChangeOut(AppBaseModel):
    field_id: str | None = None
    sheet: str
    cell_ref: str
    label: str
    old_value: str
    new_value: str

    @model_validator(mode="after")
    def populate_field_id(self):
        if not self.field_id:
            self.field_id = f"{self.sheet}:{self.cell_ref}"
        return self


class DocumentArtifactReconcilePreviewOut(AppBaseModel):
    editable: bool = False
    changes: list[DocumentArtifactCellChangeOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    blocking_errors: list[str] = Field(default_factory=list)


class DocumentArtifactPreviewOut(AppBaseModel):
    title: str
    subtitle: str | None = None
    contract_version: str = "1"
    artifact: DocumentArtifactRecordOut | None = None
    download_path: str
    module_route: str | None = None
    import_supported: bool = False
    external_edit_supported: bool = False
    editable_cells: list[DocumentArtifactEditableCellOut] = Field(default_factory=list)
    sheets: list[DocumentArtifactSheetPreviewOut] = Field(default_factory=list)
    # AFG workspaces use this internal lineage value to allow sequential saves
    # from one open OnlyOffice workbook while still rejecting external writes.
    workspace_revision: int | None = None


class ExcelSessionCreateIn(AppBaseModel):
    kind: str
    key: str


class ExcelSessionOut(AppBaseModel):
    session_id: str
    kind: str
    key: str
    bearer_token: str | None = None
    status: str = "active"
    can_write: bool = False
    revision: int = 0
    file_name: str
    working_file_name: str
    created_at: datetime
    last_synced_at: datetime | None = None
    last_modified_at: datetime | None = None
    message: str | None = None
    blocking_errors: list[str] = Field(default_factory=list)


class ExcelSessionSyncOut(AppBaseModel):
    session_id: str
    status: str
    revision: int
    message: str
    last_modified_at: datetime | None = None
    blocking_errors: list[str] = Field(default_factory=list)


class ExcelSessionCloseOut(AppBaseModel):
    session_id: str
    status: str = "closed"


class OfficeDocumentLaunchOut(AppBaseModel):
    kind: str
    key: str
    launch_mode: str = "wopi-iframe"
    provider: str = "collabora"
    provider_label: str = "Collabora / LibreOffice"
    provider_branding_level: str = "vendor-dev-branding"
    title: str
    subtitle: str | None = None
    contract_version: str = "1"
    module_route: str | None = None
    fallback_route: str
    download_path: str
    artifact: DocumentArtifactRecordOut | None = None
    revision: int = 0
    can_write: bool = False
    import_supported: bool = False
    sheets: list[DocumentArtifactSheetPreviewOut] = Field(default_factory=list)
    office_available: bool = False
    office_reason: str | None = None
    editor_url: str | None = None
    access_token: str | None = None
    access_token_ttl: int | None = None
    onlyoffice_api_js_url: str | None = None
    onlyoffice_document_server_url: str | None = None
    onlyoffice_config: dict[str, Any] | None = None


class OfficeDocumentStatusOut(AppBaseModel):
    kind: str
    key: str
    provider: str = "collabora"
    provider_label: str = "Collabora / LibreOffice"
    provider_branding_level: str = "vendor-dev-branding"
    contract_version: str = "1"
    artifact: DocumentArtifactRecordOut | None = None
    revision: int = 0
    can_write: bool = False
    import_supported: bool = False
    office_available: bool = False
    live_sync_state: str = "idle"
    live_sync_message: str | None = None
    last_callback_at: datetime | None = None
    launch_revision: int | None = None
    applied_revision: int | None = None
    last_requested_save_id: int = 0
    last_applied_save_id: int = 0


class OfficeRuntimeStatusOut(AppBaseModel):
    provider: str = "collabora"
    provider_label: str = "Collabora / LibreOffice"
    provider_branding_level: str = "vendor-dev-branding"
    runtime_available: bool = False
    discovery_cached: bool = False
    last_discovery_checked_at: datetime | None = None
    runtime_url: str
    wopi_base_url: str
    callback_base_url: str | None = None
    reason: str | None = None


class OfficeForceSaveOut(AppBaseModel):
    accepted: bool = False
    state: str = "unavailable"
    detail: str | None = None
    save_id: int | None = None
