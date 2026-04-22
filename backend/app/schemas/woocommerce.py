from __future__ import annotations

from pydantic import Field

from app.schemas.base import AppBaseModel
from app.schemas.inventory import InventoryGridRowOut


class WooWorkspaceSummaryOut(AppBaseModel):
    total_products: int = 0
    published_products: int = 0
    draft_products: int = 0
    unpublished_products: int = 0
    photo_pending_products: int = 0


class WooWorkspaceOut(AppBaseModel):
    summary: WooWorkspaceSummaryOut
    rows: list[InventoryGridRowOut] = Field(default_factory=list)
