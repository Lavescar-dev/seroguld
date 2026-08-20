import { type ReactNode, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  FileText,
  Flame,
  History,
  Layers,
  Link2,
  Loader2,
  Lock,
  Package,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Trash2,
  TrendingUp,
  Unlock,
  X,
} from 'lucide-react';

import { openAuthedDocument } from '@/lib/api';
import {
  formatDate,
  formatMoney,
  formatNumber,
  labelAfgClassification,
  labelMetalType,
  labelOperationState,
  labelProductType,
  statusTone,
} from '@/lib/format';
import type {
  AfgWorkspaceDocument,
  AfgWorkspaceLine,
  LogBucketWorkspace,
  LogMeltLot,
  LogMeltLotHistory,
  LogMeltLotLine,
  LogWorkspace,
} from '@/types';
import { EmbeddedWorkbookPanel } from '../embedded/EmbeddedWorkbookPanel';

import {
  classificationOptions,
  defaultClassification,
  defaultDestination,
  toLotDraft,
  type LineDraft,
  type LogActiveTab,
  type LogSurfaceView,
  type MeltLotDraft,
  type SplitGroupKey,
} from './types';
import {
  buildBucketGroups,
  lineHasPendingChange,
  resolveLineDraft,
  splitGroupKeyForDraft,
  sumLines,
  toFloat,
} from './lineHelpers';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;
const TH =
  'border border-brand-300 bg-brand-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-brand-700 whitespace-nowrap';
const TD = 'border border-brand-200 px-3 py-2 text-sm';
const cellIn =
  'w-full border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900 transition-colors focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-200';

const splitMeta: Record<
  SplitGroupKey,
  {
    label: string;
    badge: string;
    bg: string;
    border: string;
    text: string;
    header: string;
    accent: string;
  }
> = {
  jewelry_cleaning: {
    label: 'Smykker Lager',
    badge: 'S',
    bg: 'bg-amber-100',
    border: 'border-amber-400',
    text: 'text-amber-800',
    header: 'bg-amber-50',
    accent: 'bg-amber-500',
  },
  white_gold: {
    label: 'Hvidguld / Beyaz Au',
    badge: 'H',
    bg: 'bg-sky-100',
    border: 'border-sky-400',
    text: 'text-sky-800',
    header: 'bg-sky-50',
    accent: 'bg-sky-500',
  },
  separate_storage: {
    label: 'Ayrı Depolama',
    badge: 'D',
    bg: 'bg-purple-100',
    border: 'border-purple-400',
    text: 'text-purple-800',
    header: 'bg-purple-50',
    accent: 'bg-purple-500',
  },
};

function formatWorkbookYearLabel(year: number) {
  return `Canlı workbook · ${year}`;
}



function effectiveLineState(line: AfgWorkspaceLine) {
  if (line.operation_destination === 'melt') return 'melted';
  if (line.operation_destination === 'inventory') return 'in_inventory';
  if (line.operation_destination === 'undecided') return 'undecided';
  return line.product_status || line.operation_destination || 'awaiting_decision';
}


function buildDocumentGroups(document: AfgWorkspaceDocument, drafts: Record<string, LineDraft>) {
  const pending: AfgWorkspaceLine[] = [];
  const groups: Record<SplitGroupKey, AfgWorkspaceLine[]> = {
    jewelry_cleaning: [],
    white_gold: [],
    separate_storage: [],
  };

  for (const line of document.lines) {
    const splitKey = splitGroupKeyForDraft(resolveLineDraft(line, drafts));
    if (splitKey === 'jewelry_cleaning') {
      groups.jewelry_cleaning.push(line);
    } else if (splitKey === 'white_gold') {
      groups.white_gold.push(line);
    } else if (splitKey === 'separate_storage') {
      groups.separate_storage.push(line);
    } else {
      pending.push(line);
    }
  }

  return { pending, groups };
}


function summaryCards(bucket: LogBucketWorkspace | undefined, totalDocuments: number, activeTab: LogActiveTab) {
  const summary = bucket?.summary;
  const splitWeight = bucket?.split_groups.reduce((sum, group) => sum + toFloat(group.total_weight_grams), 0) || 0;
  const splitPure = bucket?.split_groups.reduce((sum, group) => sum + toFloat(group.total_pure_gold_grams), 0) || 0;
  const splitAmount = bucket?.split_groups.reduce((sum, group) => sum + toFloat(group.total_amount_dkk), 0) || 0;
  const lastLot = bucket?.melt_lots[0];
  const meltAfterPure = bucket?.melt_lots.reduce((sum, lot) => sum + toFloat(lot.after_pure_gold_grams), 0) || 0;
  const pureLabel = activeTab === 'silver' ? 'g saf' : 'g has';

  return [
    {
      icon: <Layers className="h-4 w-4" />,
      label: 'Toplam Alış Havuzu',
      primary: formatNumber(summary?.total_weight_grams || '0', ' g'),
      secondary: formatMoney(summary?.total_amount_dkk || '0'),
      tertiary: `${formatNumber(summary?.total_pure_gold_grams || '0', ` ${pureLabel}`)} · ${totalDocuments} belge`,
      accent: 'brand' as const,
    },
    {
      icon: <Package className="h-4 w-4" />,
      label: 'Toplam Ayrılan',
      primary: formatNumber(splitWeight, ' g'),
      secondary: formatMoney(splitAmount),
      tertiary: `${formatNumber(splitPure, ` ${pureLabel}`)} · Takı + Beyaz Altın + Depo`,
      accent: 'amber' as const,
    },
    {
      icon: <Flame className="h-4 w-4" />,
      label: 'Eritmeye Giden (net)',
      primary: formatNumber(bucket?.melt_queue.total_weight_grams || '0', ' g'),
      secondary: formatMoney(bucket?.melt_queue.total_amount_dkk || '0'),
      tertiary: formatNumber(bucket?.melt_queue.total_pure_gold_grams || '0', ` ${pureLabel}`),
      accent: 'orange' as const,
    },
    {
      icon: <TrendingUp className="h-4 w-4" />,
      label: 'Eritme Lotları',
      primary: `${bucket?.melt_lots.length || 0} lot`,
      secondary: lastLot?.sent_date ? `Son: ${formatDate(lastLot.sent_date)}` : '—',
      tertiary: formatNumber(meltAfterPure, ` ${pureLabel}`),
      accent: 'emerald' as const,
    },
  ];
}

function bucketMeta(activeTab: LogActiveTab) {
  if (activeTab === 'silver') {
    return {
      badge: 'AG',
      label: 'Sølv — Gümüş',
      subLabel: 'År 2026',
      mainLabel: 'Ana Alış Logu — AG Sølv / År 2026',
      pureHeader: 'Has Gümüş (g)',
      emptyTitle: 'Henüz gümüş log kaydı yok',
      emptySubtitle: 'Gümüş alış kayıtları geldikçe burada belge havuzu oluşacak.',
      tone: 'slate' as const,
    };
  }
  return {
    badge: 'AU',
    label: 'Guld — Altın',
    subLabel: 'År 2026',
    mainLabel: 'Ana Alış Logu — AU Guld / År 2026',
    pureHeader: 'Has Altın (g)',
    emptyTitle: 'Henüz altın log kaydı yok',
    emptySubtitle: 'Alış finalize edildiğinde burada belge havuzu oluşacak.',
    tone: 'amber' as const,
  };
}

export interface LogPageProps {
  workspace?: LogWorkspace;
  isLoading: boolean;
  isError: boolean;
  onRetryWorkspace: () => void;
  activeView: LogSurfaceView;
  onActiveViewChange: (view: LogSurfaceView) => void;
  activeTab: LogActiveTab;
  onActiveTabChange: (tab: LogActiveTab) => void;
  query: string;
  onQueryChange: (value: string) => void;
  expandedDocument: number | null;
  onToggleDocument: (sequenceNo: number) => void;
  showMeltSection: boolean;
  onToggleMeltSection: () => void;
  lineDrafts: Record<string, LineDraft>;
  onDraftChange: (lineId: string, patch: Partial<LineDraft>) => void;
  lotDrafts: Record<string, MeltLotDraft>;
  onLotDraftChange: (lotId: string, patch: Partial<MeltLotDraft>) => void;
  routeBusy: boolean;
  meltBusy: boolean;
  createMeltBusy: boolean;
  finalizeBusy: boolean;
  deleteBusy: boolean;
  pendingRouteCount: number;
  pendingRouteSummary: { count: number; weight: number; amount: number; pure: number };
  onDiscardRouteReview: () => void;
  onApplyRouteReview: () => void;
  onRoute: (line: AfgWorkspaceLine, destination: 'inventory' | 'undecided' | 'melt') => void;
  onSaveLot: (lotId: string) => void;
  onCreateMeltLot: () => void;
  onFinalizeLot: (lotId: string, reverse: boolean) => void;
  onDeleteLot: (lotId: string) => void;
  onDownloadLotPdf: (lotId: string) => void;
  onOpenLotHistory: (lotId: string) => void;
  onCloseLotHistory: () => void;
  historyLotId: string | null;
  lotHistory: LogMeltLotHistory[];
  lotHistoryLoading: boolean;
  onOpenLotLines: (lotId: string) => void;
  onCloseLotLines: () => void;
  linesLotId: string | null;
  lotLines: LogMeltLotLine[];
  lotLinesLoading: boolean;
  selectedYear: number;
  onSelectedYearChange: (year: number) => void;
}

export function LogPage({
  workspace,
  isLoading,
  isError,
  onRetryWorkspace,
  activeView,
  onActiveViewChange,
  activeTab,
  onActiveTabChange,
  query,
  onQueryChange,
  expandedDocument,
  onToggleDocument,
  showMeltSection,
  onToggleMeltSection,
  lineDrafts,
  onDraftChange,
  lotDrafts,
  onLotDraftChange,
  routeBusy,
  meltBusy,
  createMeltBusy,
  finalizeBusy,
  deleteBusy,
  pendingRouteCount,
  pendingRouteSummary,
  onDiscardRouteReview,
  onApplyRouteReview,
  onRoute,
  onSaveLot,
  onCreateMeltLot,
  onFinalizeLot,
  onDeleteLot,
  onDownloadLotPdf,
  onOpenLotHistory,
  onCloseLotHistory,
  historyLotId,
  lotHistory,
  lotHistoryLoading,
  onOpenLotLines,
  onCloseLotLines,
  linesLotId,
  lotLines,
  lotLinesLoading,
  selectedYear,
  onSelectedYearChange,
}: LogPageProps) {
  const goldBucket = workspace?.gold;
  const silverBucket = workspace?.silver;
  const activeBucket = activeTab === 'silver' ? silverBucket : goldBucket;
  const workbookYear = selectedYear;
  const cards = useMemo(
    () => summaryCards(activeBucket, activeBucket?.summary.total_documents || 0, activeTab),
    [activeBucket, activeTab],
  );
  const workbookStatus = formatWorkbookYearLabel(workbookYear);
  const systemContent = isLoading ? (
    <div className="border-b-2 border-brand-200 bg-white px-6 py-16 text-center">
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand-400" />
      <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-brand-500">Çalışma alanı</p>
      <p className="mt-1 text-sm text-brand-600">Log workspace hazırlanıyor...</p>
    </div>
  ) : isError || !workspace ? (
    <div className="border-b-2 border-rose-200 bg-rose-50 px-6 py-12 text-center">
      <AlertTriangle className="mx-auto h-6 w-6 text-rose-500" />
      <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-rose-600">Çalışma alanı</p>
      <p className="mt-1 text-sm text-rose-700">Log workspace alınamadı. Bağlantıyı kontrol edin.</p>
      <button
        type="button"
        onClick={onRetryWorkspace}
        className="mt-4 inline-flex items-center gap-2 border border-rose-400 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-widest text-rose-700 hover:bg-rose-100"
      >
        <RefreshCcw className="h-3 w-3" />
        Tekrar Dene
      </button>
    </div>
  ) : (
    <>
      <div className="flex border-b-2 border-brand-300 bg-brand-50">
        <WorkspaceTab
          active={activeTab === 'gold'}
          tone="amber"
          badge="AU"
          label="Guld — Altın"
          subLabel="Board parity"
          count={goldBucket?.documents.length || 0}
          onClick={() => onActiveTabChange('gold')}
        />
        <WorkspaceTab
          active={activeTab === 'silver'}
          tone="slate"
          badge="AG"
          label="Sølv — Gümüş"
          subLabel="Aynı gümüş arayüzü"
          count={silverBucket?.documents.length || 0}
          onClick={() => onActiveTabChange('silver')}
        />
      </div>
      <div className="grid grid-cols-1 divide-y divide-brand-200 border-b-2 border-brand-300 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
        {cards.map((card) => (
          <KpiCard key={card.label} {...card} />
        ))}
      </div>
      {activeBucket ? (
        <BucketWorkspaceView
          activeTab={activeTab}
          bucket={activeBucket}
          expandedDocument={expandedDocument}
          query={query}
          showMeltSection={showMeltSection}
          lineDrafts={lineDrafts}
          lotDrafts={lotDrafts}
          routeBusy={routeBusy}
          meltBusy={meltBusy}
          createMeltBusy={createMeltBusy}
          finalizeBusy={finalizeBusy}
          deleteBusy={deleteBusy}
          pendingRouteCount={pendingRouteCount}
          pendingRouteSummary={pendingRouteSummary}
          onQueryChange={onQueryChange}
          onToggleDocument={onToggleDocument}
          onToggleMeltSection={onToggleMeltSection}
          onDraftChange={onDraftChange}
          onDiscardRouteReview={onDiscardRouteReview}
          onApplyRouteReview={onApplyRouteReview}
          onRoute={onRoute}
          onLotDraftChange={onLotDraftChange}
          onSaveLot={onSaveLot}
          onCreateMeltLot={onCreateMeltLot}
          onFinalizeLot={onFinalizeLot}
          onDeleteLot={onDeleteLot}
          onDownloadLotPdf={onDownloadLotPdf}
          onOpenLotHistory={onOpenLotHistory}
          onOpenLotLines={onOpenLotLines}
        />
      ) : (
        <div className="px-6 py-16 text-center text-sm text-brand-500">Log workspace alınamadı.</div>
      )}
    </>
  );

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    const list: number[] = [];
    for (let y = current; y >= current - 5; y--) list.push(y);
    if (!list.includes(selectedYear)) list.unshift(selectedYear);
    return list;
  }, [selectedYear]);

  return (
    <div style={sansStyle} className="min-h-full bg-white">
      <div className="border-b-2 border-brand-300 bg-gradient-to-r from-brand-50 to-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center border border-brand-700 bg-brand-800">
              <Activity className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-black uppercase tracking-wider text-brand-900">Log Sistemi — AFG Operasyon</h2>
              <p className="mt-0.5 text-xs text-brand-500">Alış → Ayrıştırma → Depo → Eritme → Payout</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="border border-brand-300 bg-white px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Yıl</p>
              <select
                value={selectedYear}
                onChange={(event) => onSelectedYearChange(Number(event.target.value))}
                className="mono mt-0.5 border-0 bg-transparent p-0 text-sm font-black text-brand-900 focus:outline-none"
                style={monoStyle}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[12rem] border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Log Workbook</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-sm font-black text-brand-900" style={monoStyle}>
                  Log-{workbookYear}.xlsx
                </p>
                <span className="border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                  {workbookYear}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-emerald-700">{workbookStatus}</p>
            </div>
            {activeView === 'system' ? (
              <button
                type="button"
                onClick={onCreateMeltLot}
                disabled={createMeltBusy || (activeBucket?.melt_queue.line_count || 0) === 0}
                className="inline-flex items-center gap-2 border border-orange-800 bg-orange-700 px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Flame className="h-3.5 w-3.5" />
                Yeni Eritme Lotu
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <LogSurfaceTabs
        activeView={activeView}
        onActiveViewChange={onActiveViewChange}
        workbookStatus={workbookStatus}
        pendingRouteCount={pendingRouteCount}
      />
      {activeView === 'excel' ? <LogExcelSurface year={workbookYear} /> : systemContent}

      {historyLotId ? (
        <LotHistoryDrawer
          entries={lotHistory}
          loading={lotHistoryLoading}
          onClose={onCloseLotHistory}
        />
      ) : null}
      {linesLotId ? (
        <LotLinesDrawer
          entries={lotLines}
          loading={lotLinesLoading}
          onClose={onCloseLotLines}
        />
      ) : null}
    </div>
  );
}

const HISTORY_ACTION_LABEL: Record<string, string> = {
  created: 'Oluşturuldu',
  updated: 'Güncellendi',
  deleted: 'Silindi',
  finalized: 'Finalize edildi',
  reopened: 'Tekrar açıldı',
  line_attached: 'Satır bağlandı',
  line_detached: 'Satır ayrıldı',
};

function LotHistoryDrawer({
  entries,
  loading,
  onClose,
}: {
  entries: LogMeltLotHistory[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-brand-950/20">
      <button type="button" className="flex-1 cursor-default" aria-label="Geçmiş katmanı" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[28rem] overflow-y-auto border-l-2 border-brand-300 bg-white shadow-2xl">
        <div className="sticky top-0 border-b border-brand-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Lot Geçmişi</p>
              <h3 className="mt-1 text-base font-black text-brand-900">Audit Trail</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="border border-brand-300 bg-white p-1.5 text-brand-700 hover:bg-brand-50"
              aria-label="Kapat"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-brand-500">Yükleniyor...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-sm text-brand-400">Bu lot için henüz history kaydı yok.</div>
        ) : (
          <ol className="space-y-2 px-4 py-4">
            {entries.map((entry) => (
              <li key={entry.id} className="border border-brand-200 bg-white px-3 py-2 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-black uppercase tracking-widest text-brand-700">
                    {HISTORY_ACTION_LABEL[entry.action] || entry.action}
                  </span>
                  <span className="mono text-[10px] text-brand-400">
                    {new Date(entry.created_at).toLocaleString(document.documentElement.lang)}
                  </span>
                </div>
                {entry.performed_by_email ? (
                  <p className="mt-0.5 text-[10px] text-brand-500">{entry.performed_by_email}</p>
                ) : null}
                {entry.notes ? <p className="mt-1 text-[11px] text-brand-700">{entry.notes}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}

function LotLinesDrawer({
  entries,
  loading,
  onClose,
}: {
  entries: LogMeltLotLine[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-brand-950/20">
      <button type="button" className="flex-1 cursor-default" aria-label="Lines overlay" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[36rem] overflow-y-auto border-l-2 border-brand-300 bg-white shadow-2xl">
        <div className="sticky top-0 border-b border-brand-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Bağlı AFG Satırları</p>
              <h3 className="mt-1 text-base font-black text-brand-900">{entries.length} satır</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="border border-brand-300 bg-white p-1.5 text-brand-700 hover:bg-brand-50"
              aria-label="Kapat"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-brand-500">Yükleniyor...</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-6 text-sm text-brand-400">Bu lot'a henüz bağlı satır yok.</div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-brand-200 bg-brand-50">
                <th className="px-2 py-2 text-left font-black uppercase tracking-wider text-brand-600">AFG</th>
                <th className="px-2 py-2 text-center font-black uppercase tracking-wider text-brand-600">#</th>
                <th className="px-2 py-2 text-right font-black uppercase tracking-wider text-brand-600">Gram</th>
                <th className="px-2 py-2 text-right font-black uppercase tracking-wider text-brand-600">Has</th>
                <th className="px-2 py-2 text-right font-black uppercase tracking-wider text-brand-600">DKK</th>
                <th className="px-2 py-2 text-left font-black uppercase tracking-wider text-brand-600">Müşteri</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((line) => (
                <tr key={line.line_id} className="border-b border-brand-100">
                  <td className="px-2 py-1.5 text-brand-900" style={monoStyle}>
                    {line.document_number || `#${line.document_sequence_no}`}
                  </td>
                  <td className="px-2 py-1.5 text-center text-brand-400">{line.line_no}</td>
                  <td className="px-2 py-1.5 text-right" style={monoStyle}>
                    {formatNumber(line.weight_grams, ' g')}
                  </td>
                  <td className="px-2 py-1.5 text-right" style={monoStyle}>
                    {formatNumber(line.pure_gold_grams, ' g')}
                  </td>
                  <td className="px-2 py-1.5 text-right" style={monoStyle}>
                    {formatMoney(line.line_total_dkk)}
                  </td>
                  <td className="px-2 py-1.5 text-brand-700">{line.customer_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </aside>
    </div>
  );
}

function LogSurfaceTabs({
  activeView,
  onActiveViewChange,
  workbookStatus,
  pendingRouteCount,
}: {
  activeView: LogSurfaceView;
  onActiveViewChange: (view: LogSurfaceView) => void;
  workbookStatus: string;
  pendingRouteCount: number;
}) {
  const excelLocked = pendingRouteCount > 0 && activeView === 'system';

  return (
    <div className="border-b-2 border-brand-300 bg-brand-50 px-4 py-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'system' as const, label: 'System', shortLabel: 'SYS' },
          { key: 'excel' as const, label: 'Excel', shortLabel: 'XLSX' },
        ].map((tab) => {
          const isActive = activeView === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onActiveViewChange(tab.key)}
              disabled={tab.key === 'excel' && excelLocked}
              className={`inline-flex items-center gap-2 border px-3 py-2 text-[11px] font-black uppercase tracking-widest transition ${
                isActive
                  ? 'border-brand-900 bg-brand-900 text-white'
                  : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-100'
              } ${tab.key === 'excel' && excelLocked ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span className={`mono px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-brand-700 text-brand-100' : 'bg-brand-100 text-brand-600'}`}>
                {tab.shortLabel}
              </span>
              {tab.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onActiveViewChange('excel')}
          disabled={excelLocked}
          className={`ml-auto inline-flex min-w-[13rem] items-center gap-3 border px-3 py-2 text-left transition ${
            activeView === 'excel'
              ? 'border-brand-900 bg-brand-900 text-white'
              : 'border-emerald-300 bg-white text-brand-900 hover:bg-emerald-50'
          } ${excelLocked ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <FileSpreadsheet className={`h-4 w-4 ${activeView === 'excel' ? 'text-emerald-200' : 'text-emerald-700'}`} />
          <span className="min-w-0 flex-1">
            <span className={`block text-[10px] font-black uppercase tracking-widest ${activeView === 'excel' ? 'text-brand-200' : 'text-emerald-700'}`}>Log Workbook</span>
            <span className={`block truncate text-xs font-black uppercase tracking-wider ${activeView === 'excel' ? 'text-white' : 'text-brand-900'}`}>Log-{new Date().getFullYear()}.xlsx</span>
            <span className={`block truncate text-[11px] ${activeView === 'excel' ? 'text-brand-200' : 'text-brand-500'}`}>
              {excelLocked ? 'Önce review bar içinden uygula veya vazgeç' : workbookStatus}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function LogExcelSurface({ year }: { year: number }) {
  return (
    <div className="flex-1 min-h-0 border-b-2 border-brand-300 bg-stone-100">
      <div className="h-[calc(100vh-16rem)] min-h-[760px]">
        <EmbeddedWorkbookPanel kind="log" artifactKey={String(year)} layoutMode="workspace" />
      </div>
    </div>
  );
}

function BucketWorkspaceView({
  activeTab,
  bucket,
  expandedDocument,
  query,
  showMeltSection,
  lineDrafts,
  lotDrafts,
  routeBusy,
  meltBusy,
  createMeltBusy,
  finalizeBusy,
  deleteBusy,
  pendingRouteCount,
  pendingRouteSummary,
  onQueryChange,
  onToggleDocument,
  onToggleMeltSection,
  onDraftChange,
  onDiscardRouteReview,
  onApplyRouteReview,
  onRoute,
  onLotDraftChange,
  onSaveLot,
  onCreateMeltLot,
  onFinalizeLot,
  onDeleteLot,
  onDownloadLotPdf,
  onOpenLotHistory,
  onOpenLotLines,
}: {
  activeTab: LogActiveTab;
  bucket: LogBucketWorkspace;
  expandedDocument: number | null;
  query: string;
  showMeltSection: boolean;
  lineDrafts: Record<string, LineDraft>;
  lotDrafts: Record<string, MeltLotDraft>;
  routeBusy: boolean;
  meltBusy: boolean;
  createMeltBusy: boolean;
  finalizeBusy: boolean;
  deleteBusy: boolean;
  pendingRouteCount: number;
  pendingRouteSummary: { count: number; weight: number; amount: number; pure: number };
  onQueryChange: (value: string) => void;
  onToggleDocument: (sequenceNo: number) => void;
  onToggleMeltSection: () => void;
  onDraftChange: (lineId: string, patch: Partial<LineDraft>) => void;
  onDiscardRouteReview: () => void;
  onApplyRouteReview: () => void;
  onRoute: (line: AfgWorkspaceLine, destination: 'inventory' | 'undecided' | 'melt') => void;
  onLotDraftChange: (lotId: string, patch: Partial<MeltLotDraft>) => void;
  onSaveLot: (lotId: string) => void;
  onCreateMeltLot: () => void;
  onFinalizeLot: (lotId: string, reverse: boolean) => void;
  onDeleteLot: (lotId: string) => void;
  onDownloadLotPdf: (lotId: string) => void;
  onOpenLotHistory: (lotId: string) => void;
  onOpenLotLines: (lotId: string) => void;
}) {
  const meta = bucketMeta(activeTab);
  const documents = bucket.documents;
  const grandTotals = useMemo(
    () =>
      documents.reduce(
        (sum, document) => ({
          weight: sum.weight + toFloat(document.total_weight_grams),
          amount: sum.amount + toFloat(document.net_amount_dkk),
          pure: sum.pure + toFloat(document.total_pure_gold_grams),
        }),
        { weight: 0, amount: 0, pure: 0 },
      ),
    [documents],
  );
  const bucketGroups = useMemo(() => buildBucketGroups(documents, lineDrafts), [documents, lineDrafts]);
  const bucketGroupedTotals = useMemo(
    () => ({
      jewelry_cleaning: sumLines(bucketGroups.jewelry_cleaning),
      white_gold: sumLines(bucketGroups.white_gold),
      separate_storage: sumLines(bucketGroups.separate_storage),
    }),
    [bucketGroups],
  );
  const bucketGroupedCounts = useMemo(
    () => ({
      jewelry_cleaning: bucketGroups.jewelry_cleaning.length,
      white_gold: bucketGroups.white_gold.length,
      separate_storage: bucketGroups.separate_storage.length,
    }),
    [bucketGroups],
  );
  const selectedDocument = documents.find((document) => document.sequence_no === expandedDocument) ?? documents[0] ?? null;
  const selectedWorkspace = useMemo(() => {
    if (!selectedDocument) {
      return null;
    }
    const { pending, groups } = buildDocumentGroups(selectedDocument, lineDrafts);
    const groupedTotals = {
      jewelry_cleaning: sumLines(groups.jewelry_cleaning),
      white_gold: sumLines(groups.white_gold),
      separate_storage: sumLines(groups.separate_storage),
    };
    const groupedCount =
      groups.jewelry_cleaning.length + groups.white_gold.length + groups.separate_storage.length;
    const documentRoutedPure =
      groupedTotals.jewelry_cleaning.pure + groupedTotals.white_gold.pure + groupedTotals.separate_storage.pure;
    const documentRoutedWeight =
      groupedTotals.jewelry_cleaning.weight + groupedTotals.white_gold.weight + groupedTotals.separate_storage.weight;
    const documentRoutedAmount =
      groupedTotals.jewelry_cleaning.amount + groupedTotals.white_gold.amount + groupedTotals.separate_storage.amount;
    const remainingPure = toFloat(selectedDocument.total_pure_gold_grams) - documentRoutedPure;
    return {
      document: selectedDocument,
      pending,
      groupedTotals,
      groupedCount,
      documentRoutedPure,
      documentRoutedWeight,
      documentRoutedAmount,
      remainingPure,
    };
  }, [lineDrafts, selectedDocument]);

  return (
    <div>
      <div className="border-b-2 border-brand-300">
        <div className="flex items-center justify-between gap-4 border-b border-brand-200 bg-brand-50 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className={`h-5 w-1 ${meta.tone === 'amber' ? 'bg-amber-500' : 'bg-slate-500'}`} />
            <span className="text-xs font-black uppercase tracking-widest text-brand-700">{meta.mainLabel}</span>
            <span
              className={`border px-2 py-0.5 text-xs font-black ${meta.tone === 'amber' ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-slate-300 bg-slate-100 text-slate-700'}`}
              style={monoStyle}
            >
              {bucket.summary.total_documents} afregning
            </span>
          </div>
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-brand-400" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="AFG nr. veya müşteri ara..."
              className="w-56 border border-brand-300 bg-white py-1 pl-7 pr-6 text-xs text-brand-800 outline-none transition focus:border-brand-700"
              style={monoStyle}
            />
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-brand-300" />
            <p className="text-sm font-semibold text-brand-500">{meta.emptyTitle}</p>
            <p className="mt-1 text-xs text-brand-400">{meta.emptySubtitle}</p>
            {query ? (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="mt-4 inline-flex items-center gap-2 border border-brand-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-700 hover:bg-brand-50"
              >
                Aramayı Temizle
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-brand-300">
                  <th className={`${TH} w-8 text-center`}>#</th>
                  <th className={TH}>Afg nr.</th>
                  <th className={TH}>Dato</th>
                  <th className={`${TH} text-left`}>Müşteri</th>
                  <th className={`${TH} border-amber-300 bg-amber-50 text-center text-amber-800`}>Gram</th>
                  <th className={`${TH} border-amber-300 bg-amber-50 text-right text-amber-800`}>Kr.</th>
                  <th className={`${TH} border-amber-400 bg-amber-100 text-center text-amber-900`}>{meta.pureHeader}</th>
                  <th className={`${TH} w-12 text-center`}>Ayrım</th>
                  <th className={`${TH} w-20 text-center`}>Seçim</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document, index) => {
                  const selected = selectedDocument?.sequence_no === document.sequence_no;
                  const { groups } = buildDocumentGroups(document, lineDrafts);
                  const groupedCount =
                    groups.jewelry_cleaning.length + groups.white_gold.length + groups.separate_storage.length;

                  return (
                    <tr
                      key={document.sequence_no}
                      className={`cursor-pointer border-b transition-colors ${
                        selected
                          ? 'border-b-amber-300 bg-amber-50'
                          : index % 2 === 0
                            ? 'border-b-brand-100 bg-white hover:bg-amber-50/40'
                            : 'border-b-brand-100 bg-brand-50/50 hover:bg-amber-50/40'
                      } ${groupedCount > 0 ? 'border-l-[3px] border-l-amber-400' : ''}`}
                      onClick={() => onToggleDocument(document.sequence_no)}
                    >
                      <td className={`${TD} text-center text-xs font-black text-brand-300`} style={monoStyle}>
                        {index + 1}
                      </td>
                      <td className={TD}>
                        <p className="text-xs font-black text-brand-900" style={monoStyle}>
                          {document.document_number}
                        </p>
                        <p className="mt-1 text-[11px] text-brand-400" style={monoStyle}>
                          {document.line_count} kalem
                        </p>
                      </td>
                      <td className={`${TD} text-brand-600`} style={monoStyle}>
                        {formatDate(document.issued_at)}
                      </td>
                      <td className={TD}>
                        <p className="font-semibold text-brand-900">{document.customer_name || 'Müşteri yok'}</p>
                        <p className="mt-1 text-xs text-brand-500">{document.customer_phone || document.customer_email || '-'}</p>
                      </td>
                      <td className={`${TD} border-amber-200 bg-amber-50/60 text-center`} style={monoStyle}>
                        {formatNumber(document.total_weight_grams, ' g')}
                      </td>
                      <td className={`${TD} border-amber-200 bg-amber-50/60 text-right font-semibold text-brand-900`} style={monoStyle}>
                        {formatMoney(document.net_amount_dkk)}
                      </td>
                      <td className={`${TD} border-amber-300 bg-amber-100/70 text-center font-black text-amber-900`} style={monoStyle}>
                        {formatNumber(document.total_pure_gold_grams, ' g')}
                      </td>
                      <td className={TD}>
                        <div className="text-center">
                          {groupedCount > 0 ? (
                            <span className="inline-flex items-center gap-1 border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-xs font-black text-amber-700" style={monoStyle}>
                              {groupedCount}
                            </span>
                          ) : (
                            <span className="text-xs text-brand-200">—</span>
                          )}
                        </div>
                      </td>
                      <td className={`${TD} text-center`}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleDocument(document.sequence_no);
                          }}
                          className={`inline-flex items-center gap-1 border px-2 py-1 text-[11px] font-black uppercase tracking-wider transition ${
                            selected
                              ? 'border-amber-400 bg-amber-100 text-amber-800'
                              : 'border-brand-300 bg-white text-brand-600 hover:bg-brand-50'
                          }`}
                        >
                          <ChevronUp className={`h-3.5 w-3.5 ${selected ? 'rotate-180' : ''}`} />
                          {selected ? 'Açık' : 'Seç'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-brand-400 bg-brand-100">
                  <td colSpan={4} className="border border-brand-300 px-4 py-2.5">
                    <span className="text-xs font-black uppercase tracking-wider text-brand-700">I alt — {documents.length} afregning</span>
                  </td>
                  <td className="border border-amber-300 bg-amber-100 px-3 py-2.5 text-center text-sm font-black text-amber-900" style={monoStyle}>
                    {grandTotals.weight.toFixed(2)}
                  </td>
                  <td className="border border-amber-300 bg-amber-100 px-3 py-2.5 text-right text-sm font-black text-amber-900" style={monoStyle}>
                    {grandTotals.amount.toFixed(0)}
                  </td>
                  <td className="border border-amber-400 bg-amber-200 px-3 py-2.5 text-center text-sm font-black text-amber-900" style={monoStyle}>
                    {grandTotals.pure.toFixed(3)}
                  </td>
                  <td colSpan={2} className="border border-brand-300 bg-brand-100" />
                </tr>
              </tfoot>
            </table>

            {pendingRouteCount > 0 ? (
              <ReviewBar
                summary={pendingRouteSummary}
                busy={routeBusy}
                onDiscard={onDiscardRouteReview}
                onApply={onApplyRouteReview}
              />
            ) : null}

            {selectedWorkspace ? (
              <div className="border-t-2 border-amber-300 bg-amber-50/30 px-5 py-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.95fr)]">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wider text-brand-600">Belge Pipeline</p>
                        <p className="mt-1 text-xs text-brand-500">
                          Seçili AFG için bekleyen satırları review edin; kararlar önce review bar’da birikir.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void openAuthedDocument(`/api/pos/sessions/${selectedWorkspace.document.session_id}/receipt?audience=admin&format=html`)
                        }
                        className="inline-flex items-center gap-2 border border-brand-300 bg-white px-3 py-2 text-xs font-bold uppercase tracking-wider text-brand-700 transition hover:bg-brand-50"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Belgeyi Aç
                      </button>
                    </div>

                    <PendingLinesTable
                      lines={selectedWorkspace.pending}
                      lineDrafts={lineDrafts}
                      busy={routeBusy}
                      onDraftChange={onDraftChange}
                      onRoute={onRoute}
                    />

                    {(selectedWorkspace.groupedCount > 0 || selectedWorkspace.pending.length > 0) && (
                      <div className="flex flex-wrap items-center gap-5 border border-brand-600 bg-brand-800 px-4 py-2.5">
                        <span className="text-xs font-black uppercase tracking-widest text-brand-400">
                          AFG #{selectedWorkspace.document.document_number}
                        </span>
                        <div className="h-4 w-px bg-brand-600" />
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-brand-500">Ayrılan:</span>
                          <span className="text-xs font-bold text-amber-300" style={monoStyle}>
                            {formatNumber(selectedWorkspace.documentRoutedWeight, ' g')}
                          </span>
                          <span className="text-xs text-brand-600">·</span>
                          <span className="text-xs font-bold text-brand-300" style={monoStyle}>
                            {formatMoney(selectedWorkspace.documentRoutedAmount)}
                          </span>
                          <span className="text-xs text-brand-600">·</span>
                          <span className="text-xs font-bold text-amber-400" style={monoStyle}>
                            {formatNumber(selectedWorkspace.documentRoutedPure, activeTab === 'silver' ? ' g saf' : ' g has')}
                          </span>
                        </div>
                        <div className="h-4 w-px bg-brand-600" />
                        <div className="flex items-center gap-1.5">
                          <Flame className="h-3 w-3 text-orange-400" />
                          <span className="text-xs text-brand-500">Kalan:</span>
                          <span className="text-xs font-black text-orange-300" style={monoStyle}>
                            {formatNumber(selectedWorkspace.remainingPure > 0 ? selectedWorkspace.remainingPure : 0, activeTab === 'silver' ? ' g saf' : ' g has')}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="border border-brand-200 bg-white">
                      <div className="flex items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2.5">
                        <div className="h-5 w-1 bg-brand-500" />
                        <span className="text-xs font-black uppercase tracking-widest text-brand-700">Ayrım Board</span>
                        <span className="text-xs text-brand-400">Takı / Cleaning · Beyaz Altın · Ayrı Depo</span>
                      </div>
                      <div className="space-y-3 p-3">
                        {(Object.keys(splitMeta) as SplitGroupKey[]).map((key) => (
                          <SplitGroupCard
                            key={key}
                            groupKey={key}
                            lines={bucketGroups[key]}
                            totals={bucketGroupedTotals[key]}
                            lineDrafts={lineDrafts}
                            busy={routeBusy}
                            onDraftChange={onDraftChange}
                            onRoute={onRoute}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <SplitSummarySection bucket={bucket} groupedTotals={bucketGroupedTotals} groupedCounts={bucketGroupedCounts} />
      <MeltSection
        bucket={bucket}
        show={showMeltSection}
        createBusy={createMeltBusy}
        updateBusy={meltBusy}
        finalizeBusy={finalizeBusy}
        deleteBusy={deleteBusy}
        lotDrafts={lotDrafts}
        onToggle={onToggleMeltSection}
        onCreate={onCreateMeltLot}
        onDraftChange={onLotDraftChange}
        onSave={onSaveLot}
        onFinalize={onFinalizeLot}
        onDelete={onDeleteLot}
        onDownloadPdf={onDownloadLotPdf}
        onOpenHistory={onOpenLotHistory}
        onOpenLines={onOpenLotLines}
      />
    </div>
  );
}

function ReviewBar({
  summary,
  busy,
  onDiscard,
  onApply,
}: {
  summary: { count: number; weight: number; amount: number; pure: number };
  busy: boolean;
  onDiscard: () => void;
  onApply: () => void;
}) {
  return (
    <div className="border-t-2 border-brand-700 bg-brand-900 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="border border-amber-400 bg-amber-500/20 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-amber-300">
            Review + Apply
          </span>
          <span className="text-xs text-brand-300">
            {summary.count} bekleyen değişiklik
          </span>
          <span className="text-xs font-black text-white" style={monoStyle}>
            {summary.weight.toFixed(2)} g
          </span>
          <span className="text-xs font-black text-white" style={monoStyle}>
            {summary.amount.toFixed(0)} kr.
          </span>
          <span className="text-xs font-black text-amber-300" style={monoStyle}>
            {summary.pure.toFixed(3)} has
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy}
            className="border border-brand-500 bg-brand-800 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-brand-200 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy}
            className="inline-flex items-center gap-2 border border-emerald-400 bg-emerald-500/15 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-emerald-200 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Uygula
          </button>
        </div>
      </div>
    </div>
  );
}

function SplitSummarySection({
  bucket,
  groupedTotals,
  groupedCounts,
}: {
  bucket: LogBucketWorkspace;
  groupedTotals: Record<SplitGroupKey, { weight: number; amount: number; pure: number }>;
  groupedCounts: Record<SplitGroupKey, number>;
}) {
  const totalSplitWeight = Object.values(groupedTotals).reduce((sum, group) => sum + group.weight, 0);
  const totalSplitAmount = Object.values(groupedTotals).reduce((sum, group) => sum + group.amount, 0);
  const totalSplitPure = Object.values(groupedTotals).reduce((sum, group) => sum + group.pure, 0);

  return (
    <div className="border-b-2 border-brand-300">
      <div className="flex items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2.5">
        <div className="h-5 w-1 bg-brand-500" />
        <span className="text-xs font-black uppercase tracking-widest text-brand-700">Ayrıştırma Özeti — Lager / Hvidguld / Spandlager</span>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-brand-200">
            <th className={`${TH} text-left`}>Grup</th>
            <th className={`${TH} text-center`}>Gram</th>
            <th className={`${TH} text-right`}>Alış Fiyatı (kr.)</th>
            <th className={`${TH} border-amber-300 bg-amber-50 text-center text-amber-800`}>Has Altın (g)</th>
            <th className={`${TH} text-center`}>Kalem</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(splitMeta) as SplitGroupKey[]).map((key) => {
            const meta = splitMeta[key];
            const totals = groupedTotals[key];
            return (
              <tr key={key} className="border-b border-brand-100 transition-colors hover:bg-brand-50">
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    <div className={`h-4 w-1 ${meta.accent}`} />
                    <span className={`border px-2 py-0.5 text-xs font-black ${meta.bg} ${meta.text} ${meta.border}`}>{meta.label}</span>
                  </div>
                </td>
                <td className={`${TD} text-center`} style={monoStyle}>{totals.weight.toFixed(2)}</td>
                <td className={`${TD} text-right`} style={monoStyle}>{totals.amount.toFixed(0)}</td>
                <td className={`${TD} border-amber-200 bg-amber-50 text-center`} style={monoStyle}>{totals.pure.toFixed(3)}</td>
                <td className={`${TD} text-center`}><span className="text-xs font-bold text-brand-500" style={monoStyle}>{groupedCounts[key] || 0}</span></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-brand-300 bg-brand-50">
            <td className="border border-brand-300 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-brand-700">Total Ayrılan</td>
            <td className="border border-brand-300 px-3 py-2.5 text-center font-black text-brand-900" style={monoStyle}>{totalSplitWeight.toFixed(2)}</td>
            <td className="border border-brand-300 px-3 py-2.5 text-right font-black text-brand-900" style={monoStyle}>{totalSplitAmount.toFixed(0)}</td>
            <td className="border border-amber-300 bg-amber-50 px-3 py-2.5 text-center font-black text-amber-900" style={monoStyle}>{totalSplitPure.toFixed(3)}</td>
            <td className="border border-brand-300" />
          </tr>
          <tr className="border-t border-red-200">
            <td className="border border-red-200 bg-red-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-red-700">− Düşme (Lager/Hvidguld/Spandlager)</td>
            <td className="border border-red-200 bg-red-50 px-3 py-2 text-center font-black text-red-700" style={monoStyle}>−{totalSplitWeight.toFixed(2)}</td>
            <td className="border border-red-200 bg-red-50 px-3 py-2 text-right font-black text-red-700" style={monoStyle}>−{totalSplitAmount.toFixed(0)}</td>
            <td className="border border-red-300 bg-red-100 px-3 py-2 text-center font-black text-red-800" style={monoStyle}>−{totalSplitPure.toFixed(3)}</td>
            <td className="border border-red-200 bg-red-50 px-3 py-2 text-xs italic text-red-400">= D34</td>
          </tr>
          <tr className="border-t-2 border-orange-300">
            <td className="border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-orange-800">Net Eritmeye Giden</td>
            <td className="border border-orange-200 bg-orange-50 px-3 py-2.5 text-center font-black text-orange-900" style={monoStyle}>{toFloat(bucket.melt_queue.total_weight_grams).toFixed(2)}</td>
            <td className="border border-orange-200 bg-orange-50 px-3 py-2.5 text-right font-black text-orange-900" style={monoStyle}>{toFloat(bucket.melt_queue.total_amount_dkk).toFixed(0)}</td>
            <td className="border border-orange-300 bg-orange-100 px-3 py-2.5 text-center font-black text-orange-900" style={monoStyle}>{toFloat(bucket.melt_queue.total_pure_gold_grams).toFixed(3)}</td>
            <td className="border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs text-orange-400">= D37</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MeltSection({
  bucket,
  show,
  createBusy,
  updateBusy,
  finalizeBusy,
  deleteBusy,
  lotDrafts,
  onToggle,
  onCreate,
  onDraftChange,
  onSave,
  onFinalize,
  onDelete,
  onDownloadPdf,
  onOpenHistory,
  onOpenLines,
}: {
  bucket: LogBucketWorkspace;
  show: boolean;
  createBusy: boolean;
  updateBusy: boolean;
  finalizeBusy: boolean;
  deleteBusy: boolean;
  lotDrafts: Record<string, MeltLotDraft>;
  onToggle: () => void;
  onCreate: () => void;
  onDraftChange: (lotId: string, patch: Partial<MeltLotDraft>) => void;
  onSave: (lotId: string) => void;
  onFinalize: (lotId: string, reverse: boolean) => void;
  onDelete: (lotId: string) => void;
  onDownloadPdf: (lotId: string) => void;
  onOpenHistory: (lotId: string) => void;
  onOpenLines: (lotId: string) => void;
}) {
  return (
    <div>
      <button type="button" onClick={onToggle} className="group flex w-full items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-3 transition-colors hover:bg-brand-100">
        <div className="flex items-center gap-3">
          <div className="h-5 w-1 bg-orange-500" />
          <span className="text-xs font-black uppercase tracking-widest text-brand-700">Eritme / Satış / Payout</span>
          <span className="border border-orange-300 bg-orange-100 px-2 py-0.5 text-xs font-black text-orange-700" style={monoStyle}>{bucket.melt_lots.length} lot</span>
        </div>
        <div className="flex items-center gap-2 text-brand-400">
          <span className="text-xs text-brand-500">{show ? 'Gizle' : 'Göster'}</span>
          {show ? <ChevronUp className="h-4 w-4 transition-colors group-hover:text-brand-700" /> : <ChevronDown className="h-4 w-4 transition-colors group-hover:text-brand-700" />}
        </div>
      </button>
      {show ? (
        <div className="space-y-4 bg-orange-50/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border border-orange-200 bg-white px-4 py-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-orange-700">Eritme Havuzu</p>
              <p className="mt-1 text-xs text-brand-500">Bu havuzdan yeni melt lot kartı açılabilir.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="font-semibold text-brand-700" style={monoStyle}>{bucket.melt_queue.line_count} satır</span>
              <span className="font-semibold text-brand-700" style={monoStyle}>{formatNumber(bucket.melt_queue.total_weight_grams, ' g')}</span>
              <span className="font-semibold text-brand-700" style={monoStyle}>{formatMoney(bucket.melt_queue.total_amount_dkk)}</span>
              <span className="font-semibold text-orange-800" style={monoStyle}>{formatNumber(bucket.melt_queue.total_pure_gold_grams, ' g has')}</span>
            </div>
            <button
              type="button"
              onClick={onCreate}
              disabled={createBusy || bucket.melt_queue.line_count === 0}
              className="inline-flex items-center gap-2 border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-orange-800 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Yeni Eritme Lotu
            </button>
          </div>
          {bucket.melt_lots.length === 0 ? (
            <div className="border-2 border-dashed border-orange-200 bg-white px-6 py-12 text-center">
              <Flame className="mx-auto mb-3 h-8 w-8 text-orange-200" />
              <p className="text-sm font-semibold text-brand-400">Henüz eritme lotu yok</p>
              <p className="mt-1 text-xs text-brand-300">Yukarıdan yeni lot açıldığında payout bloğu burada oluşacak.</p>
            </div>
          ) : (
            bucket.melt_lots.map((lot, index) => (
              <MeltLotCard
                key={lot.id}
                index={index}
                lot={lot}
                draft={lotDrafts[lot.id] || toLotDraft(lot)}
                busy={updateBusy}
                finalizeBusy={finalizeBusy}
                deleteBusy={deleteBusy}
                onDraftChange={(patch) => onDraftChange(lot.id, patch)}
                onSave={() => onSave(lot.id)}
                onFinalize={(reverse) => onFinalize(lot.id, reverse)}
                onDelete={() => onDelete(lot.id)}
                onDownloadPdf={() => onDownloadPdf(lot.id)}
                onOpenHistory={() => onOpenHistory(lot.id)}
                onOpenLines={() => onOpenLines(lot.id)}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function PendingLinesTable({
  lines,
  lineDrafts,
  busy,
  onDraftChange,
  onRoute,
}: {
  lines: AfgWorkspaceLine[];
  lineDrafts: Record<string, LineDraft>;
  busy: boolean;
  onDraftChange: (lineId: string, patch: Partial<LineDraft>) => void;
  onRoute: (line: AfgWorkspaceLine, destination: 'inventory' | 'undecided' | 'melt') => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="border border-brand-200 bg-white px-4 py-4">
        <p className="text-xs font-black uppercase tracking-widest text-brand-500">Bekleyen Satırlar</p>
        <p className="mt-2 text-xs text-brand-400">Bu belgede standart sınıflandırmada bekleyen satır kalmadı.</p>
      </div>
    );
  }

  return (
    <div className="border border-brand-200 bg-white">
      <div className="border-b border-brand-200 bg-brand-50 px-4 py-2">
        <p className="text-xs font-black uppercase tracking-widest text-brand-600">Bekleyen Satırlar</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-brand-200">
              <th className={`${TH} text-left`}>Kalem</th>
              <th className={`${TH} text-left`}>Ürün</th>
              <th className={`${TH} text-center`}>Gram</th>
              <th className={`${TH} text-right`}>Kr.</th>
              <th className={`${TH} text-center`}>Has</th>
              <th className={`${TH} text-left`}>Sınıf</th>
              <th className={`${TH} text-left`}>Not</th>
              <th className={`${TH} text-center`}>Rota</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const draft = resolveLineDraft(line, lineDrafts);
              const pending = lineHasPendingChange(line, lineDrafts);
              return (
                <tr key={line.id} className={`border-b border-brand-100 align-top ${pending ? 'bg-amber-50/40' : ''}`}>
                  <td className={TD}>
                    <p className="text-xs font-black text-brand-800" style={monoStyle}>#{line.line_no}</p>
                    <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone(effectiveLineState(line))}`}>{labelOperationState(effectiveLineState(line))}</span>
                    {pending ? <p className="mt-2 text-[11px] font-black uppercase tracking-wider text-amber-700">İnceleme</p> : null}
                  </td>
                  <td className={TD}>
                    <p className="font-semibold text-brand-900">{labelProductType(line.product_type)} · {labelMetalType(line.metal_type)}</p>
                    <p className="mt-1 text-xs text-brand-500">{line.product_number || line.reference_number || 'Ref yok'}</p>
                  </td>
                  <td className={`${TD} text-center`} style={monoStyle}>{formatNumber(line.weight_grams, ' g')}</td>
                  <td className={`${TD} text-right`} style={monoStyle}>{formatMoney(line.line_total_dkk)}</td>
                  <td className={`${TD} text-center`} style={monoStyle}>{formatNumber(line.pure_gold_grams, ' g')}</td>
                  <td className={TD}>
                    <select value={draft.classification} onChange={(event) => onDraftChange(line.id, { classification: event.target.value as LineDraft['classification'] })} className={`${cellIn} text-xs`}>
                      {classificationOptions.map((option) => (
                        <option key={option} value={option}>{labelAfgClassification(option)}</option>
                      ))}
                    </select>
                  </td>
                  <td className={TD}>
                    <input value={draft.note} onChange={(event) => onDraftChange(line.id, { note: event.target.value })} className={`${cellIn} text-xs`} placeholder="Operasyon notu" />
                  </td>
                  <td className={TD}>
                    <div className="grid grid-cols-3 gap-1">
                      <RouteButton label="Envanter" tone="emerald" active={draft.destination === 'inventory'} disabled={busy} onClick={() => onRoute(line, 'inventory')} />
                      <RouteButton label="Kararsız" tone="violet" active={draft.destination === 'undecided'} disabled={busy} onClick={() => onRoute(line, 'undecided')} />
                      <RouteButton label="Erit" tone="orange" active={draft.destination === 'melt'} disabled={busy} onClick={() => onRoute(line, 'melt')} />
                    </div>
                    {line.is_gdpr_locked ? <p className="mt-2 text-[11px] text-orange-700">GDPR süresi devam ediyor (bilgi).</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SplitGroupCard({
  groupKey,
  lines,
  totals,
  lineDrafts,
  busy,
  onDraftChange,
  onRoute,
}: {
  groupKey: SplitGroupKey;
  lines: AfgWorkspaceLine[];
  totals: { weight: number; amount: number; pure: number };
  lineDrafts: Record<string, LineDraft>;
  busy: boolean;
  onDraftChange: (lineId: string, patch: Partial<LineDraft>) => void;
  onRoute: (line: AfgWorkspaceLine, destination: 'inventory' | 'undecided' | 'melt') => void;
}) {
  const meta = splitMeta[groupKey];

  return (
    <div className={`overflow-hidden border bg-white ${meta.border}`}>
      <div className={`flex items-center justify-between border-b px-3 py-2 ${meta.border} ${meta.header}`}>
        <div className="flex items-center gap-2">
          <div className={`h-4 w-1.5 ${meta.accent}`} />
          <span className={`border px-1.5 py-0.5 text-xs font-black ${meta.bg} ${meta.text} ${meta.border}`} style={monoStyle}>{meta.badge}</span>
          <span className={`text-xs font-black uppercase tracking-wider ${meta.text}`}>{meta.label}</span>
          {lines.length > 0 ? <span className={`text-xs font-bold ${meta.text} opacity-60`} style={monoStyle}>({lines.length})</span> : null}
        </div>
      </div>
      <div className={`grid border-b px-2 py-1.5 text-xs font-black uppercase tracking-wider ${meta.header} ${meta.border} ${meta.text} ${groupKey === 'white_gold' ? 'grid-cols-[1.1fr,0.75fr,0.75fr,1.6fr]' : 'grid-cols-[1.1fr,0.75fr,0.75fr,0.75fr,1.6fr]'}`}>
        <span>{groupKey === 'separate_storage' ? 'AFG ref.' : 'Varernr.'}</span>
        <span className="text-center">Vægt (g)</span>
        <span className="text-right">Købspris</span>
        <span className="text-center">Finguld</span>
        <span className="text-left">Aksiyon</span>
      </div>
      <div className="divide-y divide-brand-50 bg-white">
        {lines.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs italic text-brand-300">— boş —</p>
        ) : (
          lines.map((line) => {
            const draft = resolveLineDraft(line, lineDrafts);
            const pending = lineHasPendingChange(line, lineDrafts);
            return (
              <div key={line.id} className={`grid items-start gap-1 px-2 py-2 ${groupKey === 'white_gold' ? 'grid-cols-[1.1fr,0.75fr,0.75fr,1.6fr]' : 'grid-cols-[1.1fr,0.75fr,0.75fr,0.75fr,1.6fr]'} ${pending ? 'bg-amber-50/30' : ''}`}>
                <div className="text-xs">
                  <p className={`font-bold ${meta.text}`} style={monoStyle}>{line.product_number || line.reference_number || line.document_number}</p>
                  <p className="mt-1 text-[11px] text-brand-400">#{line.line_no}</p>
                  {pending ? <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-amber-700">İnceleme</p> : null}
                </div>
                <div className="text-center text-xs text-brand-800" style={monoStyle}>{toFloat(line.weight_grams).toFixed(2)}</div>
                <div className="text-right text-xs text-brand-800" style={monoStyle}>{toFloat(line.line_total_dkk).toFixed(0)}</div>
                {groupKey !== 'white_gold' ? <div className="text-center text-xs font-bold text-brand-900" style={monoStyle}>{toFloat(line.pure_gold_grams).toFixed(3)}</div> : null}
                <div className="space-y-1">
                  <div className="grid grid-cols-3 gap-1">
                    <RouteButton label="Envanter" tone="emerald" active={draft.destination === 'inventory'} disabled={busy} onClick={() => onRoute(line, 'inventory')} />
                    <RouteButton label="Kararsız" tone="violet" active={draft.destination === 'undecided'} disabled={busy} onClick={() => onRoute(line, 'undecided')} />
                    <RouteButton label="Erit" tone="orange" active={draft.destination === 'melt'} disabled={busy} onClick={() => onRoute(line, 'melt')} />
                  </div>
                  <div className="grid gap-1 md:grid-cols-[0.9fr,1.1fr]">
                    <select value={draft.classification} onChange={(event) => onDraftChange(line.id, { classification: event.target.value as LineDraft['classification'] })} className="border border-brand-300 bg-white px-2 py-1 text-[11px] text-brand-700 outline-none transition focus:border-brand-700">
                      {classificationOptions.map((option) => <option key={option} value={option}>{labelAfgClassification(option)}</option>)}
                    </select>
                    <input value={draft.note} onChange={(event) => onDraftChange(line.id, { note: event.target.value })} className="border border-brand-300 bg-white px-2 py-1 text-[11px] text-brand-700 outline-none transition focus:border-brand-700" placeholder="Not" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${statusTone(effectiveLineState(line))}`}>{labelOperationState(effectiveLineState(line))}</span>
                    {line.is_gdpr_locked ? <span className="text-[10px] text-orange-700">GDPR kilitli</span> : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {lines.length > 0 ? (
        <div className={`grid border-t px-2 py-2 ${meta.border} ${meta.bg} ${groupKey === 'white_gold' ? 'grid-cols-[1.1fr,0.75fr,0.75fr,1.6fr]' : 'grid-cols-[1.1fr,0.75fr,0.75fr,0.75fr,1.6fr]'}`}>
          <span className={`text-xs font-black ${meta.text}`} style={monoStyle}>I alt</span>
          <span className={`text-center text-xs font-black ${meta.text}`} style={monoStyle}>{totals.weight.toFixed(2)}</span>
          <span className={`text-right text-xs font-black ${meta.text}`} style={monoStyle}>{totals.amount.toFixed(0)}</span>
          {groupKey !== 'white_gold' ? <span className={`text-center text-xs font-black ${meta.text}`} style={monoStyle}>{totals.pure.toFixed(3)}</span> : null}
          <span />
        </div>
      ) : null}
    </div>
  );
}

function MeltLotCard({
  index,
  lot,
  draft,
  busy,
  finalizeBusy,
  deleteBusy,
  onDraftChange,
  onSave,
  onFinalize,
  onDelete,
  onDownloadPdf,
  onOpenHistory,
  onOpenLines,
}: {
  index: number;
  lot: LogMeltLot;
  draft: MeltLotDraft;
  busy: boolean;
  finalizeBusy: boolean;
  deleteBusy: boolean;
  onDraftChange: (patch: Partial<MeltLotDraft>) => void;
  onSave: () => void;
  onFinalize: (reverse: boolean) => void;
  onDelete: () => void;
  onDownloadPdf: () => void;
  onOpenHistory: () => void;
  onOpenLines: () => void;
}) {
  const isFinalized = lot.status === 'finalized';
  const lineCount = lot.line_count || 0;

  // L13 — Payout variance uyarısı: estimated vs payout %5+ fark
  const payoutNum = toFloat(lot.payout_total_dkk);
  const estimatedNum = toFloat(lot.estimated_sale_value_dkk);
  const variancePct =
    payoutNum > 0 && estimatedNum > 0
      ? Math.abs((payoutNum - estimatedNum) / estimatedNum) * 100
      : 0;
  const showVariance = payoutNum > 0 && estimatedNum > 0 && variancePct >= 5;

  return (
    <div className="overflow-hidden border border-orange-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-orange-600 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <Flame className="h-4 w-4 text-orange-200" />
          <span className="text-xs font-black uppercase tracking-widest text-orange-200">Lot #{index + 1}</span>
          {isFinalized ? (
            <span className="inline-flex items-center gap-1 border border-emerald-400 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-800">
              <Lock className="h-2.5 w-2.5" /> Kesinleştir
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-800">
              <Unlock className="h-2.5 w-2.5" /> Draft
            </span>
          )}
          <div className="h-4 w-px bg-orange-500" />
          <span className="font-black text-white" style={monoStyle}>{formatDate(lot.sent_date)}</span>
          <span className="text-xs text-orange-300">— Sendt den</span>
          {lot.purchased_from_date ? (
            <>
              <span className="text-orange-400">·</span>
              <span className="text-xs text-orange-300" style={monoStyle}>Købt fra {formatDate(lot.purchased_from_date)}</span>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={onOpenLines}
            className="inline-flex items-center gap-1 border border-orange-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-100 hover:bg-orange-700"
            title="Bağlı AFG satırları"
          >
            <Link2 className="h-3 w-3" /> {lineCount}
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1 border border-orange-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-100 hover:bg-orange-700"
            title="Geçmiş"
          >
            <History className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDownloadPdf}
            className="inline-flex items-center gap-1 border border-orange-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-100 hover:bg-orange-700"
            title="PDF olarak indir"
          >
            <Download className="h-3 w-3" />
            PDF
          </button>
          {!isFinalized ? (
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="inline-flex items-center gap-1 border border-orange-500 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-100 hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Lot'u kaydet"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Kaydet
            </button>
          ) : null}
          {!isFinalized ? (
            <button
              type="button"
              onClick={() => onFinalize(false)}
              disabled={finalizeBusy}
              className="inline-flex items-center gap-1 border border-emerald-400 bg-emerald-700 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              title="Lot'u finalize et (kilitle)"
            >
              {finalizeBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Finalize
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onFinalize(true)}
              disabled={finalizeBusy}
              className="inline-flex items-center gap-1 border border-amber-400 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Yeniden aç (taslak duruma al)"
            >
              <Unlock className="h-3 w-3" />
              Reopen
            </button>
          )}
          {!isFinalized && lineCount === 0 ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleteBusy}
              className="inline-flex items-center gap-1 border border-rose-400 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-100 hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Lot'u sil"
            >
              {deleteBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          ) : null}
        </div>
      </div>

      {showVariance ? (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
          <div className="flex-1 text-xs">
            <p className="font-black uppercase tracking-widest text-amber-800">
              Payout sapması: %{variancePct.toFixed(1)}
            </p>
            <p className="mt-0.5 text-amber-700">
              Tahmini {formatMoney(lot.estimated_sale_value_dkk)} · Gerçek {formatMoney(lot.payout_total_dkk)}.
              Fark {formatMoney(payoutNum - estimatedNum)}. Lütfen quote/kurs/payout girişlerini doğrulayın.
            </p>
          </div>
        </div>
      ) : null}

      <fieldset
        disabled={isFinalized}
        className={`grid divide-x divide-orange-100 xl:grid-cols-3 ${
          isFinalized ? 'opacity-70 [&_input]:cursor-not-allowed [&_textarea]:cursor-not-allowed' : ''
        }`}
      >
        <div className="space-y-3 p-4">
          <SectionTinyHeader title="Gram & Has Altın" />
          <DateField label="Gönderim Tarihi" value={draft.sent_date} onChange={(value) => onDraftChange({ sent_date: value })} />
          <DateField label="Alış başlangıcı" value={draft.purchased_from_date} onChange={(value) => onDraftChange({ purchased_from_date: value })} />
          <div className="overflow-hidden border border-brand-100">
            <div className="grid grid-cols-3 border-b border-brand-100 bg-brand-50">
              <div className="border-r border-brand-100 px-2 py-1.5 text-xs font-black uppercase text-brand-500"></div>
              <div className="border-r border-brand-100 px-2 py-1.5 text-center text-xs font-black uppercase text-brand-500">Gram</div>
              <div className="px-2 py-1.5 text-center text-xs font-black uppercase text-amber-600">Has</div>
            </div>
            <div className="grid grid-cols-3 border-b border-brand-50">
              <div className="flex items-center border-r border-brand-100 px-2 py-1.5 text-xs font-bold text-brand-600">Öncesi</div>
              <div className="border-r border-brand-100 px-2 py-1.5 text-center text-xs" style={monoStyle}>{toFloat(lot.before_weight_grams).toFixed(2)}</div>
              <div className="bg-amber-50 px-2 py-1.5 text-center text-xs font-black text-amber-800" style={monoStyle}>{toFloat(lot.before_pure_gold_grams).toFixed(3)}</div>
            </div>
            <div className="grid grid-cols-3 border-b border-brand-50 bg-emerald-50/50">
              <div className="flex items-center border-r border-brand-100 px-2 py-1.5 text-xs font-bold text-emerald-700">Sonrası</div>
              <div className="border-r border-brand-100 bg-brand-50 px-2 py-1.5 text-center text-xs text-brand-300" style={monoStyle}>—</div>
              <input
                type="number"
                step="0.001"
                value={draft.after_pure_gold_grams}
                onChange={(event) => onDraftChange({ after_pure_gold_grams: event.target.value })}
                className="border-0 bg-emerald-50 px-2 py-1.5 text-center text-xs font-bold text-emerald-900 outline-none"
                style={monoStyle}
                placeholder="0.000"
              />
            </div>
            <div className="grid grid-cols-3">
              <div className="flex items-center border-r border-brand-100 px-2 py-1.5 text-xs font-bold text-red-600">Fark</div>
              <div className="border-r border-brand-100 bg-brand-50 px-2 py-1.5 text-center text-xs text-brand-300" style={monoStyle}>—</div>
              <div className="px-2 py-1.5 text-center text-xs font-black text-red-700" style={monoStyle}>
                {toFloat(lot.bridge_difference_dkk) !== 0 ? formatMoney(lot.bridge_difference_dkk) : '—'}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3 p-4">
          <SectionTinyHeader title="Giderler & Satış" />
          <TextField label="Sigorta" value={draft.insurance_dkk} onChange={(value) => onDraftChange({ insurance_dkk: value })} />
          <TextField label="Kargo" value={draft.shipping_dkk} onChange={(value) => onDraftChange({ shipping_dkk: value })} />
          <TextField label="Rafinasyon" value={draft.refining_dkk} onChange={(value) => onDraftChange({ refining_dkk: value })} />
          <div className="flex items-center justify-between border border-brand-200 bg-brand-50 px-3 py-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-600">Toplam Gider</span>
            <span className="text-sm font-black text-brand-900" style={monoStyle}>{formatMoney(lot.cost_total_dkk)}</span>
          </div>
          <DateField label="Satış tarihi" value={draft.sale_date} onChange={(value) => onDraftChange({ sale_date: value })} />
          <TextField label="Fiyat teklifi (EUR)" value={draft.quote_eur} onChange={(value) => onDraftChange({ quote_eur: value })} />
          <TextField label="Kur (DKK/EUR)" value={draft.exchange_rate_dkk} onChange={(value) => onDraftChange({ exchange_rate_dkk: value })} />
        </div>

        <div className="space-y-3 p-4">
          <SectionTinyHeader title="Payout — Sonuç" />
          <div className="overflow-hidden border border-brand-100">
            {[
              { label: 'Has altın (sonrası)', value: formatNumber(draft.after_pure_gold_grams || lot.after_pure_gold_grams, ' g'), color: 'text-amber-700' },
              { label: '× Quote', value: draft.quote_eur || lot.quote_eur || '—', color: 'text-brand-700' },
              { label: '× Kurs', value: draft.exchange_rate_dkk || lot.exchange_rate_dkk || '—', color: 'text-brand-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between border-b border-brand-50 px-3 py-1.5 last:border-b-0">
                <span className="text-xs text-brand-500">{label}</span>
                <span className={`text-xs font-bold ${color}`} style={monoStyle}>{value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <span className="text-xs font-black uppercase tracking-wider text-emerald-700">= DK Total</span>
              <span className="text-sm font-black text-emerald-900" style={monoStyle}>{formatMoney(lot.estimated_sale_value_dkk)}</span>
            </div>
          </div>
          <TextField label="Toplam ödeme" value={draft.payout_total_dkk} onChange={(value) => onDraftChange({ payout_total_dkk: value })} />
          <div className="border border-brand-100">
            <div className="flex items-center justify-between border-b border-brand-50 px-3 py-1.5">
              <span className="text-xs text-brand-500">Alış maliyeti</span>
              <span className="text-xs font-bold text-red-600" style={monoStyle}>−{formatMoney(lot.before_amount_dkk)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-xs text-brand-500">Giderler</span>
              <span className="text-xs font-bold text-red-500" style={monoStyle}>−{formatMoney(lot.cost_total_dkk)}</span>
            </div>
          </div>
          <div className={`border-2 px-3 py-3 ${toFloat(lot.net_after_costs_dkk) > 0 ? 'border-emerald-400 bg-emerald-50' : toFloat(lot.net_after_costs_dkk) < 0 ? 'border-red-300 bg-red-50' : 'border-brand-200 bg-brand-50'}`}>
            <p className="text-xs font-black uppercase tracking-wider text-brand-500">Avance I alt (A51)</p>
            <p className={`mt-1 text-2xl font-black tracking-tight ${toFloat(lot.net_after_costs_dkk) > 0 ? 'text-emerald-800' : toFloat(lot.net_after_costs_dkk) < 0 ? 'text-red-700' : 'text-brand-300'}`} style={monoStyle}>
              {lot.net_after_costs_dkk ? `${toFloat(lot.net_after_costs_dkk).toFixed(0)} DKK` : '—'}
            </p>
            <p className="mt-1 text-xs text-brand-400">= Total − Alış − Giderler</p>
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-brand-500">Not</label>
            <textarea value={draft.notes} onChange={(event) => onDraftChange({ notes: event.target.value })} rows={2} className="mt-2 w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-brand-700" />
          </div>
        </div>
      </fieldset>
    </div>
  );
}

function WorkspaceTab({ active, tone, badge, label, subLabel, count, onClick }: { active: boolean; tone: 'amber' | 'slate'; badge: string; label: string; subLabel: string; count: number; onClick: () => void }) {
  const badgeClassName = tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700';
  const activeBorder = tone === 'amber' ? 'border-b-amber-600' : 'border-b-slate-500';
  return (
    <button type="button" onClick={onClick} className={`border-r border-brand-200 px-6 py-3 text-left transition-colors ${active ? `-mb-0.5 border-b-2 bg-white ${activeBorder}` : 'hover:bg-brand-100'}`}>
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 text-xs font-black ${badgeClassName}`} style={monoStyle}>{badge}</span>
        <span className="text-sm font-black uppercase tracking-wider text-brand-900">{label}</span>
        <span className="text-xs text-brand-400" style={monoStyle}>{count}</span>
      </div>
      <p className="mt-1 text-xs text-brand-400">{subLabel}</p>
    </button>
  );
}

function KpiCard({ icon, label, primary, secondary, tertiary, accent }: { icon: ReactNode; label: string; primary: string; secondary: string; tertiary: string; accent: 'brand' | 'amber' | 'orange' | 'emerald' }) {
  const accentBar = accent === 'amber' ? 'bg-amber-500' : accent === 'orange' ? 'bg-orange-500' : accent === 'emerald' ? 'bg-emerald-500' : 'bg-brand-600';
  const primaryClass = accent === 'amber' ? 'text-amber-800' : accent === 'orange' ? 'text-orange-800' : accent === 'emerald' ? 'text-emerald-700' : 'text-brand-900';
  const secondaryClass = accent === 'amber' ? 'text-amber-600' : accent === 'orange' ? 'text-orange-600' : accent === 'emerald' ? 'text-emerald-600' : 'text-brand-600';
  const iconClass = accent === 'amber' ? 'bg-amber-100 text-amber-700' : accent === 'orange' ? 'bg-orange-100 text-orange-700' : accent === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700';
  return (
    <div className="relative overflow-hidden bg-white px-4 py-3">
      <div className={`absolute bottom-0 left-0 top-0 w-1 ${accentBar}`} />
      <div className="pl-1">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-wider text-brand-500">{label}</p>
          <div className={`p-1.5 ${iconClass}`}>{icon}</div>
        </div>
        <p className={`text-base font-black ${primaryClass}`} style={monoStyle}>{primary}</p>
        <p className={`mt-0.5 text-xs ${secondaryClass}`} style={monoStyle}>{secondary}</p>
        <p className="mt-0.5 text-xs text-brand-400" style={monoStyle}>{tertiary}</p>
      </div>
    </div>
  );
}

function SectionTinyHeader({ title }: { title: string }) {
  return (
    <p className="flex items-center gap-2 border-b border-orange-100 pb-1.5 text-xs font-black uppercase tracking-widest text-orange-600">
      <span className="inline-block h-3 w-1 bg-orange-400" />
      {title}
    </p>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-wider text-brand-500">{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-brand-700" />
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-wider text-brand-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-brand-700" />
    </label>
  );
}

function RouteButton({
  label,
  tone,
  active,
  disabled,
  onClick,
}: {
  label: string;
  tone: 'emerald' | 'violet' | 'orange';
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
      : tone === 'violet'
        ? 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100'
        : 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`border px-2 py-1 text-[11px] font-black uppercase tracking-wider transition ${toneClass} ${active ? 'ring-1 ring-current' : ''} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
