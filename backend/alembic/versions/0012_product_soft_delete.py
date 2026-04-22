"""add soft delete fields for inventory products

Revision ID: 0012_product_soft_delete
Revises: 0011_pos_session_optional_customer
Create Date: 2026-03-28 20:45:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0012_product_soft_delete"
down_revision: Union[str, None] = "0011_pos_session_optional_customer"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("products")}
    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("products")}

    with op.batch_alter_table("products") as batch_op:
        if "deleted_at" not in columns:
            batch_op.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        if "deleted_by_user_id" not in columns:
            batch_op.add_column(sa.Column("deleted_by_user_id", sa.Uuid(), nullable=True))
        if "fk_products_deleted_by_user_id_users" not in foreign_keys:
            batch_op.create_foreign_key(
                "fk_products_deleted_by_user_id_users",
                "users",
                ["deleted_by_user_id"],
                ["id"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("products")}
    foreign_keys = {fk["name"] for fk in inspector.get_foreign_keys("products")}

    with op.batch_alter_table("products") as batch_op:
        if "fk_products_deleted_by_user_id_users" in foreign_keys:
            batch_op.drop_constraint("fk_products_deleted_by_user_id_users", type_="foreignkey")
        if "deleted_by_user_id" in columns:
            batch_op.drop_column("deleted_by_user_id")
        if "deleted_at" in columns:
            batch_op.drop_column("deleted_at")
