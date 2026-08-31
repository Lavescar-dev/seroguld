"""U16 — Uniconta debtor Account 20-karakter kırpması ve insert çakışma ağı.

2026-09-01 teşhisi: Uniconta Debtor Account'u 20 karaktere sessizce kırpar;
kod 34 karakterlik anahtarla sorgu atıp kaydı bulamıyor, insert yine aynı
kırpılmış anahtara düşüp 400 "A key with the name already exists" döndürüyordu
(canlı örnek: OMAR HUSSEIN AL-RASHID → CRM-1791bb2c-41fe-40).
"""

from __future__ import annotations

import pytest

from app.services import uniconta_service as service


# Canlı vakadan: pos_sessions 1791bb2c41fe40c3856679b59cf72308,
# Uniconta'daki gerçek hesap CRM-1791bb2c-41fe-40.
HEX_ID = "1791bb2c41fe40c3856679b59cf72308"
DASHED = "1791bb2c-41fe-40c3-8566-79b59cf72308"
EXPECTED_ACCOUNT = "CRM-1791bb2c-41fe-40"


@pytest.fixture(autouse=True)
def _clean_debtor_cache():
    service._debtor_cache_invalidate()
    yield
    service._debtor_cache_invalidate()


def test_account_builder_truncates_to_uniconta_limit() -> None:
    account = service._build_uniconta_account_for_customer(HEX_ID)
    assert account == EXPECTED_ACCOUNT
    assert len(account) <= 20


def test_account_builder_dashed_and_hex_agree() -> None:
    assert service._build_uniconta_account_for_customer(DASHED) == EXPECTED_ACCOUNT
    assert (
        service._build_uniconta_account_for_customer(HEX_ID)
        == service._build_uniconta_account_for_customer(DASHED)
    )


def test_account_builder_none_is_empty() -> None:
    assert service._build_uniconta_account_for_customer(None) == ""


class _CollisionClient:
    """query → boş (kayıt görünmüyor), insert → 400 already exists;
    Name ile tekrar aramada mevcut kaydı döndürür."""

    def __init__(self) -> None:
        self.insert_calls = 0

    async def query(self, entity, *, filters=None, top=100, skip=0, order_by_desc=False):
        props = {f.get("PropertyName") for f in (filters or [])}
        if "Name" in props:
            return [{"Account": EXPECTED_ACCOUNT, "Name": "OMAR HUSSEIN AL-RASHID"}]
        return []

    async def _request(self, method, path, **kwargs):
        self.insert_calls += 1
        raise service.UnicontaError(
            'Uniconta POST /Crud/Insert/DebtorClient 400: "A key with the name already exists"'
        )


@pytest.mark.asyncio
async def test_ensure_debtor_falls_back_to_existing_record_on_collision() -> None:
    client = _CollisionClient()
    account = await service.ensure_debtor_for_customer(
        client,
        customer_id=HEX_ID,
        name="OMAR HUSSEIN AL-RASHID",
    )
    assert account == EXPECTED_ACCOUNT
    assert client.insert_calls == 1


@pytest.mark.asyncio
async def test_ensure_debtor_reraises_when_collision_lookup_finds_nothing() -> None:
    class _EmptyClient(_CollisionClient):
        async def query(self, entity, *, filters=None, top=100, skip=0, order_by_desc=False):
            return []

    client = _EmptyClient()
    with pytest.raises(service.UnicontaError):
        await service.ensure_debtor_for_customer(
            client,
            customer_id=HEX_ID,
            name="OMAR HUSSEIN AL-RASHID",
        )
