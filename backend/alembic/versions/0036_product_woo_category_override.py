"""products.woocommerce_category_ids — yayın kategori override'ı

Revision ID: 0036_product_woo_categories
Revises: 0035_product_dims_inventory
Create Date: 2026-08-19 20:00:00.000000

Yayın panelindeki kategori seçici WP'den gelen gerçek kategori ID'lerini bu
kolona yazar; doluysa publish payload'ı Settings kategori haritası yerine bu
listeyi kullanır. NULL = eski davranış (harita).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0036_product_woo_categories"
down_revision: Union[str, None] = "0035_product_dims_inventory"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("woocommerce_category_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "woocommerce_category_ids")
