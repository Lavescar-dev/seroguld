"""add inventory product metadata

Revision ID: 0009_inventory_product_metadata
Revises: 0008_customer_postal_code
Create Date: 2026-03-27 00:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0009_inventory_product_metadata"
down_revision: Union[str, None] = "0008_customer_postal_code"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("display_name", sa.String(length=255), nullable=True))
    op.add_column("products", sa.Column("unit_count", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("products", sa.Column("total_weight_grams", sa.Numeric(10, 2), nullable=True))
    op.add_column("products", sa.Column("shop_price_dkk", sa.Numeric(12, 2), nullable=True))
    op.add_column("products", sa.Column("shop_sync_status", sa.String(length=30), nullable=True))
    op.add_column("products", sa.Column("length_cm", sa.String(length=30), nullable=True))
    op.add_column("products", sa.Column("width_mm", sa.Numeric(10, 2), nullable=True))
    op.add_column("products", sa.Column("thickness_mm", sa.Numeric(10, 2), nullable=True))
    op.add_column("products", sa.Column("producer", sa.String(length=120), nullable=True))
    op.add_column("products", sa.Column("inventory_category", sa.String(length=30), nullable=True))
    op.add_column("products", sa.Column("inventory_subcategory", sa.String(length=30), nullable=True))
    op.add_column("products", sa.Column("operation_destination", sa.String(length=30), nullable=True))
    op.add_column("products", sa.Column("operation_classification", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "operation_classification")
    op.drop_column("products", "operation_destination")
    op.drop_column("products", "inventory_subcategory")
    op.drop_column("products", "inventory_category")
    op.drop_column("products", "producer")
    op.drop_column("products", "thickness_mm")
    op.drop_column("products", "width_mm")
    op.drop_column("products", "length_cm")
    op.drop_column("products", "shop_sync_status")
    op.drop_column("products", "shop_price_dkk")
    op.drop_column("products", "total_weight_grams")
    op.drop_column("products", "unit_count")
    op.drop_column("products", "display_name")
