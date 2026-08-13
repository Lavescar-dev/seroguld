"""add daily market-rate confirmation audit

Revision ID: 0034_market_rate_confirmation
Revises: 0033_woocommerce_catalog
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0034_market_rate_confirmation"
down_revision: Union[str, None] = "0033_woocommerce_catalog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "market_rate_confirmations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column(
            "business_timezone",
            sa.String(length=64),
            nullable=False,
            server_default="Europe/Copenhagen",
        ),
        sa.Column("confirmation_mode", sa.String(length=20), nullable=False),
        sa.Column("gold_dkk", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("silver_dkk", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("platinum_dkk", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("palladium_dkk", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("confirmed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "confirmation_mode IN ('saved', 'unchanged')",
            name="ck_market_rate_confirmations_mode",
        ),
        sa.ForeignKeyConstraint(["confirmed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_date", name="uq_market_rate_confirmations_business_date"),
    )
    op.create_index(
        "ix_market_rate_confirmations_business_date",
        "market_rate_confirmations",
        ["business_date"],
        unique=False,
    )
    op.create_index(
        "ix_market_rate_confirmations_confirmed_by_user_id",
        "market_rate_confirmations",
        ["confirmed_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_market_rate_confirmations_confirmed_by_user_id",
        table_name="market_rate_confirmations",
    )
    op.drop_index(
        "ix_market_rate_confirmations_business_date",
        table_name="market_rate_confirmations",
    )
    op.drop_table("market_rate_confirmations")
