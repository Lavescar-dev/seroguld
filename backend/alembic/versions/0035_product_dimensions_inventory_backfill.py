"""product diameter + inventory_category backfill

Revision ID: 0035_product_dims_inventory
Revises: 0034_market_rate_confirmation
Create Date: 2026-08-19 14:00:00.000000

inventory_category bugüne dek yalnız görüntülemede türetiliyordu
(api/inventory.py _infer_inventory_category); filtre ham kolona baktığı için
NULL kayıtlarda kategori seçimi boş liste veriyordu. Backfill, kolonu türetme
mantığının birebiriyle doldurur; yeni kayıtlar create/update'te set edilir.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0035_product_dims_inventory"
down_revision: Union[str, None] = "0034_market_rate_confirmation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("diameter_mm", sa.Numeric(10, 2), nullable=True))

    # Enum kolonlar lowercase value saklar (enums.py values_callable).
    op.execute(
        """
        UPDATE products SET
            inventory_subcategory = CASE
                WHEN metal_type = 'silver' AND product_type = 'bar' THEN 'barrer'
                WHEN metal_type = 'silver' THEN 'smykker'
                WHEN metal_type = 'palladium' THEN 'palladyum'
                WHEN metal_type = 'platinum' THEN 'platin'
                ELSE inventory_subcategory END,
            inventory_category = CASE
                WHEN metal_type = 'silver' THEN 'gumus'
                WHEN metal_type IN ('platinum', 'palladium') THEN 'platin_pd'
                WHEN product_type = 'bar' THEN 'kulce'
                ELSE 'taki' END
        WHERE inventory_category IS NULL
        """
    )


def downgrade() -> None:
    # Backfill geri alınmaz (öncesi NULL'du; bilgi kaybı yok).
    op.drop_column("products", "diameter_mm")
