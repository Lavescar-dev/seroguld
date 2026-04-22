from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


def _dialect_name() -> str:
    return op.get_bind().dialect.name


def is_sqlite() -> bool:
    return _dialect_name() == "sqlite"


def is_postgresql() -> bool:
    return _dialect_name() == "postgresql"


def uuid_type(*, as_uuid: bool = True):
    return sa.Uuid(as_uuid=as_uuid)


def json_type():
    return sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def now_default():
    return sa.text("CURRENT_TIMESTAMP") if is_sqlite() else sa.text("now()")


def json_default(value: object):
    payload = json.dumps(value, ensure_ascii=True).replace("'", "''")
    if is_postgresql():
        return sa.text(f"'{payload}'::jsonb")
    return sa.text(f"'{payload}'")


def enum_type(*values: str, name: str, create_type: bool = True):
    if is_postgresql():
        return postgresql.ENUM(*values, name=name, create_type=create_type)
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True)


def create_enum(enum_obj) -> None:
    if is_postgresql():
        enum_obj.create(op.get_bind(), checkfirst=True)


def drop_enum(name: str) -> None:
    if is_postgresql():
        postgresql.ENUM(name=name).drop(op.get_bind(), checkfirst=True)
