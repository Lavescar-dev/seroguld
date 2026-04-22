from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class DesktopDevSessionOut(BaseModel):
    mode: str
    started_at: str
    backend_url: str
    frontend_url: str
    frontend_mode: str
    tauri_mode: str
    backend_pid: int | None = None
    frontend_pid: int | None = None
    tauri_pid: int | None = None


class RuntimeStatusOut(BaseModel):
    app_name: str
    env: str
    backend_pid: int
    backend_started_at: str
    backend_url: str
    office_runtime_url: str
    office_wopi_base_url: str
    desktop_session: DesktopDevSessionOut | None = None


class RuntimeReadinessCheckOut(BaseModel):
    name: str
    ok: bool
    detail: str | None = None


class RuntimeReadinessOut(BaseModel):
    app_name: str
    env: str
    checked_at: datetime
    ready: bool
    checks: list[RuntimeReadinessCheckOut]
