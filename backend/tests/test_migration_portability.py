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
