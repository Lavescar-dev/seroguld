"""add the explicit legal/document date used by editable AFG drafts

Revision ID: 0030_pos_session_document_date
Revises: 0029_document_artifact_revision
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0030_pos_session_document_date"
down_revision: Union[str, None] = "0029_document_artifact_revision"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "pos_sessions" not in inspector.get_table_names():
        return
    columns = {str(column["name"]) for column in inspector.get_columns("pos_sessions")}
    if "document_date" not in columns:
        with op.batch_alter_table("pos_sessions") as batch_op:
            batch_op.add_column(sa.Column("document_date", sa.Date(), nullable=True))
    # Backfill only rows without an explicit value.  SQLite's date() and
    # PostgreSQL's date cast both preserve the existing created_at date.
    op.execute(
        sa.text(
            "UPDATE pos_sessions SET document_date = date(created_at) "
            "WHERE document_date IS NULL AND created_at IS NOT NULL"
        )
    )


def downgrade() -> None:
    # The legal document date is business history; do not erase it during a
    # compatibility downgrade.
    return
