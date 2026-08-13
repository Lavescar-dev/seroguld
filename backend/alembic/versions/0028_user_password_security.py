"""user password security and forced first-login change

Revision ID: 0028_user_password_security
Revises: 0027_legacy_migration_center
Create Date: 2026-08-11 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0028_user_password_security"
down_revision: Union[str, None] = "0027_legacy_migration_center"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        return
    columns = {str(column["name"]) for column in inspector.get_columns("users")}
    missing = []
    if "must_change_password" not in columns:
        missing.append(
            sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    if "password_changed_at" not in columns:
        missing.append(sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))
    if not missing:
        return
    with op.batch_alter_table("users") as batch_op:
        for column in missing:
            batch_op.add_column(column)


def downgrade() -> None:
    # Password-change state is security/audit data and must survive a
    # compatibility downgrade.
    return
