"""add afg melt lots

Revision ID: 0010_afg_melt_lots
Revises: 0009_inventory_product_metadata
Create Date: 2026-03-27 08:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0010_afg_melt_lots"
down_revision: Union[str, None] = "0009_inventory_product_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    existing_indexes = {index["name"] for index in inspector.get_indexes("afg_melt_lots")} if "afg_melt_lots" in existing_tables else set()

    if "afg_melt_lots" in existing_tables:
        if op.f("ix_afg_melt_lots_metal_bucket") not in existing_indexes:
            op.create_index(op.f("ix_afg_melt_lots_metal_bucket"), "afg_melt_lots", ["metal_bucket"], unique=False)
        return

    op.create_table(
        "afg_melt_lots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("metal_bucket", sa.String(length=20), nullable=False),
        sa.Column("sent_date", sa.Date(), nullable=False),
        sa.Column("purchased_from_date", sa.Date(), nullable=True),
        sa.Column("before_weight_grams", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("before_amount_dkk", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("before_pure_gold_grams", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("after_pure_gold_grams", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("insurance_dkk", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("shipping_dkk", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("refining_dkk", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("sale_date", sa.Date(), nullable=True),
        sa.Column("quote_eur", sa.Numeric(12, 2), nullable=True),
        sa.Column("exchange_rate_dkk", sa.Numeric(8, 4), nullable=False, server_default="7.45"),
        sa.Column("payout_total_dkk", sa.Numeric(12, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_afg_melt_lots_metal_bucket"), "afg_melt_lots", ["metal_bucket"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "afg_melt_lots" not in existing_tables:
        return

    existing_indexes = {index["name"] for index in inspector.get_indexes("afg_melt_lots")}
    if op.f("ix_afg_melt_lots_metal_bucket") in existing_indexes:
        op.drop_index(op.f("ix_afg_melt_lots_metal_bucket"), table_name="afg_melt_lots")
    op.drop_table("afg_melt_lots")
