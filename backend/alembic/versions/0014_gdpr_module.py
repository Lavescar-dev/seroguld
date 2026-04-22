"""add gdpr operational module tables

Revision ID: 0014_gdpr_module
Revises: 0013_document_artifacts
Create Date: 2026-04-02 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0014_gdpr_module"
down_revision: Union[str, None] = "0013_document_artifacts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _column_names(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(inspector, table_name: str, index_name: str) -> bool:
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "users" in tables:
        user_columns = _column_names(inspector, "users")
        if "gdpr_status" not in user_columns:
            op.add_column("users", sa.Column("gdpr_status", sa.String(length=30), nullable=False, server_default="active"))
        if "gdpr_pseudonymized_at" not in user_columns:
            op.add_column("users", sa.Column("gdpr_pseudonymized_at", sa.DateTime(timezone=True), nullable=True))
        if "marketing_opt_out_at" not in user_columns:
            op.add_column("users", sa.Column("marketing_opt_out_at", sa.DateTime(timezone=True), nullable=True))
        if "last_gdpr_request_at" not in user_columns:
            op.add_column("users", sa.Column("last_gdpr_request_at", sa.DateTime(timezone=True), nullable=True))

    if "gdpr_requests" not in tables:
        op.create_table(
            "gdpr_requests",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("reference_number", sa.String(length=40), nullable=False),
            sa.Column("request_type", sa.String(length=40), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default="submitted"),
            sa.Column("channel", sa.String(length=30), nullable=False, server_default="public_page"),
            sa.Column("subject_name", sa.String(length=200), nullable=True),
            sa.Column("subject_email", sa.String(length=200), nullable=True),
            sa.Column("subject_phone", sa.String(length=30), nullable=True),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("verified_customer_id", sa.Uuid(), nullable=True),
            sa.Column("public_tracking_token", sa.String(length=160), nullable=False),
            sa.Column("public_tracking_token_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_reason", sa.Text(), nullable=True),
            sa.Column("request_meta", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["verified_customer_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_gdpr_requests_reference_number", "gdpr_requests", ["reference_number"], unique=True)
        op.create_index("ix_gdpr_requests_request_type", "gdpr_requests", ["request_type"], unique=False)
        op.create_index("ix_gdpr_requests_status", "gdpr_requests", ["status"], unique=False)
        op.create_index("ix_gdpr_requests_subject_email", "gdpr_requests", ["subject_email"], unique=False)
        op.create_index("ix_gdpr_requests_subject_phone", "gdpr_requests", ["subject_phone"], unique=False)
        op.create_index("ix_gdpr_requests_verified_customer_id", "gdpr_requests", ["verified_customer_id"], unique=False)
        op.create_index("ix_gdpr_requests_public_tracking_token", "gdpr_requests", ["public_tracking_token"], unique=True)

    if "gdpr_request_events" not in tables:
        op.create_table(
            "gdpr_request_events",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("request_id", sa.Uuid(), nullable=False),
            sa.Column("event_type", sa.String(length=40), nullable=False),
            sa.Column("actor_type", sa.String(length=30), nullable=False, server_default="system"),
            sa.Column("actor_user_id", sa.Uuid(), nullable=True),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("payload_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["request_id"], ["gdpr_requests.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_gdpr_request_events_request_id", "gdpr_request_events", ["request_id"], unique=False)
        op.create_index("ix_gdpr_request_events_event_type", "gdpr_request_events", ["event_type"], unique=False)
        op.create_index("ix_gdpr_request_events_actor_user_id", "gdpr_request_events", ["actor_user_id"], unique=False)

    if "gdpr_retention_policies" not in tables:
        op.create_table(
            "gdpr_retention_policies",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("policy_key", sa.String(length=60), nullable=False),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("applies_to", sa.String(length=120), nullable=False),
            sa.Column("action", sa.String(length=40), nullable=False),
            sa.Column("retention_days", sa.Integer(), nullable=False),
            sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_gdpr_retention_policies_policy_key", "gdpr_retention_policies", ["policy_key"], unique=True)

    if "gdpr_processors" not in tables:
        op.create_table(
            "gdpr_processors",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("processor_key", sa.String(length=60), nullable=False),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("category", sa.String(length=60), nullable=False),
            sa.Column("system_name", sa.String(length=120), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default="configured"),
            sa.Column("configured", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("endpoint_url", sa.Text(), nullable=True),
            sa.Column("detail", sa.Text(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_gdpr_processors_processor_key", "gdpr_processors", ["processor_key"], unique=True)

    if "gdpr_jobs" not in tables:
        op.create_table(
            "gdpr_jobs",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("request_id", sa.Uuid(), nullable=True),
            sa.Column("job_type", sa.String(length=40), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default="queued"),
            sa.Column("payload_json", sa.JSON(), nullable=False),
            sa.Column("result_json", sa.JSON(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["request_id"], ["gdpr_requests.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_gdpr_jobs_request_id", "gdpr_jobs", ["request_id"], unique=False)
        op.create_index("ix_gdpr_jobs_job_type", "gdpr_jobs", ["job_type"], unique=False)
        op.create_index("ix_gdpr_jobs_status", "gdpr_jobs", ["status"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)

    if "gdpr_jobs" in tables:
        for name in ("ix_gdpr_jobs_status", "ix_gdpr_jobs_job_type", "ix_gdpr_jobs_request_id"):
            if _has_index(inspector, "gdpr_jobs", name):
                op.drop_index(name, table_name="gdpr_jobs")
        op.drop_table("gdpr_jobs")

    if "gdpr_processors" in tables:
        if _has_index(inspector, "gdpr_processors", "ix_gdpr_processors_processor_key"):
            op.drop_index("ix_gdpr_processors_processor_key", table_name="gdpr_processors")
        op.drop_table("gdpr_processors")

    if "gdpr_retention_policies" in tables:
        if _has_index(inspector, "gdpr_retention_policies", "ix_gdpr_retention_policies_policy_key"):
            op.drop_index("ix_gdpr_retention_policies_policy_key", table_name="gdpr_retention_policies")
        op.drop_table("gdpr_retention_policies")

    if "gdpr_request_events" in tables:
        for name in (
            "ix_gdpr_request_events_actor_user_id",
            "ix_gdpr_request_events_event_type",
            "ix_gdpr_request_events_request_id",
        ):
            if _has_index(inspector, "gdpr_request_events", name):
                op.drop_index(name, table_name="gdpr_request_events")
        op.drop_table("gdpr_request_events")

    if "gdpr_requests" in tables:
        for name in (
            "ix_gdpr_requests_public_tracking_token",
            "ix_gdpr_requests_verified_customer_id",
            "ix_gdpr_requests_subject_phone",
            "ix_gdpr_requests_subject_email",
            "ix_gdpr_requests_status",
            "ix_gdpr_requests_request_type",
            "ix_gdpr_requests_reference_number",
        ):
            if _has_index(inspector, "gdpr_requests", name):
                op.drop_index(name, table_name="gdpr_requests")
        op.drop_table("gdpr_requests")

    inspector = sa.inspect(bind)
    tables = _table_names(inspector)
    if "users" in tables:
        user_columns = _column_names(inspector, "users")
        for column_name in (
            "last_gdpr_request_at",
            "marketing_opt_out_at",
            "gdpr_pseudonymized_at",
            "gdpr_status",
        ):
            if column_name in user_columns:
                op.drop_column("users", column_name)
