"""add a standalone WooCommerce catalog

Revision ID: 0033_woocommerce_catalog
Revises: 0032_august_schema_reconciliation

The remote shop catalog is deliberately separate from the operational Product
inventory.  Synchronization never creates, updates, or deletes Product rows.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0033_woocommerce_catalog"
down_revision: Union[str, None] = "0032_august_schema_reconciliation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "woocommerce_catalog_state",
        sa.Column("catalog_key", sa.String(length=40), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("remote_published_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("catalog_key"),
    )
    op.create_table(
        "woocommerce_catalog_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("woocommerce_product_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=True),
        sa.Column("sku", sa.String(length=120), nullable=True),
        sa.Column("permalink", sa.Text(), nullable=True),
        sa.Column("remote_status", sa.String(length=30), nullable=False, server_default="publish"),
        sa.Column("catalog_visibility", sa.String(length=30), nullable=True),
        sa.Column("stock_status", sa.String(length=30), nullable=True),
        sa.Column("stock_quantity", sa.Integer(), nullable=True),
        sa.Column("price_dkk", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("regular_price_dkk", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("sale_price_dkk", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("weight_raw", sa.String(length=80), nullable=True),
        sa.Column("weight_grams", sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column("weight_missing", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("manual_review_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("manual_review_reasons", sa.JSON(), nullable=False),
        sa.Column("photo_missing", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("images_json", sa.JSON(), nullable=False),
        sa.Column("categories_json", sa.JSON(), nullable=False),
        sa.Column("source_payload_json", sa.JSON(), nullable=False),
        sa.Column("source_payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("remote_created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remote_modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("linked_product_id", sa.Uuid(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["linked_product_id"], ["products.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("linked_product_id", name="uq_woocommerce_catalog_items_linked_product"),
        sa.UniqueConstraint("woocommerce_product_id", name="uq_woocommerce_catalog_items_remote_product"),
    )
    op.create_index(
        "ix_woocommerce_catalog_items_woocommerce_product_id",
        "woocommerce_catalog_items",
        ["woocommerce_product_id"],
        unique=False,
    )
    op.create_index("ix_woocommerce_catalog_items_is_active", "woocommerce_catalog_items", ["is_active"], unique=False)
    op.create_index(
        "ix_woocommerce_catalog_items_manual_review_required",
        "woocommerce_catalog_items",
        ["manual_review_required"],
        unique=False,
    )
    op.create_index(
        "ix_woocommerce_catalog_items_photo_missing",
        "woocommerce_catalog_items",
        ["photo_missing"],
        unique=False,
    )
    op.create_index(
        "ix_woocommerce_catalog_items_linked_product_id",
        "woocommerce_catalog_items",
        ["linked_product_id"],
        unique=False,
    )
def downgrade() -> None:
    op.drop_index("ix_woocommerce_catalog_items_linked_product_id", table_name="woocommerce_catalog_items")
    op.drop_index("ix_woocommerce_catalog_items_photo_missing", table_name="woocommerce_catalog_items")
    op.drop_index("ix_woocommerce_catalog_items_manual_review_required", table_name="woocommerce_catalog_items")
    op.drop_index("ix_woocommerce_catalog_items_is_active", table_name="woocommerce_catalog_items")
    op.drop_index("ix_woocommerce_catalog_items_woocommerce_product_id", table_name="woocommerce_catalog_items")
    op.drop_table("woocommerce_catalog_items")
    op.drop_table("woocommerce_catalog_state")
