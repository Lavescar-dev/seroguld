import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { apiRequest, buildWsUrl } from '@/lib/api';
import type { PosDisplaySnapshot } from '@/types';
import { applyIncomingDisplaySnapshot } from './snapshotState';

export function useDisplayLiveMakeState() {
  const { token = '' } = useParams();
  const [snapshot, setSnapshot] = useState<PosDisplaySnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const reconnectRef = useRef<number | null>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let mounted = true;
    let syncTimer: number | null = null;

    async function loadSnapshot() {
      if (!token) return;
      try {
        const data = await apiRequest<PosDisplaySnapshot>(`/api/v2/display/${token}`, { auth: false });
        if (mounted) {
          setSnapshot((current) => applyIncomingDisplaySnapshot(current, data, 'display:update'));
        }
      } catch {
        if (mounted) {
          setConnection('offline');
        }
      }
    }

    const startSyncPolling = () => {
      if (syncTimer) return;
      syncTimer = window.setInterval(() => {
        void loadSnapshot();
      }, 1_000);
    };

    const connect = () => {
      if (!token) return;
      setConnection('connecting');
      socket = new WebSocket(buildWsUrl(`/api/v2/display/${token}/ws`));
      socket.onopen = () => {
        setConnection('live');
      };
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { type?: string; data?: PosDisplaySnapshot };
          if (parsed.data) {
            setSnapshot((current) =>
              applyIncomingDisplaySnapshot(current, parsed.data as PosDisplaySnapshot, parsed.type),
            );
          }
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        if (!mounted) return;
        setConnection('offline');
        reconnectRef.current = window.setTimeout(connect, 1500);
      };
    };

    void loadSnapshot();
    startSyncPolling();
    connect();

    return () => {
      mounted = false;
      if (syncTimer) {
        window.clearInterval(syncTimer);
      }
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
      }
      socket?.close();
    };
  }, [token]);

  return {
    snapshot,
    connection,
  };
}
