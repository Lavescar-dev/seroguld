from __future__ import annotations

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_admin
from app.models.user import User
from app.schemas.antifraud import AntiFraudOrdersResponse, AntiFraudOrderOut
from app.services.antifraud_service import (
    _build_human_meta_fields,
    _build_risk_reasons,
    _extract_failed_rules,
    _translate_known_note_tr,
    get_antifraud_order_detail,
    list_recent_orders_antifraud,
    set_antifraud_manual_override,
)

router = APIRouter()


class AntiFraudOverrideIn(BaseModel):
    level: str = Field(pattern="^(low|medium|high)$")
    reason: str | None = Field(default=None, max_length=500)


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


@router.post("/orders/{order_id}/override", response_model=AntiFraudOrderOut)
async def post_order_override(
    order_id: int,
    payload: AntiFraudOverrideIn,
    admin: User = Depends(require_admin),
) -> AntiFraudOrderOut:
    """O9 — Operatör false-positive flag'ler veya manuel risk seviyesi atar.

    Woo'da `_wc_af_manual_override` meta'sına yazılır; sonraki fetch'lerde
    `_resolve_effective_risk` bunu en yüksek öncelikli kaynak olarak kabul eder.
    """
    return await set_antifraud_manual_override(
        order_id=order_id,
        level=payload.level,
        reason=payload.reason,
        actor_email=getattr(admin, "email", None),
    )
