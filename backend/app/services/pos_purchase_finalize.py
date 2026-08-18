from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.enums import PosSessionStatusEnum, PosTradeSideEnum
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.schemas.pos import PosWorkspaceFinalizeRequest, PosWorkspaceFinalizeResponse
from app.services.uniconta_service import sync_pos_document_to_uniconta

LOGGER = logging.getLogger(__name__)


def _core():
    from app.services import pos_service as core

    return core


async def finalize_purchase_workspace(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceFinalizeRequest,
) -> PosWorkspaceFinalizeResponse:
    core = _core()
    # Concurrent finalize prevention: row lock al + DRAFT durumunu atomic kontrol et.
    # SQLite SERIALIZABLE varsayılan; PostgreSQL'de SELECT ... FOR UPDATE atomic lock.
    try:
        locked = (
            await session.execute(
                select(PosSession).where(PosSession.id == pos_session.id).with_for_update()
            )
        ).scalar_one_or_none()
    except Exception:
        # SQLite with_for_update yok sayar — kabul edilir (single connection).
        locked = pos_session
    if locked is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Çalışma alanı bulunamadı")
    if locked.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Çalışma alanı zaten kesinleştirilmiş veya iptal edilmiş.",
        )
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak alış workspace finalize edilebilir")

    trade_side = core._resolved_trade_side(pos_session)
    if trade_side != PosTradeSideEnum.BUY_FROM_CUSTOMER:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Çalışma alanı kesinleştirme işlemi yalnız alış akışı içindir.")
    if pos_session.customer_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Kesinleştirmeden önce müşteri seçin.")

    # A linked master customer may have a session-local workspace snapshot.
    # Finalizing must carry that snapshot into the document; otherwise the
    # system surface shows the cleared/edit value, but the saved document and
    # downstream sync silently resurrect the old User fields.
    effective_customer = await core._workspace_customer_from_session(session, pos_session)

    pos_lines = (
        await session.scalars(
            select(PosSessionLine)
            .where(PosSessionLine.pos_session_id == pos_session.id)
            .order_by(PosSessionLine.line_no.asc())
        )
    ).all()
    if not pos_lines:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Kesinleştirme için en az bir satır gerekli.")

    await core._sync_buy_session_summary_from_lines(session, pos_session=pos_session)
    target_total = core.quantize_2(
        sum((core.to_decimal(line.line_offer_dkk or Decimal("0")) for line in pos_lines), Decimal("0.00"))
    )
    if target_total <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Toplam teklif tutarı geçersiz")

    workspace_note = core._parse_workspace_note_payload(pos_session.notes)
    if payload.purchase_vat_enabled is not None:
        workspace_note["purchase_vat_enabled"] = bool(payload.purchase_vat_enabled)
    if payload.purchase_vat_rate_percent is not None:
        workspace_note["purchase_vat_rate_percent"] = str(
            core.quantize_2(core.to_decimal(payload.purchase_vat_rate_percent))
        )
    if payload.bank_info is not None:
        workspace_note["bank_info"] = {
            "reg_number": payload.bank_info.reg_number or "",
            "account_number": payload.bank_info.account_number or "",
        }
    if payload.payment_method is not None:
        workspace_note["payment_method"] = payload.payment_method if payload.payment_method in {"bank", "cash"} else "bank"
    bank_info = workspace_note.get("bank_info", {})
    payment_method = str(workspace_note.get("payment_method") or "bank").strip().lower()
    payment_method = payment_method if payment_method in {"bank", "cash"} else "bank"
    note_parts: list[str] = []
    if payload.notes and payload.notes.strip():
        note_parts.append(payload.notes.strip())
    note_parts.append("Betaling: Kontant" if payment_method == "cash" else "Betaling: Bankoverførsel")
    if payment_method == "bank" and (bank_info.get("reg_number") or bank_info.get("account_number")):
        reg = str(bank_info.get("reg_number") or "").strip() or "-"
        account = str(bank_info.get("account_number") or "").strip() or "-"
        note_parts.append(f"Overførsel: {reg} / {account}")
    finalized_notes = "\n".join(note_parts) or None
    workspace_note["freeform_note"] = payload.notes.strip() if payload.notes and payload.notes.strip() else None
    structured_notes = core._serialize_workspace_note_payload(workspace_note)
    vat_enabled = bool(workspace_note.get("purchase_vat_enabled", False))
    vat_rate = (
        core.quantize_2(core.to_decimal(workspace_note.get("purchase_vat_rate_percent") or Decimal("0.00")))
        if vat_enabled
        else Decimal("0.00")
    )
    vat_amount = core.quantize_2(target_total * vat_rate / Decimal("100"))
    gross_total = core.quantize_2(target_total + vat_amount)
    edit_source_session_id, edit_source_sequence_no = core._workspace_edit_source(pos_session.notes)

    first_line = pos_lines[0]
    pos_session.product_type = first_line.product_type
    pos_session.metal_type = first_line.metal_type
    pos_session.weight_grams = core.quantize_2(core.to_decimal(first_line.weight_grams))
    pos_session.purity_karat = first_line.purity_karat
    pos_session.purity_percentage = core.quantize_2(core.to_decimal(first_line.purity_percentage))
    pos_session.final_offer_dkk = gross_total
    pos_session.status = PosSessionStatusEnum.CONFIRMED
    pos_session.confirmed_at = core.utc_now()
    pos_session.notes = structured_notes

    if edit_source_session_id and edit_source_sequence_no:
        source_session = await core.get_pos_session_or_404(session, edit_source_session_id)
        source_document = await session.scalar(
            select(core.PosDocument).where(
                core.PosDocument.sequence_no == edit_source_sequence_no,
                core.PosDocument.pos_session_id == source_session.id,
            )
        )
        if source_document is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kaynak belge bulunamadı")

        source_transaction = await session.scalar(
            select(core.Transaction).where(core.Transaction.pos_session_id == source_session.id)
        )
        await core._replace_purchase_workspace_lines(
            session,
            target_session_id=source_session.id,
            source_lines=pos_lines,
        )
        source_session.customer_id = pos_session.customer_id
        source_session.product_type = first_line.product_type
        source_session.metal_type = first_line.metal_type
        source_session.weight_grams = core.quantize_2(core.to_decimal(first_line.weight_grams))
        source_session.purity_karat = first_line.purity_karat
        source_session.purity_percentage = core.quantize_2(core.to_decimal(first_line.purity_percentage))
        source_session.final_offer_dkk = gross_total
        source_session.notes = structured_notes
        source_session.status = PosSessionStatusEnum.CONFIRMED

        source_document.gross_amount_dkk = gross_total
        source_document.net_amount_dkk = target_total
        source_document.vat_rate_percent = vat_rate
        source_document.vat_amount_dkk = vat_amount
        source_document.customer_name = effective_customer.name or None
        source_document.customer_phone = effective_customer.phone
        source_document.customer_email = effective_customer.email
        source_document.customer_address = effective_customer.address
        source_document.customer_postal_code = effective_customer.postal_code
        source_document.customer_city = effective_customer.city
        source_document.notes = structured_notes

        if source_transaction is None:
            source_transaction, _ = await core._ensure_pos_transaction(
                session,
                pos_session=source_session,
                product=None,
                pos_document=source_document,
                trade_side=trade_side,
                amount_dkk=target_total,
                notes=finalized_notes,
            )
        else:
            source_transaction.status = "confirmed"
            source_transaction.customer_id = source_session.customer_id
            source_transaction.gross_amount_dkk = gross_total
            source_transaction.net_amount_dkk = target_total
            source_transaction.vat_rate_percent = vat_rate
            source_transaction.vat_amount_dkk = vat_amount
            source_transaction.notes = finalized_notes
            source_transaction.pos_document_sequence_no = source_document.sequence_no
            await core._replace_purchase_transaction_lines(
                session,
                transaction=source_transaction,
                source_lines=pos_lines,
            )

        source_display_lines = [core._to_display_line_out(line) for line in pos_lines]
        source_session.visible_snapshot = jsonable_encoder(
            core._to_display_out(
                source_session,
                lines=source_display_lines,
                document_kind="afregningsbilag",
                document_number=core._format_document_number(source_document),
            )
        )

        pos_session.status = PosSessionStatusEnum.CANCELLED
        pos_session.visible_snapshot = jsonable_encoder(core._to_display_out(pos_session))

        await session.commit()
        await session.refresh(source_session)
        await session.refresh(source_document)
        await session.refresh(source_transaction)
        await session.refresh(pos_session)

        await _sync_uniconta(session, source_document, source_session, pos_lines)

        core.realtime_hub.clear_display_preview(pos_session.display_token, session_code=pos_session.session_code)
        await core._emit_session_state(source_session)
        await core._emit_session_state(pos_session)
        return PosWorkspaceFinalizeResponse(
            session=core._to_clerk_out(source_session),
            document_sequence_no=source_document.sequence_no,
            document_number=core._format_document_number(source_document),
            transaction_id=source_transaction.id,
            line_count=len(pos_lines),
            uniconta_sync_status=source_document.uniconta_sync_status,
            uniconta_invoice_number=source_document.uniconta_invoice_number,
            uniconta_sync_error=source_document.uniconta_sync_error,
        )

    pos_document, _ = await core._ensure_pos_document(
        session,
        pos_session=pos_session,
        customer=pos_session.customer,
        trade_side=trade_side,
        amount_dkk=target_total,
        notes=structured_notes,
    )
    pos_document.customer_name = effective_customer.name or None
    pos_document.customer_phone = effective_customer.phone
    pos_document.customer_email = effective_customer.email
    pos_document.customer_address = effective_customer.address
    pos_document.customer_postal_code = effective_customer.postal_code
    pos_document.customer_city = effective_customer.city
    pos_document.gross_amount_dkk = gross_total
    pos_document.net_amount_dkk = target_total
    pos_document.vat_rate_percent = vat_rate
    pos_document.vat_amount_dkk = vat_amount
    transaction, _ = await core._ensure_pos_transaction(
        session,
        pos_session=pos_session,
        product=None,
        pos_document=pos_document,
        trade_side=trade_side,
        amount_dkk=target_total,
        notes=finalized_notes,
    )

    lines = [core._to_display_line_out(line) for line in pos_lines]
    pos_session.visible_snapshot = jsonable_encoder(
        core._to_display_out(
            pos_session,
            lines=lines,
            document_kind="afregningsbilag",
            document_number=core._format_document_number(pos_document),
        )
    )

    await session.commit()
    await session.refresh(pos_session)
    await session.refresh(pos_document)
    await session.refresh(transaction)

    await _sync_uniconta(session, pos_document, pos_session, pos_lines)

    core.realtime_hub.clear_display_preview(pos_session.display_token, session_code=pos_session.session_code)
    await core._emit_session_state(pos_session)
    return PosWorkspaceFinalizeResponse(
        session=core._to_clerk_out(pos_session),
        document_sequence_no=pos_document.sequence_no,
        document_number=core._format_document_number(pos_document),
        transaction_id=transaction.id,
        line_count=len(pos_lines),
        uniconta_sync_status=pos_document.uniconta_sync_status,
        uniconta_invoice_number=pos_document.uniconta_invoice_number,
        uniconta_sync_error=pos_document.uniconta_sync_error,
    )


async def _sync_uniconta(
    session: AsyncSession,
    pos_document,
    pos_session: PosSession,
    pos_lines: list[PosSessionLine],
) -> None:
    """Hybrid mode Uniconta sync — hata yutar, durum PosDocument'a yazılır.

    U15: Audit log entry — auto sync sonucunu (success/failed/skipped) `uniconta_auto_sync`
    action ile PosDocumentAudit'e yazıyor.
    """
    import json as _json
    from app.models.pos_document_audit import PosDocumentAudit

    def _audit(action: str, payload: dict, note: str | None = None) -> None:
        session.add(
            PosDocumentAudit(
                sequence_no=pos_document.sequence_no,
                pos_session_id=pos_session.id,
                action=action,
                actor_user_id=None,  # otomatik sistem aksiyonu
                actor_email="system:uniconta_finalize",
                payload_json=_json.dumps(payload, default=str, ensure_ascii=False),
                note=note,
            )
        )

    settings = get_settings()
    if not settings.uniconta_username or not settings.uniconta_password:
        LOGGER.info(
            "Uniconta sync skipped (credentials missing) for PosDocument seq=%s",
            pos_document.sequence_no,
        )
        pos_document.uniconta_sync_status = "skipped"
        pos_document.uniconta_sync_error = "Credential eksik (.env)"
        _audit("uniconta_auto_skipped", {"reason": "credentials missing"})
        await session.commit()
        return
    cache_dir = str(settings.document_root_path() / "uniconta")
    try:
        result = await sync_pos_document_to_uniconta(
            session,
            pos_document,
            pos_session=pos_session,
            pos_lines=pos_lines,
            pdf_cache_dir=cache_dir,
        )
        if result.get("ok"):
            LOGGER.info(
                "Uniconta sync OK: PosDocument seq=%s -> invoice=%s (idempotent=%s)",
                pos_document.sequence_no,
                result.get("invoice_number"),
                result.get("idempotent"),
            )
            _audit(
                "uniconta_auto_sync" if not result.get("idempotent") else "uniconta_auto_sync_idempotent",
                {
                    "ok": True,
                    "invoice_number": result.get("invoice_number"),
                    "pdf_path": result.get("pdf_path"),
                    "idempotent": bool(result.get("idempotent")),
                },
            )
        else:
            LOGGER.warning(
                "Uniconta sync failed (handled): PosDocument seq=%s reason=%s",
                pos_document.sequence_no,
                result.get("message"),
            )
            _audit(
                "uniconta_auto_failed",
                {"ok": False, "message": result.get("message")},
                note=str(result.get("message") or "")[:500] or None,
            )
        await session.commit()
        await session.refresh(pos_document)
    except Exception as exc:  # pragma: no cover — defansif (commit/refresh errors)
        LOGGER.exception(
            "Uniconta sync unexpected exception (rollback): PosDocument seq=%s",
            pos_document.sequence_no,
        )
        await session.rollback()
        _ = exc
