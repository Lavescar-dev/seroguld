"""persist customer city and guard hashed identity uniqueness

Revision ID: 0024_customer_address_identity_guards
Revises: 0023_pos_document_customer_snapshot
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0024_customer_address_identity_guards"
down_revision: Union[str, None] = "0023_pos_document_customer_snapshot"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CUSTOMER_CPR_INDEX = "uq_users_customer_cpr_hash"
_IDENTITY_DOCUMENT_INDEX = "uq_customer_identity_documents_doc_hash"
_CUSTOMER_CPR_PREDICATE = "cpr_hash IS NOT NULL AND role = 'customer'"
_IDENTITY_DOCUMENT_PREDICATE = "identity_doc_number_hash IS NOT NULL"


def _raise_if_duplicate_hashes(bind) -> None:
    """Fail before writing instead of deciding which sensitive record to merge."""

    duplicate_cpr = bind.execute(
        sa.text(
            """
            SELECT 1
            FROM users
            WHERE cpr_hash IS NOT NULL AND role = 'customer'
            GROUP BY cpr_hash
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if duplicate_cpr is not None:
        raise RuntimeError(
            "Migration aborted: duplicate customer CPR hashes exist. "
            "Resolve the affected customer records manually; no records were merged."
        )

    duplicate_document = bind.execute(
        sa.text(
            """
            SELECT 1
            FROM customer_identity_documents
            WHERE identity_doc_number_hash IS NOT NULL
            GROUP BY identity_doc_number_hash
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if duplicate_document is not None:
        raise RuntimeError(
            "Migration aborted: duplicate identity-document hashes exist. "
            "Resolve the affected customer records manually; no records were merged."
        )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if not {"users", "customer_identity_documents"}.issubset(tables):
        return

    # The preflight intentionally happens before even the city column add so a
    # failed migration leaves no partial application that needs manual repair.
    _raise_if_duplicate_hashes(bind)

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "city" not in user_columns:
        with op.batch_alter_table("users") as batch_op:
            batch_op.add_column(sa.Column("city", sa.String(length=120), nullable=True))

    user_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("users")}
    if _CUSTOMER_CPR_INDEX not in user_indexes:
        op.create_index(
            _CUSTOMER_CPR_INDEX,
            "users",
            ["cpr_hash"],
            unique=True,
            sqlite_where=sa.text(_CUSTOMER_CPR_PREDICATE),
            postgresql_where=sa.text(_CUSTOMER_CPR_PREDICATE),
        )

    identity_indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("customer_identity_documents")
    }
    if _IDENTITY_DOCUMENT_INDEX not in identity_indexes:
        op.create_index(
            _IDENTITY_DOCUMENT_INDEX,
            "customer_identity_documents",
            ["identity_doc_number_hash"],
            unique=True,
            sqlite_where=sa.text(_IDENTITY_DOCUMENT_PREDICATE),
            postgresql_where=sa.text(_IDENTITY_DOCUMENT_PREDICATE),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if not {"users", "customer_identity_documents"}.issubset(tables):
        return

    identity_indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("customer_identity_documents")
    }
    if _IDENTITY_DOCUMENT_INDEX in identity_indexes:
        op.drop_index(_IDENTITY_DOCUMENT_INDEX, table_name="customer_identity_documents")

    user_indexes = {index["name"] for index in sa.inspect(bind).get_indexes("users")}
    if _CUSTOMER_CPR_INDEX in user_indexes:
        op.drop_index(_CUSTOMER_CPR_INDEX, table_name="users")

    user_columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    if "city" in user_columns:
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_column("city")
