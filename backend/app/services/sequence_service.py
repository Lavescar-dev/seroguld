from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import Integer, and_, cast, func, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pos_document import PosDocument
from app.models.product import Product
from app.models.reference_sequence import ReferenceSequence

PRODUCT_NUMBER_SEQUENCE_KEY = "product_number"
REFERENCE_NUMBER_SEQUENCE_KEY = "reference_number"
AFREGNINGS_NUMBER_SEQUENCE_KEY = "afregnings_number"
INVOICE_NUMBER_SEQUENCE_KEY = "invoice_number"

LEGACY_REFERENCE_SEQUENCE_KEYS = ("product_reference",)


async def _get_or_seed_sequence(
    session: AsyncSession,
    *,
    key: str,
    seed_value: int,
    legacy_keys: tuple[str, ...] = (),
    for_update: bool = False,
) -> ReferenceSequence:
    # Tüketim yolları satır kilidiyle okur: eşzamanlı iki finalize aynı
    # next_value'yu görüp aynı numarayı üretmesin (SQLite'ta no-op, tek
    # yazıcı; Postgres'te SELECT ... FOR UPDATE).
    current = await session.get(ReferenceSequence, key, with_for_update=bool(for_update))
    if current is not None:
        return current

    for legacy_key in legacy_keys:
        legacy = await session.get(ReferenceSequence, legacy_key)
        if legacy is not None:
            migrated = ReferenceSequence(key=key, next_value=int(legacy.next_value))
            session.add(migrated)
            await session.flush()
            return migrated

    seeded = ReferenceSequence(key=key, next_value=int(seed_value))
    session.add(seeded)
    await session.flush()
    return seeded


async def infer_product_number_seed(session: AsyncSession) -> int:
    max_number = await session.scalar(select(func.max(cast(Product.product_number, Integer))))
    return int(max_number or 0) + 1


async def infer_reference_number_seed(session: AsyncSession, *, start: int, window: int) -> int:
    """Pencere içindeki en büyük sayısal referansı SQL tarafında bulur.

    Eski hali TÜM ``Product.reference_number`` satırlarını çekip Python'da
    ayrıştırıyordu; display snapshot'ı her üretiminde workspace kurulumu bu
    fonksiyona düşündüğü için 1 sn'lik polling döngülerinde tablo boyutuyla
    büyüyen tarama yapıyordu. Artık MAX + pencere filtresi veritabanında
    çözülür; digit filtresi cast'ten ÖNCE uygulanır (Postgres CAST('abc' AS
    INTEGER) hata fırlatır; elle girilmiş alphanumeric referanslar eskisi
    gibi atlanır — yalnız tamamen rakam olan değerler sayılır).
    """
    lower = max(0, int(start))
    upper = lower + max(100, int(window))
    numeric_value = cast(Product.reference_number, Integer)
    if session.get_bind().dialect.name == "postgresql":
        # ^[0-9]+$ = tamamen rakam (boş string dahil değil); eski Python
        # isdigit() kabulünün referans numaraları için eşdeğeri.
        digit_filter = Product.reference_number.op("~")(r"^[0-9]+$")
    else:
        # SQLite: GLOB ile "ilk karakter rakam VE hiç rakam-dışı karakter yok".
        digit_filter = and_(
            Product.reference_number.op("GLOB")("[0-9]*"),
            not_(Product.reference_number.op("GLOB")("*[^0-9]*")),
        )
    max_seen = await session.scalar(
        select(func.max(numeric_value)).where(
            Product.reference_number.is_not(None),
            digit_filter,
            numeric_value >= lower,
            numeric_value <= upper,
        )
    )
    if max_seen is None:
        return lower
    return int(max_seen) + 1


async def infer_invoice_number_seed(session: AsyncSession) -> int:
    max_sequence = await session.scalar(select(func.max(PosDocument.sequence_no)))
    return int(max_sequence or 0) + 1


async def preview_reference_number(session: AsyncSession, *, start: int, window: int) -> str:
    seed = await infer_reference_number_seed(session, start=start, window=window)
    seq = await _get_or_seed_sequence(
        session,
        key=REFERENCE_NUMBER_SEQUENCE_KEY,
        seed_value=seed,
        legacy_keys=LEGACY_REFERENCE_SEQUENCE_KEYS,
    )
    return str(int(seq.next_value))


async def consume_reference_number(session: AsyncSession, *, start: int, window: int) -> str:
    seed = await infer_reference_number_seed(session, start=start, window=window)
    seq = await _get_or_seed_sequence(
        session,
        key=REFERENCE_NUMBER_SEQUENCE_KEY,
        seed_value=seed,
        legacy_keys=LEGACY_REFERENCE_SEQUENCE_KEYS,
        for_update=True,
    )
    candidate = int(seq.next_value)
    # Elle girilmiş bir referans sıra değerini işgal etmiş olabilir; unique
    # kısıt finalize ortasında patlamasın diye dolu numaralar atlanır.
    while True:
        if len(str(candidate)) > 10:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Referans no limiti asildi. Lutfen manuel referans girin.",
            )
        taken = await session.scalar(
            select(func.count())
            .select_from(Product)
            .where(Product.reference_number == str(candidate))
        )
        if not taken:
            break
        candidate += 1
    seq.next_value = candidate + 1
    await session.flush()
    return str(candidate)


async def consume_product_number(session: AsyncSession) -> str:
    seed = await infer_product_number_seed(session)
    seq = await _get_or_seed_sequence(
        session, key=PRODUCT_NUMBER_SEQUENCE_KEY, seed_value=seed, for_update=True
    )
    next_value = int(seq.next_value)
    if next_value > 9999:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Urun numarasi limiti doldu (9999)")
    seq.next_value = next_value + 1
    await session.flush()
    return f"{next_value:04d}"


async def preview_product_number(session: AsyncSession) -> str:
    seed = await infer_product_number_seed(session)
    seq = await _get_or_seed_sequence(session, key=PRODUCT_NUMBER_SEQUENCE_KEY, seed_value=seed)
    return f"{int(seq.next_value):04d}"


async def preview_afregnings_number(session: AsyncSession, *, start: int, window: int) -> str:
    # AFG draft numbering should follow the clerk-facing list sequence (1000 + next document sequence),
    # not the legacy reference-number seed window.
    _ = (start, window)
    next_sequence = await infer_invoice_number_seed(session)
    return str(1000 + int(next_sequence))


async def preview_invoice_number(session: AsyncSession) -> str:
    seed = await infer_invoice_number_seed(session)
    seq = await _get_or_seed_sequence(session, key=INVOICE_NUMBER_SEQUENCE_KEY, seed_value=seed)
    return str(int(seq.next_value))
