"""add document artifacts metadata table

Revision ID: 0013_document_artifacts
Revises: 0012_product_soft_delete
Create Date: 2026-03-29 01:15:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0013_document_artifacts"
down_revision: Union[str, None] = "0012_product_soft_delete"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "document_artifacts" in tables:
        return

    op.create_table(
        "document_artifacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("artifact_key", sa.String(length=160), nullable=False),
        sa.Column("module_name", sa.String(length=40), nullable=False),
        sa.Column("document_type", sa.String(length=40), nullable=False),
        sa.Column("business_key", sa.String(length=120), nullable=False),
        sa.Column("version_kind", sa.String(length=20), nullable=False),
        sa.Column("is_live", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=False),
        sa.Column("template_name", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_document_artifacts_artifact_key", "document_artifacts", ["artifact_key"], unique=True)
    op.create_index("ix_document_artifacts_module_name", "document_artifacts", ["module_name"], unique=False)
    op.create_index("ix_document_artifacts_document_type", "document_artifacts", ["document_type"], unique=False)
    op.create_index("ix_document_artifacts_business_key", "document_artifacts", ["business_key"], unique=False)
    op.create_index("ix_document_artifacts_version_kind", "document_artifacts", ["version_kind"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "document_artifacts" not in tables:
        return

    op.drop_index("ix_document_artifacts_version_kind", table_name="document_artifacts")
    op.drop_index("ix_document_artifacts_business_key", table_name="document_artifacts")
    op.drop_index("ix_document_artifacts_document_type", table_name="document_artifacts")
    op.drop_index("ix_document_artifacts_module_name", table_name="document_artifacts")
    op.drop_index("ix_document_artifacts_artifact_key", table_name="document_artifacts")
    op.drop_table("document_artifacts")
