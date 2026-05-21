"""enforce ondelete RESTRICT on pos_sessions.customer_id

Revision ID: 0017_pos_session_customer_ondelete
Revises: 0016_pos_document_uniconta_sync
Create Date: 2026-05-13 19:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0017_pos_session_customer_ondelete"
down_revision: Union[str, None] = "0016_pos_document_uniconta_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite anonymous FK constraints. Batch recreate='always' tabloyu komple
    # yeniden inşa eder; SQLAlchemy reflect ile naming convention'ı kullanır.
    with op.batch_alter_table(
        "pos_sessions",
        recreate="always",
        naming_convention={
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        },
    ) as batch_op:
        batch_op.create_foreign_key(
            "fk_pos_sessions_customer_id_users",
            "users",
            ["customer_id"],
            ["id"],
            ondelete="RESTRICT",
        )


def downgrade() -> None:
    with op.batch_alter_table(
        "pos_sessions",
        recreate="always",
        naming_convention={
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        },
    ) as batch_op:
        batch_op.create_foreign_key(
            "fk_pos_sessions_customer_id_users",
            "users",
            ["customer_id"],
            ["id"],
        )
