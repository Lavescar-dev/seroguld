"""products.woocommerce_publish_profile + production_year

Revision ID: 0038_product_publish_profile
Revises: 0037_product_reference_unique
Create Date: 2026-08-21 12:00:00.000000

Ürün tipine duyarlı Woo yayın profilleri: operatör override'ı
(jewelry/bar/coin/platinum) ve sikke üretim yılı (Årstal). İkisi de NULL =
üründen türetilir / yıl yok.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0038_product_publish_profile"
down_revision: Union[str, None] = "0037_product_reference_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("products")}
    if "woocommerce_publish_profile" not in columns:
        op.add_column("products", sa.Column("woocommerce_publish_profile", sa.String(length=20), nullable=True))
    if "production_year" not in columns:
        op.add_column("products", sa.Column("production_year", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {col["name"] for col in sa.inspect(bind).get_columns("products")}
    if "production_year" in columns:
        op.drop_column("products", "production_year")
    if "woocommerce_publish_profile" in columns:
        op.drop_column("products", "woocommerce_publish_profile")
