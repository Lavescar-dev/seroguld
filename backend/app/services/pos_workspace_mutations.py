from __future__ import annotations

import json
import re
from decimal import Decimal

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import MetalTypeEnum, PosRateSourceEnum, PosSessionStatusEnum, PosTradeSideEnum, ProductTypeEnum
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.schemas.customer import CustomerUpdate
from app.schemas.pos import (
    PosSessionCreate,
    PosWorkspaceCustomerSelectRequest,
    PosWorkspaceCustomerUpdate,
    PosWorkspaceFinalizeRequest,
    PosWorkspaceFinalizeResponse,
    PosWorkspaceOut,
    PosWorkspaceSectionsUpdate,
)


def _core():
    from app.services import pos_service as core

    return core


def _validate_workspace_postal(value: str | None) -> str | None:
    postal = str(value or "").strip()
    if not postal:
        return None
    if not re.fullmatch(r"\d{4}", postal):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Posta kodu boş veya tam 4 rakam olmalı.",
        )
    return postal


async def _claim_workspace_revision(
    session: AsyncSession,
    core,
    pos_session: PosSession,
    base_revision: int | None,
) -> dict:
    original_notes = pos_session.notes
    note_payload = core._parse_workspace_note_payload(original_notes)
    current_revision = int(note_payload.get("workspace_revision") or 1)
    if base_revision is not None and int(base_revision) != current_revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "workspace_revision_conflict",
                "current_revision": current_revision,
                "message": "Workspace başka bir yüzeyde değişti; önce güncel taslağı alın.",
            },
        )
    note_payload["workspace_revision"] = current_revision + 1
    claimed_notes = core._serialize_workspace_note_payload(note_payload)
    original_notes_clause = PosSession.notes.is_(None) if original_notes is None else PosSession.notes == original_notes
    result = await session.execute(
        update(PosSession)
        .where(
            PosSession.id == pos_session.id,
            PosSession.status == PosSessionStatusEnum.DRAFT,
            original_notes_clause,
        )
        .values(notes=claimed_notes)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        await session.rollback()
        fresh = await session.get(PosSession, pos_session.id, populate_existing=True)
        fresh_payload = core._parse_workspace_note_payload(fresh.notes if fresh is not None else None)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "workspace_revision_conflict",
                "current_revision": int(fresh_payload.get("workspace_revision") or 1),
                "message": "Workspace başka bir yüzeyde değişti; önce güncel taslağı alın.",
            },
        )
    pos_session.notes = claimed_notes
    return note_payload


async def _lock_workspace_session(session: AsyncSession, pos_session: PosSession) -> PosSession:
    locked = await session.get(
        PosSession,
        pos_session.id,
        populate_existing=True,
        with_for_update=True,
    )
    if locked is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace bulunamadı")
    return locked


async def update_purchase_workspace_customer(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceCustomerUpdate,
) -> PosWorkspaceOut:
    core = _core()
    pos_session = await _lock_workspace_session(session, pos_session)
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak alış workspace güncellenebilir")

    customer = pos_session.customer
    if customer is None and pos_session.customer_id is not None:
        customer = await session.get(core.User, pos_session.customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Önce müşteri seçin")

    note_payload = await _claim_workspace_revision(session, core, pos_session, payload.base_revision)
    # Workspace edits remain session-local for identity/contact fields.  The
    # one master-data exception is a valid postal code: this fixes the
    # existing-customer edit path without making a temporary blank in the
    # workspace erase the canonical customer record.
    postal_value = _validate_workspace_postal(payload.postal_code) if "postal_code" in payload.model_fields_set else None
    if postal_value is not None:
        await core.update_customer(session, customer, CustomerUpdate(postal_code=postal_value))
        await session.refresh(pos_session)
    snapshot = core._workspace_draft_customer_payload(payload)
    snapshot["customer_id"] = str(customer.id)
    snapshot["postal_code"] = _validate_workspace_postal(snapshot.get("postal_code"))
    note_payload["workspace_customer"] = snapshot
    note_payload["workspace_customer_city"] = str(payload.city or "").strip() or None
    pos_session.notes = core._serialize_workspace_note_payload(note_payload)
    pos_session.visible_snapshot = jsonable_encoder(core._to_display_out(pos_session))
    await session.commit()
    await session.refresh(customer)
    await session.refresh(pos_session)
    await core._emit_session_state(pos_session)
    return await core.build_purchase_workspace(session, pos_session=pos_session)


async def update_purchase_workspace_draft_customer(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceCustomerUpdate,
) -> PosWorkspaceOut:
    core = _core()
    pos_session = await _lock_workspace_session(session, pos_session)
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak alış workspace güncellenebilir")

    note_payload = await _claim_workspace_revision(session, core, pos_session, payload.base_revision)
    note_payload["draft_customer"] = core._workspace_draft_customer_payload(payload)
    note_payload["draft_customer"]["postal_code"] = _validate_workspace_postal(
        note_payload["draft_customer"].get("postal_code")
    )
    note_payload["workspace_customer"] = note_payload["draft_customer"]
    note_payload["workspace_customer_city"] = str(payload.city or "").strip() or None
    pos_session.notes = core._serialize_workspace_note_payload(note_payload)
    pos_session.visible_snapshot = jsonable_encoder(core._to_display_out(pos_session))
    await session.commit()
    await session.refresh(pos_session)
    await core._emit_session_state(pos_session)
    return await core.build_purchase_workspace(session, pos_session=pos_session)


async def select_purchase_workspace_customer(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceCustomerSelectRequest,
) -> PosWorkspaceOut:
    core = _core()
    pos_session = await _lock_workspace_session(session, pos_session)
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak alış workspace güncellenebilir")

    customer = await core._resolve_customer(
        session,
        PosSessionCreate(
            customer_id=payload.customer_id,
            customer_new=payload.customer_new,
            trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
            force_new_session=True,
        ),
    )
    if customer is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Müşteri seçimi zorunlu")

    pos_session.customer_id = customer.id
    pos_session.customer = customer
    note_payload = await _claim_workspace_revision(session, core, pos_session, payload.base_revision)
    # Selecting a customer intentionally reseeds the session snapshot from
    # the selected master record.  It must not carry a previous customer's
    # clear/text into the new selection.
    note_payload["workspace_customer"] = None
    note_payload["draft_customer"] = {}
    note_payload["workspace_customer_city"] = (
        str(payload.customer_new.city or "").strip() or None if payload.customer_new else None
    )
    pos_session.notes = core._serialize_workspace_note_payload(note_payload)
    pos_session.visible_snapshot = jsonable_encoder(core._to_display_out(pos_session))
    await session.flush()
    await core._record_customer_activity_event(session, pos_session=pos_session, customer=customer)
    await session.commit()
    await session.refresh(pos_session)
    await core._emit_session_state(pos_session)
    return await core.build_purchase_workspace(session, pos_session=pos_session)


async def replace_purchase_workspace_sections(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceSectionsUpdate,
) -> PosWorkspaceOut:
    core = _core()
    pos_session = await _lock_workspace_session(session, pos_session)
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak alış workspace güncellenebilir")

    note_payload = await _claim_workspace_revision(session, core, pos_session, payload.base_revision)
    existing_market_rates = await core._workspace_market_rates_from_session(pos_session)
    if payload.market_rates is not None:
        market_rates = core._market_rate_payload_to_workspace(
            payload.market_rates.model_dump(),
            fallback_gold_24k_dkk=core.quantize_2(
                core.to_decimal(payload.market_rates.gold_24k_dkk or existing_market_rates.gold_24k_dkk)
            ),
            fallback_silver_dkk=core.quantize_2(
                core.to_decimal(payload.market_rates.silver_dkk or existing_market_rates.silver_dkk)
            ),
        )
    else:
        market_rates = existing_market_rates
    market_rates_changed = (
        payload.market_rates is not None
        and core._serialize_workspace_market_rates_payload(market_rates)
        != core._serialize_workspace_market_rates_payload(existing_market_rates)
    )
    note_payload["market_rates"] = core._serialize_workspace_market_rates_payload(market_rates)
    if payload.bank_info is not None:
        note_payload["bank_info"] = {
            "reg_number": payload.bank_info.reg_number or "",
            "account_number": payload.bank_info.account_number or "",
        }
    # Pydantic keeps explicit ``null`` in ``model_fields_set``.  The UI uses
    # null to mean “clear this note”; checking only ``is not None`` silently
    # kept the old value and made it respawn after the response rehydrate.
    if "afg_note" in payload.model_fields_set:
        note_payload["freeform_note"] = str(payload.afg_note).strip() or None
    if payload.calculators is not None:
        note_payload["calculators"] = core._serialize_workspace_calculators_payload(payload.calculators)
    if payload.payment_method is not None:
        note_payload["payment_method"] = payload.payment_method if payload.payment_method in {"bank", "cash"} else "bank"
    if payload.numbering is not None:
        note_payload["numbering"] = {
            "afregnings_number_next": str(payload.numbering.afregnings_number_next or "").strip(),
            "invoice_number_next": str(payload.numbering.invoice_number_next or "").strip(),
        }
    requested_invoice_gold_mode = (
        core.COMPANION_MODE_MANUAL
        if payload.invoice_gold is not None and payload.invoice_gold_mode is None
        else payload.invoice_gold_mode
    )
    next_invoice_gold_mode = core._normalize_workspace_companion_mode(
        requested_invoice_gold_mode if requested_invoice_gold_mode is not None else note_payload.get("invoice_gold_mode"),
        default=core.COMPANION_MODE_MANUAL if core._invoice_gold_sheet_has_content(note_payload.get("invoice_gold", {})) else core.COMPANION_MODE_AUTO,
    )
    note_payload["invoice_gold_mode"] = next_invoice_gold_mode
    if next_invoice_gold_mode == core.COMPANION_MODE_AUTO:
        note_payload["invoice_gold"] = {"rows": [], "footer_lines": ["", "", ""]}
    elif payload.invoice_gold is not None:
        note_payload["invoice_gold"] = {
            "rows": [
                {
                    "row_key": item.row_key,
                    "code": (str(item.code).strip() if item.code is not None else None),
                    "fineness": (str(item.fineness).strip() if item.fineness is not None else None),
                    "gram": str(core.quantize_2(core.to_decimal(item.gram))),
                }
                for item in payload.invoice_gold.rows
            ],
            "footer_lines": [str(value or "").strip() for value in (payload.invoice_gold.footer_lines + ["", "", ""])[:3]],
        }

    requested_invoice_misc_mode = (
        core.COMPANION_MODE_MANUAL
        if payload.invoice_misc is not None and payload.invoice_misc_mode is None
        else payload.invoice_misc_mode
    )
    next_invoice_misc_mode = core._normalize_workspace_companion_mode(
        requested_invoice_misc_mode if requested_invoice_misc_mode is not None else note_payload.get("invoice_misc_mode"),
        default=core.COMPANION_MODE_MANUAL if core._invoice_misc_sheet_has_content(note_payload.get("invoice_misc", {})) else core.COMPANION_MODE_AUTO,
    )
    note_payload["invoice_misc_mode"] = next_invoice_misc_mode
    if next_invoice_misc_mode == core.COMPANION_MODE_AUTO:
        note_payload["invoice_misc"] = {"rows": []}
    elif payload.invoice_misc is not None:
        note_payload["invoice_misc"] = {
            "rows": [
                {
                    "row_key": item.row_key,
                    "text": str(item.text or "").strip() or None,
                    "quantity": (str(core.quantize_2(core.to_decimal(item.quantity))) if item.quantity is not None else None),
                    "unit_price_dkk": str(core.quantize_2(core.to_decimal(item.unit_price_dkk))),
                }
                for item in payload.invoice_misc.rows
            ]
        }

    existing_lines = (
        await session.scalars(select(PosSessionLine).where(PosSessionLine.pos_session_id == pos_session.id))
    ).all()
    for line in existing_lines:
        await session.delete(line)
    await session.flush()

    next_line_no = 1
    for row in payload.gold_rows:
        gram = core.quantize_2(core.to_decimal(row.gram))
        if gram <= 0:
            continue
        definition = next((item for item in core.GOLD_WORKSPACE_ROWS if core.to_decimal(item["karat"]) == core.quantize_2(core.to_decimal(row.karat))), None)
        if definition is None:
            continue
        margin = core.quantize_2(core.to_decimal(row.avance_percent))
        rate = core._workspace_market_rate_dkk(market_rates, str(definition["row_key"]))
        unit_price = core._workspace_row_unit_price_from_matrix(rate_dkk=rate, avance_percent=margin)
        line = PosSessionLine(
            pos_session_id=pos_session.id,
            line_no=next_line_no,
            product_type=ProductTypeEnum.JEWELRY,
            metal_type=MetalTypeEnum.YELLOW_GOLD,
            weight_grams=gram,
            purity_karat=str(definition["label"]).upper(),
            purity_percentage=core.quantize_2(core.to_decimal(definition["purity_percentage"])),
            rate_dkk=rate,
            margin_percent_internal=margin,
            line_offer_dkk=core._workspace_row_line_total(unit_price_dkk=unit_price, gram=gram),
            notes=json.dumps(
                {
                    "source": "purchase_workspace",
                    "row_key": str(definition["row_key"]),
                    "type_label": f"Guld {str(definition['label']).upper()}",
                },
                ensure_ascii=True,
            ),
        )
        session.add(line)
        next_line_no += 1

    for row in payload.silver_rows:
        gram = core.quantize_2(core.to_decimal(row.gram))
        if gram <= 0:
            continue
        definition = next((item for item in core.SILVER_WORKSPACE_ROWS if str(item["type_code"]) == row.type_code), None)
        if definition is None:
            continue
        margin = core.quantize_2(core.to_decimal(row.avance_percent))
        rate = core._workspace_market_rate_dkk(market_rates, str(definition["row_key"]))
        unit_price = core._workspace_row_unit_price_from_matrix(rate_dkk=rate, avance_percent=margin)
        line = PosSessionLine(
            pos_session_id=pos_session.id,
            line_no=next_line_no,
            product_type=ProductTypeEnum.JEWELRY,
            metal_type=MetalTypeEnum.SILVER,
            weight_grams=gram,
            purity_karat=None,
            purity_percentage=core.quantize_2(core.to_decimal(definition["purity_percentage"])),
            rate_dkk=rate,
            margin_percent_internal=margin,
            line_offer_dkk=core._workspace_row_line_total(unit_price_dkk=unit_price, gram=gram),
            notes=json.dumps(
                {
                    "source": "purchase_workspace",
                    "row_key": str(definition["row_key"]),
                    "type_label": str(definition["label"]),
                },
                ensure_ascii=True,
            ),
        )
        session.add(line)
        next_line_no += 1

    pos_session.notes = core._serialize_workspace_note_payload(note_payload)
    gold_24k_dkk = core.quantize_2(core.to_decimal(market_rates.gold_24k_dkk))
    if market_rates_changed:
        pos_session.manual_rate_dkk = gold_24k_dkk
        pos_session.rate_source = PosRateSourceEnum.MANUAL
    elif pos_session.rate_source != PosRateSourceEnum.MANUAL:
        pos_session.live_rate_dkk = gold_24k_dkk
        pos_session.rate_source = PosRateSourceEnum.LIVE
    await session.flush()
    await core._sync_buy_session_summary_from_lines(session, pos_session=pos_session)
    await session.commit()
    await session.refresh(pos_session)
    await core._emit_session_state(pos_session)
    return await core.build_purchase_workspace(session, pos_session=pos_session)


async def finalize_purchase_workspace(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceFinalizeRequest,
) -> PosWorkspaceFinalizeResponse:
    from app.services import pos_purchase_finalize

    return await pos_purchase_finalize.finalize_purchase_workspace(
        session,
        pos_session=pos_session,
        payload=payload,
    )


async def cancel_session(session: AsyncSession, *, pos_session: PosSession):
    core = _core()
    pos_session = await _lock_workspace_session(session, pos_session)
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturum iptal edilebilir")

    pos_session.status = PosSessionStatusEnum.CANCELLED
    pos_session.visible_snapshot = jsonable_encoder(core._to_display_out(pos_session))
    core.realtime_hub.clear_display_preview(pos_session.display_token, session_code=pos_session.session_code)

    await session.commit()
    await session.refresh(pos_session)

    await core._emit_session_state(pos_session)
    return core._to_clerk_out(pos_session)
