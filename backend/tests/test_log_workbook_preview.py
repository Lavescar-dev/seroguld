from __future__ import annotations

from datetime import date
from decimal import Decimal
from hashlib import sha256
from types import SimpleNamespace
from uuid import uuid4

from app.api.v2_support import artifact_file_response
from app.services.document_artifact_log import build_log_reconcile_preview


def _workspace(*, line, gold_lots=None):
    document = SimpleNamespace(document_number="AFG-100", lines=[line])
    empty_bucket = SimpleNamespace(documents=[], melt_lots=[])
    gold_bucket = SimpleNamespace(documents=[document], melt_lots=gold_lots or [])
    return SimpleNamespace(gold=gold_bucket, silver=empty_bucket)


def test_log_preview_exposes_route_change_and_repeat_as_idempotent_noop():
    line_id = uuid4()
    line = SimpleNamespace(
        id=line_id,
        line_no=1,
        operation_destination="undecided",
        operation_classification="standard",
        metal_type="gold",
    )
    workspace = _workspace(line=line)
    changed = SimpleNamespace(
        route_updates=[
            SimpleNamespace(
                payload=SimpleNamespace(
                    line_ids=[line_id],
                    destination="inventory",
                    classification="standard",
                )
            )
        ],
        lot_creates=[],
        lot_updates=[],
        base_version="123",
    )

    preview = build_log_reconcile_preview(workspace, changed)

    assert preview.editable is True
    assert len(preview.changes) == 1
    assert preview.changes[0].cell_ref == "G10"
    assert preview.changes[0].old_value == "- (standard)"
    assert preview.changes[0].new_value == "S (standard)"
    assert any("base revision" in warning for warning in preview.warnings)

    unchanged = SimpleNamespace(
        route_updates=[
            SimpleNamespace(
                payload=SimpleNamespace(
                    line_ids=[line_id],
                    destination="undecided",
                    classification="standard",
                )
            )
        ],
        lot_creates=[],
        lot_updates=[],
        base_version=None,
    )
    repeat_preview = build_log_reconcile_preview(workspace, unchanged)
    assert repeat_preview.changes == []
    assert any("Idempotent no-op" in warning for warning in repeat_preview.warnings)


def test_log_preview_is_side_effect_free_for_historical_lot_update():
    lot_id = uuid4()
    lot = SimpleNamespace(
        id=lot_id,
        sent_date=None,
        purchased_from_date=None,
        after_pure_gold_grams=Decimal("0"),
        insurance_dkk=None,
        shipping_dkk=None,
        refining_dkk=None,
        sale_date=None,
        quote_eur=None,
        exchange_rate_dkk=None,
        payout_total_dkk=None,
    )
    workspace = _workspace(line=SimpleNamespace(id=uuid4(), line_no=1), gold_lots=[lot])
    parsed = SimpleNamespace(
        route_updates=[],
        lot_creates=[],
        lot_updates=[
            SimpleNamespace(
                lot_id=lot_id,
                payload=SimpleNamespace(
                    sent_date=date(2026, 8, 8),
                    purchased_from_date=None,
                    after_pure_gold_grams=Decimal("1.50"),
                    insurance_dkk=None,
                    shipping_dkk=None,
                    refining_dkk=None,
                    sale_date=None,
                    quote_eur=None,
                    exchange_rate_dkk=None,
                    payout_total_dkk=None,
                ),
            )
        ],
        base_version=None,
    )

    preview = build_log_reconcile_preview(workspace, parsed)

    assert preview.editable is True
    assert {change.cell_ref for change in preview.changes} == {"B37", "F38"}
    assert any("dış sistem yazısı yapılmaz" in warning for warning in preview.warnings)
    assert lot.sent_date is None
    assert lot.after_pure_gold_grams == Decimal("0")


def test_artifact_response_exposes_content_checksum_and_revision():
    payload = b"sero-guld-export"
    checksum = sha256(payload).hexdigest()
    record = SimpleNamespace(
        file_name="Log-2026.xlsx",
        mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        checksum_sha256="stored-revision",
    )

    response = artifact_file_response(record, content=payload)

    assert response.headers["x-sero-artifact-sha256"] == checksum
    assert response.headers["etag"] == f'"{checksum}"'
    assert response.headers["x-sero-artifact-revision"] == "stored-revision"
