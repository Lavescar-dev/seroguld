"""R1-CPR — cpr_birth_hash + 6/10 hane anlambilim testleri.

Kapsam:
- hash_cpr_birth domain ayrımı (``cpr-birth:`` öneki; tam-CPR hash'iyle asla
  çakışmaz).
- classify_cpr / cpr_storage_fields sınıf tablosu (EMPTY/BIRTH/FULL/INVALID).
- Kısmi (6 hane) kayıt: tam-CPR hash'i/last4/şifreli değer YAZILMAZ, maske
  ``??????``.
- Doğum-bölümü çakışması: yumuşak 409 gövdesi + confirm_cpr_conflict tek geçiş.
- Arama: 6 hane birth_hash kolonunda, 10 hane her iki kolonda, 4 hane last4.
- customer_identity_match ``match_kind='birth'``.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.enums import RoleEnum
from app.models.user import User
from app.schemas.customer import CustomerCreate, CustomerUpdate
from app.services.customer_service import (
    CprClass,
    classify_cpr,
    create_customer,
    cpr_search_predicates,
    cpr_storage_fields,
    customer_identity_match,
    update_customer,
)
from app.utils.security import hash_cpr, hash_cpr_birth


def _session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    return engine, async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# ---------------------------------------------------------------------------
# hash_cpr_birth — domain ayrımı
# ---------------------------------------------------------------------------


def test_hash_cpr_birth_differs_from_full_cpr_hash() -> None:
    # 6 hanenin birth hash'i, aynı 6 hanenin tam-CPR hash'iyle ASLA aynı olmaz
    # (domain öneki) — aksi hâlde kısmi arama tam-hash alanını kirletir.
    assert hash_cpr_birth("010190") != hash_cpr("010190")
    # 10 hanenin birth hash'i, tam-CPR hash'inden farklıdır.
    assert hash_cpr_birth("0101901234") != hash_cpr("0101901234")
    # Deterministik.
    assert hash_cpr_birth("010190") == hash_cpr_birth("01-01-90")
    # 6 haneden kısa girdi hash üretmez.
    assert hash_cpr_birth("0101") is None
    assert hash_cpr_birth(None) is None
    assert hash_cpr_birth("") is None


# ---------------------------------------------------------------------------
# classify_cpr / cpr_storage_fields
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, CprClass.EMPTY),
        ("", CprClass.EMPTY),
        ("abc", CprClass.EMPTY),
        ("010190", CprClass.BIRTH),
        ("0101901234", CprClass.FULL),
        ("010190123", CprClass.INVALID),
        ("01019012", CprClass.INVALID),
        ("0101901", CprClass.INVALID),
        ("320190", CprClass.INVALID),  # gün 32
        ("001290", CprClass.INVALID),  # gün 00
        ("011390", CprClass.INVALID),  # ay 13
        ("011290", CprClass.BIRTH),  # ay 12 sınırı OK
        ("310190", CprClass.BIRTH),  # gün 31 sınırı OK
    ],
)
def test_classify_cpr_table(value: str | None, expected: CprClass) -> None:
    assert classify_cpr(value) is expected


def test_cpr_storage_fields_full_writes_all_columns() -> None:
    fields = cpr_storage_fields("0101901234")
    assert fields["cpr_number_encrypted"] is not None
    assert fields["cpr_hash"] == hash_cpr("0101901234")
    assert fields["cpr_last4"] == "1234"
    assert fields["cpr_birth_hash"] == hash_cpr_birth("0101901234")
    assert fields["cpr_is_partial"] is False


def test_cpr_storage_fields_birth_never_touches_full_cpr_columns() -> None:
    # 6 haneyi tam-hash'e yazmak unique partial index'in arama alanını bozar —
    # kısmi kayıt yalnız birth_hash + is_partial taşır.
    fields = cpr_storage_fields("010190")
    assert fields["cpr_number_encrypted"] is None
    assert fields["cpr_hash"] is None
    assert fields["cpr_last4"] is None
    assert fields["cpr_birth_hash"] == hash_cpr_birth("010190")
    assert fields["cpr_is_partial"] is True


@pytest.mark.parametrize("value", [None, "", "0101901"])
def test_cpr_storage_fields_clears_everything(value: str | None) -> None:
    fields = cpr_storage_fields(value)
    assert fields == {
        "cpr_number_encrypted": None,
        "cpr_hash": None,
        "cpr_last4": None,
        "cpr_birth_hash": None,
        "cpr_is_partial": False,
    }


# ---------------------------------------------------------------------------
# Yazma yolu: kısmi kayıt + yumuşak dup + onay geçişi
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_six_digit_create_stores_partial_record_with_placeholder_mask() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with Session() as session:
        customer = await create_customer(
            session,
            CustomerCreate(name="Partial CPR", email="partial-cpr@example.com", cpr_number="010190"),
        )
        await session.commit()

        assert customer.cpr_is_partial is True
        assert customer.cpr_hash is None
        assert customer.cpr_last4 is None
        assert customer.cpr_number_encrypted is None
        assert customer.cpr_birth_hash == hash_cpr_birth("010190")

        refreshed = await session.scalar(select(User).where(User.id == customer.id))
        assert refreshed is not None
        assert refreshed.cpr_is_partial is True

    await engine.dispose()


@pytest.mark.asyncio
async def test_birth_conflict_returns_soft_409_body_then_confirm_bypasses() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with Session() as session:
        first = await create_customer(
            session,
            CustomerCreate(name="First birth", email="first-birth@example.com", cpr_number="0101901234"),
        )
        await session.commit()

        # Tam-CPR'lı müşteri varken aynı doğum bölümüyle 6 haneli kayıt:
        # yumuşak 409 + makine-okunur gövde.
        with pytest.raises(HTTPException) as raised:
            await create_customer(
                session,
                CustomerCreate(name="Second birth", email="second-birth@example.com", cpr_number="010190"),
            )
        assert raised.value.status_code == 409
        detail = raised.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "cpr_birth_conflict"
        assert len(detail["matches"]) == 1
        assert detail["matches"][0]["id"] == str(first.id)
        assert detail["matches"][0]["name"] == "First birth"
        assert "0101901234" not in str(detail)  # ham CPR sızmaz

        # confirm_cpr_conflict=true ile tek denemede geçer (bayrak kalıcı
        # değildir).
        second = await create_customer(
            session,
            CustomerCreate(
                name="Second birth",
                email="second-birth@example.com",
                cpr_number="010190",
                confirm_cpr_conflict=True,
            ),
        )
        await session.commit()
        assert second.cpr_is_partial is True

    await engine.dispose()


@pytest.mark.asyncio
async def test_partial_to_full_update_fills_all_columns_and_clears_partial_flag() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with Session() as session:
        customer = await create_customer(
            session,
            CustomerCreate(name="Upgrade later", email="upgrade@example.com", cpr_number="010190"),
        )
        await session.commit()
        assert customer.cpr_is_partial is True

        await update_customer(session, customer, CustomerUpdate(cpr_number="0101901234"))
        await session.commit()

        assert customer.cpr_is_partial is False
        assert customer.cpr_hash == hash_cpr("0101901234")
        assert customer.cpr_last4 == "1234"
        assert customer.cpr_number_encrypted is not None
        assert customer.cpr_birth_hash == hash_cpr_birth("0101901234")

    await engine.dispose()


@pytest.mark.asyncio
async def test_update_to_conflicting_birth_section_soft_409_and_confirm() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with Session() as session:
        await create_customer(
            session,
            CustomerCreate(name="Existing birth", email="existing-birth@example.com", cpr_number="0202991234"),
        )
        other = await create_customer(
            session,
            CustomerCreate(name="Other customer", email="other-update@example.com", cpr_number="0303995678"),
        )
        await session.commit()

        with pytest.raises(HTTPException) as raised:
            await update_customer(session, other, CustomerUpdate(cpr_number="020299"))
        assert raised.value.status_code == 409
        assert raised.value.detail["code"] == "cpr_birth_conflict"

        await update_customer(
            session, other, CustomerUpdate(cpr_number="020299", confirm_cpr_conflict=True)
        )
        await session.commit()
        assert other.cpr_birth_hash == hash_cpr_birth("020299")

    await engine.dispose()


@pytest.mark.asyncio
async def test_exact_cpr_conflict_stays_hard_and_confirm_does_not_bypass() -> None:
    # Tam-CPR dup gerçek dup'tır: onay bayrağı geçmez.
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with Session() as session:
        await create_customer(
            session,
            CustomerCreate(name="Real dup", email="real-dup@example.com", cpr_number="0101901234"),
        )
        await session.commit()

        for confirm in (False, True):
            with pytest.raises(HTTPException) as raised:
                await create_customer(
                    session,
                    CustomerCreate(
                        name="Dup attempt",
                        email=f"dup-attempt-{confirm}@example.com",
                        cpr_number="0101901234",
                        confirm_cpr_conflict=confirm,
                    ),
                )
            assert raised.value.status_code == 409
            # Sert çakışma düz metin detail taşır, yumuşak gövde değil.
            assert not isinstance(raised.value.detail, dict)

    await engine.dispose()


# ---------------------------------------------------------------------------
# Arama + eşleme
# ---------------------------------------------------------------------------


def test_cpr_search_predicates_by_digit_count() -> None:
    assert len(cpr_search_predicates("0101901234")) == 2  # cpr_hash + birth_hash
    assert len(cpr_search_predicates("010190")) == 1  # yalnız birth_hash
    assert len(cpr_search_predicates("1234")) == 1  # last4
    assert cpr_search_predicates("12345") == []
    assert cpr_search_predicates("") == []


@pytest.mark.asyncio
async def test_search_finds_partial_customer_by_birth_section() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with Session() as session:
        full = await create_customer(
            session,
            CustomerCreate(name="Full Search", email="full-search@example.com", cpr_number="0101905678"),
        )
        # Aynı doğum bölümü → yumuşak dup uyarısı bilinçli onaylanır.
        partial = await create_customer(
            session,
            CustomerCreate(
                name="Partial Search",
                email="partial-search@example.com",
                cpr_number="010190",
                confirm_cpr_conflict=True,
            ),
        )
        # Farklı doğum bölümü — eşleşmemeli.
        await create_customer(
            session,
            CustomerCreate(name="No Match", email="no-match@example.com", cpr_number="0202901234"),
        )
        await session.commit()

        from app.services.customer_service import _digits_only  # noqa: PLC0415

        six_digit_hits = (
            (await session.scalars(select(User).where(cpr_search_predicates("010190")[0]))).all()
        )
        assert {row.id for row in six_digit_hits} == {partial.id, full.id}

        ten_digit_hits = (
            (await session.scalars(select(User).where(cpr_search_predicates("0101905678")[0]))).all()
        )
        assert [row.id for row in ten_digit_hits] == [full.id]

        assert _digits_only("01-02-90") == "010290"

    await engine.dispose()


@pytest.mark.asyncio
async def test_identity_match_reports_birth_kind_for_partial_cpr() -> None:
    engine, Session = _session_factory()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with Session() as session:
        partial = await create_customer(
            session,
            CustomerCreate(name="Birth match", email="birth-match@example.com", cpr_number="010190"),
        )
        await session.commit()

        match = await customer_identity_match(session, cpr_number="010190", identity_doc_number=None)
        assert match.status == "single"
        assert len(match.matches) == 1
        assert match.matches[0].id == str(partial.id)
        assert match.matches[0].match_kind == "birth"
        assert "birth" in (match.matches[0].matched_by or "")
        # Maskeli partial kayıt "??????" yer tutucusu taşır, ham CPR asla.
        assert match.matches[0].cpr_number_masked == "??????"
        assert "010190" not in match.model_dump_json()

        # Tam-CPR müşterisi 6 haneyle aranırsa da 'birth' kind'ı gelir.
        await create_customer(
            session,
            CustomerCreate(name="Full match", email="full-match@example.com", cpr_number="0202901234"),
        )
        await session.commit()
        full_match = await customer_identity_match(session, cpr_number="020290", identity_doc_number=None)
        assert full_match.status == "single"
        assert full_match.matches[0].match_kind == "birth"

    await engine.dispose()
