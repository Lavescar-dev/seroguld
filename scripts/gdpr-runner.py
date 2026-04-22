#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"


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


async def run_runner(mode: str) -> int:
    from app.database import AsyncSessionLocal
    from app.services.gdpr_service import run_queued_gdpr_jobs, run_retention_scan

    async with AsyncSessionLocal() as session:
        summary: dict[str, object] = {"mode": mode}
        try:
            if mode in {"scan", "scan-and-run"}:
                scan_job = await run_retention_scan(session)
                summary["scan"] = {
                    "status": scan_job.status,
                    "result_json": scan_job.result_json or {},
                }
            if mode in {"run", "scan-and-run"}:
                run_job = await run_queued_gdpr_jobs(session)
                summary["run"] = {
                    "status": run_job.status,
                    "result_json": run_job.result_json or {},
                }
            await session.commit()
        except Exception:
            await session.rollback()
            raise

    print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run GDPR retention scan and/or queued job runner.")
    parser.add_argument(
        "mode",
        choices=("scan", "run", "scan-and-run"),
        help="Which GDPR runner action to perform.",
    )
    parser.add_argument(
        "--env-file",
        default=str(ROOT_DIR / ".env"),
        help="Env file to load before importing backend settings.",
    )
    args = parser.parse_args()

    load_env_file(Path(args.env_file))
    sys.path.insert(0, str(BACKEND_DIR))
    return asyncio.run(run_runner(args.mode))


if __name__ == "__main__":
    raise SystemExit(main())
