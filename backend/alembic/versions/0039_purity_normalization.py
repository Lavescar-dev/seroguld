"""products.purity_percentage nominal karat tablosuna sabitlenir (R1-37)

Revision ID: 0039_purity_normalization
Revises: 0038_product_publish_profile
Create Date: 2026-08-22 12:00:00.000000

Excel/seed kaynakli kayitlarda 14K icin 58.33 (nominal 58.5), 22K icin 91.67
(nominal 91.6), 8K icin 33.33 (nominal 33.3) saklaniyordu; downstream float
bolmesi 0.5832999999999999 gibi artiklar uretip ekrana basiyordu ve saf metal
grami / alis tutari yanlis hesaplaniyordu. Bu migration purity_karat'i bilinen
nominal tabloya oturan TUM kayitlarin purity_percentage degerini nominale
sabitler ve pure_gold_grams'i yeniden hesaplar (weight * purity / 100, 2 hane).

Kesinlesmis belgeler (PosDocument/TransactionLine) BILEREK dokunulmaz — donmus
para asla yeniden yazilmaz; duzeltme yalniz stok kartlarini kapsar.

NOT: migration ciktisi ASCII olmali (paketli runtime stdout'u cp1252).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0039_purity_normalization"
down_revision: Union[str, None] = "0038_product_publish_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Nominal karat -> saflik yuzdesi (tek kanonik tablo; bkz.
# woocommerce_import_helpers._KARAT_TO_PURITY ile ayni degerler).
_NOMINAL_PURITY: dict[str, str] = {
    "8": "33.3",
    "9": "37.5",
    "10": "41.7",
    "14": "58.5",
    "18": "75.0",
    "21": "87.5",
    "21.6": "90.0",
    "22": "91.6",
    "24": "99.9",
}


def _karat_key(raw: str) -> str:
    # "14K" / "14k" / "14 K" / "14" -> "14"
    return raw.strip().upper().removesuffix("K").strip()


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, purity_karat, purity_percentage, weight_grams FROM products "
            "WHERE purity_karat IS NOT NULL AND purity_percentage IS NOT NULL"
        )
    ).fetchall()
    fixed = 0
    for row in rows:
        nominal = _NOMINAL_PURITY.get(_karat_key(str(row[1] or "")))
        if nominal is None:
            continue  # standart disi ayar (orn. 6K): elle girilmis deger korunur
        current = str(row[2])
        if current == nominal:
            continue
        bind.execute(
            sa.text(
                "UPDATE products SET purity_percentage = :purity, "
                "pure_gold_grams = ROUND(COALESCE(weight_grams, 0) * :purity / 100.0, 2) "
                "WHERE id = :id"
            ),
            {"purity": nominal, "id": row[0]},
        )
        fixed += 1
    if fixed:
        # ASCII-only: packaged runtime stdout is cp1252.
        print(f"[0039] normalized purity on {fixed} product(s) to nominal karat table.")


def downgrade() -> None:
    # Nominal degerler dogru degerlerdir; eski hatali 58.33/91.67 degerlerine
    # geri donus anlamli degil. no-op.
    pass
