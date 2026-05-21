"""pos_document_audit trail tablosu

Revision ID: 0018_pos_document_audit
Revises: 0017_pos_session_customer_ondelete
Create Date: 2026-05-14 18:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0018_pos_document_audit"
down_revision: Union[str, None] = "0017_pos_session_customer_ondelete"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "pos_document_audit",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("sequence_no", sa.Integer(), nullable=True, index=True),
        sa.Column(
            "pos_session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("pos_sessions.id"),
            nullable=True,
            index=True,
        ),
        sa.Column("action", sa.String(40), nullable=False, index=True),
        sa.Column(
            "actor_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
            index=True,
        ),
        sa.Column("actor_email", sa.String(200), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("request_ip", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("pos_document_audit")
