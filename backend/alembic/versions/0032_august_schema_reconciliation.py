"""reconcile August application objects omitted by retired migration chains

Revision ID: 0032_august_schema_reconciliation
Revises: 0031_legacy_missing_tables_reconciliation

Some desktop builds stamped a migration marker after creating only a subset of
the August schema.  This final, guarded migration adopts the canonical objects
without replacing tables or rewriting customer rows.  Identity uniqueness is
fail-closed: duplicate hashes abort before any city/index change is written.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0032_august_schema_reconciliation"
down_revision: Union[str, None] = "0031_legacy_missing_tables_reconciliation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _tables() -> set[str]:
    return set(_inspector().get_table_names())


def _columns(table: str) -> set[str]:
    if table not in _tables():
        return set()
    return {str(column["name"]) for column in _inspector().get_columns(table)}


def _indexes(table: str) -> set[str]:
    if table not in _tables():
        return set()
    return {str(index["name"]) for index in _inspector().get_indexes(table) if index.get("name")}


def _add_columns(table: str, columns: list[sa.Column]) -> None:
    if table not in _tables():
        return
    existing = _columns(table)
    missing = [column for column in columns if column.name not in existing]
    if not missing:
        return
    with op.batch_alter_table(table) as batch_op:
        for column in missing:
            batch_op.add_column(column)


def _ensure_existing_columns(table: str, columns: list[sa.Column]) -> None:
    """Adopt a partially-created table without replacing its rows."""

    if table in _tables():
        _add_columns(table, columns)


def _ensure_indexes(table: str, definitions: dict[str, tuple[list[str], bool]]) -> None:
    if table not in _tables():
        return
    existing = _indexes(table)
    for name, (columns, unique) in definitions.items():
        if name not in existing:
            op.create_index(name, table, columns, unique=unique)


def _ensure_cancel_and_snapshot_objects() -> None:
    if "pos_documents" not in _tables():
        return
    _add_columns(
        "pos_documents",
        [
            sa.Column("uniconta_credit_note_number", sa.String(length=40), nullable=True),
            sa.Column("uniconta_cancelled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("uniconta_cancel_reason", sa.Text(), nullable=True),
            sa.Column("customer_postal_code", sa.String(length=4), nullable=True),
            sa.Column("customer_city", sa.String(length=120), nullable=True),
        ],
    )


def _ensure_artifact_revision() -> None:
    if "document_artifacts" not in _tables() or "revision" in _columns("document_artifacts"):
        return
    _add_columns(
        "document_artifacts",
        [sa.Column("revision", sa.Integer(), nullable=False, server_default="1")],
    )


def _raise_on_duplicate_identity_hashes() -> None:
    bind = op.get_bind()
    tables = _tables()
    if "users" in tables and {"cpr_hash", "role"}.issubset(_columns("users")):
        duplicate = bind.execute(
            sa.text(
                "SELECT 1 FROM users "
                "WHERE cpr_hash IS NOT NULL AND role = 'customer' "
                "GROUP BY cpr_hash HAVING COUNT(*) > 1 LIMIT 1"
            )
        ).first()
        if duplicate is not None:
            raise RuntimeError(
                "Migration aborted: duplicate customer CPR hashes exist. "
                "Resolve the affected customer records manually; no records were merged."
            )
    if "customer_identity_documents" in tables and "identity_doc_number_hash" in _columns("customer_identity_documents"):
        duplicate = bind.execute(
            sa.text(
                "SELECT 1 FROM customer_identity_documents "
                "WHERE identity_doc_number_hash IS NOT NULL "
                "GROUP BY identity_doc_number_hash HAVING COUNT(*) > 1 LIMIT 1"
            )
        ).first()
        if duplicate is not None:
            raise RuntimeError(
                "Migration aborted: duplicate identity-document hashes exist. "
                "Resolve the affected identity records manually; no records were merged."
            )


def _ensure_identity_guards() -> None:
    tables = _tables()
    if "users" not in tables:
        return
    # Preflight must happen before adding city or either unique index.
    _raise_on_duplicate_identity_hashes()
    if "city" not in _columns("users"):
        _add_columns("users", [sa.Column("city", sa.String(length=120), nullable=True)])
    bind = op.get_bind()
    dialect = bind.dialect.name
    user_indexes = _indexes("users")
    # SQLite/PostgreSQL support partial unique indexes.  Do not create a
    # temporary unfiltered unique index: non-customer rows may legitimately
    # share a CPR hash and that transient index would reject valid data.
    if {"cpr_hash", "role"}.issubset(_columns("users")):
        kwargs = {}
        if dialect in {"sqlite", "postgresql"}:
            kwargs = {
                "sqlite_where": sa.text("cpr_hash IS NOT NULL AND role = 'customer'"),
                "postgresql_where": sa.text("cpr_hash IS NOT NULL AND role = 'customer'"),
            }
        if "uq_users_customer_cpr_hash" not in user_indexes:
            op.create_index("uq_users_customer_cpr_hash", "users", ["cpr_hash"], unique=True, **kwargs)
    if "customer_identity_documents" in _tables() and "identity_doc_number_hash" in _columns("customer_identity_documents"):
        identity_indexes = _indexes("customer_identity_documents")
        kwargs = {}
        if dialect in {"sqlite", "postgresql"}:
            kwargs = {
                "sqlite_where": sa.text("identity_doc_number_hash IS NOT NULL"),
                "postgresql_where": sa.text("identity_doc_number_hash IS NOT NULL"),
            }
        if "uq_customer_identity_documents_doc_hash" not in identity_indexes:
            op.create_index("uq_customer_identity_documents_doc_hash", "customer_identity_documents", ["identity_doc_number_hash"], unique=True, **kwargs)


def _ensure_historical_afg_objects() -> None:
    if "pos_documents" not in _tables():
        return
    _add_columns(
        "pos_documents",
        [
            sa.Column("legacy_document_number", sa.String(length=80), nullable=True),
            sa.Column("historical_import_hash", sa.String(length=64), nullable=True),
            sa.Column("historical_imported_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("historical_imported_by", sa.Uuid(), nullable=True),
        ],
    )
    # Add the FK only when the column and users table exist and no equivalent
    # constraint was inherited from an earlier migration.
    if "users" in _tables() and "historical_imported_by" in _columns("pos_documents"):
        foreign_keys = _inspector().get_foreign_keys("pos_documents")
        names = {str(item.get("name")) for item in foreign_keys if item.get("name")}
        equivalent = any(
            item.get("referred_table") == "users"
            and item.get("constrained_columns") == ["historical_imported_by"]
            and item.get("referred_columns") == ["id"]
            for item in foreign_keys
        )
        if "fk_pos_documents_historical_imported_by_users" not in names and not equivalent:
            with op.batch_alter_table("pos_documents") as batch_op:
                batch_op.create_foreign_key(
                    "fk_pos_documents_historical_imported_by_users",
                    "users",
                    ["historical_imported_by"],
                    ["id"],
                )
    _ensure_indexes(
        "pos_documents",
        {
            "uq_pos_documents_legacy_document_number": (["legacy_document_number"], True),
            "uq_pos_documents_historical_import_hash": (["historical_import_hash"], True),
            "ix_pos_documents_historical_imported_by": (["historical_imported_by"], False),
        },
    )


def _ensure_gdpr_copy_tasks() -> None:
    tables = _tables()
    if "gdpr_copy_tasks" in tables:
        _ensure_existing_columns(
            "gdpr_copy_tasks",
            [
                sa.Column("request_id", sa.Uuid(), nullable=True),
                sa.Column("task_key", sa.String(length=80), nullable=True),
                sa.Column("system_name", sa.String(length=120), nullable=True),
                sa.Column("copy_scope", sa.String(length=200), nullable=True),
                sa.Column("applicable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
                sa.Column("status", sa.String(length=40), nullable=False, server_default="pending"),
                sa.Column("reason", sa.Text(), nullable=True),
                sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
                sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            ],
        )
        _ensure_indexes(
            "gdpr_copy_tasks",
            {
                "ix_gdpr_copy_tasks_request_id": (["request_id"], False),
                "ix_gdpr_copy_tasks_status": (["status"], False),
            },
        )
        return
    if "gdpr_requests" not in tables:
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
    _ensure_indexes(
        "gdpr_copy_tasks",
        {
            "ix_gdpr_copy_tasks_request_id": (["request_id"], False),
            "ix_gdpr_copy_tasks_status": (["status"], False),
        },
    )


def _ensure_notes() -> None:
    tables = _tables()
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
    else:
        _ensure_existing_columns(
            "customer_notes",
            [
                sa.Column("customer_id", sa.Uuid(), nullable=True),
                sa.Column("author_user_id", sa.Uuid(), nullable=True),
                sa.Column("body", sa.Text(), nullable=True),
                sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
                sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            ],
        )
    if "customer_note_revisions" not in tables and "customer_notes" in _tables():
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
    elif "customer_note_revisions" in _tables():
        _ensure_existing_columns(
            "customer_note_revisions",
            [
                sa.Column("note_id", sa.Uuid(), nullable=True),
                sa.Column("customer_id", sa.Uuid(), nullable=True),
                sa.Column("actor_user_id", sa.Uuid(), nullable=True),
                sa.Column("action", sa.String(length=20), nullable=True),
                sa.Column("body_snapshot", sa.Text(), nullable=True),
                sa.Column("version", sa.Integer(), nullable=True),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
            ],
        )
    _ensure_indexes(
        "customer_notes",
        {
            "ix_customer_notes_customer_id": (["customer_id"], False),
            "ix_customer_notes_author_user_id": (["author_user_id"], False),
            "ix_customer_notes_deleted_at": (["deleted_at"], False),
        },
    )
    _ensure_indexes(
        "customer_note_revisions",
        {
            "ix_customer_note_revisions_note_id": (["note_id"], False),
            "ix_customer_note_revisions_customer_id": (["customer_id"], False),
        },
    )


def _ensure_legacy_migration_center() -> None:
    tables = _tables()
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
    else:
        _ensure_existing_columns(
            "legacy_migration_runs",
            [
                sa.Column("status", sa.String(24), nullable=False, server_default="in_progress"),
                sa.Column("current_phase", sa.String(16), nullable=False, server_default="afg"),
                sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
                sa.Column("settings_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
                sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            ],
        )
    if "legacy_migration_files" not in tables and "legacy_migration_runs" in _tables():
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
    elif "legacy_migration_files" in _tables():
        _ensure_existing_columns(
            "legacy_migration_files",
            [
                sa.Column("run_id", sa.Uuid(), nullable=True),
                sa.Column("phase", sa.String(16), nullable=False, server_default="afg"),
                sa.Column("file_name", sa.String(255), nullable=False, server_default=""),
                sa.Column("sha256", sa.String(64), nullable=False, server_default=""),
                sa.Column("stored_path", sa.Text(), nullable=False, server_default=""),
                sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
                sa.Column("status", sa.String(24), nullable=False, server_default="uploaded"),
                sa.Column("summary_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
                sa.Column("error_text", sa.Text(), nullable=True),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
                sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True),
            ],
        )
    if "legacy_migration_records" not in tables and "legacy_migration_files" in _tables():
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
    elif "legacy_migration_records" in _tables():
        _ensure_existing_columns(
            "legacy_migration_records",
            [
                sa.Column("file_id", sa.Uuid(), nullable=True),
                sa.Column("source_key", sa.String(255), nullable=False, server_default=""),
                sa.Column("entity_type", sa.String(32), nullable=False, server_default=""),
                sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
                sa.Column("payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
                sa.Column("warnings_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
                sa.Column("errors_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
                sa.Column("resolution_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            ],
        )
    if "legacy_migration_links" not in tables and "legacy_migration_records" in _tables() and "legacy_migration_runs" in _tables():
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
    elif "legacy_migration_links" in _tables():
        _ensure_existing_columns(
            "legacy_migration_links",
            [
                sa.Column("run_id", sa.Uuid(), nullable=True),
                sa.Column("record_id", sa.Uuid(), nullable=True),
                sa.Column("source_key", sa.String(255), nullable=False, server_default=""),
                sa.Column("entity_type", sa.String(32), nullable=False, server_default=""),
                sa.Column("entity_id", sa.String(64), nullable=False, server_default=""),
                sa.Column("before_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
                sa.Column("after_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            ],
        )
    _ensure_indexes(
        "legacy_migration_runs",
        {
            "ix_legacy_migration_runs_status": (["status"], False),
            "ix_legacy_migration_runs_created_by": (["created_by_user_id"], False),
        },
    )
    _ensure_indexes(
        "legacy_migration_files",
        {
            "ix_legacy_migration_files_run": (["run_id"], False),
            "ix_legacy_migration_files_phase": (["phase"], False),
            "ix_legacy_migration_files_status": (["status"], False),
            "ix_legacy_migration_files_sha256": (["sha256"], False),
        },
    )
    _ensure_indexes(
        "legacy_migration_records",
        {
            "ix_legacy_migration_records_file": (["file_id"], False),
            "ix_legacy_migration_records_source": (["source_key"], False),
            "ix_legacy_migration_records_status": (["status"], False),
        },
    )
    _ensure_indexes(
        "legacy_migration_links",
        {
            "ix_legacy_migration_links_run": (["run_id"], False),
            "ix_legacy_migration_links_entity": (["entity_id"], False),
        },
    )


def upgrade() -> None:
    # Order matters only for dependency creation; all helpers are individually
    # guarded so a partially adopted database can be upgraded safely.
    _ensure_cancel_and_snapshot_objects()
    _ensure_artifact_revision()
    _ensure_gdpr_copy_tasks()
    _ensure_identity_guards()
    _ensure_historical_afg_objects()
    _ensure_notes()
    _ensure_legacy_migration_center()


def downgrade() -> None:
    # Compatibility reconciliation is intentionally non-destructive.
    return
