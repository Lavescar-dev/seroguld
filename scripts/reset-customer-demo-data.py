#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
VENV_PYTHON = BACKEND_DIR / ".venv" / "bin" / "python"

if VENV_PYTHON.exists() and Path(sys.executable).resolve() != VENV_PYTHON.resolve():
    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])

from sqlalchemy import text


COUNT_QUERIES = {
    "customers": "select count(*) from users where role = 'customer'",
    "customer_identity_documents": (
        "select count(*) from customer_identity_documents cid "
        "join users u on u.id = cid.user_id where u.role = 'customer'"
    ),
    "customer_activity_events": "select count(*) from customer_activity_events",
    "pos_sessions": "select count(*) from pos_sessions",
    "pos_documents": "select count(*) from pos_documents",
    "document_artifacts": "select count(*) from document_artifacts",
    "transactions": "select count(*) from transactions",
    "gdpr_requests": "select count(*) from gdpr_requests",
    "woocommerce_sync_log": "select count(*) from woocommerce_sync_log",
    "products_with_customer_links": (
        "select count(*) from products where seller_customer_id is not null or buyer_customer_id is not null"
    ),
}


RESET_STEPS = (
    ("woocommerce_sync_log", "delete from woocommerce_sync_log"),
    ("pos_session_product_links", "delete from pos_session_product_links"),
    ("transaction_lines", "delete from transaction_lines"),
    ("transactions", "delete from transactions"),
    ("pos_document_audit", "delete from pos_document_audit"),
    ("document_artifacts", "delete from document_artifacts"),
    ("pos_documents", "delete from pos_documents"),
    ("pos_session_lines", "delete from pos_session_lines"),
    ("customer_activity_events", "delete from customer_activity_events"),
    ("pos_sessions", "delete from pos_sessions"),
    ("gdpr_request_events", "delete from gdpr_request_events"),
    ("gdpr_jobs", "delete from gdpr_jobs"),
    ("gdpr_requests", "delete from gdpr_requests"),
    ("customer_identity_documents", "delete from customer_identity_documents"),
    (
        "products_customer_links",
        "update products set seller_customer_id = null, buyer_customer_id = null, deleted_by_user_id = null "
        "where seller_customer_id is not null or buyer_customer_id is not null or deleted_by_user_id is not null",
    ),
    ("customers", "delete from users where role = 'customer'"),
)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


async def scalar_int(session: Any, query: str) -> int:
    value = await session.scalar(text(query))
    return int(value or 0)


async def collect_counts(session: Any) -> dict[str, int]:
    return {key: await scalar_int(session, query) for key, query in COUNT_QUERIES.items()}


async def reset_numbering(session: Any) -> list[str]:
    notes: list[str] = []
    await session.execute(text("delete from reference_sequences where key in ('afregnings_number', 'invoice_number')"))
    dialect = session.bind.dialect.name if session.bind is not None else ""
    if dialect == "postgresql":
        try:
            await session.execute(text("alter sequence pos_documents_sequence_no_seq restart with 1"))
            notes.append("pos_documents_sequence_no_seq restarted at 1")
        except Exception as exc:
            notes.append(f"pos document sequence reset skipped: {exc}")
    else:
        notes.append(f"sequence reset skipped for dialect={dialect or 'unknown'}")
    return notes


async def run_reset(*, dry_run: bool, reset_numbering_flag: bool) -> dict[str, Any]:
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        before = await collect_counts(session)
        result: dict[str, Any] = {"dry_run": dry_run, "before": before, "steps": [], "numbering": []}
        if dry_run:
            return result

        try:
            for label, statement in RESET_STEPS:
                response = await session.execute(text(statement))
                result["steps"].append({"table": label, "affected": int(response.rowcount or 0)})
            if reset_numbering_flag:
                result["numbering"] = await reset_numbering(session)
            result["after"] = await collect_counts(session)
            await session.commit()
            return result
        except Exception:
            await session.rollback()
            raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reset demo customer/AFG/GDPR data while keeping admins, products, settings, and integrations."
    )
    parser.add_argument("--env-file", default=str(ROOT_DIR / ".env"), help="Env file to load before backend settings.")
    parser.add_argument("--execute", action="store_true", help="Apply the reset. Without this, only counts are printed.")
    parser.add_argument("--confirm", default="", help="Must be RESET_CUSTOMERS when --execute is used.")
    parser.add_argument(
        "--reset-numbering",
        action="store_true",
        help="Also reset AFG/invoice numbering state after deleting POS documents.",
    )
    args = parser.parse_args()

    if args.execute and args.confirm != "RESET_CUSTOMERS":
        print("Refusing to execute: pass --confirm RESET_CUSTOMERS.", file=sys.stderr)
        return 2

    load_env_file(Path(args.env_file))
    sys.path.insert(0, str(BACKEND_DIR))
    summary = asyncio.run(run_reset(dry_run=not args.execute, reset_numbering_flag=args.reset_numbering))
    print(json.dumps(summary, ensure_ascii=True, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
