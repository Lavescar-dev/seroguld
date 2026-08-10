from __future__ import annotations

import os
from pathlib import Path
import sqlite3
import subprocess
import sys


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"


def test_fresh_sqlite_alembic_upgrade_reaches_head(tmp_path: Path) -> None:
    database_path = tmp_path / "portable-migrations.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{database_path}"

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    assert database_path.exists()

    with sqlite3.connect(database_path) as connection:
        version = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        artifact_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(document_artifacts)")
        }

    heads = subprocess.run(
        [sys.executable, "-m", "alembic", "heads"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    heads = [token for token in heads if token != "(head)"]
    assert len(heads) == 1, f"tek migration head bekleniyor: {heads}"
    assert version == (heads[0],)
    assert "revision" in artifact_columns


def test_identity_guard_migration_aborts_before_writing_when_hashes_conflict(tmp_path: Path) -> None:
    database_path = tmp_path / "duplicate-identity-hashes.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{database_path}"

    base_upgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0023_pos_document_customer_snapshot"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert base_upgrade.returncode == 0, f"{base_upgrade.stdout}\n{base_upgrade.stderr}"

    with sqlite3.connect(database_path) as connection:
        connection.executemany(
            """
            INSERT INTO users (id, email, password_hash, name, role, cpr_hash, is_active)
            VALUES (?, ?, 'x', ?, 'customer', 'duplicate-hash', 1)
            """,
            [
                ("00000000-0000-0000-0000-000000000001", "duplicate-one@example.com", "Duplicate one"),
                ("00000000-0000-0000-0000-000000000002", "duplicate-two@example.com", "Duplicate two"),
            ],
        )
        connection.commit()

    guarded_upgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert guarded_upgrade.returncode != 0
    assert "duplicate customer CPR hashes exist" in f"{guarded_upgrade.stdout}\n{guarded_upgrade.stderr}"

    with sqlite3.connect(database_path) as connection:
        user_columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
        user_indexes = {row[1] for row in connection.execute("PRAGMA index_list(users)")}

    assert "city" not in user_columns
    assert "uq_users_customer_cpr_hash" not in user_indexes
