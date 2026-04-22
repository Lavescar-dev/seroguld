"""add pos session lines table

Revision ID: 0007_pos_session_lines
Revises: 0006_transactions_core
Create Date: 2026-02-28 00:00:04.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import enum_type, now_default, uuid_type

# revision identifiers, used by Alembic.
revision: str = "0007_pos_session_lines"
down_revision: Union[str, None] = "0006_transactions_core"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    product_type_enum = enum_type(
        "bracelet",
        "ring",
        "necklace",
        "earring",
        "chain",
        "bar",
        "jewelry",
        name="product_type_enum",
        create_type=False,
    )
    metal_type_enum = enum_type(
        "yellow_gold",
        "white_gold",
        "silver",
        "platinum",
        "palladium",
        name="metal_type_enum",
        create_type=False,
    )

    op.create_table(
        "pos_session_lines",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("pos_session_id", uuid_type(), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=False),
        sa.Column("product_type", product_type_enum, nullable=False),
        sa.Column("metal_type", metal_type_enum, nullable=False),
        sa.Column("weight_grams", sa.Numeric(10, 2), nullable=False),
        sa.Column("purity_karat", sa.String(length=10), nullable=True),
        sa.Column("purity_percentage", sa.Numeric(5, 2), nullable=False),
        sa.Column("rate_dkk", sa.Numeric(10, 2), nullable=True),
        sa.Column("margin_percent_internal", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("line_offer_dkk", sa.Numeric(12, 2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.ForeignKeyConstraint(["pos_session_id"], ["pos_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pos_session_id", "line_no", name="uq_pos_session_lines_session_line_no"),
    )
    op.create_index("ix_pos_session_lines_pos_session_id", "pos_session_lines", ["pos_session_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pos_session_lines_pos_session_id", table_name="pos_session_lines")
    op.drop_table("pos_session_lines")
