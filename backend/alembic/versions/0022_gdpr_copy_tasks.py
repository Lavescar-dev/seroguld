"""persist GDPR copy task state and completion gate

Revision ID: 0022_gdpr_copy_tasks
Revises: 0021_office_artifact_revision
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0022_gdpr_copy_tasks"
down_revision: Union[str, None] = "0021_office_artifact_revision"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "gdpr_copy_tasks" in inspector.get_table_names():
        return
    if "gdpr_requests" not in inspector.get_table_names():
        return
    op.create_table(
        "gdpr_copy_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("task_key", sa.String(length=80), nullable=False),
        sa.Column("system_name", sa.String(length=120), nullable=False),
        sa.Column("copy_scope", sa.String(length=200), nullable=False),
        sa.Column("applicable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="pending"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'deleted', 'pseudonymized', 'legally_retained', 'manual_action_required', 'failed')",
            name="ck_gdpr_copy_tasks_status",
        ),
        sa.ForeignKeyConstraint(["request_id"], ["gdpr_requests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("request_id", "task_key", name="uq_gdpr_copy_tasks_request_task"),
    )
    op.create_index("ix_gdpr_copy_tasks_request_id", "gdpr_copy_tasks", ["request_id"], unique=False)
    op.create_index("ix_gdpr_copy_tasks_status", "gdpr_copy_tasks", ["status"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "gdpr_copy_tasks" not in inspector.get_table_names():
        return
    op.drop_index("ix_gdpr_copy_tasks_status", table_name="gdpr_copy_tasks")
    op.drop_index("ix_gdpr_copy_tasks_request_id", table_name="gdpr_copy_tasks")
    op.drop_table("gdpr_copy_tasks")
