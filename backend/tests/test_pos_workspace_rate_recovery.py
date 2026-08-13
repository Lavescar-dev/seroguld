from __future__ import annotations

import asyncio
import json
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.config import Settings
from app.models.enums import (
    MetalTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.user import User
from app.schemas.pos import PosWorkspaceGoldRowInput, PosWorkspaceSectionsUpdate
from app.services.gold_price import GoldPriceService
from app.services import market_rate_profile
from app.services.pos_service import build_purchase_workspace
from app.services.pos_workspace_mutations import replace_purchase_workspace_sections


def test_zero_priced_draft_is_rendered_read_only_then_repaired_by_revisioned_put(monkeypatch) -> None:
    # This scenario exercises the live-rate repair path explicitly.  The
    # application default is manual mode, so the test must opt in instead of
    # depending on a legacy GOLD_PRICE_LIVE_ENABLED value from repo .env.
    live_settings = Settings(
        _env_file=None,
        database_url="sqlite+aiosqlite:///test.db",
        market_rates_live_enabled=True,
    )
    monkeypatch.setattr(market_rate_profile, "get_settings", lambda: live_settings)

    def fake_cached_rates(cls) -> dict[str, Decimal]:
        return {
            "gold": Decimal("615.50"),
            "silver": Decimal("7.80"),
            "platinum": Decimal("255.00"),
            "palladium": Decimal("268.00"),
        }

    # Workspace builders intentionally do not perform network I/O while a
    # mutation transaction is open.  Seed the in-memory cache through the
    # synchronous read path instead of patching the async live fetcher.
    monkeypatch.setattr(
        GoldPriceService,
        "cached_rates_or_fallback",
        classmethod(fake_cached_rates),
    )

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with Session() as session:
            clerk = User(email="rate-clerk@test.local", password_hash="x", name="Clerk", role=RoleEnum.ADMIN)
            customer = User(
                email="rate-customer@test.local",
                password_hash="x",
                name="Customer",
                role=RoleEnum.CUSTOMER,
            )
            session.add_all([clerk, customer])
            await session.flush()

            pos_session = PosSession(
                session_code="RATE0001",
                display_token="display-rate-recovery",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("22.00"),
                rate_source=PosRateSourceEnum.LIVE,
                live_rate_dkk=Decimal("0.00"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
                notes=json.dumps(
                    {
                        "kind": "purchase_workspace_v1",
                        "workspace_revision": 1,
                        "market_rates": {
                            "eur_dkk_fx": "7.45",
                            "gold_rates_eur": {
                                "8": "0.0000",
                                "14": "0.0000",
                                "18": "0.0000",
                                "21": "0.0000",
                                "21.6": "0.0000",
                                "22": "0.0000",
                                "24": "0.0000",
                            },
                            "silver_rates_eur": {
                                "999": "0.0000",
                                "925": "0.0000",
                                "830": "0.0000",
                                "800": "0.0000",
                            },
                            "gold_24k_dkk": "0.00",
                            "silver_dkk": "0.00",
                        },
                    }
                ),
            )
            session.add(pos_session)
            await session.flush()

            zero_line = PosSessionLine(
                pos_session_id=pos_session.id,
                line_no=1,
                product_type=ProductTypeEnum.JEWELRY,
                metal_type=MetalTypeEnum.YELLOW_GOLD,
                weight_grams=Decimal("22.00"),
                purity_karat="8K",
                purity_percentage=Decimal("33.30"),
                rate_dkk=Decimal("0.00"),
                margin_percent_internal=Decimal("22.00"),
                line_offer_dkk=Decimal("0.00"),
                notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:8"}),
            )
            session.add(zero_line)
            await session.commit()

            workspace = await build_purchase_workspace(session, pos_session=pos_session)

            assert workspace.workspace_revision == 1
            assert workspace.needs_price_repair is True
            assert workspace.market_rates.gold_24k_dkk == Decimal("615.50")
            assert workspace.gold_rows[0].rate_dkk == Decimal("205.17")
            assert workspace.gold_rows[0].unit_price_dkk == Decimal("160.03")
            assert workspace.gold_rows[0].line_total_dkk == Decimal("3520.66")

            await session.refresh(zero_line)
            await session.refresh(pos_session)
            assert zero_line.rate_dkk == Decimal("0.00")
            assert zero_line.line_offer_dkk == Decimal("0.00")
            assert pos_session.live_rate_dkk == Decimal("0.00")
            assert json.loads(pos_session.notes or "{}")["market_rates"]["gold_24k_dkk"] == "0.00"

            repaired = await replace_purchase_workspace_sections(
                session,
                pos_session=pos_session,
                payload=PosWorkspaceSectionsUpdate(
                    base_revision=workspace.workspace_revision,
                    market_rates=workspace.market_rates,
                    gold_rows=[
                        PosWorkspaceGoldRowInput(
                            karat=row.karat,
                            gram=row.gram,
                            avance_percent=row.avance_percent,
                        )
                        for row in workspace.gold_rows
                    ],
                ),
            )

            assert repaired.workspace_revision == 2
            assert repaired.needs_price_repair is False
            repaired_line = await session.get(PosSessionLine, repaired.gold_rows[0].line_id)
            assert repaired_line is not None
            assert repaired_line.rate_dkk == Decimal("205.17")
            assert repaired_line.line_offer_dkk == Decimal("3520.66")
            await session.refresh(pos_session)
            assert pos_session.rate_source == PosRateSourceEnum.LIVE
            assert pos_session.live_rate_dkk == Decimal("615.50")
            assert json.loads(pos_session.notes or "{}")["market_rates"]["gold_24k_dkk"] == "615.50"

            repeated = await build_purchase_workspace(session, pos_session=pos_session)
            assert repeated.workspace_revision == 2
            assert repeated.needs_price_repair is False
            assert repeated.gold_rows[0].line_total_dkk == Decimal("3520.66")

            with pytest.raises(HTTPException) as stale_write:
                await replace_purchase_workspace_sections(
                    session,
                    pos_session=pos_session,
                    payload=PosWorkspaceSectionsUpdate(
                        base_revision=1,
                        market_rates=repeated.market_rates,
                        gold_rows=[
                            PosWorkspaceGoldRowInput(
                                karat=row.karat,
                                gram=row.gram,
                                avance_percent=row.avance_percent,
                            )
                            for row in repeated.gold_rows
                        ],
                    ),
                )
            assert stale_write.value.status_code == 409

            manual_session = PosSession(
                session_code="RATE0002",
                display_token="display-manual-rate-recovery",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("22.00"),
                rate_source=PosRateSourceEnum.MANUAL,
                live_rate_dkk=Decimal("615.50"),
                manual_rate_dkk=Decimal("620.00"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
                notes=json.dumps(
                    {
                        "kind": "purchase_workspace_v1",
                        "workspace_revision": 1,
                        "market_rates": {
                            "eur_dkk_fx": "7.45",
                            "gold_rates_eur": {key: "0.0000" for key in ("8", "14", "18", "21", "21.6", "22", "24")},
                            "silver_rates_eur": {key: "0.0000" for key in ("999", "925", "830", "800")},
                            "gold_24k_dkk": "0.00",
                            "silver_dkk": "0.00",
                        },
                    }
                ),
            )
            session.add(manual_session)
            await session.flush()
            session.add(
                PosSessionLine(
                    pos_session_id=manual_session.id,
                    line_no=1,
                    product_type=ProductTypeEnum.JEWELRY,
                    metal_type=MetalTypeEnum.YELLOW_GOLD,
                    weight_grams=Decimal("1.00"),
                    purity_karat="24K",
                    purity_percentage=Decimal("99.90"),
                    rate_dkk=Decimal("0.00"),
                    margin_percent_internal=Decimal("0.00"),
                    line_offer_dkk=Decimal("0.00"),
                    notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:24"}),
                )
            )
            await session.commit()

            manual_workspace = await build_purchase_workspace(session, pos_session=manual_session)
            assert manual_workspace.market_rates.gold_24k_dkk == Decimal("620.00")
            assert manual_workspace.gold_rows[-1].line_total_dkk == Decimal("620.00")
            assert manual_workspace.needs_price_repair is True

            manual_repaired = await replace_purchase_workspace_sections(
                session,
                pos_session=manual_session,
                payload=PosWorkspaceSectionsUpdate(
                    base_revision=manual_workspace.workspace_revision,
                    market_rates=manual_workspace.market_rates,
                    gold_rows=[
                        PosWorkspaceGoldRowInput(
                            karat=row.karat,
                            gram=row.gram,
                            avance_percent=row.avance_percent,
                        )
                        for row in manual_workspace.gold_rows
                    ],
                ),
            )
            await session.refresh(manual_session)
            assert manual_repaired.needs_price_repair is False
            assert manual_session.rate_source == PosRateSourceEnum.MANUAL
            assert manual_session.manual_rate_dkk == Decimal("620.00")

            mixed_session = PosSession(
                session_code="RATE0003",
                display_token="display-mixed-rate-recovery",
                clerk_user_id=clerk.id,
                customer_id=customer.id,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent_internal=Decimal("22.00"),
                rate_source=PosRateSourceEnum.LIVE,
                live_rate_dkk=Decimal("0.00"),
                status=PosSessionStatusEnum.DRAFT,
                visible_snapshot={},
                notes=json.dumps(
                    {
                        "kind": "purchase_workspace_v1",
                        "workspace_revision": 1,
                        "market_rates": {
                            "eur_dkk_fx": "7.45",
                            "gold_rates_eur": {key: "0.0000" for key in ("8", "14", "18", "21", "21.6", "22", "24")},
                            "silver_rates_eur": {key: "0.0000" for key in ("999", "925", "830", "800")},
                            "gold_24k_dkk": "0.00",
                            "silver_dkk": "0.00",
                        },
                    }
                ),
            )
            session.add(mixed_session)
            await session.flush()
            session.add_all(
                [
                    PosSessionLine(
                        pos_session_id=mixed_session.id,
                        line_no=1,
                        product_type=ProductTypeEnum.JEWELRY,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("22.00"),
                        purity_karat="8K",
                        purity_percentage=Decimal("33.30"),
                        rate_dkk=Decimal("0.00"),
                        margin_percent_internal=Decimal("22.00"),
                        line_offer_dkk=Decimal("0.00"),
                        notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:8"}),
                    ),
                    PosSessionLine(
                        pos_session_id=mixed_session.id,
                        line_no=2,
                        product_type=ProductTypeEnum.JEWELRY,
                        metal_type=MetalTypeEnum.YELLOW_GOLD,
                        weight_grams=Decimal("22.00"),
                        purity_karat="14K",
                        purity_percentage=Decimal("58.50"),
                        rate_dkk=Decimal("150.00"),
                        margin_percent_internal=Decimal("22.00"),
                        line_offer_dkk=Decimal("3300.00"),
                        notes=json.dumps({"source": "purchase_workspace", "row_key": "gold:14"}),
                    ),
                ]
            )
            await session.commit()

            mixed_workspace = await build_purchase_workspace(session, pos_session=mixed_session)
            assert mixed_workspace.needs_price_repair is False
            assert mixed_workspace.gold_rows[0].line_total_dkk == Decimal("0.00")
            assert mixed_workspace.gold_rows[1].line_total_dkk == Decimal("3300.00")
            assert mixed_workspace.summary.total_amount_dkk == Decimal("3300.00")

        await engine.dispose()

    asyncio.run(scenario())
