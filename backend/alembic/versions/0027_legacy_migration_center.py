"""add persistent legacy Excel migration center

Revision ID: 0027_legacy_migration_center
Revises: 0026_customer_notes_and_audit
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0027_legacy_migration_center"
down_revision: Union[str, None] = "0026_customer_notes_and_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "legacy_migration_runs" not in tables:
        op.create_table(
            "legacy_migration_runs",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("status", sa.String(24), nullable=False),
            sa.Column("current_phase", sa.String(16), nullable=False),
            sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("settings_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_legacy_migration_runs_status", "legacy_migration_runs", ["status"])
        op.create_index("ix_legacy_migration_runs_created_by", "legacy_migration_runs", ["created_by_user_id"])
    if "legacy_migration_files" not in tables:
        op.create_table(
            "legacy_migration_files",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("run_id", sa.Uuid(), sa.ForeignKey("legacy_migration_runs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("phase", sa.String(16), nullable=False),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            sa.Column("stored_path", sa.Text(), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(24), nullable=False),
            sa.Column("summary_json", sa.JSON(), nullable=False),
            sa.Column("error_text", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("run_id", "phase", "sha256", name="uq_legacy_migration_file_run_phase_hash"),
        )
        op.create_index("ix_legacy_migration_files_run", "legacy_migration_files", ["run_id"])
        op.create_index("ix_legacy_migration_files_phase", "legacy_migration_files", ["phase"])
        op.create_index("ix_legacy_migration_files_status", "legacy_migration_files", ["status"])
        op.create_index("ix_legacy_migration_files_sha256", "legacy_migration_files", ["sha256"])
    if "legacy_migration_records" not in tables:
        op.create_table(
            "legacy_migration_records",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("file_id", sa.Uuid(), sa.ForeignKey("legacy_migration_files.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_key", sa.String(255), nullable=False),
            sa.Column("entity_type", sa.String(32), nullable=False),
            sa.Column("status", sa.String(24), nullable=False),
            sa.Column("payload_json", sa.JSON(), nullable=False),
            sa.Column("warnings_json", sa.JSON(), nullable=False),
            sa.Column("errors_json", sa.JSON(), nullable=False),
            sa.Column("resolution_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("file_id", "source_key", name="uq_legacy_migration_record_file_source"),
        )
        op.create_index("ix_legacy_migration_records_file", "legacy_migration_records", ["file_id"])
        op.create_index("ix_legacy_migration_records_source", "legacy_migration_records", ["source_key"])
        op.create_index("ix_legacy_migration_records_status", "legacy_migration_records", ["status"])
    if "legacy_migration_links" not in tables:
        op.create_table(
            "legacy_migration_links",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("run_id", sa.Uuid(), sa.ForeignKey("legacy_migration_runs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("record_id", sa.Uuid(), sa.ForeignKey("legacy_migration_records.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_key", sa.String(255), nullable=False),
            sa.Column("entity_type", sa.String(32), nullable=False),
            sa.Column("entity_id", sa.String(64), nullable=False),
            sa.Column("before_json", sa.JSON(), nullable=False),
            sa.Column("after_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("source_key", name="uq_legacy_migration_link_source_key"),
            sa.UniqueConstraint("record_id", name="uq_legacy_migration_link_record"),
        )
        op.create_index("ix_legacy_migration_links_run", "legacy_migration_links", ["run_id"])
        op.create_index("ix_legacy_migration_links_entity", "legacy_migration_links", ["entity_id"])
    # Adopt a partially-created migration center as well; retired builds may
    # have committed tables before their index phase completed.
    inspector = sa.inspect(op.get_bind())
    definitions = {
        "legacy_migration_runs": {
            "ix_legacy_migration_runs_status": ["status"],
            "ix_legacy_migration_runs_created_by": ["created_by_user_id"],
        },
        "legacy_migration_files": {
            "ix_legacy_migration_files_run": ["run_id"],
            "ix_legacy_migration_files_phase": ["phase"],
            "ix_legacy_migration_files_status": ["status"],
            "ix_legacy_migration_files_sha256": ["sha256"],
        },
        "legacy_migration_records": {
            "ix_legacy_migration_records_file": ["file_id"],
            "ix_legacy_migration_records_source": ["source_key"],
            "ix_legacy_migration_records_status": ["status"],
        },
        "legacy_migration_links": {
            "ix_legacy_migration_links_run": ["run_id"],
            "ix_legacy_migration_links_entity": ["entity_id"],
        },
    }
    for table, table_indexes in definitions.items():
        if table not in inspector.get_table_names():
            continue
        existing = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table)}
        for name, columns in table_indexes.items():
            if name not in existing:
                op.create_index(name, table, columns)


def downgrade() -> None:
    # Migration manifests and source links are recovery/audit data.  Keep the
    # tables on compatibility downgrade rather than making a rollback lossy.
    return
