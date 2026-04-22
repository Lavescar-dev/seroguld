import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiRequest, buildWsUrl } from '@/lib/api';
import type { PosDisplayPreview, PosDisplaySnapshot } from '@/types';
import { applyIncomingDisplaySnapshot } from './snapshotState';

export function useDisplayPreviewMakeState() {
  const previewQuery = useQuery({
    queryKey: ['display', 'preview'],
    queryFn: () => apiRequest<PosDisplayPreview>('/api/v2/display/preview'),
    refetchInterval: 1_000,
  });
  const token = previewQuery.data?.display_token || '';
  const [snapshot, setSnapshot] = useState<PosDisplaySnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const reconnectRef = useRef<number | null>(null);
  const tokenRef = useRef('');

  useEffect(() => {
    const nextSnapshot = previewQuery.data?.snapshot || null;
    if (!nextSnapshot) {
      if (!token) {
        setSnapshot(null);
      }
      return;
    }
    setSnapshot((current) => applyIncomingDisplaySnapshot(current, nextSnapshot, 'display:update'));
  }, [previewQuery.data, token]);

  useEffect(() => {
    if (tokenRef.current === token) return;
    tokenRef.current = token;
    setSnapshot(null);
  }, [token]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let mounted = true;

    const connect = () => {
      if (!token) {
        setConnection('offline');
        return;
      }
      setConnection('connecting');
      socket = new WebSocket(buildWsUrl(`/api/v2/display/${token}/ws`));
      socket.onopen = () => setConnection('live');
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
        reconnectRef.current = window.setTimeout(connect, 1_500);
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
      }
      socket?.close();
    };
  }, [token]);

  return {
    token,
    snapshot,
    connection,
  };
}
