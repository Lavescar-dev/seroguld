"""add editable customer notes with immutable revision history

Revision ID: 0026_customer_notes_and_audit
Revises: 0025_historical_afg_import
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0026_customer_notes_and_audit"
down_revision: Union[str, None] = "0025_historical_afg_import"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "customer_notes" not in tables:
        op.create_table(
            "customer_notes",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("customer_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("author_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_customer_notes_customer_id", "customer_notes", ["customer_id"])
        op.create_index("ix_customer_notes_author_user_id", "customer_notes", ["author_user_id"])
        op.create_index("ix_customer_notes_deleted_at", "customer_notes", ["deleted_at"])
    if "customer_note_revisions" not in tables:
        op.create_table(
            "customer_note_revisions",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("note_id", sa.Uuid(), sa.ForeignKey("customer_notes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("customer_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("actor_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("action", sa.String(length=20), nullable=False),
            sa.Column("body_snapshot", sa.Text(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_customer_note_revisions_note_id", "customer_note_revisions", ["note_id"])
        op.create_index("ix_customer_note_revisions_customer_id", "customer_note_revisions", ["customer_id"])
    # Partially adopted databases can contain either table with only a subset
    # of its indexes.  Add missing indexes independently and leave data alone.
    inspector = sa.inspect(op.get_bind())
    for table, definitions in {
        "customer_notes": {
            "ix_customer_notes_customer_id": ["customer_id"],
            "ix_customer_notes_author_user_id": ["author_user_id"],
            "ix_customer_notes_deleted_at": ["deleted_at"],
        },
        "customer_note_revisions": {
            "ix_customer_note_revisions_note_id": ["note_id"],
            "ix_customer_note_revisions_customer_id": ["customer_id"],
        },
    }.items():
        if table not in inspector.get_table_names():
            continue
        existing = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table)}
        for name, columns in definitions.items():
            if name not in existing:
                op.create_index(name, table, columns)


def downgrade() -> None:
    # Notes and their immutable history are audit data; preserve them when an
    # older migration marker is restored.
    return
