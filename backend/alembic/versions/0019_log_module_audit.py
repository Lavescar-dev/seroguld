"""log module: lot status + history + line→lot link

Revision ID: 0019_log_module_audit
Revises: 0018_pos_document_audit
Create Date: 2026-05-15 10:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0019_log_module_audit"
down_revision: Union[str, None] = "0018_pos_document_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # AfgMeltLot lifecycle alanları
    with op.batch_alter_table("afg_melt_lots") as batch_op:
        batch_op.add_column(
            sa.Column("status", sa.String(20), nullable=False, server_default="draft")
        )
        batch_op.add_column(
            sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("finalized_by_user_id", sa.Uuid(as_uuid=True), nullable=True)
        )
        batch_op.create_index(
            "ix_afg_melt_lots_status", ["status"]
        )

    # AfgMeltLotHistory tablosu
    op.create_table(
        "afg_melt_lot_history",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "lot_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("afg_melt_lots.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("action", sa.String(40), nullable=False, index=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("performed_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("performed_by_email", sa.String(200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # TransactionLine.melt_lot_id
    with op.batch_alter_table("transaction_lines") as batch_op:
        batch_op.add_column(
            sa.Column("melt_lot_id", sa.Uuid(as_uuid=True), nullable=True)
        )
        batch_op.create_index(
            "ix_transaction_lines_melt_lot_id", ["melt_lot_id"]
        )
        # SQLite FK desteği için isimli constraint
        batch_op.create_foreign_key(
            "fk_transaction_lines_melt_lot_id_afg_melt_lots",
            "afg_melt_lots",
            ["melt_lot_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("transaction_lines") as batch_op:
        batch_op.drop_constraint(
            "fk_transaction_lines_melt_lot_id_afg_melt_lots", type_="foreignkey"
        )
        batch_op.drop_index("ix_transaction_lines_melt_lot_id")
        batch_op.drop_column("melt_lot_id")

    op.drop_table("afg_melt_lot_history")

    with op.batch_alter_table("afg_melt_lots") as batch_op:
        batch_op.drop_index("ix_afg_melt_lots_status")
        batch_op.drop_column("finalized_by_user_id")
        batch_op.drop_column("finalized_at")
        batch_op.drop_column("status")
