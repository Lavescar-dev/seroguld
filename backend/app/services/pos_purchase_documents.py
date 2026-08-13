from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.enums import PosDocumentTypeEnum, PosSessionStatusEnum
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.services.pos_workspace_exports import (
    build_purchase_workbook_bytes,
    render_purchase_workspace_print_html,
    workspace_csv_escape,
    workspace_payment_label,
    workspace_preview_document_number,
    workspace_preview_lines,
)
from app.utils.helpers import quantize_2, to_decimal


def _core():
    from app.services import pos_service as core

    return core


async def _clone_purchase_workspace_lines(
    session: AsyncSession,
    *,
    source_session_id,
    target_session_id,
) -> list[PosSessionLine]:
    source_lines = (
        await session.scalars(
            select(PosSessionLine)
            .where(PosSessionLine.pos_session_id == source_session_id)
            .order_by(PosSessionLine.line_no.asc())
        )
    ).all()

    cloned: list[PosSessionLine] = []
    for source_line in source_lines:
        cloned_line = PosSessionLine(
            pos_session_id=target_session_id,
            line_no=source_line.line_no,
            product_type=source_line.product_type,
            metal_type=source_line.metal_type,
            weight_grams=quantize_2(to_decimal(source_line.weight_grams)),
            purity_karat=source_line.purity_karat,
            purity_percentage=quantize_2(to_decimal(source_line.purity_percentage)),
            rate_dkk=(quantize_2(to_decimal(source_line.rate_dkk)) if source_line.rate_dkk is not None else None),
            margin_percent_internal=quantize_2(to_decimal(source_line.margin_percent_internal)),
            line_offer_dkk=(
                quantize_2(to_decimal(source_line.line_offer_dkk)) if source_line.line_offer_dkk is not None else None
            ),
            notes=source_line.notes,
        )
        session.add(cloned_line)
        cloned.append(cloned_line)
    await session.flush()
    return cloned


async def _replace_purchase_workspace_lines(
    session: AsyncSession,
    *,
    target_session_id,
    source_lines: list[PosSessionLine],
) -> None:
    await session.execute(delete(PosSessionLine).where(PosSessionLine.pos_session_id == target_session_id))
    await session.flush()
    for source_line in source_lines:
        session.add(
            PosSessionLine(
                pos_session_id=target_session_id,
                line_no=source_line.line_no,
                product_type=source_line.product_type,
                metal_type=source_line.metal_type,
                weight_grams=quantize_2(to_decimal(source_line.weight_grams)),
                purity_karat=source_line.purity_karat,
                purity_percentage=quantize_2(to_decimal(source_line.purity_percentage)),
                rate_dkk=(quantize_2(to_decimal(source_line.rate_dkk)) if source_line.rate_dkk is not None else None),
                margin_percent_internal=quantize_2(to_decimal(source_line.margin_percent_internal)),
                line_offer_dkk=(
                    quantize_2(to_decimal(source_line.line_offer_dkk)) if source_line.line_offer_dkk is not None else None
                ),
                notes=source_line.notes,
            )
        )
    await session.flush()


async def _replace_purchase_transaction_lines(
    session: AsyncSession,
    *,
    transaction: Transaction,
    source_lines: list[PosSessionLine],
) -> None:
    core = _core()
    await session.execute(delete(TransactionLine).where(TransactionLine.transaction_id == transaction.id))
    await session.flush()

    for source_line in source_lines:
        pure_gold_grams = quantize_2(
            to_decimal(source_line.weight_grams) * (to_decimal(source_line.purity_percentage) / Decimal("100"))
        )
        session.add(
            TransactionLine(
                transaction_id=transaction.id,
                line_no=source_line.line_no,
                product_id=None,
                product_number=None,
                reference_number=None,
                product_type=core._product_value(source_line.product_type),
                metal_type=core._metal_value(source_line.metal_type),
                weight_grams=quantize_2(to_decimal(source_line.weight_grams)),
                purity_karat=source_line.purity_karat,
                purity_percentage=quantize_2(to_decimal(source_line.purity_percentage)),
                pure_gold_grams=pure_gold_grams,
                rate_dkk=(quantize_2(to_decimal(source_line.rate_dkk)) if source_line.rate_dkk is not None else None),
                margin_percent=quantize_2(to_decimal(source_line.margin_percent_internal or Decimal("0"))),
                line_total_dkk=quantize_2(to_decimal(source_line.line_offer_dkk or Decimal("0"))),
            )
        )
    await session.flush()


async def open_purchase_document_for_edit(
    session: AsyncSession,
    *,
    sequence_no: int,
    clerk_user,
):
    core = _core()
    row = (
        await session.execute(
            select(core.PosDocument, PosSession)
            .join(PosSession, PosSession.id == core.PosDocument.pos_session_id)
            .where(core.PosDocument.sequence_no == sequence_no)
            .options(selectinload(PosSession.customer), selectinload(PosSession.clerk_user))
            .limit(1)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Belge bulunamadı")

    source_document, source_session = row
    if source_document.document_type != PosDocumentTypeEnum.PURCHASE_RECEIPT:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Sadece alış belgeleri düzenlenebilir")
    if source_session.status == PosSessionStatusEnum.CANCELLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Belge iptal edilmiş")

    draft_rows = (
        await session.scalars(
            select(PosSession)
            .where(
                PosSession.clerk_user_id == clerk_user.id,
                PosSession.status == PosSessionStatusEnum.DRAFT,
            )
            .order_by(PosSession.updated_at.desc(), PosSession.created_at.desc())
            .options(selectinload(PosSession.customer), selectinload(PosSession.clerk_user))
        )
    ).all()
    for draft in draft_rows:
        edit_source_session_id, edit_source_sequence_no = core._workspace_edit_source(draft.notes)
        if edit_source_session_id == source_session.id and edit_source_sequence_no == source_document.sequence_no:
            return await core.build_purchase_workspace(session, pos_session=draft)

    source_note_payload = core._parse_workspace_note_payload(source_document.notes or source_session.notes)
    payment_method = core.extract_purchase_payment_method(source_document.notes or source_session.notes) or "bank"
    bank_reg_number, bank_account_number = core.extract_purchase_bank_info(source_document.notes or source_session.notes)
    note_payload = source_note_payload
    note_payload["payment_method"] = payment_method
    note_payload["bank_info"] = {
        "reg_number": bank_reg_number or "",
        "account_number": bank_account_number or "",
    }
    note_payload["edit_source_session_id"] = str(source_session.id)
    note_payload["edit_source_sequence_no"] = int(source_document.sequence_no)
    if not str(note_payload.get("numbering", {}).get("afregnings_number_next") or "").strip():
        note_payload["numbering"] = {
            **(note_payload.get("numbering") if isinstance(note_payload.get("numbering"), dict) else {}),
            "afregnings_number_next": str(1000 + source_document.sequence_no),
            "invoice_number_next": str(note_payload.get("numbering", {}).get("invoice_number_next") or "").strip(),
        }

    edit_session = PosSession(
        session_code=core._random_session_code(),
        display_token=core._random_display_token(),
        clerk_user_id=clerk_user.id,
        customer_id=source_session.customer_id,
        trade_side=source_session.trade_side,
        product_type=source_session.product_type,
        metal_type=source_session.metal_type,
        weight_grams=source_session.weight_grams,
        purity_karat=source_session.purity_karat,
        purity_percentage=source_session.purity_percentage,
        live_rate_dkk=source_session.live_rate_dkk,
        manual_rate_dkk=source_session.manual_rate_dkk,
        rate_source=source_session.rate_source,
        margin_percent_internal=source_session.margin_percent_internal,
        final_offer_dkk=source_session.final_offer_dkk,
        visible_snapshot={},
        notes=core._serialize_workspace_note_payload(note_payload),
        status=PosSessionStatusEnum.DRAFT,
    )
    session.add(edit_session)
    await session.flush()
    await _clone_purchase_workspace_lines(
        session,
        source_session_id=source_session.id,
        target_session_id=edit_session.id,
    )
    await core._sync_buy_session_summary_from_lines(session, pos_session=edit_session)
    edit_session.visible_snapshot = jsonable_encoder(core._to_display_out(edit_session))

    await session.commit()
    await session.refresh(edit_session)
    await core._emit_session_state(edit_session)
    return await core.build_purchase_workspace(session, pos_session=edit_session)


async def delete_purchase_document(
    session: AsyncSession,
    *,
    sequence_no: int,
) -> None:
    core = _core()
    row = (
        await session.execute(
            select(core.PosDocument, PosSession, Transaction)
            .join(PosSession, PosSession.id == core.PosDocument.pos_session_id)
            .outerjoin(Transaction, Transaction.pos_document_sequence_no == core.PosDocument.sequence_no)
            .where(core.PosDocument.sequence_no == sequence_no)
            .limit(1)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Belge bulunamadı")

    pos_document, pos_session, transaction = row
    if pos_document.document_type != PosDocumentTypeEnum.PURCHASE_RECEIPT:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Sadece alış belgeleri silinebilir")
    if pos_session.status == PosSessionStatusEnum.CANCELLED:
        return

    pos_session.status = PosSessionStatusEnum.CANCELLED
    pos_session.visible_snapshot = jsonable_encoder(core._to_display_out(pos_session))
    if transaction is not None:
        transaction.status = "cancelled"
        transaction.notes = transaction.notes or "Belge iptal edildi"

    await session.commit()
    await session.refresh(pos_session)
    await core._emit_session_state(pos_session)


async def build_purchase_workspace_csv_export(
    session: AsyncSession,
    *,
    pos_session: PosSession,
) -> tuple[str, str]:
    core = _core()
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dışa aktarma yalnız etkin alış çalışma alanı için hazırlanabilir.")
    workspace = await core.build_purchase_workspace(session, pos_session=pos_session)
    payment_method = core._workspace_payment_method_from_session(pos_session)
    lines = workspace_preview_lines(workspace)
    rows: list[list[str | Decimal | int | None]] = [
        ["Afregningsnr.", workspace_preview_document_number(workspace)],
        ["Dato", workspace.session.updated_at.strftime("%d.%m.%Y %H:%M")],
        ["Navn", workspace.customer.name or "—"],
        ["CPR", workspace.customer.cpr_number or "—"],
        ["Kørekort / Pas", workspace.customer.identity_doc_number or "—"],
        ["Telefon", workspace.customer.phone or "—"],
        ["E-mail", workspace.customer.email or "—"],
        ["Adresse", workspace.customer.address or "—"],
        ["Postnr.", workspace.customer.postal_code or "—"],
        [],
        ["Type", "Saflık", "Lødighed", "Gram", "Avance %", "Birim", "Toplam"],
        *[
            [
                line["type"],
                line["fineness"],
                line["lodighed"],
                line["gram"],
                line["avance"],
                line["unit_price"],
                line["line_total"],
            ]
            for line in lines
        ],
        [],
        ["Ödeme", workspace_payment_label(payment_method)],
        ["Reg.nr.", "—" if payment_method == "cash" else (workspace.bank_info.reg_number or "—")],
        ["Kontonr.", "—" if payment_method == "cash" else (workspace.bank_info.account_number or "—")],
        ["Toplam", core._fmt_decimal(workspace.summary.total_amount_dkk)],
    ]
    csv_payload = "\n".join(";".join(workspace_csv_escape(cell) for cell in row) for row in rows)
    filename = f"AFG-{workspace_preview_document_number(workspace).replace('/', '-')}.csv"
    return filename, "\ufeff" + csv_payload


async def build_purchase_workspace_xlsx_export(
    session: AsyncSession,
    *,
    pos_session: PosSession,
) -> tuple[str, bytes]:
    core = _core()
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dışa aktarma yalnız etkin alış çalışma alanı için hazırlanabilir.")
    workspace = await core.build_purchase_workspace(session, pos_session=pos_session)
    document_number = workspace_preview_document_number(workspace)
    lines = workspace_preview_lines(workspace)
    payload = build_purchase_workbook_bytes(
        document_number=document_number,
        issued_at=workspace.session.updated_at,
        customer=workspace.customer,
        payment_method=core._workspace_payment_method_from_session(pos_session),
        bank_info=workspace.bank_info,
        lines=lines,
        net_amount_dkk=workspace.summary.net_amount_dkk,
        vat_rate_percent=workspace.summary.vat_rate_percent,
        vat_amount_dkk=workspace.summary.vat_amount_dkk,
        gross_amount_dkk=workspace.summary.gross_amount_dkk,
        note=workspace.afg_note,
    )
    return f"AFG-{document_number.replace('/', '-')}.xlsx", payload


async def build_purchase_workspace_print_html(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    auto_print: bool = True,
) -> str:
    core = _core()
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yazdırma önizlemesi yalnız etkin alış çalışma alanı için hazırlanabilir.")
    workspace = await core.build_purchase_workspace(session, pos_session=pos_session)
    return render_purchase_workspace_print_html(
        workspace=workspace,
        payment_method=core._workspace_payment_method_from_session(pos_session),
        lines=workspace_preview_lines(workspace),
        auto_print=auto_print,
    )
