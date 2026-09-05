"""afg_melt_lot_history.lot_id nullable — terminal deleted audit kaydı lot'tan bağımsız kalır.

delete_afg_melt_lot daha önce "deleted" history satırını lot silinmeden ÖNCE
yazıyordu; PostgreSQL'de afg_melt_lot_history.lot_id FK ihlaliyle 500 üretiyordu.
Yeni düzen: lot geçmişi lot ile birlikte silinir, terminal "deleted" audit
kaydı ise lot silindikten sonra lot_id=None ile yazılır. Bunun için lot_id
nullable olmalı — bu migration tek şema değişikliğini taşır (FK tanımı
değişmez; ondelete cascade bilinçli eklenmedi, çünkü sessiz audit silme
Bogføringsloven §10 izini zayıflatır).

Revision ID: 0041_melt_lot_history_nullable_lot_id
Revises: 0040_product_woo_metal_pricing
Create Date: 2026-09-05 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0041_melt_lot_history_nullable_lot_id"
down_revision: Union[str, None] = "0040_product_woo_metal_pricing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("afg_melt_lot_history") as batch_op:
        batch_op.alter_column(
            "lot_id",
            existing_type=sa.Uuid(as_uuid=True),
            nullable=True,
        )


def downgrade() -> None:
    # lot_id=None kalmış terminal "deleted" audit kayıtları bir lot'a
    # bağlanamaz; NOT NULL geri getirilmeden önce bunlar düşürülür.
    op.execute("DELETE FROM afg_melt_lot_history WHERE lot_id IS NULL")
    with op.batch_alter_table("afg_melt_lot_history") as batch_op:
        batch_op.alter_column(
            "lot_id",
            existing_type=sa.Uuid(as_uuid=True),
            nullable=False,
        )
