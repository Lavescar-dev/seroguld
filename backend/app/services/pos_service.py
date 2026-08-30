from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.customer_activity import CustomerActivityEvent
from app.models.customer_identity import CustomerIdentityDocument
from app.models.enums import (
    MetalTypeEnum,
    PosDocumentTypeEnum,
    PosRateSourceEnum,
    PosSessionStatusEnum,
    PosTradeSideEnum,
    ProductStatusEnum,
    ProductTypeEnum,
    RoleEnum,
)
from app.models.pos_document import PosDocument
from app.models.pos_session import PosSession
from app.models.pos_session_line import PosSessionLine
from app.models.pos_session_product_link import PosSessionProductLink
from app.models.product import Product
from app.models.product_history import ProductHistory
from app.models.transaction import Transaction
from app.models.transaction_line import TransactionLine
from app.models.user import User
from app.schemas.customer import CustomerCreate, CustomerUpdate
from app.schemas.pos import (
    PosConfirmRequest,
    PosConfirmResponse,
    PosWorkspaceCalculatorsOut,
    PosWorkspaceCalculatorsUpdate,
    PosWorkspaceCalculatorRowOut,
    PosDisplayLineOut,
    PosManualRateUpdate,
    PosQuoteUpdate,
    PosRealtimePreview,
    PosSessionLineBulkCreate,
    PosSessionLineCreate,
    PosSessionLineOut,
    PosSessionLineUpdate,
    PosSessionCreate,
    PosSessionDisplayOut,
    PosSessionOutClerk,
    PosRealtimePreviewLine,
    PosWorkspaceBankInfo,
    PosWorkspaceCustomerOut,
    PosWorkspaceCustomerSelectRequest,
    PosWorkspaceCustomerUpdate,
    PosWorkspaceFinalizeRequest,
    PosWorkspaceFinalizeResponse,
    PosWorkspaceBarRowOut,
    PosWorkspacePtPdRowOut,
    PosWorkspaceExtraRowOut,
    PosWorkspaceGoldRowOut,
    PosWorkspaceInvoiceGoldRowOut,
    PosWorkspaceInvoiceGoldSheetOut,
    PosWorkspaceInvoiceGoldSheetUpdate,
    PosWorkspaceInvoiceMiscRowOut,
    PosWorkspaceInvoiceMiscSheetOut,
    PosWorkspaceInvoiceMiscSheetUpdate,
    PosWorkspaceMarketRates,
    PosWorkspaceNumberingOut,
    PosWorkspaceOpenRequest,
    PosWorkspaceOut,
    PosWorkspaceSectionsUpdate,
    PosWorkspaceSilverRowOut,
    PosWorkspaceSummaryOut,
)
from app.schemas.product import ProductCreate, ProductStatusUpdate
from app.services.customer_service import create_customer, update_customer
from app.services.gold_price import GoldPriceService
from app.services.pos_document_service import (
    customer_party_label as _customer_party_label,
    document_title_tr as _document_title_tr,
    ensure_pos_document as _ensure_pos_document,
    format_document_number as _format_document_number,
    seller_address_line as _seller_address_line,
)
from app.services.product_service import create_product
from app.services.product_service import get_product_or_404 as get_inventory_product_or_404
from app.services.product_service import update_status
from app.services.pos_receipt_renderer import render_pos_receipt_html, render_pos_receipt_pdf
from app.services.pos_transaction_service import ensure_pos_transaction as _ensure_pos_transaction
from app.services import (
    pos_display_service,
    pos_purchase_documents,
    pos_purchase_finalize,
    pos_workspace_mutations,
    pos_workspace_state,
)
from app.services.pos_value_helpers import (
    active_rate as _active_rate,
    calculate_offer as _calculate_offer,
    display_metal_type as _display_metal_type,
    display_product_type as _display_product_type,
    fmt_decimal as _fmt_decimal,
    metal_rate_key as _metal_rate_key,
    metal_value as _metal_value,
    product_value as _product_value,
    recalculate_pos_session as _recalculate,
    resolved_trade_side as _resolved_trade_side,
)
from app.services.realtime import realtime_hub
from app.services.sequence_service import (
    consume_reference_number,
    preview_afregnings_number,
    preview_invoice_number,
    preview_product_number,
    preview_reference_number,
)
from app.utils.helpers import quantize_2, to_decimal, utc_now
from app.utils.security import decrypt_field, hash_sensitive_value, mask_cpr, mask_last4

settings = get_settings()
DEFAULT_POS_MARGIN_PERCENT = Decimal("8.00")
SALE_OVERRIDE_EPSILON = Decimal("0.01")
_DISPLAY_FINAL_DEFAULT = object()
WORKSPACE_NOTE_KIND = "purchase_workspace_v1"
DEFAULT_EUR_DKK_FX = Decimal("7.45")

GOLD_WORKSPACE_ROWS: tuple[dict[str, str | Decimal], ...] = (
    {"row_key": "gold:8", "karat": Decimal("8.0"), "label": "8k", "lodighed": "333", "purity_percentage": Decimal("33.30")},
    {"row_key": "gold:14", "karat": Decimal("14.0"), "label": "14k", "lodighed": "585", "purity_percentage": Decimal("58.50")},
    {"row_key": "gold:18", "karat": Decimal("18.0"), "label": "18k", "lodighed": "750", "purity_percentage": Decimal("75.00")},
    {"row_key": "gold:21", "karat": Decimal("21.0"), "label": "21k", "lodighed": "875", "purity_percentage": Decimal("87.50")},
    {"row_key": "gold:21.6", "karat": Decimal("21.6"), "label": "21.6k", "lodighed": "900", "purity_percentage": Decimal("90.00")},
    # 22K lødighed şablonun kendi formülüyle (CEILING) uyumlu: 916, 917 değil.
    {"row_key": "gold:22", "karat": Decimal("22.0"), "label": "22k", "lodighed": "916", "purity_percentage": Decimal("91.60")},
    {"row_key": "gold:24", "karat": Decimal("24.0"), "label": "24k", "lodighed": "999", "purity_percentage": Decimal("99.90")},
)

SILVER_WORKSPACE_ROWS: tuple[dict[str, str | Decimal], ...] = (
    {"row_key": "silver:2", "type_code": "2", "label": "Finsølv", "lodighed": "999", "purity_percentage": Decimal("99.90")},
    {"row_key": "silver:3", "type_code": "3", "label": "Sterling sølv", "lodighed": "925", "purity_percentage": Decimal("92.50")},
    {"row_key": "silver:4", "type_code": "4", "label": "3 tårnet sølv", "lodighed": "830", "purity_percentage": Decimal("83.00")},
    # Plet saflık oranıyla hesaplanmaz; fiyatı global plet_dkk skaleridir.
    {"row_key": "silver:5", "type_code": "5", "label": "Plet", "lodighed": "", "purity_percentage": Decimal("0.00")},
)

# Barlar bağımsız global fiyatlı ayrı satır türleridir; depoya BAR ürün
# türüyle aktarılırlar. row_key şeması "bar:" — altın karat-parse yoluna girmez.
BAR_WORKSPACE_ROWS: tuple[dict[str, str | Decimal], ...] = (
    {"row_key": "bar:gold", "bar_type": "gold", "type_code": "6", "label": "Guldbarre", "karat": Decimal("24.0"), "lodighed": "999.9", "purity_percentage": Decimal("99.99")},
    {"row_key": "bar:silver", "bar_type": "silver", "type_code": "7", "label": "Sølvbarre", "karat": None, "lodighed": "999", "purity_percentage": Decimal("99.90")},
)

# Platin/Palladyum alış satırları (0.3.7): row_key "ptpd:" — karat-parse yoluna
# girmez; fiyat kaynağı global platinum_dkk/palladium_dkk (Metals.Dev canlı
# meta'lı). Depoya metal_type üzerinden platin_pd kategorisiyle akarlar.
PT_PD_WORKSPACE_ROWS: tuple[dict[str, str | Decimal | None], ...] = (
    {"row_key": "ptpd:platinum", "metal": "platinum", "type_code": "8", "label": "Platin", "lodighed": "950", "purity_percentage": Decimal("95.00")},
    {"row_key": "ptpd:palladium", "metal": "palladium", "type_code": "9", "label": "Palladium", "lodighed": "500", "purity_percentage": Decimal("50.00")},
)

INVOICE_GOLD_ROW_COUNT = 12
INVOICE_MISC_ROW_COUNT = 15
COMPANION_MODE_AUTO = "auto"
COMPANION_MODE_MANUAL = "manual"
INVOICE_GOLD_CODE_LABELS: dict[str, str] = {
    "1": "Guld",
    "2": "Finsølv",
    "3": "Sterling sølv",
    "4": "3 tårnet sølv",
    "5": "Plet",
    "6": "Guldbarre",
    "7": "Sølvbarre",
    "8": "Platin",
    "9": "Palladium",
}
INVOICE_GOLD_DEFAULT_LODIGHED: dict[str, str] = {
    "2": "999",
    "3": "925",
    "4": "830",
    "5": "",
    "6": "999.9",
    "7": "999",
    "8": "950",
    "9": "500",
}
GOLD_RATE_KEYS: tuple[str, ...] = tuple(str(item["row_key"]).split(":", 1)[1] for item in GOLD_WORKSPACE_ROWS)
# Plet matristen çıktı (global skaler); oran matrisi anahtarları yalnız
# saflık bazlı gümüş satırlarıdır.
SILVER_RATE_KEYS: tuple[str, ...] = tuple(
    str(item["lodighed"]) for item in SILVER_WORKSPACE_ROWS if str(item["lodighed"])
)
DEFAULT_GOLD_CALCULATOR_ROWS: tuple[dict[str, Any], ...] = (
    # Kniv beregner başlangıç ağırlıkları güncel şablona göre: 4, 6, 8, 10.
    {"row_key": "calc_gold:1", "unit_weight": Decimal("4"), "count": Decimal("0"), "target_row_key": "gold:8"},
    {"row_key": "calc_gold:2", "unit_weight": Decimal("6"), "count": Decimal("0"), "target_row_key": "gold:14"},
    {"row_key": "calc_gold:3", "unit_weight": Decimal("8"), "count": Decimal("0"), "target_row_key": "gold:18"},
    {"row_key": "calc_gold:4", "unit_weight": Decimal("10"), "count": Decimal("0"), "target_row_key": "gold:21"},
    {"row_key": "calc_gold:5", "unit_weight": Decimal("0"), "count": Decimal("0"), "target_row_key": None},
)
DEFAULT_SILVER_CALCULATOR_ROWS: tuple[dict[str, Any], ...] = (
    {"row_key": "calc_silver:1", "unit_weight": Decimal("1.75"), "count": Decimal("0"), "target_row_key": "silver:2"},
    {"row_key": "calc_silver:2", "unit_weight": Decimal("3.508"), "count": Decimal("0"), "target_row_key": "silver:3"},
    {"row_key": "calc_silver:3", "unit_weight": Decimal("7.016"), "count": Decimal("0"), "target_row_key": "silver:4"},
    {"row_key": "calc_silver:4", "unit_weight": Decimal("17.54"), "count": Decimal("0"), "target_row_key": "silver:5"},
    {"row_key": "calc_silver:5", "unit_weight": Decimal("0"), "count": Decimal("0"), "target_row_key": None},
    {"row_key": "calc_silver:6", "unit_weight": Decimal("0"), "count": Decimal("0"), "target_row_key": None},
)


def _normalize_workspace_companion_mode(value: object, *, default: str = COMPANION_MODE_AUTO) -> str:
    return pos_workspace_state._normalize_workspace_companion_mode(value, default=default)


def _invoice_gold_sheet_has_content(payload: dict[str, Any]) -> bool:
    return pos_workspace_state._invoice_gold_sheet_has_content(payload)


def _invoice_misc_sheet_has_content(payload: dict[str, Any]) -> bool:
    return pos_workspace_state._invoice_misc_sheet_has_content(payload)


def _normalize_workspace_market_rate(value: Decimal | None, fallback: Decimal) -> Decimal:
    return pos_workspace_state._normalize_workspace_market_rate(value, fallback)


def _workspace_note_decimal(value: object, fallback: Decimal) -> Decimal:
    return pos_workspace_state._workspace_note_decimal(value, fallback)


def _workspace_note_decimal4(value: object, fallback: Decimal) -> Decimal:
    return pos_workspace_state._workspace_note_decimal4(value, fallback)


def _quantize_4(value: Decimal | int | str | None) -> Decimal:
    return pos_workspace_state._quantize_4(value)


def _gold_definition_by_row_key(row_key: str) -> dict[str, str | Decimal] | None:
    return pos_workspace_state._gold_definition_by_row_key(row_key)


def _silver_definition_by_row_key(row_key: str) -> dict[str, str | Decimal] | None:
    return pos_workspace_state._silver_definition_by_row_key(row_key)


def _silver_definition_by_lodighed(lodighed: str) -> dict[str, str | Decimal] | None:
    return pos_workspace_state._silver_definition_by_lodighed(lodighed)


def _default_gold_rate_map(*, gold_24k_dkk: Decimal) -> dict[str, Decimal]:
    return pos_workspace_state._default_gold_rate_map(gold_24k_dkk=gold_24k_dkk)


def _default_silver_rate_map(*, silver_999_dkk: Decimal) -> dict[str, Decimal]:
    return pos_workspace_state._default_silver_rate_map(silver_999_dkk=silver_999_dkk)


def _build_workspace_market_rates(
    *,
    eur_dkk_fx: Decimal,
    gold_rates_dkk: dict[str, Decimal],
    silver_rates_dkk: dict[str, Decimal],
) -> PosWorkspaceMarketRates:
    return pos_workspace_state._build_workspace_market_rates(
        eur_dkk_fx=eur_dkk_fx,
        gold_rates_dkk=gold_rates_dkk,
        silver_rates_dkk=silver_rates_dkk,
    )


def _market_rate_payload_to_workspace(
    market_payload: dict[str, Any],
    *,
    fallback_gold_24k_dkk: Decimal,
    fallback_silver_dkk: Decimal,
) -> PosWorkspaceMarketRates:
    return pos_workspace_state._market_rate_payload_to_workspace(
        market_payload,
        fallback_gold_24k_dkk=fallback_gold_24k_dkk,
        fallback_silver_dkk=fallback_silver_dkk,
    )


def _serialize_workspace_market_rates_payload(
    market_rates: PosWorkspaceMarketRates | dict[str, Any] | None,
) -> dict[str, Any]:
    return pos_workspace_state._serialize_workspace_market_rates_payload(market_rates)


def _workspace_market_rate_dkk(market_rates: PosWorkspaceMarketRates, row_key: str) -> Decimal:
    return pos_workspace_state._workspace_market_rate_dkk(market_rates, row_key)


def _workspace_row_unit_price_from_matrix(*, rate_dkk: Decimal, avance_percent: Decimal) -> Decimal:
    return pos_workspace_state._workspace_row_unit_price_from_matrix(
        rate_dkk=rate_dkk,
        avance_percent=avance_percent,
    )


def _default_calculator_rows(kind: str) -> list[dict[str, Any]]:
    return pos_workspace_state._default_calculator_rows(kind)


def _workspace_calculators_from_note(note_payload: dict[str, Any]) -> PosWorkspaceCalculatorsOut:
    return pos_workspace_state._workspace_calculators_from_note(note_payload)


def _serialize_workspace_calculators_payload(
    calculators: PosWorkspaceCalculatorsOut | PosWorkspaceCalculatorsUpdate | dict[str, Any] | None,
) -> dict[str, Any]:
    return pos_workspace_state._serialize_workspace_calculators_payload(calculators)


def _workspace_note_defaults() -> dict[str, Any]:
    return pos_workspace_state._workspace_note_defaults()


def _parse_workspace_note_payload(value: str | None) -> dict[str, Any]:
    return pos_workspace_state._parse_workspace_note_payload(value)


def _serialize_workspace_note_payload(payload: dict[str, Any]) -> str:
    return pos_workspace_state._serialize_workspace_note_payload(payload)


def _workspace_draft_customer_has_inputs(payload: dict[str, Any] | None) -> bool:
    return pos_workspace_state._workspace_draft_customer_has_inputs(payload)


def _workspace_draft_customer_payload(
    payload: PosWorkspaceCustomerUpdate | PosWorkspaceCustomerOut,
) -> dict[str, Any]:
    return pos_workspace_state._workspace_draft_customer_payload(payload)


def _workspace_draft_customer_from_note(note_payload: dict[str, Any]) -> PosWorkspaceCustomerOut | None:
    return pos_workspace_state._workspace_draft_customer_from_note(note_payload)


def extract_purchase_payment_method(value: str | None) -> str | None:
    return pos_workspace_state.extract_purchase_payment_method(value)


def extract_purchase_bank_info(value: str | None) -> tuple[str | None, str | None]:
    return pos_workspace_state.extract_purchase_bank_info(value)


def extract_purchase_freeform_note(value: str | None) -> str | None:
    return pos_workspace_state.extract_purchase_freeform_note(value)


def extract_purchase_market_rates(
    value: str | None,
    *,
    default_gold_24k_dkk: Decimal = Decimal("0.00"),
    default_silver_dkk: Decimal = Decimal("0.00"),
) -> PosWorkspaceMarketRates:
    return pos_workspace_state.extract_purchase_market_rates(
        value,
        default_gold_24k_dkk=default_gold_24k_dkk,
        default_silver_dkk=default_silver_dkk,
    )


def extract_purchase_numbering(
    value: str | None,
    *,
    default_afregnings_number: str = "",
    default_invoice_number: str = "",
) -> PosWorkspaceNumberingOut:
    return pos_workspace_state.extract_purchase_numbering(
        value,
        default_afregnings_number=default_afregnings_number,
        default_invoice_number=default_invoice_number,
    )


def extract_purchase_invoice_gold_sheet(
    value: str | None,
    *,
    market_rates: PosWorkspaceMarketRates,
) -> PosWorkspaceInvoiceGoldSheetOut:
    return pos_workspace_state.extract_purchase_invoice_gold_sheet(value, market_rates=market_rates)


def extract_purchase_invoice_misc_sheet(value: str | None) -> PosWorkspaceInvoiceMiscSheetOut:
    return pos_workspace_state.extract_purchase_invoice_misc_sheet(value)


def _workspace_edit_source(value: str | None) -> tuple[UUID | None, int | None]:
    return pos_workspace_state._workspace_edit_source(value)


def _parse_workspace_line_meta(notes: str | None) -> dict[str, Any]:
    if not notes:
        return {}
    try:
        payload = json.loads(notes)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _workspace_row_unit_price(*, rate_dkk: Decimal, purity_percentage: Decimal, avance_percent: Decimal) -> Decimal:
    unit = to_decimal(rate_dkk) * (to_decimal(purity_percentage) / Decimal("100"))
    unit = unit * (Decimal("1.00") - (to_decimal(avance_percent) / Decimal("100")))
    return quantize_2(unit)


def _workspace_row_line_total(*, unit_price_dkk: Decimal, gram: Decimal) -> Decimal:
    return quantize_2(to_decimal(unit_price_dkk) * to_decimal(gram))


def _random_session_code() -> str:
    return secrets.token_hex(4).upper()


def _random_display_token() -> str:
    return secrets.token_urlsafe(30)


def _hash_for_risk(value: str | None) -> str | None:
    if not value:
        return None
    clean = value.strip().lower()
    if not clean:
        return None
    return hash_sensitive_value(clean)


async def _record_customer_activity_event(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    customer: User,
) -> None:
    identity_doc = await session.scalar(
        select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer.id)
    )
    session.add(
        CustomerActivityEvent(
            customer_id=customer.id,
            pos_session_id=pos_session.id,
            source="pos_session",
            address_hash=_hash_for_risk(decrypt_field(customer.address_encrypted)),
            phone_hash=_hash_for_risk(customer.phone),
            cpr_hash=customer.cpr_hash,
            identity_doc_number_hash=(identity_doc.identity_doc_number_hash if identity_doc else None),
        )
    )


def _empty_workspace_customer() -> PosWorkspaceCustomerOut:
    return PosWorkspaceCustomerOut(
        customer_id=None,
        name="",
        email=None,
        phone=None,
        address=None,
        postal_code=None,
        city=None,
        cpr_number=None,
        identity_doc_type=None,
        identity_doc_number=None,
        identity_doc_country=None,
    )


async def get_next_reference_number_preview(session: AsyncSession) -> str:
    return await preview_reference_number(
        session,
        start=int(settings.pos_reference_start),
        window=int(settings.pos_reference_scan_window),
    )


async def consume_next_reference_number(session: AsyncSession) -> str:
    return await consume_reference_number(
        session,
        start=int(settings.pos_reference_start),
        window=int(settings.pos_reference_scan_window),
    )

async def _sync_buy_session_summary_from_lines(
    session: AsyncSession,
    *,
    pos_session: PosSession,
) -> None:
    if _resolved_trade_side(pos_session) != PosTradeSideEnum.BUY_FROM_CUSTOMER:
        return

    rows = (
        await session.scalars(
            select(PosSessionLine)
            .where(PosSessionLine.pos_session_id == pos_session.id)
            .order_by(PosSessionLine.line_no.asc())
        )
    ).all()

    # SQLite (and some PostgreSQL server-default paths) expires ``updated_at``
    # after the flush that updates the draft.  The display snapshot is built
    # in the same async transaction, so refresh this server-maintained scalar
    # before normal attribute access can trigger a forbidden lazy load.
    await session.refresh(pos_session, attribute_names=["updated_at"])

    if not rows:
        pos_session.product_type = None
        pos_session.metal_type = None
        pos_session.weight_grams = None
        pos_session.purity_karat = None
        pos_session.purity_percentage = None
        pos_session.final_offer_dkk = None
        pos_session.visible_snapshot = jsonable_encoder(_to_display_out(pos_session))
        return

    first = rows[0]
    pos_session.product_type = first.product_type
    pos_session.metal_type = first.metal_type
    pos_session.weight_grams = quantize_2(to_decimal(first.weight_grams))
    pos_session.purity_karat = first.purity_karat
    pos_session.purity_percentage = quantize_2(to_decimal(first.purity_percentage))

    total = Decimal("0.00")
    for line in rows:
        line_rate = to_decimal(line.rate_dkk) if line.rate_dkk is not None else _active_rate(pos_session)
        line_offer = (
            to_decimal(line.line_offer_dkk)
            if line.line_offer_dkk is not None
            else _calculate_offer(
                weight_grams=to_decimal(line.weight_grams),
                purity_percentage=to_decimal(line.purity_percentage),
                active_rate=line_rate,
                trade_side=PosTradeSideEnum.BUY_FROM_CUSTOMER,
                margin_percent=to_decimal(line.margin_percent_internal),
            )
        )
        if line_offer is not None:
            total += quantize_2(line_offer)

    pos_session.final_offer_dkk = quantize_2(total) if total > Decimal("0.00") else None

    if _active_rate(pos_session) is None and first.rate_dkk is not None:
        pos_session.live_rate_dkk = quantize_2(to_decimal(first.rate_dkk))
        if pos_session.rate_source != PosRateSourceEnum.MANUAL:
            pos_session.rate_source = PosRateSourceEnum.LIVE

    pos_session.visible_snapshot = jsonable_encoder(_to_display_out(pos_session))


def _to_display_out(
    pos_session: PosSession,
    *,
    trade_side_override: PosTradeSideEnum | str | None = None,
    lines: list[PosDisplayLineOut] | None = None,
    final_offer_override: Decimal | None | object = _DISPLAY_FINAL_DEFAULT,
    document_kind: str | None = None,
    document_number: str | None = None,
) -> PosSessionDisplayOut:
    return pos_display_service._to_display_out(
        pos_session,
        trade_side_override=trade_side_override,
        lines=lines,
        final_offer_override=final_offer_override,
        document_kind=document_kind,
        document_number=document_number,
    )


def _preview_workspace_totals(
    *,
    gold_rows: list[PosWorkspaceGoldRowOut],
    silver_rows: list[PosWorkspaceSilverRowOut],
) -> tuple[int, Decimal, Decimal, Decimal]:
    return pos_display_service._preview_workspace_totals(
        gold_rows=gold_rows,
        silver_rows=silver_rows,
    )


async def _attach_display_workspace_rows(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    snapshot: PosSessionDisplayOut,
) -> PosSessionDisplayOut:
    return await pos_display_service._attach_display_workspace_rows(
        session,
        pos_session=pos_session,
        snapshot=snapshot,
    )


def _to_clerk_out(pos_session: PosSession) -> PosSessionOutClerk:
    return pos_display_service._to_clerk_out(pos_session)


def clerk_snapshot(pos_session: PosSession) -> PosSessionOutClerk:
    return pos_display_service.clerk_snapshot(pos_session)


def _cached_display_preview_entry(pos_session: PosSession):
    preview_entry = realtime_hub.get_display_preview(pos_session.display_token)
    if preview_entry is None:
        return None
    if (
        preview_entry.session_code != pos_session.session_code
        or pos_session.status != PosSessionStatusEnum.DRAFT
        or _resolved_trade_side(pos_session) != PosTradeSideEnum.BUY_FROM_CUSTOMER
    ):
        realtime_hub.clear_display_preview(
            pos_session.display_token,
            session_code=preview_entry.session_code,
        )
        return None
    return preview_entry


def _overlay_cached_preview_customer(
    pos_session: PosSession,
    snapshot: PosSessionDisplayOut,
) -> PosSessionDisplayOut:
    preview_entry = _cached_display_preview_entry(pos_session)
    if preview_entry is None:
        return snapshot

    preview = preview_entry.snapshot
    if int(preview.workspace_revision or 1) < int(snapshot.workspace_revision or 1):
        realtime_hub.clear_display_preview(pos_session.display_token, session_code=preview.session_code)
        return snapshot
    # Preview frames are complete snapshots.  Preserve explicit empty values
    # instead of truthy-merging the previous master customer into them.
    return preview


async def _overlay_display_customer_identity(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    snapshot: PosSessionDisplayOut,
) -> PosSessionDisplayOut:
    if snapshot.customer_identity_doc_number:
        return snapshot.model_copy(
            update={
                "customer_cpr_masked": mask_cpr(snapshot.customer_cpr),
                "customer_identity_doc_number_masked": mask_last4(snapshot.customer_identity_doc_number),
            }
        )
    customer_id = pos_session.customer_id
    if customer_id is None:
        return snapshot.model_copy(update={"customer_cpr_masked": mask_cpr(snapshot.customer_cpr)})
    identity = await session.scalar(
        select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer_id)
    )
    identity_number = decrypt_field(identity.identity_doc_number_encrypted) if identity else None
    return snapshot.model_copy(
        update={
            "customer_cpr_masked": mask_cpr(snapshot.customer_cpr),
            "customer_identity_doc_number": identity_number,
            "customer_identity_doc_number_masked": mask_last4(identity_number),
        }
    )


async def _emit_session_state(pos_session: PosSession) -> None:
    try:
        async with AsyncSessionLocal() as realtime_session:
            fresh = await get_pos_session_or_404(realtime_session, pos_session.id)
            resolved_snapshot = await display_snapshot(realtime_session, fresh)
            display_payload = {
                "type": "display:update",
                "data": jsonable_encoder(resolved_snapshot),
            }
            clerk_payload = {"type": "clerk:update", "data": jsonable_encoder(_to_clerk_out(fresh))}
    except Exception:
        try:
            async with AsyncSessionLocal() as realtime_session:
                fresh = await get_pos_session_or_404(realtime_session, pos_session.id)
                fallback_display = await display_snapshot(realtime_session, fresh)
        except Exception:
            fallback_display = _to_display_out(pos_session)
        display_payload = {"type": "display:update", "data": jsonable_encoder(fallback_display)}
        clerk_payload = {"type": "clerk:update", "data": jsonable_encoder(_to_clerk_out(pos_session))}
    await realtime_hub.broadcast_display(pos_session.display_token, display_payload)
    await realtime_hub.broadcast_clerk(pos_session.id, clerk_payload)


async def _display_document_meta(session: AsyncSession, pos_session_id) -> dict[str, str | None]:
    pos_document = await session.scalar(select(PosDocument).where(PosDocument.pos_session_id == pos_session_id))
    if pos_document is None:
        return {"document_kind": None, "document_number": None}
    return {
        "document_kind": "faktura" if pos_document.document_type == PosDocumentTypeEnum.SALE_INVOICE else "afregningsbilag",
        "document_number": _format_document_number(pos_document),
    }


def _draft_display_document_meta(pos_session: PosSession) -> dict[str, str | None]:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        return {"document_kind": None, "document_number": None}
    if _resolved_trade_side(pos_session) != PosTradeSideEnum.BUY_FROM_CUSTOMER:
        return {"document_kind": None, "document_number": None}
    note_payload = _parse_workspace_note_payload(pos_session.notes)
    numbering_payload = note_payload.get("numbering") if isinstance(note_payload, dict) else None
    if not isinstance(numbering_payload, dict):
        return {"document_kind": "afregningsbilag", "document_number": None}
    document_number = str(numbering_payload.get("afregnings_number_next") or "").strip() or None
    return {
        "document_kind": "afregningsbilag",
        "document_number": document_number,
    }


async def _resolve_customer(session: AsyncSession, payload: PosSessionCreate) -> User | None:
    if payload.customer_id:
        customer = await session.get(User, payload.customer_id)
        if not customer or customer.role != RoleEnum.CUSTOMER:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Müşteri bulunamadı")
        return customer

    if payload.customer_new:
        customer_name = payload.customer_new.name.strip()
        customer_phone = (payload.customer_new.phone or "").strip()
        customer_cpr = (payload.customer_new.cpr_number or "").strip()
        identity_doc_number = (payload.customer_new.identity_doc_number or "").strip()
        phone_digits = "".join(ch for ch in customer_phone if ch.isdigit())
        cpr_digits = "".join(ch for ch in customer_cpr if ch.isdigit())

        if not customer_name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Yeni müşteri için ad soyad zorunlu")
        if not customer_phone:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Yeni müşteri için telefon zorunlu")
        if len(phone_digits) < 7 or len(phone_digits) > 15:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Yeni müşteri telefon formatı geçersiz (7-15 rakam).",
            )
        if not customer_cpr:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Yeni müşteri için CPR zorunlu")
        if len(cpr_digits) != 10:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Yeni müşteri CPR formatı geçersiz (10 rakam).",
            )
        if not identity_doc_number:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Yeni müşteri için kimlik belge numarası zorunlu")
        if len(identity_doc_number) < 4:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Yeni müşteri kimlik belge numarası en az 4 karakter olmalı.",
            )

        try:
            customer_payload = CustomerCreate(
                name=customer_name,
                email=payload.customer_new.email,
                phone=customer_phone,
                address=payload.customer_new.address,
                postal_code=payload.customer_new.postal_code,
                city=payload.customer_new.city,
                cpr_number=cpr_digits,
                identity_doc_type=payload.customer_new.identity_doc_type,
                identity_doc_number=identity_doc_number,
                identity_doc_country=payload.customer_new.identity_doc_country,
                identity_photo_refs=payload.customer_new.identity_photo_refs,
            )
        except ValidationError as exc:
            first_error = exc.errors()[0] if exc.errors() else None
            message = first_error.get("msg") if isinstance(first_error, dict) else "Müşteri verisi geçersiz"
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message) from exc

        customer = await create_customer(
            session,
            customer_payload,
        )
        return customer

    return None


async def get_pos_session_or_404(session: AsyncSession, session_id) -> PosSession:
    pos_session = await session.scalar(
        select(PosSession)
        .where(PosSession.id == session_id)
        .options(selectinload(PosSession.customer), selectinload(PosSession.clerk_user))
    )
    if not pos_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="POS oturumu bulunamadı")
    return pos_session


async def get_pos_session_by_display_token_or_404(session: AsyncSession, display_token: str) -> PosSession:
    pos_session = await session.scalar(
        select(PosSession)
        .where(PosSession.display_token == display_token)
        .options(selectinload(PosSession.customer), selectinload(PosSession.clerk_user))
    )
    if not pos_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Görüntüleme oturumu bulunamadı")
    return pos_session


async def find_open_draft_pos_session(
    session: AsyncSession,
    *,
    clerk_user_id,
    customer_id,
    trade_side: PosTradeSideEnum,
) -> PosSession | None:
    draft_rows = (
        await session.scalars(
            select(PosSession)
            .where(
                PosSession.clerk_user_id == clerk_user_id,
                PosSession.customer_id == customer_id,
                PosSession.status == PosSessionStatusEnum.DRAFT,
            )
            .order_by(PosSession.created_at.desc())
            .options(selectinload(PosSession.customer), selectinload(PosSession.clerk_user))
        )
    ).all()

    for row in draft_rows:
        if _resolved_trade_side(row) == trade_side:
            return row
    return None


async def find_latest_draft_pos_session(
    session: AsyncSession,
    *,
    clerk_user_id,
    trade_side: PosTradeSideEnum,
) -> PosSession | None:
    rows = (
        await session.scalars(
            select(PosSession)
            .where(
                PosSession.clerk_user_id == clerk_user_id,
                PosSession.status == PosSessionStatusEnum.DRAFT,
            )
            .order_by(PosSession.updated_at.desc(), PosSession.created_at.desc())
            .options(selectinload(PosSession.customer), selectinload(PosSession.clerk_user))
        )
    ).all()

    for row in rows:
        if _resolved_trade_side(row) == trade_side:
            return row
    return None


async def revoke_display_token(
    session: AsyncSession,
    *,
    clerk_user_id,
    display_token: str | None = None,
    trade_side: PosTradeSideEnum = PosTradeSideEnum.BUY_FROM_CUSTOMER,
) -> PosSession | None:
    """Müşteri ekranı token'ını yeniden üretir.

    İstemci, açtığı müşteri ekranı penceresini kapatmak istediğinde token'ı
    "geri alır": eski token'ın önizleme kopyası atılır, oturuma yeni bir token
    yazılır. Eski değer artık display/preview ya da ws çağrılarında çözülemez;
    pencere bir sonraki anlık görüntü/oylama denemesinde çevrimdışına düşer.

    ``display_token`` verilirse ve çözümlenebilirse o oturum hedeflenir; aksi
    halde kasiyerin en güncel DRAFT alış oturumu kullanılır. Döndürülen oturum
    yeni token'ı taşır; iptal edilecek oturum yoksa ``None`` döner.
    """
    pos_session: PosSession | None = None
    requested_token = (display_token or "").strip()
    if requested_token:
        candidate = await session.scalar(
            select(PosSession)
            .where(PosSession.display_token == requested_token)
            .options(selectinload(PosSession.customer), selectinload(PosSession.clerk_user))
        )
        # Yalnızca kendi oturumunun token'ı geri alınabilir; başkasının oturumuna
        # işaret eden bir token yok sayılıp kasiyerin kendi taslağına düşülür.
        if candidate is not None and candidate.clerk_user_id == clerk_user_id:
            if candidate.status == PosSessionStatusEnum.DRAFT:
                pos_session = candidate
    if pos_session is None:
        pos_session = await find_latest_draft_pos_session(
            session,
            clerk_user_id=clerk_user_id,
            trade_side=trade_side,
        )
    if pos_session is None:
        return None

    previous_token = pos_session.display_token
    realtime_hub.clear_display_preview(previous_token)
    pos_session.display_token = _random_display_token()
    await session.commit()
    await session.refresh(pos_session)
    return pos_session


async def create_pos_session(
    session: AsyncSession,
    payload: PosSessionCreate,
    clerk_user: User,
) -> PosSessionOutClerk:
    requested_trade_side = payload.trade_side

    customer = await _resolve_customer(session, payload)

    if customer is not None and payload.customer_id and not payload.force_new_session:
        existing_draft = await find_open_draft_pos_session(
            session,
            clerk_user_id=clerk_user.id,
            customer_id=customer.id,
            trade_side=requested_trade_side,
        )
        if existing_draft is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Bu müşteri için açık bir taslak POS oturumu var "
                    f"({existing_draft.session_code}). "
                    "Önce mevcut taslağa devam edin veya yeni oturum açmayı açıkça onaylayın."
                ),
            )

    # NOTE: Existing local DB'lerde enum migration zorunluluğunu kırmamak için
    # DB tarafında alış değeriyle tutuyoruz; UI/display trade_side snapshot'tan okunur.
    trade_side_for_db = payload.trade_side
    if payload.trade_side == PosTradeSideEnum.SELL_TO_CUSTOMER:
        trade_side_for_db = PosTradeSideEnum.BUY_FROM_CUSTOMER

    pos_session = PosSession(
        session_code=_random_session_code(),
        display_token=_random_display_token(),
        clerk_user_id=clerk_user.id,
        customer_id=(customer.id if customer is not None else None),
        trade_side=trade_side_for_db,
        margin_percent_internal=DEFAULT_POS_MARGIN_PERCENT,
        rate_source=PosRateSourceEnum.LIVE,
        status=PosSessionStatusEnum.DRAFT,
        visible_snapshot={},
    )

    session.add(pos_session)
    await session.flush()

    if customer is not None:
        await _record_customer_activity_event(session, pos_session=pos_session, customer=customer)
    await session.commit()

    fresh = await get_pos_session_or_404(session, pos_session.id)
    fresh.visible_snapshot = jsonable_encoder(
        _to_display_out(fresh, trade_side_override=requested_trade_side)
    )
    await session.commit()
    await session.refresh(fresh)

    await _emit_session_state(fresh)
    return _to_clerk_out(fresh)


async def update_quote(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosQuoteUpdate,
) -> PosSessionOutClerk:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturum güncellenebilir")

    if payload.product_type is not None:
        pos_session.product_type = payload.product_type
    if payload.metal_type is not None:
        pos_session.metal_type = payload.metal_type
    if payload.weight_grams is not None:
        pos_session.weight_grams = quantize_2(payload.weight_grams)
    if payload.purity_karat is not None:
        pos_session.purity_karat = payload.purity_karat
    if payload.purity_percentage is not None:
        pos_session.purity_percentage = quantize_2(payload.purity_percentage)
    if payload.margin_percent_internal is not None:
        pos_session.margin_percent_internal = quantize_2(payload.margin_percent_internal)

    _recalculate(pos_session)
    pos_session.visible_snapshot = jsonable_encoder(_to_display_out(pos_session))

    await session.commit()
    await session.refresh(pos_session)

    await _emit_session_state(pos_session)
    return _to_clerk_out(pos_session)


def _to_line_out(line: PosSessionLine) -> PosSessionLineOut:
    return PosSessionLineOut(
        id=line.id,
        pos_session_id=line.pos_session_id,
        line_no=line.line_no,
        product_type=line.product_type,
        metal_type=line.metal_type,
        weight_grams=line.weight_grams,
        purity_karat=line.purity_karat,
        purity_percentage=line.purity_percentage,
        rate_dkk=line.rate_dkk,
        margin_percent_internal=line.margin_percent_internal,
        line_offer_dkk=line.line_offer_dkk,
        notes=line.notes,
        created_at=line.created_at,
        updated_at=line.updated_at,
    )


def _to_display_line_out(line: PosSessionLine) -> PosDisplayLineOut:
    meta = _parse_workspace_line_meta(line.notes)
    purity_percentage = quantize_2(to_decimal(line.purity_percentage))
    lodighed = format((purity_percentage * Decimal("10")), ".0f")
    line_total = quantize_2(to_decimal(line.line_offer_dkk)) if line.line_offer_dkk is not None else None
    unit_price = (
        quantize_2(line_total / quantize_2(to_decimal(line.weight_grams)))
        if line_total is not None and to_decimal(line.weight_grams) > 0
        else None
    )
    return PosDisplayLineOut(
        line_no=line.line_no,
        product_type=line.product_type,
        metal_type=line.metal_type,
        weight_grams=quantize_2(to_decimal(line.weight_grams)),
        purity_karat=line.purity_karat,
        purity_percentage=purity_percentage,
        type_label=(str(meta.get("type_label")) if meta.get("type_label") else None),
        lodighed=lodighed,
        rate_dkk=(quantize_2(to_decimal(line.rate_dkk)) if line.rate_dkk is not None else None),
        unit_price_dkk=unit_price,
        line_offer_dkk=line_total,
        notes=line.notes,
    )


async def _list_display_lines(
    session: AsyncSession,
    pos_session_id,
) -> list[PosDisplayLineOut]:
    rows = (
        await session.scalars(
            select(PosSessionLine)
            .where(PosSessionLine.pos_session_id == pos_session_id)
            .order_by(PosSessionLine.line_no.asc())
        )
    ).all()
    return [_to_display_line_out(row) for row in rows]


async def list_pos_session_lines(
    session: AsyncSession,
    *,
    pos_session: PosSession,
) -> list[PosSessionLineOut]:
    rows = (
        await session.scalars(
            select(PosSessionLine)
            .where(PosSessionLine.pos_session_id == pos_session.id)
            .order_by(PosSessionLine.line_no.asc())
        )
    ).all()
    return [_to_line_out(row) for row in rows]


def _infer_workspace_row_key(line: PosSessionLine) -> str | None:
    # Bar satırları notlarında explicit row_key taşır; saflık eşleşmesiyle
    # normal satırlara karışmasınlar (Sølvbarre 99.90 Finsølv ile aynı).
    if line.product_type == ProductTypeEnum.BAR:
        return "bar:gold" if line.metal_type == MetalTypeEnum.YELLOW_GOLD else "bar:silver"
    if line.metal_type == MetalTypeEnum.PLATINUM:
        return "ptpd:platinum"
    if line.metal_type == MetalTypeEnum.PALLADIUM:
        return "ptpd:palladium"
    purity_value = quantize_2(to_decimal(line.purity_percentage))
    if line.metal_type == MetalTypeEnum.SILVER:
        for definition in SILVER_WORKSPACE_ROWS:
            if purity_value == quantize_2(to_decimal(definition["purity_percentage"])):
                return str(definition["row_key"])
        return "silver:5"

    for definition in GOLD_WORKSPACE_ROWS:
        if line.purity_karat and line.purity_karat.lower() == str(definition["label"]).lower():
            return str(definition["row_key"])
        if purity_value == quantize_2(to_decimal(definition["purity_percentage"])):
            return str(definition["row_key"])
    return None


async def _workspace_market_rates_from_session(
    pos_session: PosSession,
) -> PosWorkspaceMarketRates:
    return await pos_workspace_state._workspace_market_rates_from_session(pos_session)


def _workspace_bank_info_from_session(pos_session: PosSession) -> PosWorkspaceBankInfo:
    return pos_workspace_state._workspace_bank_info_from_session(pos_session)


def _workspace_payment_method_from_session(pos_session: PosSession) -> str:
    return pos_workspace_state._workspace_payment_method_from_session(pos_session)


def _workspace_numbering_from_note(
    note_payload: dict[str, Any],
    *,
    product_number_next: str,
    reference_number_next: str,
    default_afregnings_number: str,
    default_invoice_number: str,
) -> PosWorkspaceNumberingOut:
    return pos_workspace_state._workspace_numbering_from_note(
        note_payload,
        product_number_next=product_number_next,
        reference_number_next=reference_number_next,
        default_afregnings_number=default_afregnings_number,
        default_invoice_number=default_invoice_number,
    )


def _invoice_gold_default_rows() -> list[dict[str, Any]]:
    return pos_workspace_state._invoice_gold_default_rows()


def _invoice_misc_default_rows() -> list[dict[str, Any]]:
    return pos_workspace_state._invoice_misc_default_rows()


def _workspace_decimal_text(value: Decimal | str | int | None) -> str:
    return pos_workspace_state._workspace_decimal_text(value)


def _invoice_gold_auto_sheet_from_workspace_rows(
    *,
    gold_rows: list[PosWorkspaceGoldRowOut],
    silver_rows: list[PosWorkspaceSilverRowOut],
    bar_rows: list[PosWorkspaceBarRowOut] | tuple = (),
    ptpd_rows: list[PosWorkspacePtPdRowOut] | tuple = (),
    market_rates: PosWorkspaceMarketRates,
) -> PosWorkspaceInvoiceGoldSheetOut:
    return pos_workspace_state._invoice_gold_auto_sheet_from_workspace_rows(
        gold_rows=gold_rows,
        silver_rows=silver_rows,
        bar_rows=bar_rows,
        ptpd_rows=ptpd_rows,
        market_rates=market_rates,
    )


def _invoice_misc_auto_sheet() -> PosWorkspaceInvoiceMiscSheetOut:
    return pos_workspace_state._invoice_misc_auto_sheet()


def _invoice_gold_rows_from_note(
    note_payload: dict[str, Any],
    *,
    market_rates: PosWorkspaceMarketRates,
) -> PosWorkspaceInvoiceGoldSheetOut:
    return pos_workspace_state._invoice_gold_rows_from_note(
        note_payload,
        market_rates=market_rates,
    )


def _invoice_misc_rows_from_note(note_payload: dict[str, Any]) -> PosWorkspaceInvoiceMiscSheetOut:
    return pos_workspace_state._invoice_misc_rows_from_note(note_payload)


async def _workspace_customer_from_session(
    session: AsyncSession,
    pos_session: PosSession,
) -> PosWorkspaceCustomerOut:
    note_payload = _parse_workspace_note_payload(pos_session.notes)
    # A linked customer can still have a session-local edit.  The explicit
    # workspace_customer key is presence-aware, so an intentionally empty
    # snapshot must win over the master User row.
    if isinstance(note_payload.get("workspace_customer"), dict):
        snapshot = _workspace_draft_customer_from_note(note_payload)
        if snapshot is not None:
            return snapshot.model_copy(update={"customer_id": pos_session.customer_id})
    customer = pos_session.customer
    if customer is None and pos_session.customer_id is not None:
        customer = await session.get(User, pos_session.customer_id)
    if customer is None:
        draft_customer = _workspace_draft_customer_from_note(_parse_workspace_note_payload(pos_session.notes))
        if draft_customer is not None:
            return draft_customer
        return _empty_workspace_customer()

    identity = await session.scalar(
        select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer.id)
    )
    cpr_plain = decrypt_field(customer.cpr_number_encrypted)
    identity_number = decrypt_field(identity.identity_doc_number_encrypted) if identity else None

    return PosWorkspaceCustomerOut(
        customer_id=customer.id,
        name=customer.name,
        email=customer.email,
        phone=customer.phone,
        address=decrypt_field(customer.address_encrypted),
        postal_code=customer.postal_code,
        city=str(note_payload.get("workspace_customer_city") or "").strip() or customer.city,
        cpr_number=cpr_plain,
        identity_doc_type=(identity.identity_doc_type if identity else None),
        identity_doc_number=identity_number,
        identity_doc_country=(identity.identity_doc_country if identity else None),
    )


async def _workspace_numbering_preview(
    session: AsyncSession,
    *,
    pos_session: PosSession | None = None,
) -> PosWorkspaceNumberingOut:
    reference_number = await get_next_reference_number_preview(session)
    afregnings_number = await preview_afregnings_number(session, start=9600, window=5000)
    invoice_number = await preview_invoice_number(session)
    product_number = await preview_product_number(session)
    note_payload = _parse_workspace_note_payload(pos_session.notes) if pos_session is not None else _workspace_note_defaults()
    return _workspace_numbering_from_note(
        note_payload,
        product_number_next=product_number,
        reference_number_next=reference_number,
        default_afregnings_number=afregnings_number,
        default_invoice_number=invoice_number,
    )


async def build_purchase_workspace(
    session: AsyncSession,
    *,
    pos_session: PosSession,
) -> PosWorkspaceOut:
    pos_lines = (
        await session.scalars(
            select(PosSessionLine)
            .where(PosSessionLine.pos_session_id == pos_session.id)
            .order_by(PosSessionLine.line_no.asc())
        )
    ).all()
    market_rates = await _workspace_market_rates_from_session(pos_session)
    note_payload = _parse_workspace_note_payload(pos_session.notes)
    active_pos_lines = [line for line in pos_lines if quantize_2(to_decimal(line.weight_grams)) > 0]
    derive_legacy_zero_prices = bool(active_pos_lines) and all(
        to_decimal(line.rate_dkk) <= 0 and to_decimal(line.line_offer_dkk) <= 0
        for line in active_pos_lines
    )
    has_zero_price_candidate = False

    bank_info = _workspace_bank_info_from_session(pos_session)
    customer = await _workspace_customer_from_session(session, pos_session)
    note_payload = _parse_workspace_note_payload(pos_session.notes)
    numbering_preview = await _workspace_numbering_preview(session, pos_session=pos_session)
    invoice_gold_mode = _normalize_workspace_companion_mode(
        note_payload.get("invoice_gold_mode"),
        default=COMPANION_MODE_MANUAL if _invoice_gold_sheet_has_content(note_payload.get("invoice_gold", {})) else COMPANION_MODE_AUTO,
    )
    invoice_misc_mode = _normalize_workspace_companion_mode(
        note_payload.get("invoice_misc_mode"),
        default=COMPANION_MODE_MANUAL if _invoice_misc_sheet_has_content(note_payload.get("invoice_misc", {})) else COMPANION_MODE_AUTO,
    )
    calculators = _workspace_calculators_from_note(note_payload)

    line_by_row_key: dict[str, PosSessionLine] = {}
    for line in pos_lines:
        meta = _parse_workspace_line_meta(line.notes)
        row_key = str(meta.get("row_key") or _infer_workspace_row_key(line) or "")
        if row_key:
            line_by_row_key[row_key] = line

    gold_rows: list[PosWorkspaceGoldRowOut] = []
    silver_rows: list[PosWorkspaceSilverRowOut] = []
    total_weight = Decimal("0.00")
    total_pure = Decimal("0.00")
    gold_weight = Decimal("0.00")
    silver_weight = Decimal("0.00")
    total_amount = Decimal("0.00")
    active_line_count = 0

    for definition in GOLD_WORKSPACE_ROWS:
        row_key = str(definition["row_key"])
        line = line_by_row_key.get(row_key)
        gram = quantize_2(to_decimal(line.weight_grams if line is not None else 0))
        avance = quantize_2(to_decimal(line.margin_percent_internal if line is not None else 0))
        rate = _workspace_market_rate_dkk(market_rates, row_key)
        purity = quantize_2(to_decimal(definition["purity_percentage"]))
        repair_row_price = bool(
            derive_legacy_zero_prices
            and line is not None
            and gram > 0
            and to_decimal(line.rate_dkk) <= 0
            and to_decimal(line.line_offer_dkk) <= 0
            and rate > 0
        )
        if line is not None and gram > 0:
            has_zero_price_candidate = has_zero_price_candidate or repair_row_price
        # CANLI: birim fiyat DAİMA güncel matris oranından hesaplanır
        # (unit = rate + mer_pris kr/g, R2-07); donmuş line_offer_dkk GÖSTERİLMEZ.
        # Böylece oran değişince açık alış satırı anında güncellenir.
        unit_price = _workspace_row_unit_price_from_matrix(rate_dkk=rate, avance_percent=avance)
        line_total = _workspace_row_line_total(unit_price_dkk=unit_price, gram=gram)
        if gram > 0:
            active_line_count += 1
            total_weight += gram
            gold_weight += gram
            total_pure += quantize_2(gram * (purity / Decimal("100")))
            total_amount += line_total
        gold_rows.append(
            PosWorkspaceGoldRowOut(
                row_key=row_key,
                line_id=(line.id if line is not None else None),
                line_no=(line.line_no if line is not None else None),
                karat=to_decimal(definition["karat"]),
                label=str(definition["label"]),
                lodighed=str(definition["lodighed"]),
                purity_percentage=purity,
                gram=gram,
                avance_percent=avance,
                rate_dkk=rate,
                unit_price_dkk=unit_price,
                line_total_dkk=line_total,
            )
        )

    for definition in SILVER_WORKSPACE_ROWS:
        row_key = str(definition["row_key"])
        line = line_by_row_key.get(row_key)
        gram = quantize_2(to_decimal(line.weight_grams if line is not None else 0))
        avance = quantize_2(to_decimal(line.margin_percent_internal if line is not None else 0))
        rate = _workspace_market_rate_dkk(market_rates, row_key)
        purity = quantize_2(to_decimal(definition["purity_percentage"]))
        repair_row_price = bool(
            derive_legacy_zero_prices
            and line is not None
            and gram > 0
            and to_decimal(line.rate_dkk) <= 0
            and to_decimal(line.line_offer_dkk) <= 0
            and rate > 0
        )
        if line is not None and gram > 0:
            has_zero_price_candidate = has_zero_price_candidate or repair_row_price
        # CANLI: birim fiyat DAİMA güncel matris oranından hesaplanır
        # (unit = rate + mer_pris kr/g, R2-07); donmuş line_offer_dkk GÖSTERİLMEZ.
        # Böylece oran değişince açık alış satırı anında güncellenir.
        unit_price = _workspace_row_unit_price_from_matrix(rate_dkk=rate, avance_percent=avance)
        line_total = _workspace_row_line_total(unit_price_dkk=unit_price, gram=gram)
        if gram > 0:
            active_line_count += 1
            total_weight += gram
            silver_weight += gram
            total_pure += quantize_2(gram * (purity / Decimal("100")))
            total_amount += line_total
        silver_rows.append(
            PosWorkspaceSilverRowOut(
                row_key=row_key,
                line_id=(line.id if line is not None else None),
                line_no=(line.line_no if line is not None else None),
                type_code=str(definition["type_code"]),
                label=str(definition["label"]),
                lodighed=str(definition["lodighed"]),
                purity_percentage=purity,
                gram=gram,
                avance_percent=avance,
                rate_dkk=rate,
                unit_price_dkk=unit_price,
                line_total_dkk=line_total,
            )
        )

    bar_rows: list[PosWorkspaceBarRowOut] = []
    for definition in BAR_WORKSPACE_ROWS:
        row_key = str(definition["row_key"])
        line = line_by_row_key.get(row_key)
        gram = quantize_2(to_decimal(line.weight_grams if line is not None else 0))
        avance = quantize_2(to_decimal(line.margin_percent_internal if line is not None else 0))
        rate = _workspace_market_rate_dkk(market_rates, row_key)
        purity = quantize_2(to_decimal(definition["purity_percentage"]))
        # CANLI TEK HESAP (F0.4): bar satırı da altın/gümüş gibi DAİMA güncel
        # matris oranından hesaplanır; donmuş line_offer_dkk GÖSTERİLMEZ. Aksi
        # halde offer=0 kalan bar satırı 615,50 oran varken bile 0 görünüyordu
        # (R1-24). Oran > 0 iken toplam asla 0 kalmaz.
        unit_price = _workspace_row_unit_price_from_matrix(rate_dkk=rate, avance_percent=avance)
        line_total = _workspace_row_line_total(unit_price_dkk=unit_price, gram=gram)
        if gram > 0:
            active_line_count += 1
            total_weight += gram
            if str(definition["bar_type"]) == "gold":
                gold_weight += gram
            else:
                silver_weight += gram
            total_pure += quantize_2(gram * (purity / Decimal("100")))
            total_amount += line_total
        bar_rows.append(
            PosWorkspaceBarRowOut(
                row_key=row_key,
                line_id=(line.id if line is not None else None),
                line_no=(line.line_no if line is not None else None),
                bar_type=str(definition["bar_type"]),
                label=str(definition["label"]),
                lodighed=str(definition["lodighed"]),
                purity_percentage=purity,
                gram=gram,
                avance_percent=avance,
                rate_dkk=rate,
                unit_price_dkk=unit_price,
                line_total_dkk=line_total,
            )
        )

    ptpd_rows: list[PosWorkspacePtPdRowOut] = []
    for definition in PT_PD_WORKSPACE_ROWS:
        row_key = str(definition["row_key"])
        line = line_by_row_key.get(row_key)
        gram = quantize_2(to_decimal(line.weight_grams if line is not None else 0))
        avance = quantize_2(to_decimal(line.margin_percent_internal if line is not None else 0))
        rate = _workspace_market_rate_dkk(market_rates, row_key)
        purity = quantize_2(to_decimal(definition["purity_percentage"]))
        # CANLI TEK HESAP (F0.4): platin/palladyum satırı da DAİMA güncel matris
        # oranından hesaplanır; donmuş line_offer_dkk GÖSTERİLMEZ — R1-23'teki
        # "33 g × 280 ama TOPLAM 0" para hatasının kökü buydu (offer=0 donmuştu).
        unit_price = _workspace_row_unit_price_from_matrix(rate_dkk=rate, avance_percent=avance)
        line_total = _workspace_row_line_total(unit_price_dkk=unit_price, gram=gram)
        if gram > 0:
            active_line_count += 1
            total_weight += gram
            total_pure += quantize_2(gram * (purity / Decimal("100")))
            total_amount += line_total
        ptpd_rows.append(
            PosWorkspacePtPdRowOut(
                row_key=row_key,
                line_id=(line.id if line is not None else None),
                line_no=(line.line_no if line is not None else None),
                metal=str(definition["metal"]),
                label=str(definition["label"]),
                lodighed=str(definition["lodighed"]),
                purity_percentage=purity,
                gram=gram,
                avance_percent=avance,
                rate_dkk=rate,
                unit_price_dkk=unit_price,
                line_total_dkk=line_total,
            )
        )

    # R2-01 — DİNAMİK "Kniv / Çeyrek altın" satırları: sabit tanımlara oturmayan,
    # gümüş altındaki sekmeden eklenen satırlar. Fiyat metal+karattan CANLI
    # çözülür (F0.4 tek hesap), mer pris eklenir. Toplamlara dahil edilir.
    extra_rows: list[PosWorkspaceExtraRowOut] = []
    for line in pos_lines:
        meta = _parse_workspace_line_meta(line.notes)
        kind = str(meta.get("kind") or "")
        if kind not in ("kniv", "quarter"):
            continue
        metal = str(meta.get("metal") or ("gold" if kind == "quarter" else "silver"))
        karat = str(meta.get("karat") or "")
        gram = quantize_2(to_decimal(line.weight_grams))
        avance = quantize_2(to_decimal(line.margin_percent_internal))
        if metal == "gold":
            rate = quantize_2(to_decimal(market_rates.gold_rates_dkk.get(karat) or Decimal("0")))
        else:
            rate = quantize_2(to_decimal(market_rates.silver_rates_dkk.get(karat) or Decimal("0")))
        purity = quantize_2(to_decimal(line.purity_percentage or 0))
        unit_price = _workspace_row_unit_price_from_matrix(rate_dkk=rate, avance_percent=avance)
        line_total = _workspace_row_line_total(unit_price_dkk=unit_price, gram=gram)
        if gram > 0:
            active_line_count += 1
            total_weight += gram
            if metal == "gold":
                gold_weight += gram
            else:
                silver_weight += gram
            total_pure += quantize_2(gram * (purity / Decimal("100")))
            total_amount += line_total
        extra_rows.append(
            PosWorkspaceExtraRowOut(
                row_key=str(meta.get("row_key") or f"extra:{line.line_no}"),
                line_id=line.id,
                line_no=line.line_no,
                kind=kind,
                label=str(meta.get("label") or ("Çeyrek altın" if kind == "quarter" else "Kniv")),
                metal=metal,
                karat=karat,
                purity_percentage=purity,
                gram=gram,
                avance_percent=avance,
                rate_dkk=rate,
                unit_price_dkk=unit_price,
                line_total_dkk=line_total,
            )
        )

    invoice_gold = (
        _invoice_gold_auto_sheet_from_workspace_rows(
            gold_rows=gold_rows,
            silver_rows=silver_rows,
            bar_rows=bar_rows,
            ptpd_rows=ptpd_rows,
            market_rates=market_rates,
        )
        if invoice_gold_mode == COMPANION_MODE_AUTO
        else _invoice_gold_rows_from_note(note_payload, market_rates=market_rates)
    )
    invoice_misc = (
        _invoice_misc_auto_sheet()
        if invoice_misc_mode == COMPANION_MODE_AUTO
        else _invoice_misc_rows_from_note(note_payload)
    )
    purchase_vat_enabled = bool(note_payload.get("purchase_vat_enabled", False))
    purchase_vat_rate = (
        quantize_2(to_decimal(note_payload.get("purchase_vat_rate_percent") or Decimal("0.00")))
        if purchase_vat_enabled
        else Decimal("0.00")
    )
    net_amount = quantize_2(total_amount)
    vat_amount = quantize_2(net_amount * purchase_vat_rate / Decimal("100"))
    gross_amount = quantize_2(net_amount + vat_amount)

    return PosWorkspaceOut(
        workspace_revision=int(note_payload.get("workspace_revision") or 1),
        # Only an entirely zero-priced legacy draft is auto-persisted by the
        # client. Mixed/positive offers may be intentional and remain intact.
        needs_price_repair=has_zero_price_candidate,
        session=_to_clerk_out(pos_session),
        customer=customer,
        bank_info=bank_info,
        payment_method=_workspace_payment_method_from_session(pos_session),
        market_rates=market_rates,
        afg_note=extract_purchase_freeform_note(pos_session.notes),
        purchase_vat_enabled=purchase_vat_enabled,
        purchase_vat_rate_percent=purchase_vat_rate,
        calculators=calculators,
        numbering_preview=numbering_preview,
        invoice_gold_mode=invoice_gold_mode,
        gold_rows=gold_rows,
        silver_rows=silver_rows,
        bar_rows=bar_rows,
        ptpd_rows=ptpd_rows,
        extra_rows=extra_rows,
        invoice_gold=invoice_gold,
        invoice_misc_mode=invoice_misc_mode,
        invoice_misc=invoice_misc,
        quick_mode_editable=True,
        summary=PosWorkspaceSummaryOut(
            active_line_count=active_line_count,
            total_weight_grams=quantize_2(total_weight),
            total_pure_gold_grams=quantize_2(total_pure),
            gold_weight_grams=quantize_2(gold_weight),
            silver_weight_grams=quantize_2(silver_weight),
            total_amount_dkk=quantize_2(total_amount),
            net_amount_dkk=net_amount,
            vat_rate_percent=purchase_vat_rate,
            vat_amount_dkk=vat_amount,
            gross_amount_dkk=gross_amount,
        ),
    )


async def _clone_purchase_workspace_lines(
    session: AsyncSession,
    *,
    source_session_id,
    target_session_id,
) -> list[PosSessionLine]:
    return await pos_purchase_documents._clone_purchase_workspace_lines(
        session,
        source_session_id=source_session_id,
        target_session_id=target_session_id,
    )


async def _replace_purchase_workspace_lines(
    session: AsyncSession,
    *,
    target_session_id,
    source_lines: list[PosSessionLine],
) -> None:
    await pos_purchase_documents._replace_purchase_workspace_lines(
        session,
        target_session_id=target_session_id,
        source_lines=source_lines,
    )


async def _replace_purchase_transaction_lines(
    session: AsyncSession,
    *,
    transaction: Transaction,
    source_lines: list[PosSessionLine],
) -> None:
    await pos_purchase_documents._replace_purchase_transaction_lines(
        session,
        transaction=transaction,
        source_lines=source_lines,
    )


async def open_purchase_document_for_edit(
    session: AsyncSession,
    *,
    sequence_no: int,
    clerk_user: User,
) -> PosWorkspaceOut:
    return await pos_purchase_documents.open_purchase_document_for_edit(
        session,
        sequence_no=sequence_no,
        clerk_user=clerk_user,
    )


async def delete_purchase_document(
    session: AsyncSession,
    *,
    sequence_no: int,
) -> None:
    await pos_purchase_documents.delete_purchase_document(session, sequence_no=sequence_no)


async def store_purchase_workspace_preferences(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    bank_info: PosWorkspaceBankInfo | None = None,
    market_rates: PosWorkspaceMarketRates | None = None,
    payment_method: str | None = None,
) -> None:
    note_payload = _parse_workspace_note_payload(pos_session.notes)
    numbering_preview = await _workspace_numbering_preview(session)
    if not str(note_payload.get("numbering", {}).get("afregnings_number_next") or "").strip():
        note_payload["numbering"] = {
            **(note_payload.get("numbering") if isinstance(note_payload.get("numbering"), dict) else {}),
            "afregnings_number_next": numbering_preview.afregnings_number_next,
            "invoice_number_next": numbering_preview.invoice_number_next,
        }
    if bank_info is not None:
        note_payload["bank_info"] = {
            "reg_number": bank_info.reg_number or "",
            "account_number": bank_info.account_number or "",
        }
    if market_rates is not None:
        note_payload["market_rates"] = _serialize_workspace_market_rates_payload(market_rates)
        pos_session.live_rate_dkk = quantize_2(to_decimal(market_rates.gold_24k_dkk))
        pos_session.rate_source = PosRateSourceEnum.LIVE
    if payment_method is not None:
        note_payload["payment_method"] = payment_method if payment_method in {"bank", "cash"} else "bank"
    pos_session.notes = _serialize_workspace_note_payload(note_payload)
    await session.flush()


async def build_purchase_workspace_csv_export(
    session: AsyncSession,
    *,
    pos_session: PosSession,
) -> tuple[str, str]:
    return await pos_purchase_documents.build_purchase_workspace_csv_export(session, pos_session=pos_session)


async def build_purchase_workspace_xlsx_export(
    session: AsyncSession,
    *,
    pos_session: PosSession,
) -> tuple[str, bytes]:
    return await pos_purchase_documents.build_purchase_workspace_xlsx_export(session, pos_session=pos_session)


async def build_purchase_workspace_print_html(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    auto_print: bool = True,
) -> str:
    return await pos_purchase_documents.build_purchase_workspace_print_html(
        session,
        pos_session=pos_session,
        auto_print=auto_print,
    )


async def update_purchase_workspace_customer(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceCustomerUpdate,
    commit: bool = True,
    emit: bool = True,
    lock: bool = True,
    claim_revision: bool = True,
) -> PosWorkspaceOut:
    return await pos_workspace_mutations.update_purchase_workspace_customer(
        session,
        pos_session=pos_session,
        payload=payload,
        commit=commit,
        emit=emit,
        lock=lock,
        claim_revision=claim_revision,
    )


async def update_purchase_workspace_draft_customer(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceCustomerUpdate,
    commit: bool = True,
    emit: bool = True,
    lock: bool = True,
    claim_revision: bool = True,
) -> PosWorkspaceOut:
    return await pos_workspace_mutations.update_purchase_workspace_draft_customer(
        session,
        pos_session=pos_session,
        payload=payload,
        commit=commit,
        emit=emit,
        lock=lock,
        claim_revision=claim_revision,
    )


async def select_purchase_workspace_customer(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceCustomerSelectRequest,
) -> PosWorkspaceOut:
    return await pos_workspace_mutations.select_purchase_workspace_customer(
        session,
        pos_session=pos_session,
        payload=payload,
    )


async def replace_purchase_workspace_sections(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceSectionsUpdate,
    commit: bool = True,
    emit: bool = True,
    lock: bool = True,
    claim_revision: bool = True,
) -> PosWorkspaceOut:
    return await pos_workspace_mutations.replace_purchase_workspace_sections(
        session,
        pos_session=pos_session,
        payload=payload,
        commit=commit,
        emit=emit,
        lock=lock,
        claim_revision=claim_revision,
    )


async def finalize_purchase_workspace(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosWorkspaceFinalizeRequest,
) -> PosWorkspaceFinalizeResponse:
    return await pos_purchase_finalize.finalize_purchase_workspace(
        session,
        pos_session=pos_session,
        payload=payload,
    )


async def create_pos_session_line(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosSessionLineCreate,
) -> PosSessionLineOut:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturumda satır eklenebilir")

    max_line_no = await session.scalar(
        select(func.max(PosSessionLine.line_no)).where(PosSessionLine.pos_session_id == pos_session.id)
    )
    next_line_no = int(max_line_no or 0) + 1

    margin = (
        to_decimal(payload.margin_percent_internal)
        if payload.margin_percent_internal is not None
        else to_decimal(pos_session.margin_percent_internal or Decimal("0"))
    )
    rate = to_decimal(payload.rate_dkk) if payload.rate_dkk is not None else _active_rate(pos_session)
    offer = _calculate_offer(
        weight_grams=to_decimal(payload.weight_grams),
        purity_percentage=to_decimal(payload.purity_percentage),
        active_rate=rate,
        trade_side=_resolved_trade_side(pos_session),
        margin_percent=margin,
    )

    line = PosSessionLine(
        pos_session_id=pos_session.id,
        line_no=next_line_no,
        product_type=payload.product_type,
        metal_type=payload.metal_type,
        weight_grams=quantize_2(payload.weight_grams),
        purity_karat=payload.purity_karat,
        purity_percentage=quantize_2(payload.purity_percentage),
        rate_dkk=(quantize_2(rate) if rate is not None else None),
        margin_percent_internal=quantize_2(margin),
        line_offer_dkk=offer,
        notes=payload.notes,
    )
    session.add(line)
    await session.flush()
    await _sync_buy_session_summary_from_lines(session, pos_session=pos_session)
    await session.commit()
    await session.refresh(line)
    return _to_line_out(line)


async def create_pos_session_lines_bulk(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosSessionLineBulkCreate,
) -> list[PosSessionLineOut]:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturumda satır eklenebilir")
    if len(payload.items) > 50:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Tek seferde en fazla 50 satır eklenebilir")

    max_line_no = await session.scalar(
        select(func.max(PosSessionLine.line_no)).where(PosSessionLine.pos_session_id == pos_session.id)
    )
    next_line_no = int(max_line_no or 0) + 1
    trade_side = _resolved_trade_side(pos_session)
    active_rate = _active_rate(pos_session)

    created_lines: list[PosSessionLine] = []
    for item in payload.items:
        margin = (
            to_decimal(item.margin_percent_internal)
            if item.margin_percent_internal is not None
            else to_decimal(pos_session.margin_percent_internal or Decimal("0"))
        )
        rate = to_decimal(item.rate_dkk) if item.rate_dkk is not None else active_rate
        offer = _calculate_offer(
            weight_grams=to_decimal(item.weight_grams),
            purity_percentage=to_decimal(item.purity_percentage),
            active_rate=rate,
            trade_side=trade_side,
            margin_percent=margin,
        )
        line = PosSessionLine(
            pos_session_id=pos_session.id,
            line_no=next_line_no,
            product_type=item.product_type,
            metal_type=item.metal_type,
            weight_grams=quantize_2(item.weight_grams),
            purity_karat=item.purity_karat,
            purity_percentage=quantize_2(item.purity_percentage),
            rate_dkk=(quantize_2(rate) if rate is not None else None),
            margin_percent_internal=quantize_2(margin),
            line_offer_dkk=offer,
            notes=item.notes,
        )
        session.add(line)
        created_lines.append(line)
        next_line_no += 1

    await session.flush()
    await _sync_buy_session_summary_from_lines(session, pos_session=pos_session)
    await session.commit()
    for line in created_lines:
        await session.refresh(line)

    return [_to_line_out(line) for line in created_lines]


async def update_pos_session_line(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    line_id,
    payload: PosSessionLineUpdate,
) -> PosSessionLineOut:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturumda satır güncellenebilir")

    line = await session.scalar(
        select(PosSessionLine).where(
            PosSessionLine.id == line_id,
            PosSessionLine.pos_session_id == pos_session.id,
        )
    )
    if line is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="POS satırı bulunamadı")

    if payload.product_type is not None:
        line.product_type = payload.product_type
    if payload.metal_type is not None:
        line.metal_type = payload.metal_type
    if payload.weight_grams is not None:
        line.weight_grams = quantize_2(payload.weight_grams)
    if payload.purity_karat is not None:
        line.purity_karat = payload.purity_karat
    if payload.purity_percentage is not None:
        line.purity_percentage = quantize_2(payload.purity_percentage)
    if payload.rate_dkk is not None:
        line.rate_dkk = quantize_2(payload.rate_dkk)
    if payload.margin_percent_internal is not None:
        line.margin_percent_internal = quantize_2(payload.margin_percent_internal)
    if payload.notes is not None:
        line.notes = payload.notes

    offer = _calculate_offer(
        weight_grams=to_decimal(line.weight_grams),
        purity_percentage=to_decimal(line.purity_percentage),
        active_rate=(to_decimal(line.rate_dkk) if line.rate_dkk is not None else _active_rate(pos_session)),
        trade_side=_resolved_trade_side(pos_session),
        margin_percent=to_decimal(line.margin_percent_internal),
    )
    line.line_offer_dkk = offer

    await session.flush()
    await _sync_buy_session_summary_from_lines(session, pos_session=pos_session)
    await session.commit()
    await session.refresh(line)
    return _to_line_out(line)


async def delete_pos_session_line(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    line_id,
) -> None:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturumda satır silinebilir")

    line = await session.scalar(
        select(PosSessionLine).where(
            PosSessionLine.id == line_id,
            PosSessionLine.pos_session_id == pos_session.id,
        )
    )
    if line is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="POS satırı bulunamadı")
    await session.delete(line)
    await session.flush()
    await _sync_buy_session_summary_from_lines(session, pos_session=pos_session)
    await session.commit()


async def sync_live_rate(session: AsyncSession, *, pos_session: PosSession) -> PosSessionOutClerk:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturumda kur senkronize edilir")

    metal_key = _metal_rate_key(pos_session.metal_type)
    rates = await GoldPriceService().get_rates()
    live_rate = to_decimal(rates.get(metal_key), default="0")

    pos_session.live_rate_dkk = quantize_2(live_rate)
    if pos_session.rate_source != PosRateSourceEnum.MANUAL:
        pos_session.rate_source = PosRateSourceEnum.LIVE

    _recalculate(pos_session)
    pos_session.visible_snapshot = jsonable_encoder(_to_display_out(pos_session))

    await session.commit()
    await session.refresh(pos_session)

    await _emit_session_state(pos_session)
    return _to_clerk_out(pos_session)


async def set_manual_rate(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosManualRateUpdate,
) -> PosSessionOutClerk:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturumda manuel kur ayarlanır")

    pos_session.manual_rate_dkk = quantize_2(payload.manual_rate_dkk)
    pos_session.rate_source = PosRateSourceEnum.MANUAL

    _recalculate(pos_session)
    pos_session.visible_snapshot = jsonable_encoder(_to_display_out(pos_session))

    await session.commit()
    await session.refresh(pos_session)

    await _emit_session_state(pos_session)
    return _to_clerk_out(pos_session)


def _resolve_sale_override_audit(
    *,
    pos_session: PosSession,
    sale_price: Decimal,
    payload: PosConfirmRequest,
) -> dict[str, Any]:
    session_margin = quantize_2(to_decimal(pos_session.margin_percent_internal or Decimal("0")))
    default_margin = DEFAULT_POS_MARGIN_PERCENT
    margin_overridden = abs(session_margin - default_margin) > SALE_OVERRIDE_EPSILON

    expected_sale_price = (
        quantize_2(to_decimal(pos_session.final_offer_dkk))
        if pos_session.final_offer_dkk is not None
        else None
    )
    price_overridden = (
        expected_sale_price is not None
        and abs(quantize_2(sale_price) - expected_sale_price) > SALE_OVERRIDE_EPSILON
    )

    requires_approval = margin_overridden or price_overridden
    override_reason = (payload.sale_override_reason or "").strip()
    if requires_approval and not payload.sale_override_approved:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Satış fiyatı/marj override edildi. "
                "Devam etmek için 'override onayı' kutusunu işaretleyin."
            ),
        )
    if requires_approval and not override_reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Satış override işlemi için zorunlu denetim notu girin."
            ),
        )

    return {
        "required": requires_approval,
        "approved": bool(payload.sale_override_approved and requires_approval),
        "reason": (override_reason or None),
        "price_overridden": price_overridden,
        "margin_overridden": margin_overridden,
        "expected_sale_price_dkk": (str(expected_sale_price) if expected_sale_price is not None else None),
        "actual_sale_price_dkk": str(quantize_2(sale_price)),
        "default_margin_percent_internal": str(default_margin),
        "actual_margin_percent_internal": str(session_margin),
    }


async def confirm_session(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    payload: PosConfirmRequest,
    clerk_user: User,
) -> PosConfirmResponse:
    if pos_session.status != PosSessionStatusEnum.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sadece taslak oturum onaylanabilir")

    trade_side = _resolved_trade_side(pos_session)
    requested_reference = (payload.reference_number or "").strip()
    allow_line_total_adjustment = bool(payload.allow_line_total_adjustment)
    pos_lines = (
        await session.scalars(
            select(PosSessionLine)
            .where(PosSessionLine.pos_session_id == pos_session.id)
            .order_by(PosSessionLine.line_no.asc())
        )
    ).all()
    has_line_items = len(pos_lines) > 0

    active_rate = _active_rate(pos_session)
    if (
        trade_side != PosTradeSideEnum.SELL_TO_CUSTOMER
        and not has_line_items
        and (active_rate is None or pos_session.final_offer_dkk is None)
    ):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Kur ve teklif alanları eksik")

    if trade_side == PosTradeSideEnum.SELL_TO_CUSTOMER:
        if not get_settings().invoice_sale_tax_policy_configured:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "sales_tax_policy_required",
                    "message": "Satış faturası için KDV/vergi politikası Ayarlar'dan onaylanmadan satış kesinleştirilemez.",
                },
            )
        sale_price = (
            to_decimal(payload.sale_price_dkk)
            if payload.sale_price_dkk is not None
            else (to_decimal(pos_session.final_offer_dkk) if pos_session.final_offer_dkk is not None else None)
        )
        if sale_price is None or sale_price <= 0:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Satış fiyatı geçersiz")
        sale_override_audit = _resolve_sale_override_audit(
            pos_session=pos_session,
            sale_price=sale_price,
            payload=payload,
        )

        if payload.sale_product_id is not None:
            # Envanterden satış modu
            sale_product = await get_inventory_product_or_404(session, payload.sale_product_id)
            # GDPR kilidi satışı engellemez (0.3.8: yalnız bilgi).
            if sale_product.status != ProductStatusEnum.FOR_SALE:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Seçilen ürün satışta değil. Sadece 'satışta' durumundaki ürünler satılabilir.",
                )

            sold_product = await update_status(
                session,
                sale_product,
                ProductStatusUpdate(
                    status=ProductStatusEnum.SOLD,
                    sale_price_dkk=sale_price,
                    buyer_customer_id=pos_session.customer_id,
                ),
                clerk_user.id,
            )

            pos_session.product_type = sale_product.product_type
            pos_session.metal_type = sale_product.metal_type
            pos_session.weight_grams = quantize_2(to_decimal(sale_product.weight_grams))
            pos_session.purity_karat = sale_product.purity_karat
            pos_session.purity_percentage = (
                quantize_2(to_decimal(sale_product.purity_percentage))
                if sale_product.purity_percentage is not None
                else None
            )
            pos_session.final_offer_dkk = quantize_2(sale_price)
            pos_session.status = PosSessionStatusEnum.CONFIRMED
            pos_session.confirmed_at = utc_now()
            pos_session.notes = payload.notes
            pos_session.visible_snapshot = jsonable_encoder(_to_display_out(pos_session))

            session.add(
                ProductHistory(
                    product_id=sold_product.id,
                    action="pos_sale_confirmed",
                    old_value=None,
                    new_value={
                        "pos_session_id": str(pos_session.id),
                        "trade_side": trade_side.value,
                        "sale_mode": "inventory",
                        "sale_override": sale_override_audit,
                    },
                    performed_by=clerk_user.id,
                    notes="Canlı POS satış oturumundan (envanterden) onaylandı",
                )
            )
            session.add(
                PosSessionProductLink(
                    pos_session_id=pos_session.id,
                    product_id=sold_product.id,
                )
            )
            pos_document, _ = await _ensure_pos_document(
                session,
                pos_session=pos_session,
                customer=pos_session.customer,
                trade_side=trade_side,
                amount_dkk=sale_price,
                notes=payload.notes,
            )
            await _ensure_pos_transaction(
                session,
                pos_session=pos_session,
                product=sold_product,
                pos_document=pos_document,
                trade_side=trade_side,
                amount_dkk=sale_price,
                notes=payload.notes,
            )

            await session.commit()
            await session.refresh(pos_session)

            await _emit_session_state(pos_session)
            return PosConfirmResponse(
                session=_to_clerk_out(pos_session),
                product_id=sold_product.id,
                product_number=sold_product.product_number,
                product_ids=[sold_product.id],
                product_numbers=[sold_product.product_number],
            )

        # Manuel satış modu
        if (
            not pos_session.product_type
            or not pos_session.metal_type
            or pos_session.weight_grams is None
            or pos_session.purity_percentage is None
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Manuel satış için ürün alanları eksik",
            )

        manual_purchase_cost = (
            to_decimal(payload.manual_purchase_cost_dkk)
            if payload.manual_purchase_cost_dkk is not None
            else sale_price
        )

        manual_reference = requested_reference or await consume_next_reference_number(session)
        manual_product_payload = ProductCreate(
            reference_number=manual_reference,
            product_type=(
                pos_session.product_type
                if isinstance(pos_session.product_type, ProductTypeEnum)
                else ProductTypeEnum(pos_session.product_type)
            ),
            metal_type=(
                pos_session.metal_type
                if isinstance(pos_session.metal_type, MetalTypeEnum)
                else MetalTypeEnum(pos_session.metal_type)
            ),
            weight_grams=to_decimal(pos_session.weight_grams),
            purity_karat=pos_session.purity_karat,
            purity_percentage=to_decimal(pos_session.purity_percentage),
            # Manuel satışta maliyet bilinmiyorsa satış fiyatı baz alınır (varsayılan 0 kar).
            purchase_price_dkk=manual_purchase_cost,
            gold_rate_at_purchase=active_rate,
            commission=to_decimal(pos_session.margin_percent_internal),
            purchase_date=utc_now() - timedelta(days=15),
            notes=payload.notes,
            storage_location=payload.storage_location,
            needs_cleaning=False,
        )
        manual_created = await create_product(session, manual_product_payload, clerk_user.id)

        manual_product = await get_inventory_product_or_404(session, manual_created.id)
        await update_status(
            session,
            manual_product,
            ProductStatusUpdate(status=ProductStatusEnum.FOR_SALE),
            clerk_user.id,
        )
        manual_product_for_sale = await get_inventory_product_or_404(session, manual_created.id)
        sold_manual_product = await update_status(
            session,
            manual_product_for_sale,
            ProductStatusUpdate(
                status=ProductStatusEnum.SOLD,
                sale_price_dkk=sale_price,
                buyer_customer_id=pos_session.customer_id,
            ),
            clerk_user.id,
        )

        pos_session.final_offer_dkk = quantize_2(sale_price)
        pos_session.status = PosSessionStatusEnum.CONFIRMED
        pos_session.confirmed_at = utc_now()
        pos_session.notes = payload.notes
        pos_session.visible_snapshot = jsonable_encoder(_to_display_out(pos_session))

        session.add(
            ProductHistory(
                product_id=sold_manual_product.id,
                action="pos_manual_sale_confirmed",
                old_value=None,
                new_value={
                    "pos_session_id": str(pos_session.id),
                    "trade_side": trade_side.value,
                    "sale_mode": "manual",
                    "manual_purchase_cost_dkk": str(manual_purchase_cost),
                    "sale_override": sale_override_audit,
                },
                performed_by=clerk_user.id,
                notes="Canlı POS satış oturumundan (manuel) onaylandı",
            )
        )
        session.add(
            PosSessionProductLink(
                pos_session_id=pos_session.id,
                product_id=sold_manual_product.id,
            )
        )
        pos_document, _ = await _ensure_pos_document(
            session,
            pos_session=pos_session,
            customer=pos_session.customer,
            trade_side=trade_side,
            amount_dkk=sale_price,
            notes=payload.notes,
        )
        await _ensure_pos_transaction(
            session,
            pos_session=pos_session,
            product=sold_manual_product,
            pos_document=pos_document,
            trade_side=trade_side,
            amount_dkk=sale_price,
            notes=payload.notes,
        )
        await session.commit()
        await session.refresh(pos_session)

        await _emit_session_state(pos_session)
        return PosConfirmResponse(
            session=_to_clerk_out(pos_session),
            product_id=sold_manual_product.id,
            product_number=sold_manual_product.product_number,
            product_ids=[sold_manual_product.id],
            product_numbers=[sold_manual_product.product_number],
        )

    if (
        not has_line_items
        and (
            not pos_session.product_type
            or not pos_session.metal_type
            or pos_session.weight_grams is None
            or pos_session.purity_percentage is None
        )
    ):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Teklif alanları eksik")

    line_payloads: list[dict[str, Any]] = []
    if has_line_items:
        for line in pos_lines:
            line_rate = to_decimal(line.rate_dkk) if line.rate_dkk is not None else active_rate
            margin = to_decimal(line.margin_percent_internal)
            line_amount = (
                to_decimal(line.line_offer_dkk)
                if line.line_offer_dkk is not None
                else _calculate_offer(
                    weight_grams=to_decimal(line.weight_grams),
                    purity_percentage=to_decimal(line.purity_percentage),
                    active_rate=line_rate,
                    trade_side=trade_side,
                    margin_percent=margin,
                )
            )
            if line_amount is None or line_amount <= 0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Kalem #{line.line_no} için geçerli teklif tutarı üretilemedi",
                )
            line_payloads.append(
                {
                    "line_no": line.line_no,
                    "product_type": line.product_type,
                    "metal_type": line.metal_type,
                    "weight_grams": to_decimal(line.weight_grams),
                    "purity_karat": line.purity_karat,
                    "purity_percentage": to_decimal(line.purity_percentage),
                    "gold_rate_at_purchase": line_rate,
                    "commission": margin,
                    "purchase_price_dkk": quantize_2(line_amount),
                    "line_note": (line.notes or "").strip(),
                }
            )
    else:
        line_payloads.append(
            {
                "line_no": 1,
                "product_type": (
                    pos_session.product_type
                    if isinstance(pos_session.product_type, ProductTypeEnum)
                    else ProductTypeEnum(pos_session.product_type)
                ),
                "metal_type": (
                    pos_session.metal_type
                    if isinstance(pos_session.metal_type, MetalTypeEnum)
                    else MetalTypeEnum(pos_session.metal_type)
                ),
                "weight_grams": to_decimal(pos_session.weight_grams),
                "purity_karat": pos_session.purity_karat,
                "purity_percentage": to_decimal(pos_session.purity_percentage),
                "gold_rate_at_purchase": active_rate,
                "commission": to_decimal(pos_session.margin_percent_internal),
                "purchase_price_dkk": quantize_2(to_decimal(pos_session.final_offer_dkk)),
                "line_note": "",
            }
        )

    line_total_sum = quantize_2(sum((item["purchase_price_dkk"] for item in line_payloads), Decimal("0.00")))
    target_total = (
        quantize_2(to_decimal(pos_session.final_offer_dkk))
        if pos_session.final_offer_dkk is not None
        else line_total_sum
    )
    if target_total <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Toplam teklif tutarı geçersiz")

    if line_payloads:
        delta = quantize_2(target_total - line_total_sum)
        if delta != Decimal("0.00"):
            if has_line_items and abs(delta) > Decimal("0.01") and not allow_line_total_adjustment:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Kalem toplamı ile nihai teklif arasında fark var. "
                        "Düzeltme için açık onay gerekir."
                    ),
                )
            line_payloads[-1]["purchase_price_dkk"] = quantize_2(line_payloads[-1]["purchase_price_dkk"] + delta)

    created_products: list[Product] = []
    for idx, line_payload in enumerate(line_payloads):
        if idx == 0 and requested_reference:
            reference_number = requested_reference
        else:
            reference_number = await consume_next_reference_number(session)
        product_notes = payload.notes
        if line_payload["line_note"]:
            product_notes = (
                f"{payload.notes}\nKalem notu: {line_payload['line_note']}"
                if payload.notes
                else f"Kalem notu: {line_payload['line_note']}"
            )

        product_payload = ProductCreate(
            reference_number=reference_number,
            product_type=line_payload["product_type"],
            metal_type=line_payload["metal_type"],
            weight_grams=line_payload["weight_grams"],
            purity_karat=line_payload["purity_karat"],
            purity_percentage=line_payload["purity_percentage"],
            purchase_price_dkk=line_payload["purchase_price_dkk"],
            gold_rate_at_purchase=line_payload["gold_rate_at_purchase"],
            commission=line_payload["commission"],
            seller_customer_id=pos_session.customer_id,
            notes=product_notes,
            storage_location=payload.storage_location,
            needs_cleaning=payload.needs_cleaning,
        )
        created = await create_product(session, product_payload, clerk_user.id)
        created_products.append(created)
        session.add(
            ProductHistory(
                product_id=created.id,
                action="pos_confirmed",
                old_value=None,
                new_value={
                    "pos_session_id": str(pos_session.id),
                    "trade_side": trade_side.value,
                    "line_no": line_payload["line_no"],
                    "line_count": len(line_payloads),
                },
                performed_by=clerk_user.id,
                notes="Canlı POS oturumundan onaylandı",
            )
        )

    primary_product = created_products[0]
    pos_session.product_type = primary_product.product_type
    pos_session.metal_type = primary_product.metal_type
    pos_session.weight_grams = quantize_2(to_decimal(primary_product.weight_grams))
    pos_session.purity_karat = primary_product.purity_karat
    pos_session.purity_percentage = (
        quantize_2(to_decimal(primary_product.purity_percentage))
        if primary_product.purity_percentage is not None
        else None
    )
    pos_session.final_offer_dkk = target_total
    pos_session.status = PosSessionStatusEnum.CONFIRMED
    pos_session.confirmed_at = utc_now()
    pos_session.notes = payload.notes
    pos_session.visible_snapshot = jsonable_encoder(_to_display_out(pos_session))

    session.add(
        PosSessionProductLink(
            pos_session_id=pos_session.id,
            product_id=primary_product.id,
        )
    )
    pos_document, _ = await _ensure_pos_document(
        session,
        pos_session=pos_session,
        customer=pos_session.customer,
        trade_side=trade_side,
        amount_dkk=target_total,
        notes=payload.notes,
    )
    await _ensure_pos_transaction(
        session,
        pos_session=pos_session,
        product=primary_product,
        pos_document=pos_document,
        trade_side=trade_side,
        amount_dkk=target_total,
        notes=payload.notes,
        line_products=created_products if has_line_items else None,
    )

    await session.commit()
    await session.refresh(pos_session)

    await _emit_session_state(pos_session)
    return PosConfirmResponse(
        session=_to_clerk_out(pos_session),
        product_id=primary_product.id,
        product_number=primary_product.product_number,
        product_ids=[item.id for item in created_products],
        product_numbers=[item.product_number for item in created_products],
    )


async def cancel_session(session: AsyncSession, *, pos_session: PosSession) -> PosSessionOutClerk:
    return await pos_workspace_mutations.cancel_session(session, pos_session=pos_session)


async def display_snapshot(session: AsyncSession, pos_session: PosSession) -> PosSessionDisplayOut:
    return await pos_display_service.display_snapshot(session, pos_session)


async def get_pos_confirmed_product_or_404(session: AsyncSession, pos_session_id) -> Product:
    link = await session.scalar(
        select(PosSessionProductLink).where(PosSessionProductLink.pos_session_id == pos_session_id)
    )
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bu POS oturumuna ait ürün bulunamadı")

    product = await session.scalar(
        select(Product)
        .where(Product.id == link.product_id)
        .options(selectinload(Product.seller_customer), selectinload(Product.buyer_customer))
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onaylanan ürün kaydı bulunamadı")
    return product


async def build_pos_receipt_context(
    session: AsyncSession,
    *,
    pos_session: PosSession,
    audience: str = "customer",
) -> dict[str, Any]:
    if pos_session.status != PosSessionStatusEnum.CONFIRMED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fiş yalnızca onaylanmış oturumlar için üretilebilir")

    try:
        product = await get_pos_confirmed_product_or_404(session, pos_session.id)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        product = None
    customer = pos_session.customer
    if not customer:
        customer = await session.get(User, pos_session.customer_id)
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Müşteri kaydı bulunamadı")

    identity = await session.scalar(
        select(CustomerIdentityDocument).where(CustomerIdentityDocument.user_id == customer.id)
    )

    cpr_plain = decrypt_field(customer.cpr_number_encrypted)
    address_plain = decrypt_field(customer.address_encrypted)
    identity_number = decrypt_field(identity.identity_doc_number_encrypted) if identity else None

    customer_info = {
        "name": customer.name or "-",
        "phone": customer.phone or "-",
        "email": customer.email or "-",
        "address": address_plain or "-",
        "cpr_masked": mask_cpr(cpr_plain) or "-",
        "identity_type": (identity.identity_doc_type.value if identity and identity.identity_doc_type else "-"),
        "identity_number_masked": mask_last4(identity_number) or "-",
        "identity_country": (identity.identity_doc_country or "-") if identity else "-",
    }

    trade_side = _resolved_trade_side(pos_session)
    if trade_side == PosTradeSideEnum.SELL_TO_CUSTOMER:
        rate_value = _active_rate(pos_session)
        if rate_value is None and product is not None and product.gold_rate_at_purchase is not None:
            rate_value = to_decimal(product.gold_rate_at_purchase)
        offer_value = (
            product.sale_price_dkk
            if product is not None and product.sale_price_dkk is not None
            else pos_session.final_offer_dkk
        )
        amount_label = "Tahsil Edilen Tutar (Brüt)"
    else:
        rate_value = (
            to_decimal(product.gold_rate_at_purchase)
            if product is not None and product.gold_rate_at_purchase is not None
            else None
        )
        offer_value = product.purchase_price_dkk if product is not None else pos_session.final_offer_dkk
        amount_label = "Müşteriye Ödenen Tutar"

    offer_amount = to_decimal(offer_value) if offer_value is not None else None
    pos_document, document_created = await _ensure_pos_document(
        session,
        pos_session=pos_session,
        customer=customer,
        trade_side=trade_side,
        amount_dkk=offer_amount,
        notes=(product.notes if product is not None else None) or pos_session.notes,
    )
    # Eski onaylı oturumlarda belge kaydı yoksa burada bir kez oluşturup kalıcılaştırırız.
    if document_created:
        await session.commit()
        await session.refresh(pos_document)

    # Eski onaylı oturumlarda transaction kaydı yoksa burada bir kez oluşturup kalıcılaştırırız.
    _, tx_created = await _ensure_pos_transaction(
        session,
        pos_session=pos_session,
        product=product,
        pos_document=pos_document,
        trade_side=trade_side,
        amount_dkk=offer_amount,
        notes=pos_document.notes or (product.notes if product is not None else None) or pos_session.notes,
    )
    if tx_created:
        await session.commit()

    transaction = await session.scalar(
        select(Transaction)
        .where(Transaction.pos_session_id == pos_session.id)
        .options(selectinload(Transaction.lines))
    )
    tx_lines = list(sorted((transaction.lines if transaction else []), key=lambda item: item.line_no))
    receipt_lines: list[dict[str, str | int]] = []
    for line in tx_lines:
        purity_karat_value = line.purity_karat or "-"
        purity_percentage_value = (
            _fmt_decimal(line.purity_percentage)
            if line.purity_percentage is not None
            else "-"
        )
        fineness_label = (
            f"{purity_karat_value} / {purity_percentage_value}%"
            if purity_karat_value != "-" or purity_percentage_value != "-"
            else "-"
        )
        receipt_lines.append(
            {
                "line_no": int(line.line_no),
                "product_number": line.product_number or "-",
                "reference_number": line.reference_number or "-",
                "product_type": _display_product_type(line.product_type),
                "metal_type": _metal_value(line.metal_type),  # ham enum; Danca etiket renderer'da (X2)
                "weight_grams": (_fmt_decimal(line.weight_grams) if line.weight_grams is not None else "-"),
                "purity_karat": purity_karat_value,
                "purity_percentage": purity_percentage_value,
                "fineness_label": fineness_label,
                "pure_metal_grams": (_fmt_decimal(line.pure_gold_grams) if line.pure_gold_grams is not None else "-"),
                "rate_dkk": (_fmt_decimal(line.rate_dkk) if line.rate_dkk is not None else "-"),
                "margin_percent": _fmt_decimal(line.margin_percent),
                "line_total_dkk": _fmt_decimal(line.line_total_dkk),
            }
        )

    if not receipt_lines:
        if product is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fiş için satır verisi bulunamadı")
        purity_karat_value = product.purity_karat or "-"
        purity_percentage_value = (
            _fmt_decimal(product.purity_percentage)
            if product.purity_percentage is not None
            else "-"
        )
        fineness_label = (
            f"{purity_karat_value} / {purity_percentage_value}%"
            if purity_karat_value != "-" or purity_percentage_value != "-"
            else "-"
        )
        receipt_lines = [
            {
                "line_no": 1,
                "product_number": product.product_number,
                "reference_number": product.reference_number or "-",
                "product_type": _display_product_type(product.product_type),
                "metal_type": _metal_value(product.metal_type),  # ham enum; Danca etiket renderer'da (X2)
                "weight_grams": _fmt_decimal(product.weight_grams),
                "purity_karat": purity_karat_value,
                "purity_percentage": purity_percentage_value,
                "fineness_label": fineness_label,
                "pure_metal_grams": (
                    _fmt_decimal(product.pure_gold_grams) if product.pure_gold_grams is not None else "-"
                ),
                "rate_dkk": _fmt_decimal(rate_value) if rate_value is not None else "-",
                "margin_percent": _fmt_decimal(pos_session.margin_percent_internal),
                "line_total_dkk": _fmt_decimal(offer_amount) if offer_amount is not None else "-",
            }
        ]

    document_number = _format_document_number(pos_document)
    generated_at = pos_document.issued_at or pos_session.confirmed_at or utc_now()
    supply_at = pos_document.supply_at or pos_session.confirmed_at or generated_at
    document_type = pos_document.document_type
    primary_line = receipt_lines[0] if receipt_lines else None
    if audience == "customer":
        customer_info["cpr_masked"] = "-"
        customer_info["identity_type"] = "-"
        customer_info["identity_number_masked"] = "-"
        customer_info["identity_country"] = "-"

    context = {
        "audience": audience,
        "copy_label": "Müşteri" if audience == "customer" else "Yönetim",
        "shop_name": settings.invoice_seller_name,
        "shop_address": _seller_address_line(),
        "shop_cvr": settings.invoice_seller_cvr,
        "shop_email": settings.invoice_seller_email or "-",
        "shop_phone": settings.invoice_seller_phone or "-",
        "document_type": document_type.value,
        "document_title": _document_title_tr(document_type),
        "document_number": document_number,
        "receipt_number": document_number,
        "generated_at": generated_at,
        "supply_at": supply_at,
        "session_code": pos_session.session_code,
        "trade_side": trade_side.value,
        "customer_party_label": _customer_party_label(document_type),
        "product_number": (
            product.product_number
            if product is not None
            else str(primary_line.get("product_number", "-") if primary_line else "-")
        ),
        "reference_number": (
            product.reference_number or "-"
            if product is not None
            else str(primary_line.get("reference_number", "-") if primary_line else "-")
        ),
        "product_type": (
            _display_product_type(product.product_type)
            if product is not None
            else str(primary_line.get("product_type", "-") if primary_line else "-")
        ),
        "metal_type": (
            _metal_value(product.metal_type)  # ham enum; Danca etiket renderer'da (X2)
            if product is not None
            else str(primary_line.get("metal_type", "-") if primary_line else "-")
        ),
        "weight_grams": (
            _fmt_decimal(product.weight_grams)
            if product is not None
            else str(primary_line.get("weight_grams", "-") if primary_line else "-")
        ),
        "purity_karat": (
            product.purity_karat or "-"
            if product is not None
            else str(primary_line.get("purity_karat", "-") if primary_line else "-")
        ),
        "purity_percentage": (
            _fmt_decimal(product.purity_percentage) if product is not None and product.purity_percentage is not None
            else str(primary_line.get("purity_percentage", "-") if primary_line else "-")
        ),
        "pure_gold_grams": (
            _fmt_decimal(product.pure_gold_grams) if product is not None and product.pure_gold_grams is not None
            else str(primary_line.get("pure_metal_grams", "-") if primary_line else "-")
        ),
        "rate_dkk": (
            _fmt_decimal(rate_value) if rate_value is not None else str(primary_line.get("rate_dkk", "-") if primary_line else "-")
        ),
        "margin_percent_internal": _fmt_decimal(pos_session.margin_percent_internal),
        "offer_dkk": _fmt_decimal(offer_amount) if offer_amount is not None else "-",
        "currency_code": pos_document.currency_code,
        "vat_rate_percent": _fmt_decimal(pos_document.vat_rate_percent),
        "vat_amount_dkk": _fmt_decimal(pos_document.vat_amount_dkk),
        "net_amount_dkk": _fmt_decimal(pos_document.net_amount_dkk),
        "gross_amount_dkk": _fmt_decimal(pos_document.gross_amount_dkk),
        "amount_label": amount_label,
        "notes": pos_document.notes or (product.notes if product is not None else None) or pos_session.notes or "-",
        "line_count": len(receipt_lines),
        "lines": receipt_lines,
        "customer": customer_info,
    }
    return context


async def build_realtime_display_snapshot(
    session: AsyncSession,
    pos_session: PosSession,
    payload: PosRealtimePreview,
) -> PosSessionDisplayOut:
    return await pos_display_service.build_realtime_display_snapshot(session, pos_session, payload)
