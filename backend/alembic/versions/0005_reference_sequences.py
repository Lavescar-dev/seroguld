"""add reference sequence table

Revision ID: 0005_reference_sequences
Revises: 0004_pos_documents
Create Date: 2026-02-28 00:00:02.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import now_default

# revision identifiers, used by Alembic.
revision: str = "0005_reference_sequences"
down_revision: Union[str, None] = "0004_pos_documents"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reference_sequences",
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("next_value", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("reference_sequences")
