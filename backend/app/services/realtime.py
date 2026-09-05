from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass

from fastapi import WebSocket, WebSocketDisconnect

from app.schemas.pos import PosSessionDisplayOut

LOGGER = logging.getLogger(__name__)


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
        self._display_preview_counters: dict[str, int] = defaultdict(int)

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
            # Ömür döngüsü: son görüntüleyici de gittiyse önizleme kopyası ve
            # sayacı birlikte düşür — hiç kapanmayacak terk edilmiş taslak
            # token'ları tam snapshot'la süreç ömrü boyunca bellek tutmasın.
            self._display_preview.pop(display_token, None)
            self._display_preview_counters.pop(display_token, None)

    async def connect_clerk(
        self,
        session_id: uuid.UUID,
        websocket: WebSocket,
        *,
        subprotocol: str | None = None,
    ) -> None:
        await websocket.accept(subprotocol=subprotocol)
        self._clerk_connections[str(session_id)].add(websocket)

    async def disconnect_clerk(self, session_id: uuid.UUID, websocket: WebSocket) -> None:
        key = str(session_id)
        connections = self._clerk_connections.get(key)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            self._clerk_connections.pop(key, None)

    def has_display_connections(self, display_token: str) -> bool:
        """Bu token için bağlı görüntüleyici var mı?

        _emit_session_state ağır snapshot zincirini yalnız gerçek bir alıcı
        olduğunda kurabilsin diye; bağlantı yoksa snapshot kurulum atlanır.
        """
        return bool(self._display_connections.get(display_token))

    def has_clerk_connections(self, session_id: uuid.UUID) -> bool:
        return bool(self._clerk_connections.get(str(session_id)))

    async def close_display_token(self, display_token: str, *, code: int = 4409, reason: str = "token revoked") -> None:
        """Token'ın tüm görüntüleyici bağlantılarını kapatır.

        Revoke/finalize sunucu tarafında çağırır: kiosk'un ölmesi artık ön
        yüzdeki REST probe davranışına borçlu değil — eski bağlantılar anında
        close frame'i alır ve hub kaydı temizlenir.
        """
        for websocket in list(self._display_connections.get(display_token, set())):
            try:
                await websocket.close(code=code, reason=reason)
            except Exception:  # noqa: BLE001 — zaten kopmuş soket close'u sorun değil
                LOGGER.debug("display close atlandı (token=%s)", display_token, exc_info=True)
            self._display_connections.get(display_token, set()).discard(websocket)
        self._display_connections.pop(display_token, None)
        self._display_preview.pop(display_token, None)
        self._display_preview_counters.pop(display_token, None)

    async def _broadcast(self, key: str, payload: dict, *, label: str) -> None:
        """Tek serileştirme + paralel gönderim.

        Payload bir kez json.dumps edilir (alıcı başına yeniden serileştirme
        yok); send_text çağrıları gather ile paralel koşar — yavaş/askıda tek
        TCP bağlantısı diğer alıcıları sırayla bekletmez. Gönderim hatası
        WebSocketDisconnect (normal kapanış) ise debug, diğer her hata
        exception seviyesinde token etiketiyle loglanır; kök neden artık
        kayıtta görünür. Başarısız bağlantı hub'dan düşürülür.
        """
        connections = self._display_connections if label == "display" else self._clerk_connections
        targets = list(connections.get(key, set()))
        if not targets:
            return
        text = json.dumps(payload, ensure_ascii=False, default=str)
        results = await asyncio.gather(
            *(websocket.send_text(text) for websocket in targets),
            return_exceptions=True,
        )
        for websocket, result in zip(targets, results):
            if not isinstance(result, BaseException):
                continue
            if isinstance(result, WebSocketDisconnect):
                LOGGER.debug("%s bağlantısı kapandı (key=%s)", label, key)
            else:
                LOGGER.error(
                    "%s gönderimi başarısız (key=%s): %s",
                    label,
                    key,
                    result,
                    exc_info=result,
                )
            if label == "display":
                await self.disconnect_display(key, websocket)
            else:
                await self.disconnect_clerk(key, websocket)  # type: ignore[arg-type]

    async def broadcast_display(self, display_token: str, payload: dict) -> None:
        await self._broadcast(display_token, payload, label="display")

    async def broadcast_clerk(self, session_id: uuid.UUID, payload: dict) -> None:
        await self._broadcast(str(session_id), payload, label="clerk")

    def get_display_preview(self, display_token: str) -> DisplayPreviewEntry | None:
        return self._display_preview.get(display_token)

    def set_display_preview(self, display_token: str, snapshot: PosSessionDisplayOut) -> DisplayPreviewEntry | None:
        current = self._display_preview.get(display_token)
        if current is not None and current.session_code != snapshot.session_code:
            # Oturum değişti: sıra sayacı gerçekten 1'e döner (eski no-op
            # kendi üstüne yazıyordu); istemciden gelen bayat sequence dikkate
            # alınmaz.
            sequence = 1
        else:
            sequence = max(self._display_preview_counters[display_token] + 1, snapshot.preview_sequence or 0)
        self._display_preview_counters[display_token] = sequence
        snapshot = snapshot.model_copy(update={"preview_sequence": sequence})
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
        self._display_preview_counters.pop(display_token, None)


realtime_hub = RealtimeHub()
