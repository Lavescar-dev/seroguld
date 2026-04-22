"""add gdpr runner support fields

Revision ID: 0015_gdpr_runner_and_woo_customer_map
Revises: 0014_gdpr_module
Create Date: 2026-04-02 18:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0015_gdpr_runner_and_woo_customer_map"
down_revision: Union[str, None] = "0014_gdpr_module"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "users" in tables:
        user_columns = _column_names(inspector, "users")
        if "woocommerce_customer_id" not in user_columns:
            op.add_column("users", sa.Column("woocommerce_customer_id", sa.String(length=40), nullable=True))
        inspector = sa.inspect(bind)
        if not _has_index(inspector, "users", "ix_users_woocommerce_customer_id"):
            op.create_index("ix_users_woocommerce_customer_id", "users", ["woocommerce_customer_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "users" in tables:
        if _has_index(inspector, "users", "ix_users_woocommerce_customer_id"):
            op.drop_index("ix_users_woocommerce_customer_id", table_name="users")
        user_columns = _column_names(inspector, "users")
        if "woocommerce_customer_id" in user_columns:
            op.drop_column("users", "woocommerce_customer_id")
