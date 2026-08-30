import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest, buildWsUrl } from '@/lib/api';
import type { PosDisplayPreview, PosDisplaySnapshot } from '@/types';
import { useToast } from '@/lib/toast';
import { applyIncomingDisplaySnapshot } from './snapshotState';

// POST /api/v2/display/revoke yanıtı: mevcut token'ın iptal edilip yeni token
// verilip verilmediğini bildirir (alan adları backend kontratıyla birebir).
type DisplayRevokeResponse = {
  token?: string | null;
  display_token?: string | null;
};

export function useDisplayPreviewMakeState() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const previewQuery = useQuery({
    queryKey: ['display', 'preview'],
    queryFn: () => apiRequest<PosDisplayPreview>('/api/v2/display/preview'),
    refetchInterval: 1_000,
  });
  const queryToken = previewQuery.data?.display_token || '';
  // Revoke sonrası sunucu yeni token yayınlayana kadar yerel override geçerli;
  // invalidate edilen preview sorgusu taze token'ı döndürünce override düşer.
  const [tokenOverride, setTokenOverride] = useState<string | null>(null);
  const token = tokenOverride ?? queryToken;

  useEffect(() => {
    if (tokenOverride === null) return;
    if (!queryToken) return;
    setTokenOverride(null);
  }, [tokenOverride, queryToken]);

  const [snapshot, setSnapshot] = useState<PosDisplaySnapshot | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const reconnectRef = useRef<number | null>(null);
  const tokenRef = useRef('');

  const revokeDisplayPreviewMutation = useMutation({
    mutationFn: () =>
      apiRequest<DisplayRevokeResponse>('/api/v2/display/revoke', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    // Başarıda dönen (varsa) yeni token'ı devreye al, preview sorgusunu tazele.
    onSuccess: (response) => {
      setTokenOverride(response?.display_token || response?.token || '');
      void queryClient.invalidateQueries({ queryKey: ['display', 'preview'] });
      toast.success(
        'Müşteri ekranı tokenı yenilendi',
        'Açık ekran penceresi bir sonraki güncelleme denemesinde çevrimdışı düşer.',
      );
    },
    onError: (error) => {
      toast.error('Token geri alınamadı', error instanceof Error ? error.message : undefined);
    },
  });

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
    onRevoke: () => revokeDisplayPreviewMutation.mutate(),
    revokingToken: revokeDisplayPreviewMutation.isPending,
  };
}
