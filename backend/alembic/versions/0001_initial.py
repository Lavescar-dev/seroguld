"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-02-25 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.migration_helpers import create_enum, drop_enum, enum_type, json_default, json_type, now_default, uuid_type

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    role_enum = enum_type("admin", "customer", name="role_enum")
    product_type_enum = enum_type(
        "bracelet",
        "ring",
        "necklace",
        "earring",
        "chain",
        "bar",
        "jewelry",
        name="product_type_enum",
    )
    metal_type_enum = enum_type(
        "yellow_gold",
        "white_gold",
        "silver",
        "platinum",
        "palladium",
        name="metal_type_enum",
    )
    product_status_enum = enum_type(
        "purchased",
        "in_inventory",
        "for_sale",
        "sold",
        "melted",
        "undecided",
        name="product_status_enum",
    )

    create_enum(role_enum)
    create_enum(product_type_enum)
    create_enum(metal_type_enum)
    create_enum(product_status_enum)

    op.create_table(
        "users",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("email", sa.String(length=200), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("role", role_enum, nullable=False),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("address_encrypted", sa.Text(), nullable=True),
        sa.Column("cpr_number_encrypted", sa.Text(), nullable=True),
        sa.Column("cpr_hash", sa.String(length=128), nullable=True),
        sa.Column("cpr_last4", sa.String(length=4), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=False)
    op.create_index("ix_users_phone", "users", ["phone"], unique=False)
    op.create_index("ix_users_cpr_hash", "users", ["cpr_hash"], unique=False)

    op.create_table(
        "products",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("product_number", sa.String(length=4), nullable=False),
        sa.Column("reference_number", sa.String(length=10), nullable=True),
        sa.Column("product_type", product_type_enum, nullable=False),
        sa.Column("metal_type", metal_type_enum, nullable=False),
        sa.Column("weight_grams", sa.Numeric(10, 2), nullable=False),
        sa.Column("purity_karat", sa.String(length=10), nullable=True),
        sa.Column("purity_percentage", sa.Numeric(5, 2), nullable=True),
        sa.Column("pure_gold_grams", sa.Numeric(10, 2), nullable=True),
        sa.Column("purchase_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("purchase_price_dkk", sa.Numeric(12, 2), nullable=False),
        sa.Column("gold_rate_at_purchase", sa.Numeric(10, 2), nullable=True),
        sa.Column("commission", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("seller_customer_id", uuid_type(), nullable=True),
        sa.Column("gdpr_release_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_gdpr_locked", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("status", product_status_enum, nullable=False, server_default="purchased"),
        sa.Column("sale_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sale_price_dkk", sa.Numeric(12, 2), nullable=True),
        sa.Column("buyer_customer_id", uuid_type(), nullable=True),
        sa.Column("profit_dkk", sa.Numeric(12, 2), nullable=True),
        sa.Column("melt_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("melt_reason", sa.String(length=200), nullable=True),
        sa.Column("ai_description", sa.Text(), nullable=True),
        sa.Column("ai_description_approved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("woocommerce_product_id", sa.Integer(), nullable=True),
        sa.Column("is_published_to_site", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("photos", json_type(), nullable=False, server_default=json_default([])),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("storage_location", sa.String(length=100), nullable=True),
        sa.Column("needs_cleaning", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.ForeignKeyConstraint(["buyer_customer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["seller_customer_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_number"),
    )
    op.create_index("ix_products_product_number", "products", ["product_number"], unique=False)

    op.create_table(
        "product_history",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("product_id", uuid_type(), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("old_value", json_type(), nullable=True),
        sa.Column("new_value", json_type(), nullable=True),
        sa.Column("performed_by", uuid_type(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.ForeignKeyConstraint(["performed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_product_history_product_id", "product_history", ["product_id"], unique=False)

    op.create_table(
        "woocommerce_sync_log",
        sa.Column("id", uuid_type(), nullable=False),
        sa.Column("product_id", uuid_type(), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("wc_product_id", sa.Integer(), nullable=True),
        sa.Column("request_payload", json_type(), nullable=True),
        sa.Column("response_payload", json_type(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="success"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now_default()),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_woocommerce_sync_log_product_id", "woocommerce_sync_log", ["product_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_woocommerce_sync_log_product_id", table_name="woocommerce_sync_log")
    op.drop_table("woocommerce_sync_log")

    op.drop_index("ix_product_history_product_id", table_name="product_history")
    op.drop_table("product_history")

    op.drop_index("ix_products_product_number", table_name="products")
    op.drop_table("products")

    op.drop_index("ix_users_cpr_hash", table_name="users")
    op.drop_index("ix_users_phone", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    drop_enum("product_status_enum")
    drop_enum("metal_type_enum")
    drop_enum("product_type_enum")
    drop_enum("role_enum")
