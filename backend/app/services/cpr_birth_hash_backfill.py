"""cpr_birth_hash backfill — mevcut tam-CPR kayıtlarına doğum-bölümü hash'i.

R1-CPR: 0042 migration kolonları EKLER ama doldurmaz (backfill'in migration
içinde olması yasaktır — şifre çözme anahtarı erişimi + uzun sürebilen batch
işlemleri alembic yoluyla çalıştırılmaz). Bu servis idempotenttir:

- Yalnız ``cpr_birth_hash IS NULL`` olan müşteri satırları işlenir.
- Şifreli CPR çözülür; 10 hane → tam kolonlar zaten doludur, yalnız
  ``cpr_birth_hash`` yazılır; 6 hane (tarihsel kısmi kayıt) → birth_hash +
  ``cpr_is_partial=True``; bozuk/çözülemeyen satır ATLANIR (sessiz veri
  kaybı yok — istatistikte raporlanır).
- ``cpr_last4``'süz eski tam kayıtlarda last4 tamamlanır (liste maskesi
  artık decrypt yapmasın).
- 200'lik batch'lerle işler; her batch kendi transaction'ındadır — yarıda
  kesilirse kalan satırlar bir sonraki koşuda tamamlanır.

CLI: ``bash scripts/backfill-cpr-birth-hash.sh --dry-run`` (bkz. script).
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models.enums import RoleEnum
from app.models.user import User
from app.utils.security import decrypt_field, encrypt_field, hash_cpr_birth

logger = logging.getLogger("cpr_birth_hash_backfill")

BATCH_SIZE = 200


def _digits_only(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


async def backfill_cpr_birth_hashes(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    batch_size: int = BATCH_SIZE,
    max_batches: int | None = None,
    dry_run: bool = False,
) -> dict[str, int]:
    """Eksik ``cpr_birth_hash`` kolonlarını doldurur; istatistik döndürür.

    Anahtarlar: scanned, backfilled, partial_marked, skipped_undecryptable,
    remaining. ``max_batches`` ile sınırlı koşu (canlı sistemde küçük dilimler
    hâlinde çalıştırma) mümkündür; kalan sayısı ``remaining`` ile bildirilir.
    """
    stats = {
        "scanned": 0,
        "backfilled": 0,
        "partial_marked": 0,
        "skipped_undecryptable": 0,
        "remaining": 0,
    }

    async with session_factory() as session:
        # Toplam iş kuyruğu: kolon boş olan müşteri satırları.
        pending_ids = (
            (
                await session.scalars(
                    select(User.id)
                    .where(
                        User.role == RoleEnum.CUSTOMER,
                        User.cpr_number_encrypted.is_not(None),
                        User.cpr_birth_hash.is_(None),
                    )
                    .order_by(User.created_at.asc())
                )
            ).all()
        )
    stats["remaining"] = len(pending_ids)

    for offset in range(0, len(pending_ids), batch_size):
        if max_batches is not None and stats["scanned"] >= max_batches * batch_size:
            break
        chunk_ids = pending_ids[offset : offset + batch_size]

        async with session_factory() as session:
            rows = (
                await session.scalars(select(User).where(User.id.in_(chunk_ids)))
            ).all()
            for user in rows:
                stats["scanned"] += 1
                cpr_plain = decrypt_field(user.cpr_number_encrypted)
                digits = _digits_only(cpr_plain)
                if not digits:
                    # Çözülemeyen/boş şifreli değer: atla, kolon boş kalarak
                    # bir sonraki koşuda tekrar denenir (idempotent).
                    stats["skipped_undecryptable"] += 1
                    continue
                birth_hash = hash_cpr_birth(digits)
                if not birth_hash:
                    stats["skipped_undecryptable"] += 1
                    continue
                if dry_run:
                    stats["backfilled"] += 1
                    if len(digits) < 10:
                        stats["partial_marked"] += 1
                    continue

                user.cpr_birth_hash = birth_hash
                if len(digits) == 6 and not user.cpr_is_partial:
                    # Tarihsel kısmi kayıt: tam kolonlar zaten boştur, sadece
                    # işaretle.
                    user.cpr_is_partial = True
                    stats["partial_marked"] += 1
                elif len(digits) == 10:
                    if not user.cpr_last4:
                        # Eski tam kayıtta last4 eksikse tamamla (liste
                        # maskesi decrypt'siz çalışsın).
                        user.cpr_last4 = digits[-4:]
                    if not user.cpr_number_encrypted:
                        user.cpr_number_encrypted = encrypt_field(digits)
                stats["backfilled"] += 1
            if not dry_run:
                await session.commit()

    # skipped satırlar kolonsuz kaldığı için kuyrukta kalır (idempotent
    # yeniden koşu); kalan sayımından yalnız backfilled düşer.
    stats["remaining"] = max(stats["remaining"] - stats["backfilled"], 0)
    return stats


async def _main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="cpr_birth_hash backfill")
    parser.add_argument("--dry-run", action="store_true", help="Yazma yapmadan sayım.")
    parser.add_argument("--max-batches", type=int, default=None, help="Bu koşuda en fazla N batch işle.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    engine = create_async_engine(get_settings().database_url)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        stats = await backfill_cpr_birth_hashes(
            factory, max_batches=args.max_batches, dry_run=args.dry_run
        )
    finally:
        await engine.dispose()
    logger.info("cpr_birth_hash backfill sonucu: %s", stats)
    print(stats)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
