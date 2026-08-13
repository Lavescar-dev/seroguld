"""adopt the document artifact revision column when an earlier path skipped it

Revision ID: 0029_document_artifact_revision
Revises: 0028_user_password_security
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0029_document_artifact_revision"
down_revision: Union[str, None] = "0028_user_password_security"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "document_artifacts" not in inspector.get_table_names():
        return
    columns = {str(column["name"]) for column in inspector.get_columns("document_artifacts")}
    if "revision" in columns:
        return
    # Existing rows are assigned zero by the database default and their other
    # values are untouched.  Do not rewrite a column that a retired build
    # already created with customer-specific revision values.
    with op.batch_alter_table("document_artifacts") as batch_op:
        batch_op.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "document_artifacts" not in inspector.get_table_names():
        return
    # This is an adoption/compatibility migration.  The column may have been
    # created by a retired desktop path, so never remove it on downgrade.
    return
