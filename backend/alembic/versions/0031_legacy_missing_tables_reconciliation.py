"""create customer activity/link tables omitted by retired migration paths

Revision ID: 0031_legacy_missing_tables_reconciliation
Revises: 0030_pos_session_document_date
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0031_legacy_missing_tables_reconciliation"
down_revision: Union[str, None] = "0030_pos_session_document_date"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _ensure_indexes(table: str, definitions: dict[str, list[str]]) -> None:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return
    existing = {str(item["name"]) for item in inspector.get_indexes(table)}
    for name, columns in definitions.items():
        if name not in existing:
            op.create_index(name, table, columns)


def upgrade() -> None:
    tables = _tables()
    if "customer_activity_events" not in tables:
        op.create_table(
            "customer_activity_events",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("customer_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("pos_session_id", sa.Uuid(as_uuid=True), sa.ForeignKey("pos_sessions.id"), nullable=True),
            sa.Column("source", sa.String(length=30), nullable=False, server_default="pos_session"),
            sa.Column("address_hash", sa.String(length=128), nullable=True),
            sa.Column("phone_hash", sa.String(length=128), nullable=True),
            sa.Column("cpr_hash", sa.String(length=128), nullable=True),
            sa.Column("identity_doc_number_hash", sa.String(length=128), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if "pos_session_product_links" not in tables:
        op.create_table(
            "pos_session_product_links",
            sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
            sa.Column("pos_session_id", sa.Uuid(as_uuid=True), sa.ForeignKey("pos_sessions.id"), nullable=False, unique=True),
            sa.Column("product_id", sa.Uuid(as_uuid=True), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    _ensure_indexes(
        "customer_activity_events",
        {
            "ix_customer_activity_events_customer_id": ["customer_id"],
            "ix_customer_activity_events_pos_session_id": ["pos_session_id"],
            "ix_customer_activity_events_address_hash": ["address_hash"],
            "ix_customer_activity_events_identity_doc_number_hash": ["identity_doc_number_hash"],
        },
    )
    _ensure_indexes(
        "pos_session_product_links",
        {
            "ix_pos_session_product_links_pos_session_id": ["pos_session_id"],
            "ix_pos_session_product_links_product_id": ["product_id"],
        },
    )


def downgrade() -> None:
    # These compatibility tables may contain customer history.  Keep data and
    # only move the Alembic marker on downgrade.
    return
