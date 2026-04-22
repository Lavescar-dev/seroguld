'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { apiRequest, buildWsUrl } from '@/lib/api';
import {
  formatMoneyDkk,
  formatWeight,
  getPosDocumentKind,
  labelPosDocumentKind,
  lineSignature,
  sortPosDisplayLines,
  sumDisplayLineMetrics,
} from '@/lib/pos-mappers';
import { labelPosStatus, labelPosTradeSide } from '@/lib/labels';
import type { PosDisplayLine, PosDisplaySnapshot } from '@/types';
import { DisplayHeader } from '../components/DisplayHeader';
import { DisplayLinesTable, type DisplayAnimatedLine } from '../components/DisplayLinesTable';
import { DisplayStatePanel } from '../components/DisplayStatePanel';
import { DisplaySummaryCards } from '../components/DisplaySummaryCards';

type DisplayEvent = {
  type?: string;
  data?: PosDisplaySnapshot;
};

function formatTs(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

function toNumeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export default function DisplayPage() {
  const uiBuildTag = 'DISPLAY-V5-2026-03-17';
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const token = params?.token || '';
  const kioskMode = searchParams.get('kiosk') === '1';

  const [snapshot, setSnapshot] = useState<PosDisplaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [connectionState, setConnectionState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [animatedLines, setAnimatedLines] = useState<DisplayAnimatedLine[]>([]);

  const keepAliveRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const baseLines = useMemo<PosDisplayLine[]>(() => {
    if (!snapshot) return [];
    if (snapshot.lines && snapshot.lines.length > 0) {
      return sortPosDisplayLines(snapshot.lines);
    }

    if (snapshot.product_type || snapshot.metal_type || snapshot.weight_grams || snapshot.purity_karat || snapshot.purity_percentage) {
      return [
        {
          line_no: 1,
          product_type: (snapshot.product_type as PosDisplayLine['product_type']) || 'jewelry',
          metal_type: (snapshot.metal_type as PosDisplayLine['metal_type']) || 'yellow_gold',
          weight_grams: snapshot.weight_grams || '0',
          purity_karat: snapshot.purity_karat || '-',
          purity_percentage: snapshot.purity_percentage || '0',
          rate_dkk: snapshot.rate_dkk || null,
          line_offer_dkk: snapshot.final_offer_dkk || null,
          notes: null,
        },
      ];
    }

    return [];
  }, [snapshot]);

  const lineCount = baseLines.length;
  const resolvedDocumentKind = snapshot?.document_kind || getPosDocumentKind(snapshot?.trade_side);
  const resolvedDocumentLabel = labelPosDocumentKind(resolvedDocumentKind);
  const lineMetrics = useMemo(() => sumDisplayLineMetrics(baseLines), [baseLines]);

  const totalWeight = useMemo(() => {
    const total = toNumeric(snapshot?.total_weight_grams) ?? lineMetrics.totalWeightGrams;
    return `${formatWeight(total)} g`;
  }, [lineMetrics.totalWeightGrams, snapshot?.total_weight_grams]);

  const totalPureGold = useMemo(() => {
    const total = toNumeric(snapshot?.total_pure_gold_grams) ?? lineMetrics.totalPureMetalGrams;
    return `${formatWeight(total)} g`;
  }, [lineMetrics.totalPureMetalGrams, snapshot?.total_pure_gold_grams]);

  const totalAmountRaw = formatMoneyDkk(snapshot?.lines_total_dkk || snapshot?.final_offer_dkk);
  const activeRateRaw = formatMoneyDkk(snapshot?.rate_dkk);
  const totalAmountText = totalAmountRaw === '-' ? '- DKK' : `${totalAmountRaw} DKK`;
  const activeRateText = activeRateRaw === '-' ? '- DKK/g' : `${activeRateRaw} DKK/g`;
  const documentReference =
    snapshot?.document_number || (snapshot?.session_code ? `Taslak / ${snapshot.session_code}` : null);
  const documentStateText =
    snapshot?.status === 'confirmed'
      ? 'Belge onaylandi'
      : snapshot?.status === 'cancelled'
        ? 'Belge iptal edildi'
        : 'Taslak acik';

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) {
        setFullscreenError('');
      }
    };
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenError('');
    } catch {
      setFullscreenError('Tam ekran acilamadi. Butona tekrar tiklayin.');
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await enterFullscreen();
  }

  useEffect(() => {
    if (!kioskMode || isFullscreen) return;
    const timer = window.setTimeout(() => {
      void enterFullscreen();
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [kioskMode, isFullscreen]);

  useEffect(() => {
    if (!token) {
      setError('Display token bulunamadi.');
      setLoading(false);
      return;
    }

    let mounted = true;
    let ws: WebSocket | null = null;

    async function fetchInitialSnapshot() {
      try {
        setLoading(true);
        const data = await apiRequest<PosDisplaySnapshot>(`/api/pos/display/${token}`, { auth: false });
        if (!mounted) return;
        setSnapshot(data);
        setError('');
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Musteri ekrani yuklenemedi.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    function clearTimers() {
      if (keepAliveRef.current) {
        window.clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function scheduleReconnect() {
      if (!mounted) return;
      const delay = Math.min(12000, 1200 * 2 ** reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      setConnectionState('connecting');
      reconnectTimerRef.current = window.setTimeout(() => {
        connectWs();
      }, delay);
    }

    function connectWs() {
      if (!mounted) return;
      clearTimers();
      setConnectionState('connecting');
      ws = new WebSocket(buildWsUrl(`/api/pos/display/${token}/ws`));

      ws.onopen = () => {
        if (!mounted || !ws) return;
        reconnectAttemptRef.current = 0;
        setConnectionState('live');
        keepAliveRef.current = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const payload = JSON.parse(event.data) as DisplayEvent;
          if (payload?.data) {
            setSnapshot(payload.data);
            setError('');
          }
        } catch {
          // malformed frame ignored
        }
      };

      ws.onerror = () => {
        if (!mounted) return;
        setConnectionState('offline');
      };

      ws.onclose = () => {
        if (!mounted) return;
        setConnectionState('offline');
        scheduleReconnect();
      };
    }

    void fetchInitialSnapshot();
    connectWs();

    return () => {
      mounted = false;
      clearTimers();
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [token]);

  useEffect(() => {
    setAnimatedLines((prev) => {
      const previousByLine = new Map<number, DisplayAnimatedLine>();
      prev.forEach((item) => {
        if (item.state !== 'removing') {
          previousByLine.set(item.line.line_no, item);
        }
      });

      const nextByLineNo = new Set<number>();
      const nextRows: DisplayAnimatedLine[] = baseLines.map((line) => {
        nextByLineNo.add(line.line_no);
        const old = previousByLine.get(line.line_no);
        if (!old) {
          return {
            key: `line-${line.line_no}`,
            line,
            state: 'new',
          };
        }
        const isChanged = lineSignature(old.line) !== lineSignature(line);
        return {
          key: `line-${line.line_no}`,
          line,
          state: isChanged ? 'updated' : 'stable',
        };
      });

      const removedRows: DisplayAnimatedLine[] = [];
      previousByLine.forEach((item, lineNo) => {
        if (!nextByLineNo.has(lineNo)) {
          removedRows.push({
            key: `line-${lineNo}-removed-${Date.now()}`,
            line: item.line,
            state: 'removing',
          });
        }
      });

      return [...nextRows, ...removedRows];
    });
  }, [baseLines]);

  useEffect(() => {
    if (!animatedLines.length) return;

    const settleTimer = window.setTimeout(() => {
      setAnimatedLines((prev) =>
        prev.map((item) => {
          if (item.state === 'new' || item.state === 'updated') {
            return { ...item, state: 'stable' };
          }
          return item;
        }),
      );
    }, 900);

    const removeTimer = window.setTimeout(() => {
      setAnimatedLines((prev) => prev.filter((item) => item.state !== 'removing'));
    }, 350);

    return () => {
      window.clearTimeout(settleTimer);
      window.clearTimeout(removeTimer);
    };
  }, [animatedLines]);

  const hasSnapshot = Boolean(snapshot);
  const hasLines = animatedLines.some((item) => item.state !== 'removing');

  const statePanelMode: 'loading' | 'empty' | 'waiting_lines' | 'confirmed' | 'cancelled' | null =
    loading && !hasSnapshot
      ? 'loading'
      : !hasSnapshot
        ? 'empty'
        : snapshot?.status === 'cancelled'
          ? 'cancelled'
          : !hasLines
            ? snapshot?.status === 'confirmed'
              ? 'confirmed'
              : 'waiting_lines'
            : null;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1d1812_0%,#0d1016_58%)] text-[#f5efe1]">
      <div className="mx-auto grid min-h-screen w-full max-w-[1880px] grid-rows-[auto,1fr] gap-4 p-3 md:gap-5 md:p-6">
        <DisplayHeader
          buildTag={uiBuildTag}
          tradeLabel={snapshot ? labelPosTradeSide(snapshot.trade_side) : 'Islem bekleniyor'}
          sessionCode={snapshot?.session_code}
          statusLabel={labelPosStatus(snapshot?.status || 'draft')}
          documentKind={resolvedDocumentLabel}
          documentNumber={documentReference}
          documentStateText={documentStateText}
          connectionState={connectionState}
          updatedAtText={formatTs(snapshot?.updated_at)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => void toggleFullscreen()}
        />

        <section className="grid gap-4 rounded-3xl border border-[#4a3d2a] bg-[#171412]/95 p-4 shadow-[0_16px_34px_rgba(0,0,0,0.34)] md:gap-5 md:p-6">
          {fullscreenError && <p className="text-sm font-semibold text-amber-300 md:text-lg">{fullscreenError}</p>}
          {error && (
            <p className="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-200 md:text-lg">
              {error}
            </p>
          )}
          {snapshot && connectionState === 'connecting' && (
            <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-100 md:text-base">
              Baglanti yeniden kuruluyor. Son gecerli snapshot ekranda tutuluyor.
            </div>
          )}
          {snapshot && connectionState === 'offline' && (
            <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 md:text-base">
              Canli baglanti kesildi. Son kayitli satirlar gosterilmeye devam ediyor.
            </div>
          )}

          {snapshot && (
            <DisplaySummaryCards
              customerName={snapshot.customer_name}
              tradeLabel={snapshot ? labelPosTradeSide(snapshot.trade_side) : 'Islem bekleniyor'}
              documentLabel={resolvedDocumentLabel}
              activeRateText={activeRateText}
              totalAmountText={totalAmountText}
              lineCount={lineCount}
              totalWeightText={totalWeight}
              totalPureGoldText={totalPureGold}
            />
          )}

          {snapshot?.status === 'confirmed' && hasLines && (
            <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 md:text-base">
              Islem onaylandi. Satirlar bilgilendirme amacli gosteriliyor.
            </div>
          )}

          {snapshot?.status === 'cancelled' && hasLines && (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200 md:text-base">
              Islem iptal edildi. Gosterilen satirlar son kayitli veridir.
            </div>
          )}

          {statePanelMode ? (
            <DisplayStatePanel state={statePanelMode} connectionState={connectionState} />
          ) : (
            <DisplayLinesTable lines={animatedLines} />
          )}
        </section>
      </div>
    </main>
  );
}
