"""products.reference_number kısmi unique index

Revision ID: 0037_product_reference_unique
Revises: 0036_product_woo_categories
Create Date: 2026-08-20 12:00:00.000000

Referans numarası üretimi eşzamanlı finalize'da aynı değeri iki kez
verebiliyordu ve kolonun unique kısıtı yoktu; çakışma sessizce kalıcı
oluyordu. NULL'lara dokunmayan (elle referanssız ürünler) kısmi unique
index eklenir.

Zaten çift kayıt varsa migration ELLE müdahale beklemeden kendi çözer:
her çakışan grupta en uygun satır (canlı > yumuşak silinmiş, sonra en eski)
referansı korur; fazlalıklar referanssız (NULL) bırakılır. Böylece paketli
uygulama açılırken migration takılıp "yerel çalışma alanı hazır değil"
ekranında kalmaz. reference_number VARCHAR(10) olduğu için sonekle
tekilleştirme yapılamaz; fazlalık satırlar NULL'lanır ve operatör UI'dan
yeniden referans atayabilir.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0037_product_reference_unique"
down_revision: Union[str, None] = "0036_product_woo_categories"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX_NAME = "uq_products_reference_number"
_PREDICATE = "reference_number IS NOT NULL"


def upgrade() -> None:
    bind = op.get_bind()

    # Çift referanslı grupları migration İÇİNDE çöz (elle temizlik gerektirmez):
    # her grupta bir satır referansı korur, diğerleri NULL'lanır. Korunacak
    # satır önceliği: önce canlı (deleted_at IS NULL), sonra en eski (created_at),
    # eşitlikte id. Kısmi unique index yalnız NOT NULL satırları kapsadığından
    # bu güvenli ve tekrar çalıştırılabilir (idempotent).
    duplicate_groups = bind.execute(
        sa.text(
            "SELECT reference_number FROM products "
            "WHERE reference_number IS NOT NULL "
            "GROUP BY reference_number HAVING COUNT(*) > 1"
        )
    ).fetchall()
    cleared = 0
    for row in duplicate_groups:
        reference = row[0]
        members = bind.execute(
            sa.text(
                "SELECT id FROM products WHERE reference_number = :reference "
                "ORDER BY (deleted_at IS NOT NULL), created_at, id"
            ),
            {"reference": reference},
        ).fetchall()
        for extra in members[1:]:
            bind.execute(
                sa.text("UPDATE products SET reference_number = NULL WHERE id = :id"),
                {"id": extra[0]},
            )
            cleared += 1
    if cleared:
        # ASCII-ONLY: paketli runtime'ın stdout'u cp1252; Türkçe karakter yazmak
        # UnicodeEncodeError ile migration'ı çökertir (0.3.14'te bu satır böyle
        # patlamıştı). Operatör referanssız kalan ürünleri UI'dan yeniden atar.
        print(
            f"[0037] resolved {len(duplicate_groups)} duplicate reference "
            f"group(s); cleared reference_number on {cleared} extra row(s)."
        )

    existing = {index["name"] for index in sa.inspect(bind).get_indexes("products")}
    if _INDEX_NAME not in existing:
        op.create_index(
            _INDEX_NAME,
            "products",
            ["reference_number"],
            unique=True,
            sqlite_where=sa.text(_PREDICATE),
            postgresql_where=sa.text(_PREDICATE),
        )


def downgrade() -> None:
    bind = op.get_bind()
    existing = {index["name"] for index in sa.inspect(bind).get_indexes("products")}
    if _INDEX_NAME in existing:
        op.drop_index(_INDEX_NAME, table_name="products")
