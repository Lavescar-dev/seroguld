"""products.woo_markup_rate + woo_min_price_dkk

Revision ID: 0040_product_woo_metal_pricing
Revises: 0039_purity_normalization
Create Date: 2026-08-31 16:30:00.000000

Woo otomatik metal fiyatlari: yayinda WP "Live Gold Price" eklentisinin
meta sozlesmesine (_metal_* / _markup_rate) giden urun bazli markup ve
taban fiyat. Ikisi de NULL = settings default'u kullan.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0040_product_woo_metal_pricing"
down_revision: Union[str, None] = "0039_purity_normalization"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("products")}
    if "woo_markup_rate" not in columns:
        op.add_column("products", sa.Column("woo_markup_rate", sa.Numeric(8, 5), nullable=True))
    if "woo_min_price_dkk" not in columns:
        op.add_column("products", sa.Column("woo_min_price_dkk", sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("products")}
    if "woo_min_price_dkk" in columns:
        op.drop_column("products", "woo_min_price_dkk")
    if "woo_markup_rate" in columns:
        op.drop_column("products", "woo_markup_rate")
