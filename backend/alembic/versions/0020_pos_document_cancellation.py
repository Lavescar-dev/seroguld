"""pos_documents: Uniconta kredi notu / iptal alanları (faithful reconstruction)

Revision ID: 0020_pos_document_cancellation
Revises: 0019_log_module_audit
Create Date: 2026-08-08 15:30:00.000000

Bağlam (MIG-001): `data/desktop.db` bu revision adıyla damgalıydı ancak migration
dosyası hiçbir repo kopyasında / git geçmişinde / handoff paketinde bulunamadı.
DB'nin doğrulanmış gerçek şemasıyla birebir eşleşecek şekilde sadık biçimde yeniden
üretildi: `pos_documents` tablosunda yalnızca şu üç nullable kolon vardı:
  - uniconta_credit_note_number VARCHAR(40)
  - uniconta_cancelled_at DATETIME
  - uniconta_cancel_reason TEXT
Kanıt: .ai/reports/seroguld-crm-runtime-stabilization-*/mig001-schema-diff.txt

Kolon varlığı guard'lıdır: 0020 damgalı eski DB'lerde upgrade no-op olur,
yeni/boş DB'lerde kolonlar normal eklenir.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0020_pos_document_cancellation"
down_revision: Union[str, None] = "0019_log_module_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_COLUMNS = (
    sa.Column("uniconta_credit_note_number", sa.String(length=40), nullable=True),
    sa.Column("uniconta_cancelled_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("uniconta_cancel_reason", sa.Text(), nullable=True),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {column["name"] for column in inspector.get_columns("pos_documents")}
    missing = [column for column in _NEW_COLUMNS if column.name not in existing]
    if not missing:
        return
    with op.batch_alter_table("pos_documents") as batch_op:
        for column in missing:
            batch_op.add_column(column)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {column["name"] for column in inspector.get_columns("pos_documents")}
    with op.batch_alter_table("pos_documents") as batch_op:
        for column in _NEW_COLUMNS:
            if column.name in existing:
                batch_op.drop_column(column.name)
