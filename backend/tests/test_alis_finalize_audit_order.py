"""Finalize işlem sınırı disiplini (MEDIUM: commit sonrası korumasız adımlar).

finalize_purchase_workspace belgeyi kendi commit'iyle kalıcılaştırır. Endpoint
artık finalize audit kaydını HEMEN sonra yazıp commit eder; Office artifact
senkronu best-effort'tur — sync patlarsa istemci 500 almak yerine kesinleşmiş
yanıtı alır (retry 409'a düşmesi ve audit kaybı önlenir).
"""
from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

import app.api.v2  # noqa: F401  # v2_alis'in kullandığı isimleri önce yükler (dairesel import sırası)
import app.api.v2_alis as v2_alis


class _FakeDb:
    def __init__(self, events: list[str]) -> None:
        self._events = events

    def add(self, _obj) -> None:
        self._events.append("audit_added")

    async def commit(self) -> None:
        self._events.append("commit")

    async def rollback(self) -> None:
        self._events.append("rollback")


@pytest.mark.asyncio
async def test_finalize_audits_first_and_artifact_sync_is_best_effort(monkeypatch):
    events: list[str] = []

    async def fake_get_pos_session_or_404(db, session_id):
        return SimpleNamespace(id=session_id)

    async def fake_finalize(db, *, pos_session, payload):
        events.append("finalize")
        return SimpleNamespace(
            document_sequence_no=42,
            document_number="SG-2026-000042",
            uniconta_sync_status="not_applicable",
        )

    async def fake_detail(*, sequence_no, db, _):
        events.append(f"detail_{sequence_no}")
        return SimpleNamespace()

    async def failing_sync(db, detail):
        events.append("artifact_sync")
        raise RuntimeError("xlsm render patladı")

    monkeypatch.setattr(v2_alis, "get_pos_session_or_404", fake_get_pos_session_or_404)
    monkeypatch.setattr(v2_alis, "finalize_purchase_workspace", fake_finalize)
    monkeypatch.setattr(v2_alis, "get_legacy_pos_document_detail", fake_detail)
    monkeypatch.setattr(v2_alis, "sync_afg_document_artifact", failing_sync)

    db = _FakeDb(events)
    response = await v2_alis.post_alis_workspace_finalize_v2(
        session_id=uuid4(),
        payload=SimpleNamespace(),
        request=SimpleNamespace(client=SimpleNamespace(host="127.0.0.1")),
        db=db,
        admin=SimpleNamespace(id=uuid4(), email="finalize-admin@test.local"),
    )

    # Belge kesinleşti; artifact sync patlasa da 200 sözleşmesi korunur.
    assert response.document_sequence_no == 42

    # Sıra: finalize → audit → commit → artifact sync denemesi → rollback.
    assert events.index("finalize") < events.index("audit_added")
    assert events.index("audit_added") < events.index("commit")
    assert events.index("commit") < events.index("artifact_sync")
    assert events[-1] == "rollback"
    # Audit tam olarak bir kez yazılır (artifact rollback'i audit'i silmez).
    assert events.count("audit_added") == 1
