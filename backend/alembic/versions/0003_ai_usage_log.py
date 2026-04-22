"""add ai usage log table

Revision ID: 0003_ai_usage_log
Revises: 0002_pos_and_identity
Create Date: 2026-02-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import now_default, uuid_type

# revision identifiers, used by Alembic.
revision: str = "0003_ai_usage_log"
down_revision: Union[str, None] = "0002_pos_and_identity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_usage_log",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("product_id", uuid_type(), nullable=True),
        sa.Column("performed_by", uuid_type(), nullable=True),
        sa.Column("provider", sa.String(length=40), nullable=False, server_default="openai"),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_cost_usd", sa.Numeric(14, 8), nullable=False, server_default="0"),
        sa.Column("output_cost_usd", sa.Numeric(14, 8), nullable=False, server_default="0"),
        sa.Column("total_cost_usd", sa.Numeric(14, 8), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.ForeignKeyConstraint(["performed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_usage_log_product_id", "ai_usage_log", ["product_id"], unique=False)
    op.create_index("ix_ai_usage_log_performed_by", "ai_usage_log", ["performed_by"], unique=False)
    op.create_index("ix_ai_usage_log_created_at", "ai_usage_log", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ai_usage_log_created_at", table_name="ai_usage_log")
    op.drop_index("ix_ai_usage_log_performed_by", table_name="ai_usage_log")
    op.drop_index("ix_ai_usage_log_product_id", table_name="ai_usage_log")
    op.drop_table("ai_usage_log")
