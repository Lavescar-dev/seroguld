"""allow empty purchase drafts without a selected customer

Revision ID: 0011_pos_session_optional_customer
Revises: 0010_afg_melt_lots
Create Date: 2026-03-28 12:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0011_pos_session_optional_customer"
down_revision: Union[str, None] = "0010_afg_melt_lots"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"]: column for column in inspector.get_columns("pos_sessions")}
    customer_column = columns.get("customer_id")
    if customer_column and customer_column.get("nullable"):
        return

    with op.batch_alter_table("pos_sessions") as batch_op:
        batch_op.alter_column(
            "customer_id",
            existing_type=sa.Uuid(),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    null_count = bind.execute(sa.text("select count(*) from pos_sessions where customer_id is null")).scalar() or 0
    if int(null_count) > 0:
        raise RuntimeError("Cannot downgrade 0011_pos_session_optional_customer while pos_sessions.customer_id contains NULL rows")

    with op.batch_alter_table("pos_sessions") as batch_op:
        batch_op.alter_column(
            "customer_id",
            existing_type=sa.Uuid(),
            nullable=False,
        )
