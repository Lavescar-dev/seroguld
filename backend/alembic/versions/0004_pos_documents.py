"""add pos document table

Revision ID: 0004_pos_documents
Revises: 0003_ai_usage_log
Create Date: 2026-02-28 00:00:01.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import create_enum, drop_enum, enum_type, now_default, uuid_type

# revision identifiers, used by Alembic.
revision: str = "0004_pos_documents"
down_revision: Union[str, None] = "0003_ai_usage_log"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pos_document_type_enum = enum_type(
        "sale_invoice",
        "purchase_receipt",
        name="pos_document_type_enum",
    )
    create_enum(pos_document_type_enum)

    op.create_table(
        "pos_documents",
        sa.Column("sequence_no", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("pos_session_id", uuid_type(), nullable=False),
        sa.Column("document_type", pos_document_type_enum, nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.Column("supply_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("currency_code", sa.String(length=3), nullable=False, server_default="DKK"),
        sa.Column("gross_amount_dkk", sa.Numeric(12, 2), nullable=False),
        sa.Column("net_amount_dkk", sa.Numeric(12, 2), nullable=False),
        sa.Column("vat_rate_percent", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("vat_amount_dkk", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("customer_name", sa.String(length=200), nullable=True),
        sa.Column("customer_phone", sa.String(length=30), nullable=True),
        sa.Column("customer_email", sa.String(length=200), nullable=True),
        sa.Column("customer_address", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.ForeignKeyConstraint(["pos_session_id"], ["pos_sessions.id"]),
        sa.UniqueConstraint("pos_session_id"),
    )
    op.create_index("ix_pos_documents_pos_session_id", "pos_documents", ["pos_session_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pos_documents_pos_session_id", table_name="pos_documents")
    op.drop_table("pos_documents")
    drop_enum("pos_document_type_enum")
