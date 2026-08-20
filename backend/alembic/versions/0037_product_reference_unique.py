"""products.reference_number kısmi unique index

Revision ID: 0037_product_reference_unique
Revises: 0036_product_woo_categories
Create Date: 2026-08-20 12:00:00.000000

Referans numarası üretimi eşzamanlı finalize'da aynı değeri iki kez
verebiliyordu ve kolonun unique kısıtı yoktu; çakışma sessizce kalıcı
oluyordu. NULL'lara dokunmayan (elle referanssız ürünler) kısmi unique
index eklenir. Zaten çift kayıt varsa migration erken ve yazmadan durur.
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

    duplicate = bind.execute(
        sa.text(
            "SELECT reference_number FROM products "
            "WHERE reference_number IS NOT NULL "
            "GROUP BY reference_number HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicate is not None:
        raise RuntimeError(
            "products.reference_number çift kayıt içeriyor "
            f"(örn. {duplicate[0]!r}); unique index eklenmeden önce elle "
            "temizlenmelidir."
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
