"""add customer postal code

Revision ID: 0008_customer_postal_code
Revises: 0007_pos_session_lines
Create Date: 2026-03-27 00:00:05.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0008_customer_postal_code"
down_revision: Union[str, None] = "0007_pos_session_lines"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("postal_code", sa.String(length=20), nullable=True))
    op.create_index("ix_users_postal_code", "users", ["postal_code"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_users_postal_code", table_name="users")
    op.drop_column("users", "postal_code")
