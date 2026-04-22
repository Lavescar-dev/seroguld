from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_admin
from app.schemas.antifraud import AntiFraudOrdersResponse, AntiFraudOrderOut
from app.services.antifraud_service import (
    _build_human_meta_fields,
    _build_risk_reasons,
    _extract_failed_rules,
    _translate_known_note_tr,
    get_antifraud_order_detail,
    list_recent_orders_antifraud,
)

router = APIRouter()


@router.get("/recent-orders", response_model=AntiFraudOrdersResponse)
async def get_recent_orders(
    days: int = Query(default=30, ge=1, le=365),
    per_page: int = Query(default=25, ge=1, le=100),
    include_notes: bool = Query(default=False),
    notes_per_order: int = Query(default=5, ge=1, le=20),
    detail_mode: bool = Query(default=False),
    _=Depends(require_admin),
) -> AntiFraudOrdersResponse:
    return await list_recent_orders_antifraud(
        days=days,
        per_page=per_page,
        include_notes=include_notes,
        notes_per_order=notes_per_order,
        detail_mode=detail_mode,
    )


@router.get("/orders/{order_id}", response_model=AntiFraudOrderOut)
async def get_order_detail(
    order_id: int,
    include_notes: bool = Query(default=True),
    notes_per_order: int = Query(default=10, ge=1, le=20),
    _=Depends(require_admin),
) -> AntiFraudOrderOut:
    return await get_antifraud_order_detail(
        order_id=order_id,
        include_notes=include_notes,
        notes_per_order=notes_per_order,
    )
