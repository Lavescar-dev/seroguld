"""add uniconta sync fields to pos_documents

Revision ID: 0016_pos_document_uniconta_sync
Revises: 0015_gdpr_runner_and_woo_customer_map
Create Date: 2026-05-12 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0016_pos_document_uniconta_sync"
down_revision: Union[str, None] = "0015_gdpr_runner_and_woo_customer_map"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("pos_documents") as batch_op:
        batch_op.add_column(sa.Column("uniconta_sync_status", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("uniconta_invoice_number", sa.String(length=40), nullable=True))
        batch_op.add_column(sa.Column("uniconta_account", sa.String(length=40), nullable=True))
        batch_op.add_column(sa.Column("uniconta_invoice_date", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("uniconta_pdf_path", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("uniconta_synced_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("uniconta_sync_error", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("pos_documents") as batch_op:
        batch_op.drop_column("uniconta_sync_error")
        batch_op.drop_column("uniconta_synced_at")
        batch_op.drop_column("uniconta_pdf_path")
        batch_op.drop_column("uniconta_invoice_date")
        batch_op.drop_column("uniconta_account")
        batch_op.drop_column("uniconta_invoice_number")
        batch_op.drop_column("uniconta_sync_status")
