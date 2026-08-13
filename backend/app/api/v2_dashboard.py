from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.database import get_db
from app.models.user import User
from app.schemas.dashboard_overview import (
    DashboardMarketRateConfirmationIn,
    DashboardMarketRateConfirmationOut,
    DashboardOverviewOut,
)
from app.services.dashboard_overview import (
    build_dashboard_overview,
    build_market_rate_confirmation_state,
    record_market_rate_confirmation,
)


router = APIRouter()


@router.get("/overview", response_model=DashboardOverviewOut)
async def get_dashboard_overview(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> DashboardOverviewOut:
    """Return a local-only management snapshot; no remote API is called."""

    return await build_dashboard_overview(db)


@router.get(
    "/market-rate-confirmation",
    response_model=DashboardMarketRateConfirmationOut,
)
async def get_market_rate_confirmation(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> DashboardMarketRateConfirmationOut:
    return await build_market_rate_confirmation_state(db)


@router.post(
    "/market-rate-confirmation",
    response_model=DashboardMarketRateConfirmationOut,
)
async def post_market_rate_confirmation(
    payload: DashboardMarketRateConfirmationIn,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> DashboardMarketRateConfirmationOut:
    """Audit the active rate snapshot for today's Copenhagen business day.

    ``saved`` means the caller saved rates through the existing inventory
    settings flow immediately before confirming; ``unchanged`` confirms the
    already-active values.  This endpoint itself does not edit market rates.
    """

    result = await record_market_rate_confirmation(
        db,
        confirmed_by_user_id=admin.id,
        mode=payload.mode,
    )
    await db.commit()
    return result
