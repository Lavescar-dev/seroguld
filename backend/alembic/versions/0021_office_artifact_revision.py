"""add monotonic revision to document artifacts

Revision ID: 0021_office_artifact_revision
Revises: 0020_pos_document_cancellation
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0021_office_artifact_revision"
down_revision: Union[str, None] = "0020_pos_document_cancellation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "document_artifacts" not in tables:
        return
    columns = {column["name"] for column in inspector.get_columns("document_artifacts")}
    if "revision" in columns:
        return
    with op.batch_alter_table("document_artifacts") as batch_op:
        batch_op.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "document_artifacts" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("document_artifacts")}
    if "revision" not in columns:
        return
    with op.batch_alter_table("document_artifacts") as batch_op:
        batch_op.drop_column("revision")
