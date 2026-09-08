"""users tablosuna cpr_birth_hash + cpr_is_partial — CPR 6/10 düzeltmesi.

R1-CPR: OCR/form artık yalnız ilk 6 hane (doğum tarihi DDMMYY) ile müşteri
kaydına izin verir. Kısmi kayıtta tam-CPR hash'i YAZILMAZ (unique partial
index'in etki alanı karışır); doğum-bölümü araması ve yumuşak dup uyarısı
cpr_birth_hash kolonuyla çalışır.

ÖNEMLİ: Backfill bu migration İÇİNDE YOK — şifre çözme anahtarı erişimi ve
uzun sürebilen batch işi migration'da çalıştırılmaz. Idempotent backfill
aracı: backend/app/services/cpr_birth_hash_backfill.py (CLI: scripts
üzerinden).

Revision ID: 0042_user_cpr_birth_hash
Revises: 0041_melt_lot_history_nullable_lot_id
Create Date: 2026-09-08 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0042_user_cpr_birth_hash"
down_revision: Union[str, None] = "0041_melt_lot_history_nullable_lot_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("cpr_birth_hash", sa.String(length=128), nullable=True))
        batch_op.add_column(
            sa.Column("cpr_is_partial", sa.Boolean(), nullable=False, server_default=sa.text("false"))
        )
        batch_op.create_index("ix_users_cpr_birth_hash", ["cpr_birth_hash"])


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_index("ix_users_cpr_birth_hash")
        batch_op.drop_column("cpr_is_partial")
        batch_op.drop_column("cpr_birth_hash")
