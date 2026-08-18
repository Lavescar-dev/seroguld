from __future__ import annotations

import json
import re
from decimal import Decimal, ROUND_CEILING
from typing import Any
from uuid import UUID

from app.models.enums import PosRateSourceEnum
from app.models.pos_session import PosSession
from app.schemas.pos import (
    PosWorkspaceBankInfo,
    PosWorkspaceCalculatorRowOut,
    PosWorkspaceCalculatorsOut,
    PosWorkspaceCalculatorsUpdate,
    PosWorkspaceCustomerOut,
    PosWorkspaceCustomerUpdate,
    PosWorkspaceGoldRowOut,
    PosWorkspaceInvoiceGoldRowOut,
    PosWorkspaceInvoiceGoldSheetOut,
    PosWorkspaceInvoiceMiscRowOut,
    PosWorkspaceInvoiceMiscSheetOut,
    PosWorkspaceMarketRates,
    PosWorkspaceNumberingOut,
    PosWorkspaceSilverRowOut,
)
from app.services.market_rate_profile import get_effective_market_rate_profile_cached
from app.utils.helpers import quantize_2, to_decimal


def _core():
    from app.services import pos_service as core

    return core


def _normalize_workspace_companion_mode(value: object, *, default: str) -> str:
    core = _core()
    text = str(value or "").strip().lower()
    if text in {core.COMPANION_MODE_AUTO, core.COMPANION_MODE_MANUAL}:
        return text
    return default


def _invoice_gold_sheet_has_content(payload: dict[str, Any]) -> bool:
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("code") or "").strip():
            return True
        if str(row.get("fineness") or "").strip():
            return True
        if quantize_2(to_decimal(row.get("gram") or 0)) > 0:
            return True
    footer_lines = payload.get("footer_lines") if isinstance(payload.get("footer_lines"), list) else []
    return any(str(value or "").strip() for value in footer_lines)


def _invoice_misc_sheet_has_content(payload: dict[str, Any]) -> bool:
    rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("text") or "").strip():
            return True
        if row.get("quantity") not in {None, ""} and quantize_2(to_decimal(row.get("quantity"))) > 0:
            return True
        if quantize_2(to_decimal(row.get("unit_price_dkk") or 0)) > 0:
            return True
    return False


def _normalize_workspace_market_rate(value: Decimal | None, fallback: Decimal) -> Decimal:
    if value is None:
        return quantize_2(fallback)
    return quantize_2(to_decimal(value))


def _quantize_4(value: Decimal | int | str | None) -> Decimal:
    return to_decimal(value or 0).quantize(Decimal("0.0001"))


def _workspace_note_decimal(value: object, fallback: Decimal) -> Decimal:
    if value is None:
        return quantize_2(fallback)
    text = str(value).strip()
    if not text:
        return quantize_2(fallback)
    try:
        return quantize_2(to_decimal(text))
    except Exception:
        return quantize_2(fallback)


def _workspace_note_decimal4(value: object, fallback: Decimal) -> Decimal:
    if value is None:
        return _quantize_4(fallback)
    text = str(value).strip()
    if not text:
        return _quantize_4(fallback)
    try:
        return _quantize_4(to_decimal(text))
    except Exception:
        return _quantize_4(fallback)


def _workspace_positive_decimal(value: object, fallback: Decimal) -> Decimal:
    parsed = _workspace_note_decimal(value, fallback)
    return parsed if parsed > 0 else quantize_2(fallback)


def _workspace_positive_decimal4(value: object, fallback: Decimal) -> Decimal:
    parsed = _workspace_note_decimal4(value, fallback)
    return parsed if parsed > 0 else _quantize_4(fallback)


def _gold_definition_by_row_key(row_key: str) -> dict[str, str | Decimal] | None:
    core = _core()
    return next((item for item in core.GOLD_WORKSPACE_ROWS if str(item["row_key"]) == row_key), None)


def _silver_definition_by_row_key(row_key: str) -> dict[str, str | Decimal] | None:
    core = _core()
    return next((item for item in core.SILVER_WORKSPACE_ROWS if str(item["row_key"]) == row_key), None)


def _silver_definition_by_lodighed(lodighed: str) -> dict[str, str | Decimal] | None:
    core = _core()
    target = str(lodighed or "").strip()
    return next((item for item in core.SILVER_WORKSPACE_ROWS if str(item["lodighed"]) == target), None)


def _default_gold_rate_map(*, gold_24k_dkk: Decimal, fx: Decimal) -> dict[str, Decimal]:
    core = _core()
    gold_24k_eur = _quantize_4(to_decimal(gold_24k_dkk) / to_decimal(fx or core.DEFAULT_EUR_DKK_FX))
    return {
        str(item["row_key"]).split(":", 1)[1]: _quantize_4(
            gold_24k_eur * (to_decimal(item["karat"]) / Decimal("24"))
        )
        for item in core.GOLD_WORKSPACE_ROWS
    }


def _default_silver_rate_map(*, silver_999_dkk: Decimal, fx: Decimal) -> dict[str, Decimal]:
    core = _core()
    silver_999_eur = _quantize_4(to_decimal(silver_999_dkk) / to_decimal(fx or core.DEFAULT_EUR_DKK_FX))
    return {
        str(item["lodighed"]): _quantize_4(
            silver_999_eur * (to_decimal(item["purity_percentage"]) / Decimal("99.90"))
        )
        for item in core.SILVER_WORKSPACE_ROWS
    }


def _build_workspace_market_rates(
    *,
    eur_dkk_fx: Decimal,
    gold_rates_eur: dict[str, Decimal],
    silver_rates_eur: dict[str, Decimal],
) -> PosWorkspaceMarketRates:
    core = _core()
    fx = quantize_2(to_decimal(eur_dkk_fx or core.DEFAULT_EUR_DKK_FX))
    gold_24k_eur = _quantize_4(gold_rates_eur.get("24"))
    silver_999_eur = _quantize_4(silver_rates_eur.get("999"))
    gold_matrix = []
    for definition in core.GOLD_WORKSPACE_ROWS:
        rate_key = str(definition["row_key"]).split(":", 1)[1]
        eur_per_gram = _quantize_4(gold_rates_eur.get(rate_key))
        gold_matrix.append(
            {
                "row_key": str(definition["row_key"]),
                "label": str(definition["label"]).upper(),
                "lodighed": str(definition["lodighed"]),
                "eur_per_gram": eur_per_gram,
                "dkk_per_gram": quantize_2(eur_per_gram * fx),
                "karat": quantize_2(to_decimal(definition["karat"])),
                "type_code": "1",
            }
        )
    silver_matrix = []
    for definition in core.SILVER_WORKSPACE_ROWS:
        rate_key = str(definition["lodighed"])
        eur_per_gram = _quantize_4(silver_rates_eur.get(rate_key))
        silver_matrix.append(
            {
                "row_key": str(definition["row_key"]),
                "label": str(definition["label"]),
                "lodighed": rate_key,
                "eur_per_gram": eur_per_gram,
                "dkk_per_gram": quantize_2(eur_per_gram * fx),
                "karat": None,
                "type_code": str(definition["type_code"]),
            }
        )
    return PosWorkspaceMarketRates(
        eur_dkk_fx=fx,
        gold_rates_eur={key: _quantize_4(value) for key, value in gold_rates_eur.items()},
        silver_rates_eur={key: _quantize_4(value) for key, value in silver_rates_eur.items()},
        gold_24k_dkk=quantize_2(gold_24k_eur * fx),
        silver_dkk=quantize_2(silver_999_eur * fx),
        gold_matrix=gold_matrix,
        silver_matrix=silver_matrix,
    )


def _market_rate_payload_to_workspace(
    market_payload: dict[str, Any],
    *,
    fallback_gold_24k_dkk: Decimal,
    fallback_silver_dkk: Decimal,
) -> PosWorkspaceMarketRates:
    core = _core()
    fx = _workspace_positive_decimal(market_payload.get("eur_dkk_fx"), core.DEFAULT_EUR_DKK_FX)
    gold_fallback_map = _default_gold_rate_map(gold_24k_dkk=fallback_gold_24k_dkk, fx=fx)
    silver_fallback_map = _default_silver_rate_map(silver_999_dkk=fallback_silver_dkk, fx=fx)
    raw_gold_rates = market_payload.get("gold_rates_eur") if isinstance(market_payload.get("gold_rates_eur"), dict) else {}
    raw_silver_rates = market_payload.get("silver_rates_eur") if isinstance(market_payload.get("silver_rates_eur"), dict) else {}
    gold_rates_eur = {
        key: _workspace_positive_decimal4(raw_gold_rates.get(key), gold_fallback_map[key])
        for key in core.GOLD_RATE_KEYS
    }
    silver_rates_eur = {
        key: _workspace_positive_decimal4(raw_silver_rates.get(key), silver_fallback_map[key])
        for key in core.SILVER_RATE_KEYS
    }
    return _build_workspace_market_rates(
        eur_dkk_fx=fx,
        gold_rates_eur=gold_rates_eur,
        silver_rates_eur=silver_rates_eur,
    )


def _serialize_workspace_market_rates_payload(
    market_rates: PosWorkspaceMarketRates | dict[str, Any] | None,
) -> dict[str, Any]:
    core = _core()
    if market_rates is None:
        return {}
    if isinstance(market_rates, PosWorkspaceMarketRates):
        data = market_rates.model_dump()
    elif isinstance(market_rates, dict):
        data = market_rates
    else:
        data = {}
    fx = _workspace_note_decimal(data.get("eur_dkk_fx"), core.DEFAULT_EUR_DKK_FX)
    fallback_gold = _workspace_note_decimal(data.get("gold_24k_dkk"), Decimal("0.00"))
    fallback_silver = _workspace_note_decimal(data.get("silver_dkk"), Decimal("0.00"))
    workspace_rates = _market_rate_payload_to_workspace(
        data,
        fallback_gold_24k_dkk=fallback_gold,
        fallback_silver_dkk=fallback_silver,
    )
    return {
        "eur_dkk_fx": str(workspace_rates.eur_dkk_fx),
        "gold_rates_eur": {key: str(_quantize_4(value)) for key, value in workspace_rates.gold_rates_eur.items()},
        "silver_rates_eur": {key: str(_quantize_4(value)) for key, value in workspace_rates.silver_rates_eur.items()},
        "gold_24k_dkk": str(quantize_2(workspace_rates.gold_24k_dkk)),
        "silver_dkk": str(quantize_2(workspace_rates.silver_dkk)),
    }


def _workspace_market_rate_dkk(market_rates: PosWorkspaceMarketRates, row_key: str) -> Decimal:
    if row_key.startswith("gold:"):
        key = row_key.split(":", 1)[1]
        return quantize_2(_quantize_4(market_rates.gold_rates_eur.get(key)) * to_decimal(market_rates.eur_dkk_fx))
    definition = _silver_definition_by_row_key(row_key)
    if definition is not None:
        key = str(definition["lodighed"])
        return quantize_2(_quantize_4(market_rates.silver_rates_eur.get(key)) * to_decimal(market_rates.eur_dkk_fx))
    return Decimal("0.00")


def _workspace_row_unit_price_from_matrix(*, rate_dkk: Decimal, avance_percent: Decimal) -> Decimal:
    return quantize_2(to_decimal(rate_dkk) * (Decimal("1.00") - (to_decimal(avance_percent) / Decimal("100"))))


def _default_calculator_rows(kind: str) -> list[dict[str, Any]]:
    core = _core()
    source = core.DEFAULT_GOLD_CALCULATOR_ROWS if kind == "gold" else core.DEFAULT_SILVER_CALCULATOR_ROWS
    return [dict(item) for item in source]


def _workspace_calculators_from_note(note_payload: dict[str, Any]) -> PosWorkspaceCalculatorsOut:
    raw_payload = note_payload.get("calculators") if isinstance(note_payload.get("calculators"), dict) else {}

    def build_rows(kind: str) -> list[PosWorkspaceCalculatorRowOut]:
        raw_rows = raw_payload.get(f"{kind}_rows") if isinstance(raw_payload.get(f"{kind}_rows"), list) else []
        by_key = {
            str(item.get("row_key") or "").strip(): item
            for item in raw_rows
            if isinstance(item, dict) and str(item.get("row_key") or "").strip()
        }
        rows: list[PosWorkspaceCalculatorRowOut] = []
        for definition in _default_calculator_rows(kind):
            raw = by_key.get(definition["row_key"], definition)
            unit_weight = quantize_2(
                to_decimal(raw.get("unit_weight") if isinstance(raw, dict) else definition["unit_weight"])
            )
            count = quantize_2(to_decimal(raw.get("count") if isinstance(raw, dict) else definition["count"]))
            rows.append(
                PosWorkspaceCalculatorRowOut(
                    row_key=str(definition["row_key"]),
                    unit_weight=unit_weight,
                    count=count,
                    total_weight=quantize_2(unit_weight * count),
                    target_row_key=(
                        str(raw.get("target_row_key") or "").strip() or definition.get("target_row_key")
                    )
                    if isinstance(raw, dict)
                    else definition.get("target_row_key"),
                )
            )
        return rows

    return PosWorkspaceCalculatorsOut(
        gold_rows=build_rows("gold"),
        silver_rows=build_rows("silver"),
    )


def _serialize_workspace_calculators_payload(
    calculators: PosWorkspaceCalculatorsOut | PosWorkspaceCalculatorsUpdate | dict[str, Any] | None,
) -> dict[str, Any]:
    if calculators is None:
        return {"gold_rows": [], "silver_rows": []}
    if isinstance(calculators, (PosWorkspaceCalculatorsOut, PosWorkspaceCalculatorsUpdate)):
        data = calculators.model_dump()
    elif isinstance(calculators, dict):
        data = calculators
    else:
        data = {}

    def serialize_rows(kind: str) -> list[dict[str, Any]]:
        raw_rows = data.get(f"{kind}_rows") if isinstance(data.get(f"{kind}_rows"), list) else []
        by_key = {
            str(item.get("row_key") or "").strip(): item
            for item in raw_rows
            if isinstance(item, dict) and str(item.get("row_key") or "").strip()
        }
        serialized: list[dict[str, Any]] = []
        for definition in _default_calculator_rows(kind):
            raw = by_key.get(str(definition["row_key"]), definition)
            serialized.append(
                {
                    "row_key": str(definition["row_key"]),
                    "unit_weight": str(
                        quantize_2(
                            to_decimal(raw.get("unit_weight") if isinstance(raw, dict) else definition["unit_weight"])
                        )
                    ),
                    "count": str(
                        quantize_2(to_decimal(raw.get("count") if isinstance(raw, dict) else definition["count"]))
                    ),
                    "target_row_key": (
                        str(raw.get("target_row_key") or "").strip() or definition.get("target_row_key")
                    )
                    if isinstance(raw, dict)
                    else definition.get("target_row_key"),
                }
            )
        return serialized

    return {
        "gold_rows": serialize_rows("gold"),
        "silver_rows": serialize_rows("silver"),
    }


def _workspace_note_defaults() -> dict[str, Any]:
    core = _core()
    return {
        "kind": core.WORKSPACE_NOTE_KIND,
        "workspace_revision": 1,
        "draft_customer": {},
        # Presence-aware session snapshot.  Unlike the legacy draft_customer
        # fallback, an all-empty snapshot is intentional and must not fall
        # back to the linked master customer.
        "workspace_customer": None,
        "workspace_customer_city": None,
        "bank_info": {"reg_number": "", "account_number": ""},
        "market_rates": {},
        "calculators": {"gold_rows": [], "silver_rows": []},
        "payment_method": "bank",
        "numbering": {"afregnings_number_next": "", "invoice_number_next": ""},
        "invoice_gold_mode": core.COMPANION_MODE_AUTO,
        "invoice_gold": {"rows": [], "footer_lines": ["", "", ""]},
        "invoice_misc_mode": core.COMPANION_MODE_AUTO,
        "invoice_misc": {"rows": []},
        "freeform_note": None,
        # Yeni alışlarda KDV yok: net = ödenecek. Eski KDV'li belgeler bu
        # anahtarı notlarında açıkça taşıdığı için etkilenmez.
        "purchase_vat_enabled": False,
        "purchase_vat_rate_percent": "0.00",
        "edit_source_session_id": None,
        "edit_source_sequence_no": None,
    }


def _parse_workspace_note_payload(value: str | None) -> dict[str, Any]:
    core = _core()
    if not value:
        return _workspace_note_defaults()
    try:
        parsed = json.loads(value)
    except Exception:
        return _workspace_note_defaults()
    if not isinstance(parsed, dict) or parsed.get("kind") != core.WORKSPACE_NOTE_KIND:
        return _workspace_note_defaults()
    try:
        parsed["workspace_revision"] = max(int(parsed.get("workspace_revision") or 1), 1)
    except (TypeError, ValueError):
        parsed["workspace_revision"] = 1
    def normalize_customer(raw_customer: object, *, customer_id: object | None = None) -> dict[str, Any] | None:
        if not isinstance(raw_customer, dict):
            return None
        return {
            "customer_id": str(raw_customer.get("customer_id") or customer_id or "").strip() or None,
            "name": str(raw_customer.get("name") or "").strip(),
            "email": str(raw_customer.get("email") or "").strip() or None,
            "phone": str(raw_customer.get("phone") or "").strip() or None,
            "address": str(raw_customer.get("address") or "").strip() or None,
            "postal_code": str(raw_customer.get("postal_code") or "").strip() or None,
            "city": str(raw_customer.get("city") or "").strip() or None,
            "cpr_number": str(raw_customer.get("cpr_number") or "").strip() or None,
            "identity_doc_type": raw_customer.get("identity_doc_type"),
            "identity_doc_number": str(raw_customer.get("identity_doc_number") or "").strip() or None,
            "identity_doc_country": str(raw_customer.get("identity_doc_country") or "").strip() or None,
        }

    draft_customer = parsed.get("draft_customer")
    parsed["draft_customer"] = normalize_customer(draft_customer) or {}
    workspace_customer = normalize_customer(parsed.get("workspace_customer"))
    parsed["workspace_customer"] = workspace_customer
    parsed["workspace_customer_city"] = str(parsed.get("workspace_customer_city") or "").strip() or None
    bank_info = parsed.get("bank_info")
    if not isinstance(bank_info, dict):
        parsed["bank_info"] = {"reg_number": "", "account_number": ""}
    market_rates = parsed.get("market_rates")
    if not isinstance(market_rates, dict):
        parsed["market_rates"] = {}
    calculators = parsed.get("calculators")
    if not isinstance(calculators, dict):
        parsed["calculators"] = {"gold_rows": [], "silver_rows": []}
    else:
        parsed["calculators"] = _serialize_workspace_calculators_payload(calculators)
    numbering = parsed.get("numbering")
    if not isinstance(numbering, dict):
        parsed["numbering"] = {"afregnings_number_next": "", "invoice_number_next": ""}
    else:
        parsed["numbering"] = {
            "afregnings_number_next": str(numbering.get("afregnings_number_next") or "").strip(),
            "invoice_number_next": str(numbering.get("invoice_number_next") or "").strip(),
        }
    invoice_gold = parsed.get("invoice_gold")
    if not isinstance(invoice_gold, dict):
        parsed["invoice_gold"] = {"rows": [], "footer_lines": ["", "", ""]}
    else:
        raw_rows = invoice_gold.get("rows")
        raw_footer_lines = invoice_gold.get("footer_lines")
        parsed["invoice_gold"] = {
            "rows": raw_rows if isinstance(raw_rows, list) else [],
            "footer_lines": raw_footer_lines if isinstance(raw_footer_lines, list) else ["", "", ""],
        }
    parsed["invoice_gold_mode"] = _normalize_workspace_companion_mode(
        parsed.get("invoice_gold_mode"),
        default=core.COMPANION_MODE_MANUAL
        if _invoice_gold_sheet_has_content(parsed["invoice_gold"])
        else core.COMPANION_MODE_AUTO,
    )
    invoice_misc = parsed.get("invoice_misc")
    if not isinstance(invoice_misc, dict):
        parsed["invoice_misc"] = {"rows": []}
    else:
        raw_rows = invoice_misc.get("rows")
        parsed["invoice_misc"] = {"rows": raw_rows if isinstance(raw_rows, list) else []}
    parsed["invoice_misc_mode"] = _normalize_workspace_companion_mode(
        parsed.get("invoice_misc_mode"),
        default=core.COMPANION_MODE_MANUAL
        if _invoice_misc_sheet_has_content(parsed["invoice_misc"])
        else core.COMPANION_MODE_AUTO,
    )
    freeform_note = parsed.get("freeform_note")
    parsed["freeform_note"] = str(freeform_note).strip() or None if freeform_note else None
    parsed["purchase_vat_enabled"] = bool(parsed.get("purchase_vat_enabled", False))
    parsed["purchase_vat_rate_percent"] = str(
        quantize_2(to_decimal(parsed.get("purchase_vat_rate_percent") or Decimal("0.00")))
    )
    payment_method = str(parsed.get("payment_method") or "").strip().lower()
    parsed["payment_method"] = payment_method if payment_method in {"bank", "cash"} else "bank"
    raw_source_session_id = parsed.get("edit_source_session_id")
    parsed["edit_source_session_id"] = str(raw_source_session_id).strip() if raw_source_session_id else None
    raw_source_sequence_no = parsed.get("edit_source_sequence_no")
    try:
        parsed["edit_source_sequence_no"] = int(raw_source_sequence_no) if raw_source_sequence_no else None
    except (TypeError, ValueError):
        parsed["edit_source_sequence_no"] = None
    return parsed


def _serialize_workspace_note_payload(payload: dict[str, Any]) -> str:
    core = _core()
    sanitized = _workspace_note_defaults()
    try:
        sanitized["workspace_revision"] = max(int(payload.get("workspace_revision") or 1), 1)
    except (TypeError, ValueError):
        sanitized["workspace_revision"] = 1
    draft_customer = payload.get("draft_customer", {}) if isinstance(payload.get("draft_customer"), dict) else {}
    sanitized["draft_customer"] = {
        "customer_id": str(draft_customer.get("customer_id") or "").strip() or None,
        "name": str(draft_customer.get("name") or "").strip(),
        "email": str(draft_customer.get("email") or "").strip() or None,
        "phone": str(draft_customer.get("phone") or "").strip() or None,
        "address": str(draft_customer.get("address") or "").strip() or None,
        "postal_code": str(draft_customer.get("postal_code") or "").strip() or None,
        "city": str(draft_customer.get("city") or "").strip() or None,
        "cpr_number": str(draft_customer.get("cpr_number") or "").strip() or None,
        "identity_doc_type": draft_customer.get("identity_doc_type"),
        "identity_doc_number": str(draft_customer.get("identity_doc_number") or "").strip() or None,
        "identity_doc_country": str(draft_customer.get("identity_doc_country") or "").strip() or None,
    }
    workspace_customer = payload.get("workspace_customer")
    if isinstance(workspace_customer, dict):
        sanitized["workspace_customer"] = {
            "customer_id": str(workspace_customer.get("customer_id") or "").strip() or None,
            "name": str(workspace_customer.get("name") or "").strip(),
            "email": str(workspace_customer.get("email") or "").strip() or None,
            "phone": str(workspace_customer.get("phone") or "").strip() or None,
            "address": str(workspace_customer.get("address") or "").strip() or None,
            "postal_code": str(workspace_customer.get("postal_code") or "").strip() or None,
            "city": str(workspace_customer.get("city") or "").strip() or None,
            "cpr_number": str(workspace_customer.get("cpr_number") or "").strip() or None,
            "identity_doc_type": workspace_customer.get("identity_doc_type"),
            "identity_doc_number": str(workspace_customer.get("identity_doc_number") or "").strip() or None,
            "identity_doc_country": str(workspace_customer.get("identity_doc_country") or "").strip() or None,
        }
    sanitized["workspace_customer_city"] = str(payload.get("workspace_customer_city") or "").strip() or None
    sanitized["bank_info"] = {
        "reg_number": str(payload.get("bank_info", {}).get("reg_number", "") or "").strip(),
        "account_number": str(payload.get("bank_info", {}).get("account_number", "") or "").strip(),
    }
    sanitized["market_rates"] = _serialize_workspace_market_rates_payload(payload.get("market_rates"))
    sanitized["calculators"] = _serialize_workspace_calculators_payload(payload.get("calculators"))
    sanitized["numbering"] = {
        "afregnings_number_next": str(payload.get("numbering", {}).get("afregnings_number_next", "") or "").strip(),
        "invoice_number_next": str(payload.get("numbering", {}).get("invoice_number_next", "") or "").strip(),
    }
    sanitized["invoice_gold_mode"] = _normalize_workspace_companion_mode(
        payload.get("invoice_gold_mode"),
        default=core.COMPANION_MODE_MANUAL
        if _invoice_gold_sheet_has_content(payload.get("invoice_gold", {}))
        else core.COMPANION_MODE_AUTO,
    )
    invoice_gold = payload.get("invoice_gold", {}) if isinstance(payload.get("invoice_gold"), dict) else {}
    raw_gold_rows = invoice_gold.get("rows") if isinstance(invoice_gold.get("rows"), list) else []
    sanitized["invoice_gold"] = {
        "rows": [
            {
                "row_key": str(item.get("row_key") or "").strip(),
                "code": str(item.get("code") or "").strip() or None,
                "fineness": str(item.get("fineness") or "").strip() or None,
                "gram": str(quantize_2(to_decimal(item.get("gram") or 0))),
            }
            for item in raw_gold_rows
            if str(item.get("row_key") or "").strip()
        ],
        "footer_lines": [
            str(value or "").strip()
            for value in (
                (
                    invoice_gold.get("footer_lines")
                    if isinstance(invoice_gold.get("footer_lines"), list)
                    else ["", "", ""]
                )
                + ["", "", ""]
            )[:3]
        ],
    }
    sanitized["invoice_misc_mode"] = _normalize_workspace_companion_mode(
        payload.get("invoice_misc_mode"),
        default=core.COMPANION_MODE_MANUAL
        if _invoice_misc_sheet_has_content(payload.get("invoice_misc", {}))
        else core.COMPANION_MODE_AUTO,
    )
    invoice_misc = payload.get("invoice_misc", {}) if isinstance(payload.get("invoice_misc"), dict) else {}
    raw_misc_rows = invoice_misc.get("rows") if isinstance(invoice_misc.get("rows"), list) else []
    sanitized["invoice_misc"] = {
        "rows": [
            {
                "row_key": str(item.get("row_key") or "").strip(),
                "text": str(item.get("text") or "").strip() or None,
                "quantity": (
                    str(quantize_2(to_decimal(item.get("quantity")))) if item.get("quantity") not in {None, ""} else None
                ),
                "unit_price_dkk": str(quantize_2(to_decimal(item.get("unit_price_dkk") or 0))),
            }
            for item in raw_misc_rows
            if str(item.get("row_key") or "").strip()
        ]
    }
    freeform_note = str(payload.get("freeform_note") or "").strip()
    sanitized["freeform_note"] = freeform_note or None
    sanitized["purchase_vat_enabled"] = bool(payload.get("purchase_vat_enabled", False))
    sanitized["purchase_vat_rate_percent"] = str(
        quantize_2(to_decimal(payload.get("purchase_vat_rate_percent") or Decimal("0.00")))
    )
    payment_method = str(payload.get("payment_method") or "").strip().lower()
    sanitized["payment_method"] = payment_method if payment_method in {"bank", "cash"} else "bank"
    source_session_id = str(payload.get("edit_source_session_id") or "").strip()
    sanitized["edit_source_session_id"] = source_session_id or None
    raw_source_sequence_no = payload.get("edit_source_sequence_no")
    try:
        sanitized["edit_source_sequence_no"] = int(raw_source_sequence_no) if raw_source_sequence_no else None
    except (TypeError, ValueError):
        sanitized["edit_source_sequence_no"] = None
    return json.dumps(sanitized, ensure_ascii=True)


def _workspace_draft_customer_has_inputs(payload: dict[str, Any] | None) -> bool:
    if not isinstance(payload, dict):
        return False
    return any(
        str(payload.get(field) or "").strip()
        for field in ("name", "email", "phone", "address", "postal_code", "city", "cpr_number", "identity_doc_number")
    )


def _workspace_draft_customer_payload(
    payload: PosWorkspaceCustomerUpdate | PosWorkspaceCustomerOut,
) -> dict[str, Any]:
    return {
        "customer_id": str(payload.customer_id) if isinstance(payload, PosWorkspaceCustomerOut) and payload.customer_id else None,
        "name": str(payload.name or "").strip(),
        "email": str(payload.email or "").strip() or None,
        "phone": str(payload.phone or "").strip() or None,
        "address": str(payload.address or "").strip() or None,
        "postal_code": str(payload.postal_code or "").strip() or None,
        "city": str(payload.city or "").strip() or None,
        "cpr_number": str(payload.cpr_number or "").strip() or None,
        "identity_doc_type": payload.identity_doc_type,
        "identity_doc_number": str(payload.identity_doc_number or "").strip() or None,
        "identity_doc_country": payload.identity_doc_country,
    }


def _workspace_draft_customer_from_note(note_payload: dict[str, Any]) -> PosWorkspaceCustomerOut | None:
    raw_customer = note_payload.get("workspace_customer")
    if not isinstance(raw_customer, dict):
        raw_customer = note_payload.get("draft_customer") if isinstance(note_payload.get("draft_customer"), dict) else {}
    if not isinstance(note_payload.get("workspace_customer"), dict) and not _workspace_draft_customer_has_inputs(raw_customer):
        return None
    return PosWorkspaceCustomerOut(
        customer_id=raw_customer.get("customer_id"),
        name=str(raw_customer.get("name") or "").strip(),
        email=str(raw_customer.get("email") or "").strip() or None,
        phone=str(raw_customer.get("phone") or "").strip() or None,
        address=str(raw_customer.get("address") or "").strip() or None,
        postal_code=str(raw_customer.get("postal_code") or "").strip() or None,
        city=str(raw_customer.get("city") or "").strip() or None,
        cpr_number=str(raw_customer.get("cpr_number") or "").strip() or None,
        identity_doc_type=raw_customer.get("identity_doc_type"),
        identity_doc_number=str(raw_customer.get("identity_doc_number") or "").strip() or None,
        identity_doc_country=raw_customer.get("identity_doc_country"),
    )


def extract_purchase_payment_method(value: str | None) -> str | None:
    core = _core()
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except Exception:
        parsed = None
    if isinstance(parsed, dict) and parsed.get("kind") == core.WORKSPACE_NOTE_KIND:
        payment_method = str(parsed.get("payment_method") or "").strip().lower()
        return payment_method if payment_method in {"bank", "cash"} else "bank"

    lowered = value.lower()
    if "betaling: kontant" in lowered:
        return "cash"
    if "betaling: bankoverførsel" in lowered or "overførsel:" in lowered:
        return "bank"
    return None


def extract_purchase_bank_info(value: str | None) -> tuple[str | None, str | None]:
    core = _core()
    if not value:
        return None, None
    try:
        parsed = json.loads(value)
    except Exception:
        parsed = None
    if isinstance(parsed, dict) and parsed.get("kind") == core.WORKSPACE_NOTE_KIND:
        bank_info = parsed.get("bank_info", {}) if isinstance(parsed.get("bank_info"), dict) else {}
        reg_number = str(bank_info.get("reg_number") or "").strip() or None
        account_number = str(bank_info.get("account_number") or "").strip() or None
        return reg_number, account_number

    match = re.search(r"Overførsel:\s*([^\n/]+?)\s*/\s*([^\n]+)", value)
    if not match:
        return None, None
    return match.group(1).strip() or None, match.group(2).strip() or None


def extract_purchase_freeform_note(value: str | None) -> str | None:
    core = _core()
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except Exception:
        parsed = None
    if isinstance(parsed, dict) and parsed.get("kind") == core.WORKSPACE_NOTE_KIND:
        return str(parsed.get("freeform_note") or "").strip() or None
    return value.strip() or None


def extract_purchase_market_rates(
    value: str | None,
    *,
    default_gold_24k_dkk: Decimal = Decimal("0.00"),
    default_silver_dkk: Decimal = Decimal("0.00"),
) -> PosWorkspaceMarketRates:
    payload = _parse_workspace_note_payload(value)
    market_payload = payload.get("market_rates", {}) if isinstance(payload.get("market_rates"), dict) else {}
    return _market_rate_payload_to_workspace(
        market_payload,
        fallback_gold_24k_dkk=quantize_2(to_decimal(default_gold_24k_dkk)),
        fallback_silver_dkk=quantize_2(to_decimal(default_silver_dkk)),
    )


def extract_purchase_numbering(
    value: str | None,
    *,
    default_afregnings_number: str = "",
    default_invoice_number: str = "",
) -> PosWorkspaceNumberingOut:
    payload = _parse_workspace_note_payload(value)
    return _workspace_numbering_from_note(
        payload,
        product_number_next="",
        reference_number_next="",
        default_afregnings_number=default_afregnings_number,
        default_invoice_number=default_invoice_number,
    )


def extract_purchase_invoice_gold_sheet(
    value: str | None,
    *,
    market_rates: PosWorkspaceMarketRates,
) -> PosWorkspaceInvoiceGoldSheetOut:
    payload = _parse_workspace_note_payload(value)
    return _invoice_gold_rows_from_note(payload, market_rates=market_rates)


def extract_purchase_invoice_misc_sheet(value: str | None) -> PosWorkspaceInvoiceMiscSheetOut:
    payload = _parse_workspace_note_payload(value)
    return _invoice_misc_rows_from_note(payload)


def _workspace_edit_source(value: str | None) -> tuple[UUID | None, int | None]:
    payload = _parse_workspace_note_payload(value)
    source_session_id = payload.get("edit_source_session_id")
    source_sequence_no = payload.get("edit_source_sequence_no")
    try:
        parsed_session_id = UUID(str(source_session_id)) if source_session_id else None
    except (TypeError, ValueError):
        parsed_session_id = None
    try:
        parsed_sequence_no = int(source_sequence_no) if source_sequence_no else None
    except (TypeError, ValueError):
        parsed_sequence_no = None
    return parsed_session_id, parsed_sequence_no


async def _workspace_market_rates_from_session(pos_session: PosSession) -> PosWorkspaceMarketRates:
    note_payload = _parse_workspace_note_payload(pos_session.notes)
    # This helper is also called by workspace mutation handlers.  Never make
    # network I/O while a mutation transaction is open: a slow/unavailable
    # Stooq request would keep SQLite locked and the browser would report a
    # generic ``Load failed`` transport error.  Live refresh endpoints still
    # call ``get_rates`` explicitly and populate this cache.
    market_payload = note_payload.get("market_rates", {}) if isinstance(note_payload.get("market_rates"), dict) else {}
    if not market_payload and pos_session.rate_source != PosRateSourceEnum.MANUAL:
        market_payload = get_effective_market_rate_profile_cached()
    rates = get_effective_market_rate_profile_cached()
    live_gold_fallback = quantize_2(to_decimal(rates.get("gold_24k_dkk", 0)))
    manual_gold_fallback = quantize_2(to_decimal(pos_session.manual_rate_dkk))
    gold_fallback = (
        manual_gold_fallback
        if pos_session.rate_source == PosRateSourceEnum.MANUAL and manual_gold_fallback > 0
        else live_gold_fallback
    )
    silver_fallback = quantize_2(to_decimal(rates.get("silver_dkk", 0)))

    return _market_rate_payload_to_workspace(
        market_payload,
        fallback_gold_24k_dkk=gold_fallback,
        fallback_silver_dkk=silver_fallback,
    )


def _workspace_bank_info_from_session(pos_session: PosSession) -> PosWorkspaceBankInfo:
    note_payload = _parse_workspace_note_payload(pos_session.notes)
    bank_payload = note_payload.get("bank_info", {})
    return PosWorkspaceBankInfo(
        reg_number=str(bank_payload.get("reg_number", "") or "").strip() or None,
        account_number=str(bank_payload.get("account_number", "") or "").strip() or None,
    )


def _workspace_payment_method_from_session(pos_session: PosSession) -> str:
    return extract_purchase_payment_method(pos_session.notes) or "bank"


def _workspace_numbering_from_note(
    note_payload: dict[str, Any],
    *,
    product_number_next: str,
    reference_number_next: str,
    default_afregnings_number: str,
    default_invoice_number: str,
) -> PosWorkspaceNumberingOut:
    numbering = note_payload.get("numbering", {}) if isinstance(note_payload.get("numbering"), dict) else {}
    afregnings_number = str(numbering.get("afregnings_number_next") or "").strip() or default_afregnings_number
    invoice_number = str(numbering.get("invoice_number_next") or "").strip() or default_invoice_number
    return PosWorkspaceNumberingOut(
        product_number_next=product_number_next,
        reference_number_next=reference_number_next,
        afregnings_number_next=afregnings_number,
        invoice_number_next=invoice_number,
    )


def _invoice_gold_default_rows() -> list[dict[str, Any]]:
    core = _core()
    return [
        {
            "row_key": f"invoice_gold:{index}",
            "code": None,
            "fineness": None,
            "gram": "0.00",
        }
        for index in range(1, core.INVOICE_GOLD_ROW_COUNT + 1)
    ]


def _invoice_misc_default_rows() -> list[dict[str, Any]]:
    core = _core()
    return [
        {
            "row_key": f"invoice_misc:{index}",
            "text": None,
            "quantity": None,
            "unit_price_dkk": "0.00",
        }
        for index in range(1, core.INVOICE_MISC_ROW_COUNT + 1)
    ]


def _workspace_decimal_text(value: Decimal | str | int | None) -> str:
    decimal_value = quantize_2(to_decimal(value or 0))
    if decimal_value == decimal_value.to_integral():
        return str(int(decimal_value))
    return format(decimal_value.normalize(), "f")


def _invoice_gold_auto_sheet_from_workspace_rows(
    *,
    gold_rows: list[PosWorkspaceGoldRowOut],
    silver_rows: list[PosWorkspaceSilverRowOut],
    market_rates: PosWorkspaceMarketRates,
) -> PosWorkspaceInvoiceGoldSheetOut:
    generated_rows: list[PosWorkspaceInvoiceGoldRowOut] = []
    for row in gold_rows:
        gram = quantize_2(to_decimal(row.gram))
        if gram <= 0:
            continue
        generated_rows.append(
            PosWorkspaceInvoiceGoldRowOut(
                row_key="",
                code="1",
                label="Guld",
                fineness=_workspace_decimal_text(row.karat),
                lodighed=str(row.lodighed),
                gram=gram,
                unit_price_dkk=quantize_2(to_decimal(row.unit_price_dkk)),
                line_total_dkk=quantize_2(to_decimal(row.line_total_dkk)),
            )
        )
    for row in silver_rows:
        gram = quantize_2(to_decimal(row.gram))
        if gram <= 0:
            continue
        generated_rows.append(
            PosWorkspaceInvoiceGoldRowOut(
                row_key="",
                code=str(row.type_code),
                label=str(row.label),
                fineness=str(row.lodighed),
                lodighed=str(row.lodighed),
                gram=gram,
                unit_price_dkk=quantize_2(to_decimal(row.unit_price_dkk)),
                line_total_dkk=quantize_2(to_decimal(row.line_total_dkk)),
            )
        )
    rows: list[PosWorkspaceInvoiceGoldRowOut] = []
    total_grams = Decimal("0.00")
    total_amount = Decimal("0.00")
    for index, generated in enumerate(generated_rows[: len(_invoice_gold_default_rows())], start=1):
        generated.row_key = f"invoice_gold:{index}"
        rows.append(generated)
        total_grams += generated.gram
        total_amount += generated.line_total_dkk
    for index in range(len(rows) + 1, len(_invoice_gold_default_rows()) + 1):
        rows.append(PosWorkspaceInvoiceGoldRowOut(row_key=f"invoice_gold:{index}"))
    return PosWorkspaceInvoiceGoldSheetOut(
        rows=rows,
        footer_lines=["", "", ""],
        total_grams=quantize_2(total_grams),
        total_amount_dkk=quantize_2(total_amount),
    )


def _invoice_misc_auto_sheet() -> PosWorkspaceInvoiceMiscSheetOut:
    return _invoice_misc_rows_from_note({"invoice_misc": {"rows": []}})


def _invoice_gold_rows_from_note(
    note_payload: dict[str, Any],
    *,
    market_rates: PosWorkspaceMarketRates,
) -> PosWorkspaceInvoiceGoldSheetOut:
    core = _core()
    raw_sheet = note_payload.get("invoice_gold", {}) if isinstance(note_payload.get("invoice_gold"), dict) else {}
    raw_rows = raw_sheet.get("rows") if isinstance(raw_sheet.get("rows"), list) else []
    raw_rows_by_key = {
        str(item.get("row_key") or "").strip(): item
        for item in raw_rows
        if isinstance(item, dict) and str(item.get("row_key") or "").strip()
    }
    footer_lines = [
        str(value or "").strip()
        for value in (
            (
                raw_sheet.get("footer_lines")
                if isinstance(raw_sheet.get("footer_lines"), list)
                else ["", "", ""]
            )
            + ["", "", ""]
        )[:3]
    ]
    rows: list[PosWorkspaceInvoiceGoldRowOut] = []
    total_grams = Decimal("0.00")
    total_amount = Decimal("0.00")
    gold_rate = quantize_2(to_decimal(market_rates.gold_24k_dkk))
    silver_rate = quantize_2(to_decimal(market_rates.silver_dkk))

    for default in _invoice_gold_default_rows():
        row_key = str(default["row_key"])
        raw = raw_rows_by_key.get(row_key, default)
        code = str(raw.get("code") or "").strip() or None
        fineness = str(raw.get("fineness") or "").strip() or None
        gram = quantize_2(to_decimal(raw.get("gram") or 0))
        label = core.INVOICE_GOLD_CODE_LABELS.get(code or "")
        lodighed: str | None = None
        unit_price = Decimal("0.00")
        if code == "1":
            karat = quantize_2(to_decimal(fineness or 0))
            if karat > 0:
                if karat == Decimal("14.00"):
                    lodighed = "585"
                else:
                    lodighed_value = ((karat / Decimal("24")) * Decimal("999")).to_integral_value(rounding=ROUND_CEILING)
                    lodighed = str(int(lodighed_value))
                unit_price = quantize_2(gold_rate * (karat / Decimal("24")))
        elif code:
            lodighed = fineness or core.INVOICE_GOLD_DEFAULT_LODIGHED.get(code or "")
            lodighed_decimal = to_decimal(lodighed or 0)
            if lodighed_decimal > 0:
                unit_price = quantize_2(silver_rate * (lodighed_decimal / Decimal("999")))

        line_total = quantize_2(unit_price * gram)
        total_grams += gram
        total_amount += line_total
        rows.append(
            PosWorkspaceInvoiceGoldRowOut(
                row_key=row_key,
                code=code,
                label=label,
                fineness=fineness,
                lodighed=lodighed,
                gram=gram,
                unit_price_dkk=unit_price,
                line_total_dkk=line_total,
            )
        )

    return PosWorkspaceInvoiceGoldSheetOut(
        rows=rows,
        footer_lines=footer_lines,
        total_grams=quantize_2(total_grams),
        total_amount_dkk=quantize_2(total_amount),
    )


def _invoice_misc_rows_from_note(note_payload: dict[str, Any]) -> PosWorkspaceInvoiceMiscSheetOut:
    raw_sheet = note_payload.get("invoice_misc", {}) if isinstance(note_payload.get("invoice_misc"), dict) else {}
    raw_rows = raw_sheet.get("rows") if isinstance(raw_sheet.get("rows"), list) else []
    raw_rows_by_key = {
        str(item.get("row_key") or "").strip(): item
        for item in raw_rows
        if isinstance(item, dict) and str(item.get("row_key") or "").strip()
    }
    rows: list[PosWorkspaceInvoiceMiscRowOut] = []
    total_amount = Decimal("0.00")

    for default in _invoice_misc_default_rows():
        row_key = str(default["row_key"])
        raw = raw_rows_by_key.get(row_key, default)
        text = str(raw.get("text") or "").strip() or None
        quantity = quantize_2(to_decimal(raw.get("quantity"))) if raw.get("quantity") not in {None, ""} else None
        unit_price = quantize_2(to_decimal(raw.get("unit_price_dkk") or 0))
        is_active_row = bool(text) or quantity is not None or unit_price > 0
        effective_quantity = quantity if quantity is not None else (Decimal("1.00") if is_active_row else Decimal("0.00"))
        line_total = quantize_2(effective_quantity * unit_price)
        total_amount += line_total
        rows.append(
            PosWorkspaceInvoiceMiscRowOut(
                row_key=row_key,
                text=text,
                quantity=quantity,
                unit_price_dkk=unit_price,
                line_total_dkk=line_total,
            )
        )

    return PosWorkspaceInvoiceMiscSheetOut(
        rows=rows,
        total_amount_dkk=quantize_2(total_amount),
    )
