"""preserve historical AFG document identity and source trace

Revision ID: 0025_historical_afg_import
Revises: 0024_customer_address_identity_guards
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0025_historical_afg_import"
down_revision: Union[str, None] = "0024_customer_address_identity_guards"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "pos_documents" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("pos_documents")}
    with op.batch_alter_table("pos_documents") as batch_op:
        if "legacy_document_number" not in columns:
            batch_op.add_column(sa.Column("legacy_document_number", sa.String(length=80), nullable=True))
        if "historical_import_hash" not in columns:
            batch_op.add_column(sa.Column("historical_import_hash", sa.String(length=64), nullable=True))
        if "historical_imported_at" not in columns:
            batch_op.add_column(sa.Column("historical_imported_at", sa.DateTime(timezone=True), nullable=True))
        if "historical_imported_by" not in columns:
            batch_op.add_column(sa.Column("historical_imported_by", sa.Uuid(), nullable=True))
    # A retired migration may have added the column but not the constraint;
    # adopt that partial state without rebuilding unrelated columns.
    if "users" in inspector.get_table_names() and "historical_imported_by" in {column["name"] for column in sa.inspect(bind).get_columns("pos_documents")}:
        foreign_keys = sa.inspect(bind).get_foreign_keys("pos_documents")
        names = {str(item.get("name")) for item in foreign_keys if item.get("name")}
        equivalent = any(
            item.get("referred_table") == "users"
            and item.get("constrained_columns") == ["historical_imported_by"]
            and item.get("referred_columns") == ["id"]
            for item in foreign_keys
        )
        if "fk_pos_documents_historical_imported_by_users" not in names and not equivalent:
            with op.batch_alter_table("pos_documents") as batch_op:
                batch_op.create_foreign_key(
                    "fk_pos_documents_historical_imported_by_users",
                    "users",
                    ["historical_imported_by"],
                    ["id"],
                )
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("pos_documents")}
    if "uq_pos_documents_legacy_document_number" not in indexes:
        op.create_index("uq_pos_documents_legacy_document_number", "pos_documents", ["legacy_document_number"], unique=True)
    if "uq_pos_documents_historical_import_hash" not in indexes:
        op.create_index("uq_pos_documents_historical_import_hash", "pos_documents", ["historical_import_hash"], unique=True)
    if "ix_pos_documents_historical_imported_by" not in indexes:
        op.create_index("ix_pos_documents_historical_imported_by", "pos_documents", ["historical_imported_by"])


def downgrade() -> None:
    # Historical source identity is customer/audit data.  A compatibility
    # downgrade must move only Alembic's marker and never erase that history.
    return
