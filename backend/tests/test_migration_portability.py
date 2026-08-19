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
        catalog_tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'woocommerce_catalog_%'"
            )
        }
        catalog_state_rows = connection.execute("SELECT COUNT(*) FROM woocommerce_catalog_state").fetchone()[0]
        market_confirmation_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(market_rate_confirmations)")
        }
        product_columns = {row[1] for row in connection.execute("PRAGMA table_info(products)")}

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
    assert catalog_tables == {"woocommerce_catalog_items", "woocommerce_catalog_state"}
    assert {
        "business_date",
        "business_timezone",
        "confirmation_mode",
        "gold_dkk",
        "silver_dkk",
        "platinum_dkk",
        "palladium_dkk",
        "confirmed_by_user_id",
        "confirmed_at",
    }.issubset(market_confirmation_columns)
    # A migration seed row would make ensure_initial_admin treat a genuinely
    # clean install as non-empty and skip creation of the bootstrap admin.
    assert catalog_state_rows == 0
    assert "diameter_mm" in product_columns


def test_0035_backfills_inventory_category_like_runtime_inference(tmp_path: Path) -> None:
    database_path = tmp_path / "backfill-migrations.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{database_path}"

    def run_alembic(target: str) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", target],
            cwd=BACKEND_DIR,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"

    run_alembic("0034_market_rate_confirmation")

    rows = [
        # (id, product_type, metal_type) → beklenen (kategori, alt kategori)
        ("11111111-1111-1111-1111-111111111111", "jewelry", "yellow_gold", "taki", None),
        ("22222222-2222-2222-2222-222222222222", "bar", "yellow_gold", "kulce", None),
        ("33333333-3333-3333-3333-333333333333", "jewelry", "silver", "gumus", "smykker"),
        ("44444444-4444-4444-4444-444444444444", "bar", "silver", "gumus", "barrer"),
        ("55555555-5555-5555-5555-555555555555", "jewelry", "platinum", "platin_pd", "platin"),
        ("66666666-6666-6666-6666-666666666666", "jewelry", "palladium", "platin_pd", "palladyum"),
    ]
    with sqlite3.connect(database_path) as connection:
        for index, (row_id, product_type, metal_type, _, _) in enumerate(rows):
            connection.execute(
                """
                INSERT INTO products (
                    id, product_number, product_type, metal_type, weight_grams,
                    unit_count, purchase_date, purchase_price_dkk, photos,
                    needs_cleaning, status, gdpr_release_date, is_gdpr_locked,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 10.0, 1, '2026-08-01 00:00:00', 100.0, '[]',
                          0, 'in_inventory', '2026-09-01 00:00:00', 0,
                          '2026-08-01 00:00:00', '2026-08-01 00:00:00')
                """,
                (row_id.replace("-", ""), f"9{index:03d}", product_type, metal_type),
            )
        # Operatörün elle atadığı kategori backfill'de EZİLMEMELİ.
        connection.execute(
            """
            INSERT INTO products (
                id, product_number, product_type, metal_type, weight_grams,
                unit_count, purchase_date, purchase_price_dkk, photos,
                needs_cleaning, status, gdpr_release_date, is_gdpr_locked,
                inventory_category, inventory_subcategory, created_at, updated_at
            ) VALUES ('77777777777777777777777777777777', '9900', 'jewelry', 'yellow_gold',
                      10.0, 1, '2026-08-01 00:00:00', 100.0, '[]', 0, 'in_inventory',
                      '2026-09-01 00:00:00', 0, 'sikke', NULL,
                      '2026-08-01 00:00:00', '2026-08-01 00:00:00')
            """
        )
        connection.commit()

    run_alembic("head")

    with sqlite3.connect(database_path) as connection:
        for row_id, _, _, expected_category, expected_sub in rows:
            category, subcategory = connection.execute(
                "SELECT inventory_category, inventory_subcategory FROM products WHERE id = ?",
                (row_id.replace("-", ""),),
            ).fetchone()
            assert category == expected_category, (row_id, category)
            assert subcategory == expected_sub, (row_id, subcategory)
        manual = connection.execute(
            "SELECT inventory_category FROM products WHERE product_number = '9900'"
        ).fetchone()
        assert manual == ("sikke",)


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
