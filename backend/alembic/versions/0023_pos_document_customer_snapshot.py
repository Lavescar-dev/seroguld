"""store immutable customer postal/city values on finalized documents

Revision ID: 0023_pos_document_customer_snapshot
Revises: 0022_gdpr_copy_tasks
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0023_pos_document_customer_snapshot"
down_revision: Union[str, None] = "0022_gdpr_copy_tasks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "pos_documents" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("pos_documents")}
    with op.batch_alter_table("pos_documents") as batch_op:
        if "customer_postal_code" not in columns:
            batch_op.add_column(sa.Column("customer_postal_code", sa.String(length=4), nullable=True))
        if "customer_city" not in columns:
            batch_op.add_column(sa.Column("customer_city", sa.String(length=120), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "pos_documents" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("pos_documents")}
    with op.batch_alter_table("pos_documents") as batch_op:
        if "customer_city" in columns:
            batch_op.drop_column("customer_city")
        if "customer_postal_code" in columns:
            batch_op.drop_column("customer_postal_code")
