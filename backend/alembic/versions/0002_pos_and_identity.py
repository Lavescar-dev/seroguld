"""add pos sessions and customer identity documents

Revision ID: 0002_pos_and_identity
Revises: 0001_initial
Create Date: 2026-02-26 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import create_enum, drop_enum, enum_type, json_default, json_type, now_default, uuid_type

# revision identifiers, used by Alembic.
revision: str = "0002_pos_and_identity"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    identity_doc_type_enum = enum_type(
        "passport",
        "id_card",
        "driver_license",
        name="identity_doc_type_enum",
    )
    pos_trade_side_enum = enum_type("buy_from_customer", name="pos_trade_side_enum")
    pos_rate_source_enum = enum_type("live", "manual", name="pos_rate_source_enum")
    pos_session_status_enum = enum_type(
        "draft",
        "confirmed",
        "cancelled",
        name="pos_session_status_enum",
    )

    create_enum(identity_doc_type_enum)
    create_enum(pos_trade_side_enum)
    create_enum(pos_rate_source_enum)
    create_enum(pos_session_status_enum)

    op.create_table(
        "customer_identity_documents",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("user_id", uuid_type(), nullable=False),
        sa.Column("identity_doc_type", identity_doc_type_enum, nullable=True),
        sa.Column("identity_doc_number_encrypted", sa.Text(), nullable=True),
        sa.Column("identity_doc_number_hash", sa.String(length=128), nullable=True),
        sa.Column("identity_doc_country", sa.String(length=8), nullable=True),
        sa.Column("identity_photo_refs", json_type(), nullable=False, server_default=json_default([])),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_customer_identity_documents_user_id", "customer_identity_documents", ["user_id"], unique=False)
    op.create_index(
        "ix_customer_identity_documents_identity_doc_number_hash",
        "customer_identity_documents",
        ["identity_doc_number_hash"],
        unique=False,
    )

    op.create_table(
        "pos_sessions",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("session_code", sa.String(length=16), nullable=False),
        sa.Column("display_token", sa.String(length=128), nullable=False),
        sa.Column("clerk_user_id", uuid_type(), nullable=False),
        sa.Column("customer_id", uuid_type(), nullable=False),
        sa.Column("trade_side", pos_trade_side_enum, nullable=False, server_default="buy_from_customer"),
        sa.Column("product_type", sa.String(length=50), nullable=True),
        sa.Column("metal_type", sa.String(length=50), nullable=True),
        sa.Column("weight_grams", sa.Numeric(10, 2), nullable=True),
        sa.Column("purity_karat", sa.String(length=10), nullable=True),
        sa.Column("purity_percentage", sa.Numeric(5, 2), nullable=True),
        sa.Column("live_rate_dkk", sa.Numeric(10, 2), nullable=True),
        sa.Column("manual_rate_dkk", sa.Numeric(10, 2), nullable=True),
        sa.Column("rate_source", pos_rate_source_enum, nullable=False, server_default="live"),
        sa.Column("margin_percent_internal", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("final_offer_dkk", sa.Numeric(12, 2), nullable=True),
        sa.Column("visible_snapshot", json_type(), nullable=False, server_default=json_default({})),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", pos_session_status_enum, nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["clerk_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_code"),
        sa.UniqueConstraint("display_token"),
    )
    op.create_index("ix_pos_sessions_session_code", "pos_sessions", ["session_code"], unique=False)
    op.create_index("ix_pos_sessions_display_token", "pos_sessions", ["display_token"], unique=False)
    op.create_index("ix_pos_sessions_clerk_user_id", "pos_sessions", ["clerk_user_id"], unique=False)
    op.create_index("ix_pos_sessions_customer_id", "pos_sessions", ["customer_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pos_sessions_customer_id", table_name="pos_sessions")
    op.drop_index("ix_pos_sessions_clerk_user_id", table_name="pos_sessions")
    op.drop_index("ix_pos_sessions_display_token", table_name="pos_sessions")
    op.drop_index("ix_pos_sessions_session_code", table_name="pos_sessions")
    op.drop_table("pos_sessions")

    op.drop_index("ix_customer_identity_documents_identity_doc_number_hash", table_name="customer_identity_documents")
    op.drop_index("ix_customer_identity_documents_user_id", table_name="customer_identity_documents")
    op.drop_table("customer_identity_documents")

    drop_enum("pos_session_status_enum")
    drop_enum("pos_rate_source_enum")
    drop_enum("pos_trade_side_enum")
    drop_enum("identity_doc_type_enum")
