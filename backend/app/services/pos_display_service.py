from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.customer_identity import CustomerIdentityDocument
from app.models.enums import PosDocumentTypeEnum, PosRateSourceEnum, PosTradeSideEnum
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.schemas.pos import PosDisplayLineOut, PosRealtimePreview, PosSessionDisplayOut, PosSessionOutClerk


def _core():
    from app.services import pos_service as core

    return core


def _customer_safe_snapshot(snapshot: PosSessionDisplayOut) -> PosSessionDisplayOut:
    """Return the public display contract without raw identity values.

    Display snapshots are available through token-authenticated public REST and
    websocket routes.  Keep the legacy optional fields for wire compatibility,
    but never serialize decrypted CPR or identity-document numbers.
    """

    return snapshot.model_copy(
        update={
            "customer_cpr": None,
            "customer_identity_doc_number": None,
        }
    )


def _to_display_out(
    pos_session: PosSession,
    *,
    trade_side_override: PosTradeSideEnum | str | None = None,
    lines: list[PosDisplayLineOut] | None = None,
    final_offer_override: Decimal | None | object = None,
    document_kind: str | None = None,
    document_number: str | None = None,
) -> PosSessionDisplayOut:
    core = _core()
    resolved_trade_side = core._resolved_trade_side(pos_session, trade_side_override=trade_side_override)
    customer = pos_session.customer
    note_payload = core._parse_workspace_note_payload(pos_session.notes)
    snapshot = core._workspace_draft_customer_from_note(note_payload)
    draft_customer = snapshot if snapshot is not None else (None if customer is not None else core._workspace_draft_customer_from_note(note_payload))
    if snapshot is not None and isinstance(note_payload.get("workspace_customer"), dict):
        effective_customer_name = snapshot.name
        effective_customer_phone = snapshot.phone
        effective_customer_email = snapshot.email
        effective_customer_address = snapshot.address
        effective_customer_postal_code = snapshot.postal_code
        effective_customer_city = snapshot.city
        effective_customer_cpr = snapshot.cpr_number
        customer_identity_doc_number = snapshot.identity_doc_number
    else:
        customer_address = core.decrypt_field(customer.address_encrypted) if customer else None
        customer_cpr = core.decrypt_field(customer.cpr_number_encrypted) if customer else None
        customer_identity_doc_number = None if customer is not None else (draft_customer.identity_doc_number if draft_customer else None)
        effective_customer_name = customer.name if customer else (draft_customer.name if draft_customer else None)
        effective_customer_phone = customer.phone if customer else (draft_customer.phone if draft_customer else None)
        effective_customer_email = customer.email if customer else (draft_customer.email if draft_customer else None)
        effective_customer_address = customer_address if customer else (draft_customer.address if draft_customer else None)
        effective_customer_postal_code = customer.postal_code if customer else (draft_customer.postal_code if draft_customer else None)
        effective_customer_city = str(note_payload.get("workspace_customer_city") or "").strip() or (
            customer.city if customer else (draft_customer.city if draft_customer else None)
        )
        effective_customer_cpr = customer_cpr if customer else (draft_customer.cpr_number if draft_customer else None)
    display_lines = lines or []
    lines_total: Decimal | None = None
    total_weight: Decimal | None = None
    total_pure: Decimal | None = None
    if display_lines:
        lines_total = core.quantize_2(
            sum((core.to_decimal(item.line_offer_dkk or Decimal("0")) for item in display_lines), Decimal("0.00"))
        )
        total_weight = core.quantize_2(
            sum((core.to_decimal(item.weight_grams or Decimal("0")) for item in display_lines), Decimal("0.00"))
        )
        total_pure = core.quantize_2(
            sum(
                (
                    core.to_decimal(item.weight_grams or Decimal("0"))
                    * (core.to_decimal(item.purity_percentage or Decimal("0")) / Decimal("100"))
                )
                for item in display_lines
            ),
        )

    if final_offer_override is core._DISPLAY_FINAL_DEFAULT:
        final_offer = pos_session.final_offer_dkk
        if resolved_trade_side == PosTradeSideEnum.BUY_FROM_CUSTOMER and lines_total is not None:
            final_offer = lines_total
    else:
        final_offer = final_offer_override

    return core.PosSessionDisplayOut(
        session_code=pos_session.session_code,
        status=pos_session.status,
        trade_side=resolved_trade_side,
        customer_name=effective_customer_name,
        customer_phone=effective_customer_phone,
        customer_email=effective_customer_email,
        customer_address=effective_customer_address,
        customer_postal_code=effective_customer_postal_code,
        customer_city=effective_customer_city,
        customer_cpr=None,
        customer_cpr_masked=core.mask_cpr(effective_customer_cpr),
        customer_identity_doc_number=None,
        customer_identity_doc_number_masked=core.mask_last4(customer_identity_doc_number),
        preview_sequence=None,
        workspace_revision=int(note_payload.get("workspace_revision") or 1),
        product_type=core._product_value(pos_session.product_type),
        metal_type=core._metal_value(pos_session.metal_type),
        weight_grams=pos_session.weight_grams,
        purity_karat=pos_session.purity_karat,
        purity_percentage=pos_session.purity_percentage,
        rate_dkk=core._active_rate(pos_session),
        final_offer_dkk=final_offer,
        line_count=len(display_lines),
        lines_total_dkk=lines_total,
        total_weight_grams=total_weight,
        total_pure_gold_grams=total_pure,
        document_kind=document_kind,
        document_number=document_number,
        lines=display_lines,
        updated_at=pos_session.updated_at,
    )


def _preview_workspace_totals(
    *,
    gold_rows: list[Any],
    silver_rows: list[Any],
    bar_rows: list[Any] = (),
    ptpd_rows: list[Any] = (),
) -> tuple[int, Decimal, Decimal, Decimal]:
    core = _core()
    active_line_count = 0
    total_amount = Decimal("0.00")
    total_weight = Decimal("0.00")
    total_pure = Decimal("0.00")

    for row in [*gold_rows, *silver_rows, *bar_rows, *ptpd_rows]:
        gram = core.to_decimal(row.gram or Decimal("0"))
        line_total = core.to_decimal(row.line_total_dkk or Decimal("0"))
        purity_percentage = core.to_decimal(row.purity_percentage or Decimal("0"))
        if gram > 0:
            active_line_count += 1
        total_weight += gram
        total_amount += line_total
        total_pure += gram * (purity_percentage / Decimal("100"))

    return (
        active_line_count,
        core.quantize_2(total_amount),
        core.quantize_2(total_weight),
        core.quantize_2(total_pure),
    )


async def _attach_display_workspace_rows(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    snapshot: PosSessionDisplayOut,
) -> PosSessionDisplayOut:
    core = _core()
    try:
        workspace = await core.build_purchase_workspace(session, pos_session=pos_session)
    except Exception:
        return snapshot

    kniv_rows = [
        row
        for row in [*workspace.calculators.gold_rows, *workspace.calculators.silver_rows]
        if row.count > 0 and row.total_weight > 0
    ]
    return snapshot.model_copy(
        update={
            "gold_rows": workspace.gold_rows,
            "silver_rows": workspace.silver_rows,
            "bar_rows": workspace.bar_rows,
            "ptpd_rows": workspace.ptpd_rows,
            "kniv_rows": kniv_rows,
        }
    )


def _to_clerk_out(pos_session: PosSession) -> PosSessionOutClerk:
    core = _core()
    return core.PosSessionOutClerk(
        id=pos_session.id,
        session_code=pos_session.session_code,
        display_token=pos_session.display_token,
        customer_id=pos_session.customer_id,
        customer_name=(pos_session.customer.name if pos_session.customer else None),
        trade_side=core._resolved_trade_side(pos_session),
        product_type=core._product_value(pos_session.product_type),
        metal_type=core._metal_value(pos_session.metal_type),
        weight_grams=pos_session.weight_grams,
        purity_karat=pos_session.purity_karat,
        purity_percentage=pos_session.purity_percentage,
        live_rate_dkk=pos_session.live_rate_dkk,
        manual_rate_dkk=pos_session.manual_rate_dkk,
        active_rate_dkk=core._active_rate(pos_session),
        rate_source=pos_session.rate_source,
        margin_percent_internal=pos_session.margin_percent_internal,
        final_offer_dkk=pos_session.final_offer_dkk,
        status=pos_session.status,
        created_at=pos_session.created_at,
        updated_at=pos_session.updated_at,
        confirmed_at=pos_session.confirmed_at,
    )


def clerk_snapshot(pos_session: PosSession) -> PosSessionOutClerk:
    return _to_clerk_out(pos_session)


async def display_snapshot(session: AsyncSession, pos_session: PosSession) -> PosSessionDisplayOut:
    core = _core()
    lines = await core._list_display_lines(session, pos_session.id)
    document_meta = await core._display_document_meta(session, pos_session.id)
    if not document_meta["document_number"]:
        document_meta = core._draft_display_document_meta(pos_session)
    snapshot = _to_display_out(
        pos_session,
        lines=lines,
        final_offer_override=core._DISPLAY_FINAL_DEFAULT,
        document_kind=document_meta["document_kind"],
        document_number=document_meta["document_number"],
    )
    snapshot = await core._overlay_display_customer_identity(session, pos_session=pos_session, snapshot=snapshot)
    snapshot = await _attach_display_workspace_rows(session, pos_session=pos_session, snapshot=snapshot)
    return _customer_safe_snapshot(core._overlay_cached_preview_customer(pos_session, snapshot))


async def build_realtime_display_snapshot(
    session: AsyncSession,
    pos_session: PosSession,
    payload: PosRealtimePreview,
) -> PosSessionDisplayOut:
    core = _core()
    trade_side = payload.trade_side if payload.trade_side is not None else core._resolved_trade_side(pos_session)
    product_type = payload.product_type if payload.product_type is not None else pos_session.product_type
    metal_type = payload.metal_type if payload.metal_type is not None else pos_session.metal_type
    weight_grams = payload.weight_grams if payload.weight_grams is not None else pos_session.weight_grams
    purity_karat = payload.purity_karat if payload.purity_karat is not None else pos_session.purity_karat
    purity_percentage = payload.purity_percentage if payload.purity_percentage is not None else pos_session.purity_percentage
    margin_percent = (
        payload.margin_percent_internal
        if payload.margin_percent_internal is not None
        else pos_session.margin_percent_internal
    )

    rate_source = payload.rate_source if payload.rate_source is not None else pos_session.rate_source
    live_rate = payload.live_rate_dkk if payload.live_rate_dkk is not None else pos_session.live_rate_dkk
    manual_rate = payload.manual_rate_dkk if payload.manual_rate_dkk is not None else pos_session.manual_rate_dkk

    active_rate: Decimal | None = None
    if rate_source == PosRateSourceEnum.MANUAL and manual_rate is not None:
        active_rate = core.to_decimal(manual_rate)
    elif live_rate is not None:
        active_rate = core.to_decimal(live_rate)

    preview_gold_rows = list(payload.preview_gold_rows or [])
    preview_silver_rows = list(payload.preview_silver_rows or [])
    preview_bar_rows = list(payload.preview_bar_rows or [])
    preview_ptpd_rows = list(payload.preview_ptpd_rows or [])
    preview_has_workspace_rows = (
        payload.preview_gold_rows is not None
        or payload.preview_silver_rows is not None
        or payload.preview_bar_rows is not None
        or payload.preview_ptpd_rows is not None
    )

    final_offer = core._calculate_offer(
        weight_grams=(core.to_decimal(weight_grams) if weight_grams is not None else None),
        purity_percentage=(core.to_decimal(purity_percentage) if purity_percentage is not None else None),
        active_rate=active_rate,
        trade_side=trade_side,
        margin_percent=(core.to_decimal(margin_percent) if margin_percent is not None else Decimal("0")),
    )

    lines: list[PosDisplayLineOut]
    if payload.preview_lines:
        lines = []
        for idx, source in enumerate(payload.preview_lines, start=1):
            source_rate = core.to_decimal(source.rate_dkk) if source.rate_dkk is not None else active_rate
            source_margin = (
                core.to_decimal(source.margin_percent_internal)
                if source.margin_percent_internal is not None
                else (core.to_decimal(margin_percent) if margin_percent is not None else Decimal("0"))
            )
            source_offer = (
                core.quantize_2(core.to_decimal(source.line_offer_dkk))
                if source.line_offer_dkk is not None
                else core._calculate_offer(
                    weight_grams=core.to_decimal(source.weight_grams),
                    purity_percentage=core.to_decimal(source.purity_percentage),
                    active_rate=source_rate,
                    trade_side=trade_side,
                    margin_percent=source_margin,
                )
            )
            lines.append(
                core.PosDisplayLineOut(
                    line_no=idx,
                    product_type=source.product_type,
                    metal_type=source.metal_type,
                    weight_grams=core.quantize_2(core.to_decimal(source.weight_grams)),
                    purity_karat=source.purity_karat,
                    purity_percentage=core.quantize_2(core.to_decimal(source.purity_percentage)),
                    rate_dkk=(core.quantize_2(source_rate) if source_rate is not None else None),
                    line_offer_dkk=source_offer,
                    notes=source.notes,
                )
            )
    else:
        lines = await core._list_display_lines(session, pos_session.id)

    lines_total: Decimal | None = None
    total_weight: Decimal | None = None
    total_pure: Decimal | None = None
    if lines:
        lines_total = core.quantize_2(
            sum((core.to_decimal(item.line_offer_dkk or Decimal("0")) for item in lines), Decimal("0.00"))
        )
        total_weight = core.quantize_2(
            sum((core.to_decimal(item.weight_grams or Decimal("0")) for item in lines), Decimal("0.00"))
        )
        total_pure = core.quantize_2(
            sum(
                (
                    core.to_decimal(item.weight_grams or Decimal("0"))
                    * (core.to_decimal(item.purity_percentage or Decimal("0")) / Decimal("100"))
                )
                for item in lines
            ),
        )
    line_count = len(lines)
    if preview_has_workspace_rows:
        line_count, lines_total, total_weight, total_pure = _preview_workspace_totals(
            gold_rows=preview_gold_rows,
            silver_rows=preview_silver_rows,
            bar_rows=preview_bar_rows,
            ptpd_rows=preview_ptpd_rows,
        )
    document_meta = await core._display_document_meta(session, pos_session.id)
    if not document_meta["document_number"]:
        document_meta = core._draft_display_document_meta(pos_session)
    if trade_side == PosTradeSideEnum.BUY_FROM_CUSTOMER and lines_total is not None:
        final_offer = lines_total

    customer = pos_session.customer
    note_payload = core._parse_workspace_note_payload(pos_session.notes)
    draft_customer = core._workspace_draft_customer_from_note(note_payload)
    workspace_snapshot = draft_customer if isinstance(note_payload.get("workspace_customer"), dict) else None
    customer_address = core.decrypt_field(customer.address_encrypted) if customer and workspace_snapshot is None else None
    customer_cpr = core.decrypt_field(customer.cpr_number_encrypted) if customer and workspace_snapshot is None else None
    identity_number = None
    if customer and workspace_snapshot is None:
        identity = await session.scalar(
            select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer.id)
        )
        identity_number = core.decrypt_field(identity.identity_doc_number_encrypted) if identity else None
    elif draft_customer is not None:
        identity_number = draft_customer.identity_doc_number
    resolved_identity_number = (
        payload.customer_identity_doc_number
        if payload.customer_identity_doc_number is not None
        else identity_number
    )
    snapshot = core.PosSessionDisplayOut(
        session_code=pos_session.session_code,
        status=pos_session.status,
        trade_side=trade_side,
        customer_name=(
            payload.customer_name
            if payload.customer_name is not None
            else (workspace_snapshot.name if workspace_snapshot else (customer.name if customer else (draft_customer.name if draft_customer else None)))
        ),
        customer_phone=(
            payload.customer_phone
            if payload.customer_phone is not None
            else (workspace_snapshot.phone if workspace_snapshot else (customer.phone if customer else (draft_customer.phone if draft_customer else None)))
        ),
        customer_email=(
            payload.customer_email
            if payload.customer_email is not None
            else (workspace_snapshot.email if workspace_snapshot else (customer.email if customer else (draft_customer.email if draft_customer else None)))
        ),
        customer_address=(
            payload.customer_address
            if payload.customer_address is not None
            else (workspace_snapshot.address if workspace_snapshot else (customer_address if customer else (draft_customer.address if draft_customer else None)))
        ),
        customer_postal_code=(
            payload.customer_postal_code
            if payload.customer_postal_code is not None
            else (workspace_snapshot.postal_code if workspace_snapshot else (customer.postal_code if customer else (draft_customer.postal_code if draft_customer else None)))
        ),
        customer_city=(
            payload.customer_city
            if payload.customer_city is not None
            else (workspace_snapshot.city if workspace_snapshot else (str(note_payload.get("workspace_customer_city") or "").strip() or (draft_customer.city if draft_customer else None)))
        ),
        customer_cpr=None,
        customer_cpr_masked=core.mask_cpr(
            payload.customer_cpr
            if payload.customer_cpr is not None
            else (workspace_snapshot.cpr_number if workspace_snapshot else (customer_cpr if customer else (draft_customer.cpr_number if draft_customer else None)))
        ),
        customer_identity_doc_number=None,
        customer_identity_doc_number_masked=core.mask_last4(resolved_identity_number),
        preview_sequence=payload.preview_sequence,
        workspace_revision=int(payload.workspace_revision or note_payload.get("workspace_revision") or 1),
        product_type=core._product_value(product_type),
        metal_type=core._metal_value(metal_type),
        weight_grams=(core.quantize_2(core.to_decimal(weight_grams)) if weight_grams is not None else None),
        purity_karat=purity_karat,
        purity_percentage=(core.quantize_2(core.to_decimal(purity_percentage)) if purity_percentage is not None else None),
        rate_dkk=(core.quantize_2(active_rate) if active_rate is not None else None),
        final_offer_dkk=final_offer,
        line_count=line_count,
        lines_total_dkk=lines_total,
        total_weight_grams=total_weight,
        total_pure_gold_grams=total_pure,
        document_kind=document_meta["document_kind"],
        document_number=document_meta["document_number"],
        lines=lines,
        updated_at=core.utc_now(),
    )
    if preview_has_workspace_rows:
        # "Preview asla silmez": snapshot önce sunucudaki tüm bölümlerle
        # (bar/ptpd/kniv dahil) doldurulur; payload'da GELEN bölümler üzerine
        # yazılır, gelmeyenler sunucu değerini korur. Eski davranış yalnız
        # gold/silver yazıp bar/ptpd'yi boş bırakıyordu (AFVENTER VARELINJER).
        snapshot = await _attach_display_workspace_rows(session, pos_session=pos_session, snapshot=snapshot)
        overlay: dict[str, Any] = {}
        if payload.preview_gold_rows is not None:
            overlay["gold_rows"] = preview_gold_rows
        if payload.preview_silver_rows is not None:
            overlay["silver_rows"] = preview_silver_rows
        if payload.preview_bar_rows is not None:
            overlay["bar_rows"] = preview_bar_rows
        if payload.preview_ptpd_rows is not None:
            overlay["ptpd_rows"] = preview_ptpd_rows
        snapshot = snapshot.model_copy(update=overlay)
    elif not payload.preview_lines:
        snapshot = await _attach_display_workspace_rows(session, pos_session=pos_session, snapshot=snapshot)
    return _customer_safe_snapshot(snapshot)
