"""add transaction core tables

Revision ID: 0006_transactions_core
Revises: 0005_reference_sequences
Create Date: 2026-02-28 00:00:03.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import now_default, uuid_type

# revision identifiers, used by Alembic.
revision: str = "0006_transactions_core"
down_revision: Union[str, None] = "0005_reference_sequences"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "transactions",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("pos_session_id", uuid_type(), nullable=False),
        sa.Column("pos_document_sequence_no", sa.Integer(), nullable=True),
        sa.Column("trade_side", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="confirmed"),
        sa.Column("customer_id", uuid_type(), nullable=True),
        sa.Column("clerk_user_id", uuid_type(), nullable=True),
        sa.Column("currency_code", sa.String(length=3), nullable=False, server_default="DKK"),
        sa.Column("gross_amount_dkk", sa.Numeric(12, 2), nullable=False),
        sa.Column("net_amount_dkk", sa.Numeric(12, 2), nullable=False),
        sa.Column("vat_rate_percent", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("vat_amount_dkk", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["clerk_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["pos_document_sequence_no"], ["pos_documents.sequence_no"]),
        sa.ForeignKeyConstraint(["pos_session_id"], ["pos_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pos_session_id"),
    )
    op.create_index("ix_transactions_pos_session_id", "transactions", ["pos_session_id"], unique=False)
    op.create_index(
        "ix_transactions_pos_document_sequence_no",
        "transactions",
        ["pos_document_sequence_no"],
        unique=False,
    )
    op.create_index("ix_transactions_customer_id", "transactions", ["customer_id"], unique=False)
    op.create_index("ix_transactions_clerk_user_id", "transactions", ["clerk_user_id"], unique=False)

    op.create_table(
        "transaction_lines",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("transaction_id", uuid_type(), nullable=False),
        sa.Column("line_no", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("product_id", uuid_type(), nullable=True),
        sa.Column("product_number", sa.String(length=4), nullable=True),
        sa.Column("reference_number", sa.String(length=10), nullable=True),
        sa.Column("product_type", sa.String(length=50), nullable=True),
        sa.Column("metal_type", sa.String(length=50), nullable=True),
        sa.Column("weight_grams", sa.Numeric(10, 2), nullable=True),
        sa.Column("purity_karat", sa.String(length=10), nullable=True),
        sa.Column("purity_percentage", sa.Numeric(5, 2), nullable=True),
        sa.Column("pure_gold_grams", sa.Numeric(10, 2), nullable=True),
        sa.Column("rate_dkk", sa.Numeric(10, 2), nullable=True),
        sa.Column("margin_percent", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("line_total_dkk", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["transaction_id"], ["transactions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("transaction_id", "line_no", name="uq_transaction_lines_tx_line_no"),
    )
    op.create_index("ix_transaction_lines_transaction_id", "transaction_lines", ["transaction_id"], unique=False)
    op.create_index("ix_transaction_lines_product_id", "transaction_lines", ["product_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_transaction_lines_product_id", table_name="transaction_lines")
    op.drop_index("ix_transaction_lines_transaction_id", table_name="transaction_lines")
    op.drop_table("transaction_lines")

    op.drop_index("ix_transactions_clerk_user_id", table_name="transactions")
    op.drop_index("ix_transactions_customer_id", table_name="transactions")
    op.drop_index("ix_transactions_pos_document_sequence_no", table_name="transactions")
    op.drop_index("ix_transactions_pos_session_id", table_name="transactions")
    op.drop_table("transactions")
