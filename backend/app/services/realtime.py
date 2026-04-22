from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass

from fastapi import WebSocket

from app.schemas.pos import PosSessionDisplayOut


@dataclass(slots=True)
class DisplayPreviewEntry:
    session_code: str
    preview_sequence: int
    snapshot: PosSessionDisplayOut


class RealtimeHub:
    def __init__(self) -> None:
        self._display_connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._clerk_connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._display_preview: dict[str, DisplayPreviewEntry] = {}

    async def connect_display(self, display_token: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._display_connections[display_token].add(websocket)

    async def disconnect_display(self, display_token: str, websocket: WebSocket) -> None:
        connections = self._display_connections.get(display_token)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self._display_connections.pop(display_token, None)

    async def connect_clerk(self, session_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._clerk_connections[str(session_id)].add(websocket)

    async def disconnect_clerk(self, session_id: uuid.UUID, websocket: WebSocket) -> None:
        key = str(session_id)
        connections = self._clerk_connections.get(key)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self._clerk_connections.pop(key, None)

    async def broadcast_display(self, display_token: str, payload: dict) -> None:
        for websocket in list(self._display_connections.get(display_token, set())):
            try:
                await websocket.send_json(payload)
            except Exception:
                await self.disconnect_display(display_token, websocket)

    async def broadcast_clerk(self, session_id: uuid.UUID, payload: dict) -> None:
        key = str(session_id)
        for websocket in list(self._clerk_connections.get(key, set())):
            try:
                await websocket.send_json(payload)
            except Exception:
                await self.disconnect_clerk(session_id, websocket)

    def get_display_preview(self, display_token: str) -> DisplayPreviewEntry | None:
        return self._display_preview.get(display_token)

    def set_display_preview(self, display_token: str, snapshot: PosSessionDisplayOut) -> DisplayPreviewEntry | None:
        sequence = snapshot.preview_sequence or 0
        if sequence <= 0:
            return self._display_preview.get(display_token)
        current = self._display_preview.get(display_token)
        if current and current.session_code == snapshot.session_code and sequence <= current.preview_sequence:
            return current
        entry = DisplayPreviewEntry(
            session_code=snapshot.session_code,
            preview_sequence=sequence,
            snapshot=snapshot,
        )
        self._display_preview[display_token] = entry
        return entry

    def clear_display_preview(self, display_token: str, *, session_code: str | None = None) -> None:
        current = self._display_preview.get(display_token)
        if current is None:
            return
        if session_code is not None and current.session_code != session_code:
            return
        self._display_preview.pop(display_token, None)


realtime_hub = RealtimeHub()
