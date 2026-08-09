import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import {
  Calculator,
  ChevronDown,
  CalendarDays,
  Download,
  Ellipsis,
  FileSpreadsheet,
  Loader2,
  PanelRight,
  Pencil,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

import { formatMoney, formatNumber, formatRelativeTime } from '@/lib/format';
import { apiRequest } from '@/lib/api';
import { validateCpr } from '@/lib/cpr';
import { GOLD_MATRIX_ROWS, SILVER_MATRIX_ROWS, formatDecimalFixed, normalizeTextInput, parseDecimalValue, syncMarketRateState } from '@/make/alis/marketRates';
import type { AlisPageProps } from '@/make/alis/AlisPage';
import { useOfficeDocumentState } from '@/make/office/useOfficeDocumentState';
import { parseMrzLines } from '@/make/alis/customerEditors';
import type { PosDocumentDetail, PosPostalLookup, PosSavedPurchaseListItem } from '@/types';
import type { EditableCustomer } from '@/make/alis/types';
import type { ModernAlisViewModel } from '@/modern/adapters/alis';
import type { UnsupportedControlDescriptor } from '@/modern/adapters/types';

import { DataPill, EmptyState, LoadingState, ModernModuleShell, shellButtonClass } from './shared';
import { ModernOfficeSurface } from './ModernOfficeSurface';
import { useAlisLayoutMode, type AlisLayoutMode } from './alis/useAlisLayoutMode';

const customerFields: Array<{ key: keyof EditableCustomer; label: string; type?: 'text' | 'email' }> = [
  { key: 'name', label: 'Ad Soyad' },
  { key: 'cpr_number', label: 'CPR nr.' },
  { key: 'identity_doc_number', label: 'Kimlik / Pasaport' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'E-posta', type: 'email' },
  { key: 'address', label: 'Adres' },
  { key: 'city', label: 'Şehir' },
  { key: 'postal_code', label: 'Posta kodu' },
];

type ModernAlisDisplayBridge = Pick<AlisPageProps, 'desktopDisplayState' | 'expectedDisplayRoute' | 'routeMatches' | 'onOpenCustomerDisplay'>;

type ModernAlisListFilters = {
  query: string;
  startDate: string;
  endDate: string;
  minAmountDkk: string;
  maxAmountDkk: string;
  sort: 'sequence' | 'purchaseDate' | 'customer' | 'amount';
  direction: 'asc' | 'desc';
};

type ModernAlisPane = 'workspace' | 'history';
type ModernAlisTool = 'customer' | 'rates' | 'calculator' | 'filters' | 'roadmap' | null;
type ModernAlisState = ModernAlisViewModel['state'];
type ModernAlisRow = {
  key: string;
  name: string;
  type: string;
  purity: string;
  karat: string;
  lodighed: string;
  unitPrice: string;
  gram: string;
  avance: string;
  total: string;
};

export function ModernAlisModule({
  viewModel,
  displayBridge,
}: {
  viewModel: ModernAlisViewModel;
  displayBridge?: ModernAlisDisplayBridge;
}) {
  const { state, phase } = viewModel;
  const workspace = state.workspace;
  const hasWorkspace = Boolean(workspace);
  const activeWorkspace = workspace!;
  const hasSelectedCustomer = Boolean(workspace?.customer.customer_id);
  const layoutRef = useRef<HTMLDivElement>(null);
  const layoutMode = useAlisLayoutMode(layoutRef);
  const [pane, setPane] = useState<ModernAlisPane>('workspace');
  const [tool, setTool] = useState<ModernAlisTool>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<'gold' | 'silver'>>(() => new Set(['gold']));
  const [listFilters, setListFilters] = useState<ModernAlisListFilters>({
    query: state.purchaseSearchTerm,
    startDate: state.purchaseDate,
    endDate: '',
    minAmountDkk: '',
    maxAmountDkk: '',
    sort: 'purchaseDate',
    direction: 'desc',
  });
  const filteredDocuments = useMemo(() => {
    const query = listFilters.query.trim().toLocaleLowerCase('tr-TR');
    const min = listFilters.minAmountDkk.trim() ? parseDecimalValue(listFilters.minAmountDkk) : null;
    const max = listFilters.maxAmountDkk.trim() ? parseDecimalValue(listFilters.maxAmountDkk) : null;
    const documents = state.documents.filter((document) => {
      const matchesQuery = !query || [document.document_number, document.customer_name, document.customer_cpr_masked, document.customer_phone]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('tr-TR').includes(query));
      const issuedDate = document.issued_at.slice(0, 10);
      const matchesStart = !listFilters.startDate || issuedDate >= listFilters.startDate;
      const matchesEnd = !listFilters.endDate || issuedDate <= listFilters.endDate;
      const amount = parseDecimalValue(document.gross_amount_dkk);
      const matchesMin = min === null || amount >= min;
      const matchesMax = max === null || amount <= max;
      return matchesQuery && matchesStart && matchesEnd && matchesMin && matchesMax;
    });
    return documents.sort((left, right) => {
      let comparison = 0;
      if (listFilters.sort === 'sequence') comparison = left.sequence_no - right.sequence_no;
      if (listFilters.sort === 'purchaseDate') comparison = left.issued_at.localeCompare(right.issued_at);
      if (listFilters.sort === 'customer') comparison = String(left.customer_name || '').localeCompare(String(right.customer_name || ''), 'tr-TR');
      if (listFilters.sort === 'amount') comparison = parseDecimalValue(left.gross_amount_dkk) - parseDecimalValue(right.gross_amount_dkk);
      return listFilters.direction === 'asc' ? comparison : -comparison;
    });
  }, [listFilters, state.documents]);
  const displayLabel = !displayBridge
    ? 'Otomatik'
    : !displayBridge.desktopDisplayState?.has_secondary_monitor
      ? 'İkinci ekran yok'
      : displayBridge.routeMatches
        ? 'Hazır'
        : displayBridge.desktopDisplayState?.window_open
          ? 'Route bekliyor'
          : 'Kapalı';
  const displayTone = displayLabel === 'Hazır' ? 'success' : displayLabel === 'Otomatik' ? 'neutral' : 'warning';
  const unavailableControls = state.activeWorkspaceView === 'excel' ? [] : viewModel.unsupportedControls;

  useEffect(() => {
    if (workspace || state.draftWorkspace) setPane('workspace');
  }, [state.draftWorkspace, workspace]);

  useEffect(() => {
    const hasGold = state.goldRows.some((row) => parseDecimalValue(row.gram) > 0);
    const hasSilver = state.silverRows.some((row) => parseDecimalValue(row.gram) > 0);
    if (!hasGold && !hasSilver) return;
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (hasGold) next.add('gold');
      if (hasSilver) next.add('silver');
      return next;
    });
  }, [state.goldRows, state.silverRows]);

  function startBlankWorkspace() {
    if (workspace || state.draftWorkspace) {
      const confirmed = window.confirm('Mevcut Alış taslağı açık. Yeni boş alış başlatmak mevcut taslağı geride bırakabilir. Devam edilsin mi?');
      if (!confirmed) return;
    }
    state.onStartBlankWorkspace();
  }

  function cancelWorkspace() {
    if (!window.confirm('Bu Alış taslağı iptal edilecek. Devam edilsin mi?')) return;
    state.onCancelWorkspace();
  }

  function updateListFilters(next: Partial<ModernAlisListFilters>) {
    setListFilters((current) => ({ ...current, ...next }));
  }

  function resetListFilters() {
    setListFilters({ query: '', startDate: '', endDate: '', minAmountDkk: '', maxAmountDkk: '', sort: 'purchaseDate', direction: 'desc' });
    state.setPurchaseSearchTerm('');
    state.setPurchaseDate('');
  }

  return (
    <ModernModuleShell
      eyebrow="Alış / AFG"
      title={hasWorkspace ? activeWorkspace.session.session_code : 'Alış çalışma alanı'}
      subtitle="AFG alışını, müşteri bağlamını ve belge geçmişini tek operasyon yüzeyinde yönetin."
      blocker={viewModel.blocker}
      unsupportedControls={[]}
      badges={
        <>
          <DataPill label="Yüzey" value={state.activeWorkspaceView === 'excel' ? 'Excel' : 'System'} tone={state.activeWorkspaceView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Draft" value={state.draftWorkspace ? state.draftWorkspace.session.session_code : 'Yok'} tone={state.draftWorkspace ? 'warning' : 'neutral'} />
          <DataPill label="Müşteri" value={hasWorkspace ? (hasSelectedCustomer ? 'Seçili' : 'Bekliyor') : '—'} tone={hasSelectedCustomer ? 'success' : 'warning'} />
        </>
      }
      actions={
        <button
          type="button"
          onClick={startBlankWorkspace}
          disabled={state.startPending || Boolean(workspace)}
          title={workspace ? 'Önce açık Alış taslağını tamamlayın veya iptal edin' : undefined}
          className={shellButtonClass('primary')}
        >
          <Plus className="h-4 w-4" />
          {state.startPending ? 'Hazırlanıyor' : 'Yeni Alış'}
        </button>
      }
    >
      <div ref={layoutRef} className="min-w-0">
        {state.activeWorkspaceView === 'excel' && workspace ? (
          <ModernAlisOfficeSurface
            workspaceId={workspace.session.id}
            onClose={() => state.setActiveWorkspaceView('system')}
          />
        ) : (
          <>
            {phase === 'loading' ? <LoadingState label="Alış kayıtları yükleniyor" /> : null}
            {phase === 'error' ? (
              <EmptyState
                title="Alış listesi yüklenemedi"
                message={state.listError || 'Belgeler alınamadı. Canonical veri değiştirilmedi.'}
                action={<button type="button" onClick={state.onRetryDocuments} className={shellButtonClass('secondary')}><RefreshCcw className="h-4 w-4" />Tekrar dene</button>}
              />
            ) : null}
            {phase === 'empty' ? (
              <EmptyState
                title="Henüz Alış Yok"
                message="AFG listesi boş. Yeni alış başlatabilirsiniz."
                action={<button type="button" onClick={startBlankWorkspace} disabled={state.startPending} className={shellButtonClass('primary')}><Plus className="h-4 w-4" />Yeni Alış Başlat</button>}
              />
            ) : null}

            {phase !== 'loading' && phase !== 'error' && phase !== 'empty' ? (
              <>
                <AlisModeTabs pane={pane} hasWorkspace={hasWorkspace} documentCount={filteredDocuments.length} onChange={setPane} />
                {pane === 'workspace' ? (
                  hasWorkspace ? (
                    <AlisWorkbench
                      state={state}
                      workspace={activeWorkspace}
                      hasSelectedCustomer={hasSelectedCustomer}
                      displayBridge={displayBridge}
                      displayLabel={displayLabel}
                      layoutMode={layoutMode}
                      expandedGroups={expandedGroups}
                      onToggleGroup={(group) => setExpandedGroups((current) => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; })}
                      onOpenTool={(nextTool) => { if (nextTool === 'customer') state.setCustomerMode('existing'); setTool(nextTool); }}
                      onCancel={cancelWorkspace}
                    />
                  ) : (
                    <AlisStartPanel state={state} onStart={startBlankWorkspace} onResume={() => { state.onResumeDraft(); setPane('workspace'); }} onOpenHistory={() => setPane('history')} />
                  )
                ) : (
                  <AlisHistory state={state} documents={filteredDocuments} filters={listFilters} onChange={updateListFilters} onReset={resetListFilters} />
                )}
              </>
            ) : null}

            {tool ? (
              <AlisToolSheet
                tool={tool}
                state={state}
                hasSelectedCustomer={hasSelectedCustomer}
                filters={listFilters}
                onFilterChange={updateListFilters}
                onFilterReset={resetListFilters}
                unsupportedControls={unavailableControls}
                onClose={() => { if (tool === 'customer') state.setCustomerMode(null); setTool(null); }}
              />
            ) : null}

            {state.detailPurchase ? (
              <ModernDetailModal
                source={state.detailPurchase}
                detail={state.detail}
                loading={state.detailLoading}
                error={state.detailError}
                onClose={state.onCloseDetail}
                onEdit={state.onEditDetail}
                onDelete={state.onDeleteDetail}
                onPreview={state.onOpenDetailExcelPreview}
                onExport={state.onExportDetail}
                onPrint={state.onPrintDetail}
                actionPending={state.detailActionPending}
                onRetry={state.onRetryDetail}
              />
            ) : null}
          </>
        )}
      </div>
    </ModernModuleShell>
  );
}

function ModernAlisOfficeSurface({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void | Promise<void>;
}) {
  const officeState = useOfficeDocumentState({
    kind: 'alis-workspace',
    artifactKey: workspaceId,
    disableReopen: true,
  });

  const handleClose = async () => {
    const synced = await officeState.onBeforeClose?.();
    if (synced !== false) await onClose();
  };

  return <ModernOfficeSurface state={officeState} mode="workspace" onClose={handleClose} />;
}

function AlisModeTabs({ pane, hasWorkspace, documentCount, onChange }: { pane: ModernAlisPane; hasWorkspace: boolean; documentCount: number; onChange: (pane: ModernAlisPane) => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-sg-border" role="tablist" aria-label="Alış çalışma görünümü">
      <button type="button" role="tab" aria-selected={pane === 'workspace'} onClick={() => onChange('workspace')} className={`border-b-2 px-3 py-3 text-sm font-semibold transition ${pane === 'workspace' ? 'border-sg-accent text-sg-accent' : 'border-transparent text-sg-text-soft hover:text-sg-text'}`}>
        {hasWorkspace ? 'Aktif alış' : 'Yeni alış'}
      </button>
      <button type="button" role="tab" aria-selected={pane === 'history'} onClick={() => onChange('history')} className={`border-b-2 px-3 py-3 text-sm font-semibold transition ${pane === 'history' ? 'border-sg-accent text-sg-accent' : 'border-transparent text-sg-text-soft hover:text-sg-text'}`}>
        Geçmiş <span className="ml-1 text-xs font-normal">{documentCount}</span>
      </button>
    </div>
  );
}

function AlisStartPanel({ state, onStart, onResume, onOpenHistory }: { state: ModernAlisState; onStart: () => void; onResume: () => void; onOpenHistory: () => void }) {
  return (
    <section className="border-y border-sg-border py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-accent">Operasyon başlangıcı</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-sg-text">Yeni AFG alışını başlatın</h2>
          <p className="mt-2 max-w-xl text-sm text-sg-text-soft">Müşteri, metal satırları ve ödeme bilgileri gerçek workspace state’i ile kaydedilir.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onStart} disabled={state.startPending} className={shellButtonClass('primary')}><Plus className="h-4 w-4" />Yeni alış</button>
          <button type="button" onClick={onOpenHistory} className={shellButtonClass('secondary')}>Geçmişi aç</button>
        </div>
      </div>
      {state.draftWorkspace ? (
        <div className="mt-6 flex flex-col gap-3 border-l-4 border-sg-amber bg-sg-amber-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-sg-amber">Açık taslak</p><p className="mt-1 text-sm font-semibold text-sg-text">{state.draftWorkspace.session.session_code}</p></div>
          <button type="button" onClick={onResume} className={shellButtonClass('secondary')}>Taslağa devam et</button>
        </div>
      ) : null}
    </section>
  );
}

function AlisWorkbench({ state, workspace, hasSelectedCustomer, displayBridge, displayLabel, layoutMode, expandedGroups, onToggleGroup, onOpenTool, onCancel }: { state: ModernAlisState; workspace: NonNullable<ModernAlisState['workspace']>; hasSelectedCustomer: boolean; displayBridge?: ModernAlisDisplayBridge; displayLabel: string; layoutMode: AlisLayoutMode; expandedGroups: Set<'gold' | 'silver'>; onToggleGroup: (group: 'gold' | 'silver') => void; onOpenTool: (tool: Exclude<ModernAlisTool, null>) => void; onCancel: () => void }) {
  const goldRows: ModernAlisRow[] = state.goldRows.map((row) => ({ key: row.row_key, name: row.label || row.karat || 'Gold', type: 'Gold', purity: row.purity_percentage, karat: row.karat, lodighed: row.lodighed, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }));
  const silverRows: ModernAlisRow[] = state.silverRows.map((row) => ({ key: row.row_key, name: row.label || row.type_code || 'Silver', type: row.type_code, purity: row.purity_percentage, karat: '—', lodighed: row.lodighed, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }));
  const totalGram = [...goldRows, ...silverRows].reduce((sum, row) => sum + parseDecimalValue(row.gram), 0);
  const totalOffer = [...goldRows, ...silverRows].reduce((sum, row) => sum + parseDecimalValue(row.total), 0);
  const isWide = layoutMode === 'wide' || layoutMode === 'ultrawide';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sg-border pb-3">
        <div className="flex min-w-0 items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-sg-amber" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-sg-text">{workspace.customer.name || 'Müşteri bekleniyor'}</p><p className="text-xs text-sg-text-soft">{state.finalizePending ? 'Kaydediliyor...' : 'Taslak otomatik kaydediliyor'} · {displayLabel}</p></div></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenTool('customer')} className={shellButtonClass('secondary')}><Users className="h-4 w-4" />{hasSelectedCustomer ? 'Müşteri' : 'Müşteri seç'}</button>
          <button type="button" onClick={state.onOpenWorkspaceExcelPreview} disabled={Boolean(state.hasPendingWorkspaceSync?.())} className={shellButtonClass('secondary')}><FileSpreadsheet className="h-4 w-4" />Office</button>
          <button type="button" onClick={state.onPrintWorkspace} className={shellButtonClass('ghost')}><Printer className="h-4 w-4" />Yazdır</button>
          {displayBridge?.onOpenCustomerDisplay && !isWide ? <button type="button" onClick={() => void displayBridge.onOpenCustomerDisplay?.()} className={shellButtonClass('ghost')}>Müşteri ekranı</button> : null}
          <button type="button" onClick={() => onOpenTool('roadmap')} className={shellButtonClass('ghost')}><Ellipsis className="h-4 w-4" />Diğer</button>
        </div>
      </div>

      <div className={isWide ? 'grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_336px] 2xl:grid-cols-[minmax(0,1fr)_400px]' : 'flex min-w-0 flex-col gap-4'}>
        <main className="min-w-0 border border-sg-border bg-sg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sg-border px-4 py-3">
            <div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">AFG satırları</p><p className="mt-1 text-sm text-sg-text-soft">Gram ve avance alanlarını düzenleyin; fiyatlar oranlardan hesaplanır.</p></div>
            <button type="button" onClick={() => onOpenTool('calculator')} className={shellButtonClass('ghost')}><Calculator className="h-4 w-4" />Hesaplayıcı</button>
          </div>
          <AlisLedger title="Altın" tone="gold" rows={goldRows} expanded={expandedGroups.has('gold')} onToggle={() => onToggleGroup('gold')} onGramChange={(key, value) => state.onUpdateGoldRow(key, 'gram', value)} onAvanceChange={(key, value) => state.onUpdateGoldRow(key, 'avance_percent', value)} layoutMode={layoutMode} />
          <AlisLedger title="Gümüş" tone="silver" rows={silverRows} expanded={expandedGroups.has('silver')} onToggle={() => onToggleGroup('silver')} onGramChange={(key, value) => state.onUpdateSilverRow(key, 'gram', value)} onAvanceChange={(key, value) => state.onUpdateSilverRow(key, 'avance_percent', value)} layoutMode={layoutMode} />
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-sg-border bg-sg-surface/95 px-4 py-3 backdrop-blur">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm"><span><span className="text-sg-text-soft">Gram </span><strong className="text-sg-text">{formatNumber(totalGram, ' g')}</strong></span><span><span className="text-sg-text-soft">Teklif </span><strong className="text-sg-text">{formatMoney(String(totalOffer))}</strong></span></div>
            <div className="flex gap-2"><button type="button" onClick={onCancel} disabled={state.cancelPending} className={shellButtonClass('danger')}>İptal</button><button type="button" onClick={() => void state.onFinalizeWorkspace()} disabled={state.finalizePending || !hasSelectedCustomer} title={!hasSelectedCustomer ? 'Finalize için önce müşteri seçin veya oluşturun' : undefined} className={shellButtonClass('primary')}>{state.finalizePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}Alışı tamamla</button></div>
          </div>
        </main>

        <aside className={isWide ? 'min-w-0 self-start lg:sticky lg:top-4' : 'border border-sg-border bg-sg-surface px-4 py-3'}>
          {isWide ? <AlisInspector state={state} workspace={workspace} hasSelectedCustomer={hasSelectedCustomer} displayBridge={displayBridge} displayLabel={displayLabel} onOpenTool={onOpenTool} /> : <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sg-text-soft">İşlem bağlamı</p><p className="mt-1 text-sm text-sg-text">{hasSelectedCustomer ? workspace.customer.name : 'Müşteri seçilmedi'}</p></div><button type="button" onClick={() => onOpenTool('customer')} className={shellButtonClass('secondary')}><PanelRight className="h-4 w-4" />Bağlamı aç</button></div>}
        </aside>
      </div>
    </div>
  );
}

function AlisInspector({ state, workspace, hasSelectedCustomer, displayBridge, displayLabel, onOpenTool }: { state: ModernAlisState; workspace: NonNullable<ModernAlisState['workspace']>; hasSelectedCustomer: boolean; displayBridge?: ModernAlisDisplayBridge; displayLabel: string; onOpenTool: (tool: Exclude<ModernAlisTool, null>) => void }) {
  return (
    <div className="border border-sg-border bg-sg-surface">
      <div className="border-b border-sg-border px-4 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Müşteri</p><div className="mt-2 flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-base font-semibold text-sg-text">{hasSelectedCustomer ? workspace.customer.name : 'Müşteri seçilmedi'}</p><p className="mt-1 text-xs text-sg-text-soft">{hasSelectedCustomer ? state.customerForm.phone || 'Telefon yok' : 'Finalize öncesi gerekli'}</p></div><DataPill label="Ödeme" value={state.paymentMethod.toUpperCase()} tone="success" /></div><button type="button" onClick={() => onOpenTool('customer')} className={`${shellButtonClass('secondary')} mt-3 w-full justify-center`}>{hasSelectedCustomer ? 'Müşteriyi düzenle' : 'Müşteri seç'}</button></div>
      <div className="border-b border-sg-border px-4 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Piyasa oranları</p><p className="mt-1 text-sm font-semibold text-sg-text">Au {formatDecimalFixed(state.marketRates.gold_24k_dkk)} DKK/g</p><p className="mt-0.5 text-xs text-sg-text-soft">FX {formatDecimalFixed(state.marketRates.eur_dkk_fx)} · satır fiyatlarına otomatik uygulanır</p></div><button type="button" onClick={() => onOpenTool('rates')} className={shellButtonClass('ghost')}><SlidersHorizontal className="h-4 w-4" />Düzenle</button></div></div>
      <div className="border-b border-sg-border px-4 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Müşteri ekranı</p><p className="mt-1 text-sm text-sg-text">{displayLabel}</p></div>{displayBridge?.onOpenCustomerDisplay ? <button type="button" onClick={() => void displayBridge.onOpenCustomerDisplay?.()} className={shellButtonClass('ghost')}>Aç</button> : null}</div></div>
      <div className="px-4 py-4"><button type="button" onClick={() => onOpenTool('roadmap')} className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-sg-text transition hover:text-sg-accent"><span>Hazır olmayan entegrasyonlar</span><ChevronDown className="h-4 w-4" /></button></div>
    </div>
  );
}

function AlisLedger({ title, tone, rows, expanded, onToggle, onGramChange, onAvanceChange, layoutMode }: { title: string; tone: 'gold' | 'silver'; rows: ModernAlisRow[]; expanded: boolean; onToggle: () => void; onGramChange: (key: string, value: string) => void; onAvanceChange: (key: string, value: string) => void; layoutMode: AlisLayoutMode }) {
  const [revealedRows, setRevealedRows] = useState<Set<string>>(() => new Set());
  const totalGram = rows.reduce((sum, row) => sum + parseDecimalValue(row.gram), 0);
  const activeRows = rows.filter((row) => parseDecimalValue(row.gram) > 0).length;
  const visibleRows = rows.filter((row) => parseDecimalValue(row.gram) > 0 || revealedRows.has(row.key));
  const hiddenRows = rows.filter((row) => parseDecimalValue(row.gram) <= 0 && !revealedRows.has(row.key));
  const wide = layoutMode === 'wide' || layoutMode === 'ultrawide';
  return (
    <section className="border-b border-sg-border last:border-b-0">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-sg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sg-accent/50"><span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${tone === 'gold' ? 'bg-sg-amber' : 'bg-slate-400'}`} /><span className="text-sm font-semibold text-sg-text">{title}</span><span className="text-xs text-sg-text-soft">{activeRows} aktif · {formatNumber(totalGram, ' g')}</span></span><ChevronDown className={`h-4 w-4 text-sg-text-soft transition ${expanded ? 'rotate-180' : ''}`} /></button>
      {expanded ? <div className="px-4 pb-3"><div className="flex flex-wrap items-center justify-between gap-2 border-y border-sg-border-soft py-2"><div className={`min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft ${wide ? 'grid grid-cols-[minmax(0,1.4fr)_88px_96px_120px_132px] gap-3' : 'grid grid-cols-[minmax(0,1fr)_84px_92px_minmax(160px,200px)] gap-3'}`}><span>Malzeme</span><span>Gram</span><span>Avance</span><span>{wide ? 'Birim fiyat' : 'Hesap'}</span>{wide ? <span>Toplam</span> : null}</div>{hiddenRows.length > 0 ? <label className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-sg-text-soft"><span className="sr-only">Satır ekle</span><select aria-label={`${title} satırı ekle`} value="" onChange={(event) => { const key = event.target.value; if (!key) return; setRevealedRows((current) => new Set(current).add(key)); }} className="rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-sg-text"><option value="">+ Satır ekle</option>{hiddenRows.map((row) => <option key={row.key} value={row.key}>{row.name}</option>)}</select></label> : null}</div><div className="divide-y divide-sg-border-soft">{visibleRows.length > 0 ? visibleRows.map((row) => <AlisLedgerRow key={row.key} row={row} wide={wide} onGramChange={onGramChange} onAvanceChange={onAvanceChange} />) : <p className="py-4 text-sm text-sg-text-soft">Aktif satır yok. Yukarıdan bir satır ekleyin.</p>}</div></div> : null}
    </section>
  );
}

function AlisLedgerRow({ row, wide, onGramChange, onAvanceChange }: { row: ModernAlisRow; wide: boolean; onGramChange: (key: string, value: string) => void; onAvanceChange: (key: string, value: string) => void }) {
  const inputClass = 'w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2.5 py-2 text-sm text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/15';
  if (!wide) {
    return <div className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_100px]"><div className="min-w-0"><p className="truncate text-sm font-semibold text-sg-text">{row.name}</p><p className="mt-1 text-xs text-sg-text-soft">{row.type} · {row.karat}K · {row.lodighed} · {row.purity || '—'}%</p><p className="mt-2 text-xs text-sg-text-soft">Birim {formatMoney(row.unitPrice)}</p></div><div className="text-right"><p className="text-sm font-semibold text-sg-text">{formatMoney(row.total)}</p><label className="mt-2 block text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-sg-text-soft">Gram<input inputMode="decimal" value={row.gram} onChange={(event) => onGramChange(row.key, event.target.value)} className={inputClass} /></label><label className="mt-2 block text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-sg-text-soft">Avance<input inputMode="decimal" value={row.avance} onChange={(event) => onAvanceChange(row.key, event.target.value)} className={inputClass} /></label></div></div>;
  }
  return <div className="grid grid-cols-[minmax(0,1.4fr)_88px_96px_120px_132px] items-center gap-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-sg-text">{row.name}</p><p className="mt-1 truncate text-xs text-sg-text-soft">{row.type} · {row.karat}K · {row.lodighed} · {row.purity || '—'}%</p></div><input aria-label={`${row.name} gram`} inputMode="decimal" value={row.gram} onChange={(event) => onGramChange(row.key, event.target.value)} className={inputClass} /><input aria-label={`${row.name} avance`} inputMode="decimal" value={row.avance} onChange={(event) => onAvanceChange(row.key, event.target.value)} className={inputClass} /><span className="text-right text-sm text-sg-text-soft">{formatMoney(row.unitPrice)}</span><span className="text-right text-sm font-semibold text-sg-text">{formatMoney(row.total)}</span></div>;
}

function AlisHistory({ state, documents, filters, onChange, onReset }: { state: ModernAlisState; documents: PosSavedPurchaseListItem[]; filters: ModernAlisListFilters; onChange: (next: Partial<ModernAlisListFilters>) => void; onReset: () => void }) {
  const total = documents.reduce((sum, document) => sum + parseDecimalValue(document.gross_amount_dkk), 0);
  return <section className="border-y border-sg-border py-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Belge geçmişi</p><h2 className="mt-1 text-xl font-bold text-sg-text">Alış kayıtları</h2></div><div className="flex gap-4 text-sm text-sg-text-soft"><span>{documents.length} belge</span><span>{formatMoney(String(total))}</span></div></div><div className="mt-4"><PurchaseFilters state={state} filters={filters} onChange={onChange} onReset={onReset} /></div><DocumentList state={state} documents={documents} /></section>;
}

function AlisToolSheet({ tool, state, hasSelectedCustomer, filters, onFilterChange, onFilterReset, unsupportedControls, onClose }: { tool: Exclude<ModernAlisTool, null>; state: ModernAlisState; hasSelectedCustomer: boolean; filters: ModernAlisListFilters; onFilterChange: (next: Partial<ModernAlisListFilters>) => void; onFilterReset: () => void; unsupportedControls: UnsupportedControlDescriptor[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, [tool]);
  const title = tool === 'customer' ? 'Müşteri' : tool === 'rates' ? 'Piyasa oranları' : tool === 'calculator' ? 'Hesaplayıcılar' : tool === 'filters' ? 'Geçmiş filtreleri' : 'Hazır olmayan entegrasyonlar';
  return <div className="fixed inset-0 z-40 flex justify-end bg-sg-text/30" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }} onClick={onClose}><div className="flex h-full w-full max-w-[620px] flex-col overflow-y-auto border-l border-sg-border bg-sg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-sg-border bg-sg-surface px-5 py-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Alış araçları</p><h2 className="mt-1 text-xl font-bold text-sg-text">{title}</h2></div><button ref={closeRef} type="button" onClick={onClose} className={shellButtonClass('ghost')} aria-label="Kapat"><X className="h-5 w-5" /></button></div><div className="p-5">{tool === 'customer' ? <>{hasSelectedCustomer ? <div className="grid gap-3 sm:grid-cols-2"><EditableCustomerFields customer={state.customerForm} setCustomer={state.setCustomerForm} onBlur={state.onCustomerBlur} compact /></div> : null}<CustomerPicker state={state} hasSelectedCustomer={hasSelectedCustomer} />{hasSelectedCustomer ? <PostalLookupHint customer={state.customerForm} setCustomer={state.setCustomerForm} onBlur={state.onCustomerBlur} /> : null}</> : null}{tool === 'rates' || tool === 'calculator' ? <WorkspaceControls state={state} /> : null}{tool === 'filters' ? <PurchaseFilters state={state} filters={filters} onChange={onFilterChange} onReset={onFilterReset} /> : null}{tool === 'roadmap' ? <div className="space-y-3">{unsupportedControls.length ? unsupportedControls.map((item) => <div key={item.id} className="border-b border-sg-border-soft pb-3 last:border-b-0"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-sg-text">{item.label}</p><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sg-amber">Hazır değil</span></div><p className="mt-1 text-xs text-sg-text-soft">{item.reason}</p></div>) : <p className="text-sm text-sg-text-soft">Bu görünümde hazır olmayan kontrol bulunmuyor.</p>}</div> : null}</div></div></div>;
}

function CustomerPicker({ state, hasSelectedCustomer }: { state: ModernAlisViewModel['state']; hasSelectedCustomer: boolean }) {
  const mode = state.customerMode;
  const hasValidNewCustomer =
    state.newCustomer.name.trim().length >= 2 &&
    state.newCustomer.phone.trim().length >= 7 &&
    state.newCustomer.cpr_number.replace(/\D/g, '').length >= 10 &&
    state.newCustomer.identity_doc_number.trim().length >= 4;
  const newPostal = state.newCustomer.postal_code.replace(/\D/g, '');
  const hasValidPostal = newPostal.length === 0 || newPostal.length === 4;

  if (!mode) {
    return (
      <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Müşteri bağlantısı</p>
            <p className="mt-1 text-sm text-sg-text">Finalize öncesinde gerçek bir müşteri seçin veya oluşturun.</p>
          </div>
          {hasSelectedCustomer ? <DataPill label="Durum" value="Seçili" tone="success" /> : <DataPill label="Durum" value="Gerekli" tone="warning" />}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => state.setCustomerMode('existing')} className="rounded-sg-lg border border-sg-border bg-sg-surface p-4 text-left transition hover:border-sg-accent hover:bg-sg-accent-soft">
            <Search className="h-5 w-5 text-sg-accent" />
            <p className="mt-3 text-sm font-semibold text-sg-text">Mevcut müşteri seç</p>
            <p className="mt-1 text-xs text-sg-text-soft">İsim, CPR veya telefon ile ara.</p>
          </button>
          <button type="button" onClick={() => state.setCustomerMode('new')} className="rounded-sg-lg border border-sg-border bg-sg-surface p-4 text-left transition hover:border-sg-accent hover:bg-sg-accent-soft">
            <UserPlus className="h-5 w-5 text-sg-accent" />
            <p className="mt-3 text-sm font-semibold text-sg-text">Yeni müşteri oluştur</p>
            <p className="mt-1 text-xs text-sg-text-soft">Müşteri kartını doldurup workspace'e bağla.</p>
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'existing') {
    return (
      <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Mevcut müşteri</p>
            <p className="mt-1 text-sm text-sg-text">Gerçek müşteri kaydını seçin.</p>
          </div>
          <button type="button" onClick={() => state.setCustomerMode(null)} className={shellButtonClass('ghost')}>Kapat</button>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2">
          <Search className="h-4 w-4 text-sg-text-soft" />
          <input autoFocus value={state.customerSearchTerm} onChange={(event) => state.setCustomerSearchTerm(event.target.value)} placeholder="İsim, CPR, telefon..." className="w-full bg-transparent text-sm text-sg-text outline-none" />
        </div>
        <div className="mt-3 max-h-64 overflow-y-auto rounded-sg-md border border-sg-border bg-sg-surface">
          {state.candidateCustomers.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-sg-text-soft">Kayıtlı müşteri bulunamadı.</p>
          ) : (
            state.candidateCustomers.map((customer) => (
              <button key={customer.id} type="button" disabled={state.customerSelecting} onClick={() => state.onSelectExistingCustomer(customer.id)} className="flex w-full items-center justify-between gap-3 border-b border-sg-border-soft px-4 py-3 text-left transition last:border-b-0 hover:bg-sg-accent-soft disabled:cursor-wait disabled:opacity-60">
                <span>
                  <span className="block text-sm font-semibold text-sg-text">{customer.name}</span>
                  <span className="mt-1 block text-xs text-sg-text-soft">{customer.phone || 'Telefon yok'} · {customer.cpr_number_masked || 'CPR gizli'}</span>
                </span>
                <span className="text-xs font-semibold text-sg-accent">{state.customerSelecting ? 'Seçiliyor...' : 'Seç'}</span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(event: FormEvent) => state.onCreateNewCustomer(event)} className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Yeni müşteri</p>
          <p className="mt-1 text-sm text-sg-text">Zorunlu kimlik alanlarını tamamlayın.</p>
        </div>
        <button type="button" onClick={() => state.setCustomerMode(null)} className={shellButtonClass('ghost')}>Kapat</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ModernIdentityScanner customer={state.newCustomer} setCustomer={state.setNewCustomer} />
        <EditableCustomerFields customer={state.newCustomer} setCustomer={state.setNewCustomer} />
      </div>
      <PostalLookupHint customer={state.newCustomer} setCustomer={state.setNewCustomer} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-sg-border-soft pt-4">
        <p className="text-xs text-sg-text-soft">Ad, telefon, CPR ve kimlik belgesi zorunludur.</p>
        <button type="submit" disabled={!hasValidNewCustomer || !hasValidPostal || state.customerSelecting} className={shellButtonClass('primary')}>
          {state.customerSelecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          {state.customerSelecting ? 'Müşteri oluşturuluyor...' : 'Müşteriyi oluştur ve seç'}
        </button>
      </div>
    </form>
  );
}

function EditableCustomerFields({
  customer,
  setCustomer,
  onBlur,
  compact = false,
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onBlur?: () => void;
  compact?: boolean;
}) {
  const cprValidation = validateCpr(customer.cpr_number || '');
  return (
    <>
      {customerFields.map((field) => (
        <label key={field.key} className={compact ? 'text-xs font-semibold text-sg-text-soft' : 'text-sm font-semibold text-sg-text-soft'}>
          {field.label}
          <input
            type={field.type || 'text'}
            value={customer[field.key]}
            onChange={(event) => setCustomer((current) => ({
              ...current,
              [field.key]: field.key === 'postal_code'
                ? event.target.value.replace(/\D/g, '').slice(0, 4)
                : event.target.value,
            }))}
            onBlur={onBlur}
            className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10"
          />
          {field.key === 'cpr_number' && customer.cpr_number ? (
            <span className={`mt-1 block text-[10px] font-semibold ${cprValidation.formatOk && cprValidation.mod11Ok ? 'text-sg-green-strong' : cprValidation.formatOk ? 'text-sg-amber' : 'text-sg-red'}`}>
              {cprValidation.formatOk && cprValidation.mod11Ok ? 'CPR mod-11 doğrulandı' : cprValidation.formatOk ? 'CPR formatı tamamlandı; mod-11 uyarısı' : 'CPR formatı eksik veya geçersiz'}
            </span>
          ) : null}
        </label>
      ))}
    </>
  );
}

function ModernIdentityScanner({
  customer,
  setCustomer,
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
}) {
  const [raw, setRaw] = useState('');
  const [status, setStatus] = useState<'idle' | 'ready' | 'done' | 'error'>('idle');

  function parseIdentity() {
    const result = parseMrzLines(raw);
    const hasResult = Boolean(result.fullName || result.cprHint || result.docNumber || result.adresse || result.postnr);
    if (!hasResult) {
      setStatus('error');
      return;
    }
    setCustomer((current) => ({
      ...current,
      name: result.fullName || current.name,
      cpr_number: result.cprHint || current.cpr_number,
      identity_doc_number: result.docNumber || current.identity_doc_number,
      address: result.adresse || current.address,
      postal_code: result.postnr ? result.postnr.replace(/\D/g, '').slice(0, 4) : current.postal_code,
    }));
    setStatus('done');
  }

  return (
    <div className="rounded-sg-md border border-sg-border bg-sg-surface p-3 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-xs font-semibold text-sg-text">Kimlik tarama / MRZ</p><p className="mt-1 text-[11px] text-sg-text-soft">Keyboard scanner veya yapıştırılan MRZ metni local olarak parse edilir.</p></div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${status === 'done' ? 'bg-sg-green-soft text-sg-green-strong' : status === 'error' ? 'bg-sg-red-soft text-sg-red' : 'bg-sg-surface-soft text-sg-text-soft'}`}>
          {status === 'done' ? 'Alanlar dolduruldu' : status === 'error' ? 'MRZ tanınamadı' : status === 'ready' ? 'Hazır' : 'Bekliyor'}
        </span>
      </div>
      <textarea value={raw} onChange={(event) => { setRaw(event.target.value); setStatus(event.target.value.trim() ? 'ready' : 'idle'); }} rows={2} placeholder="MRZ / kimlik metnini buraya yapıştırın" className="mt-3 w-full rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2 font-mono text-xs text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10" />
      <div className="mt-2 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setRaw(''); setStatus('idle'); }} className={shellButtonClass('ghost')}>Temizle</button><button type="button" onClick={parseIdentity} disabled={!raw.trim()} className={shellButtonClass('secondary')}>Alanları doldur</button></div>
    </div>
  );
}

function PostalLookupHint({
  customer,
  setCustomer,
  onBlur,
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onBlur?: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'not_found' | 'unavailable'>('idle');
  const autoCityRef = useRef('');
  const normalizedPostalCode = customer.postal_code.replace(/\D/g, '').slice(0, 4);

  useEffect(() => {
    if (normalizedPostalCode.length !== 4) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const timeoutId = window.setTimeout(() => {
      void apiRequest<PosPostalLookup>(`/api/v2/alis/postal-lookup/${normalizedPostalCode}`)
        .then((result) => {
          if (cancelled) return;
          if (!result.available) {
            setStatus('unavailable');
            return;
          }
          if (!result.found || !result.postal_district) {
            setStatus('not_found');
            return;
          }
          setStatus('ready');
          setCustomer((current) => {
            const nextCity = (result.postal_district || '').trim();
            const currentCity = current.city.trim();
            const previousAutoCity = autoCityRef.current.trim();
            if (!nextCity || (currentCity && currentCity !== previousAutoCity)) return current;
            autoCityRef.current = nextCity;
            return current.city === nextCity ? current : { ...current, city: nextCity };
          });
          window.setTimeout(() => onBlur?.(), 0);
        })
        .catch(() => {
          if (!cancelled) setStatus('unavailable');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [normalizedPostalCode, setCustomer]);

  if (status === 'idle') return null;
  const message = status === 'loading'
    ? 'Posta kodu aranıyor...'
    : status === 'ready'
      ? 'Şehir posta kodundan dolduruldu.'
      : status === 'not_found'
        ? 'Bu posta kodu bulunamadı.'
        : 'Posta servisi kullanılamıyor.';
  const tone = status === 'ready' ? 'text-sg-green-strong' : status === 'not_found' || status === 'unavailable' ? 'text-sg-amber' : 'text-sg-text-soft';
  return <p className={`mt-2 text-xs font-semibold ${tone}`}>{message}</p>;
}

function WorkspaceControls({ state }: { state: ModernAlisViewModel['state'] }) {
  return (
    <div className="mt-4 rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">İşlem ayarları</p>
          <p className="mt-1 text-sm text-sg-text">AFG numarası, tam oran matrisi ve hesaplayıcılar gerçek workspace state'ine bağlıdır.</p>
        </div>
        <div className="inline-flex rounded-sg-md border border-sg-border bg-sg-surface p-1">
          {(['system', 'excel'] as const).map((view) => (
            <button key={view} type="button" onClick={() => void state.setActiveWorkspaceView(view)} className={`rounded-sg-sm px-3 py-1.5 text-xs font-semibold transition ${state.activeWorkspaceView === view ? 'bg-sg-accent text-white' : 'text-sg-text-soft hover:bg-sg-surface-soft'}`}>
              {view === 'system' ? 'System' : 'Excel'}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <WorkspaceInput label="AFG no" value={state.numbering.afregnings_number_next} onChange={(value) => state.onUpdateNumbering('afregnings_number_next', value)} />
        <WorkspaceInput label="Invoice no" value={state.numbering.invoice_number_next} onChange={(value) => state.onUpdateNumbering('invoice_number_next', value)} />
        <WorkspaceInput label="Reg.nr." value={state.bankInfo.reg_number || ''} onChange={(value) => state.setBankInfo((current) => ({ ...current, reg_number: value }))} />
        <WorkspaceInput label="Kontonr." value={state.bankInfo.account_number || ''} onChange={(value) => state.setBankInfo((current) => ({ ...current, account_number: value }))} />
        <div className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-xs text-sg-text-soft">
          <span className="block font-semibold uppercase tracking-[0.14em]">Ödeme</span>
          <span className="mt-1 block text-sm font-semibold text-sg-text">Bankoverførsel</span>
        </div>
      </div>
      <ModernRatesPanel state={state} />
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <ModernCalculatorPanel
          title="Gold hesaplayıcı"
          kind="gold_rows"
          rows={state.calculators.gold_rows}
          targets={GOLD_MATRIX_ROWS.map((row) => ({ value: `gold:${row.key}`, label: row.label }))}
          setCalculators={state.setCalculators}
          onApply={(rowKey, total) => state.onUpdateGoldRow(rowKey, 'gram', total)}
        />
        <ModernCalculatorPanel
          title="Silver hesaplayıcı"
          kind="silver_rows"
          rows={state.calculators.silver_rows}
          targets={SILVER_MATRIX_ROWS.map((row) => ({ value: `silver:${row.key}`, label: row.label }))}
          setCalculators={state.setCalculators}
          onApply={(rowKey, total) => state.onUpdateSilverRow(rowKey, 'gram', total)}
        />
      </div>
      <label className="mt-3 block text-xs font-semibold text-sg-text-soft">
        AFG notu
        <textarea value={state.afgNote} onChange={(event) => state.setAfgNote(event.target.value)} rows={2} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10" placeholder="İşlem notu" />
      </label>
    </div>
  );
}

function ModernRatesPanel({ state }: { state: ModernAlisViewModel['state'] }) {
  return (
    <div className="mt-4 rounded-sg-lg border border-sg-border bg-sg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Piyasa oranları</p>
          <p className="mt-1 text-xs text-sg-text-soft">EUR truth → FX → DKK. Gold ve Silver alanları matrisle birlikte güncellenir.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DataPill label="Au 24K" value={`${formatDecimalFixed(state.marketRates.gold_24k_dkk)} DKK/g`} tone="warning" />
          <DataPill label="FX" value={formatDecimalFixed(state.marketRates.eur_dkk_fx)} tone="neutral" />
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-sg-md border border-sg-border-soft bg-sg-surface-soft p-3">
          <p className="text-xs font-semibold text-sg-text">Gold EUR / gram</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {GOLD_MATRIX_ROWS.map((row) => (
              <RateInput
                key={row.key}
                label={`${row.label} · ${row.lodighed}`}
                value={state.marketRates.gold_rates_eur?.[row.key] || ''}
                dkk={formatDecimalFixed(parseDecimalValue(state.marketRates.gold_rates_eur?.[row.key]) * (parseDecimalValue(state.marketRates.eur_dkk_fx) || 1))}
                onChange={(value) => state.setMarketRates((current) => syncMarketRateState(current, { gold_rates_eur: { ...current.gold_rates_eur, [row.key]: normalizeTextInput(value) } }))}
              />
            ))}
          </div>
        </div>
        <div className="rounded-sg-md border border-sg-border-soft bg-sg-surface-soft p-3">
          <p className="text-xs font-semibold text-sg-text">Silver EUR / gram</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {SILVER_MATRIX_ROWS.map((row) => (
              <RateInput
                key={row.key}
                label={`${row.label} · ${row.lodighed}`}
                value={state.marketRates.silver_rates_eur?.[row.key] || ''}
                dkk={formatDecimalFixed(parseDecimalValue(state.marketRates.silver_rates_eur?.[row.key]) * (parseDecimalValue(state.marketRates.eur_dkk_fx) || 1))}
                onChange={(value) => state.setMarketRates((current) => syncMarketRateState(current, { silver_rates_eur: { ...current.silver_rates_eur, [row.key]: normalizeTextInput(value) } }))}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <WorkspaceInput label="EUR / DKK FX" value={state.marketRates.eur_dkk_fx} onChange={(value) => state.setMarketRates((current) => syncMarketRateState(current, { eur_dkk_fx: normalizeTextInput(value) }))} />
        <CommittedRateInput
          label="Au 24K DKK/g · tüm karatlara uygula"
          value={state.marketRates.gold_24k_dkk}
          onCommit={(value) => state.setMarketRates((current) => syncMarketRateState(current, { gold_24k_dkk: value }))}
        />
        <ReadOnlyMetric label="Silver DKK" value={state.marketRates.silver_dkk} />
      </div>
    </div>
  );
}

function RateInput({ label, value, dkk, onChange }: { label: string; value: string; dkk: string; onChange: (value: string) => void }) {
  return (
    <label className="rounded-sg-md border border-sg-border bg-sg-surface p-2 text-[11px] font-semibold text-sg-text-soft">
      <span className="flex items-center justify-between gap-2"><span>{label}</span><span className="font-normal text-sg-text-soft">{dkk} DKK</span></span>
      <input value={value} onChange={(event) => onChange(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-sg-sm border border-sg-border bg-sg-surface-soft px-2 py-1.5 text-sm font-normal text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10" />
    </label>
  );
}

function ReadOnlyMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2"><span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">{label}</span><span className="mt-1 block text-sm font-semibold text-sg-text">{value} DKK/g</span></div>;
}

function CommittedRateInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const normalized = normalizeTextInput(draft);
    if (parseDecimalValue(normalized) <= 0) {
      setDraft(value);
      return;
    }
    onCommit(normalized);
  };

  return (
    <label className="block text-xs font-semibold text-sg-text-soft">
      {label}
      <input
        value={draft}
        onChange={(event) => setDraft(normalizeTextInput(event.target.value))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        inputMode="decimal"
        className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10"
      />
    </label>
  );
}

function ModernCalculatorPanel({
  title,
  kind,
  rows,
  targets,
  setCalculators,
  onApply,
}: {
  title: string;
  kind: 'gold_rows' | 'silver_rows';
  rows: Array<{ row_key: string; unit_weight: string; count: string; total_weight: string; target_row_key?: string | null }>;
  targets: Array<{ value: string; label: string }>;
  setCalculators: Dispatch<SetStateAction<{ gold_rows: Array<{ row_key: string; unit_weight: string; count: string; total_weight: string; target_row_key?: string | null }>; silver_rows: Array<{ row_key: string; unit_weight: string; count: string; total_weight: string; target_row_key?: string | null }> }>>;
  onApply: (rowKey: string, total: string) => void;
}) {
  return (
    <div className="rounded-sg-lg border border-sg-border bg-sg-surface p-4">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-sg-text">{title}</p><span className="text-[11px] text-sg-text-soft">unit weight × count</span></div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? <p className="text-xs text-sg-text-soft">Hesaplayıcı satırı yok.</p> : rows.map((row) => {
          const total = formatDecimalFixed(parseDecimalValue(row.unit_weight) * parseDecimalValue(row.count));
          return (
            <div key={row.row_key} className="grid gap-2 rounded-sg-md border border-sg-border-soft bg-sg-surface-soft p-3 sm:grid-cols-[1fr_0.8fr_0.8fr_1.2fr_auto] sm:items-end">
              <label className="text-[11px] font-semibold text-sg-text-soft">Birim gram<input value={row.unit_weight} onChange={(event) => { const unitWeight = normalizeTextInput(event.target.value); const nextTotal = formatDecimalFixed(parseDecimalValue(unitWeight) * parseDecimalValue(row.count)); setCalculators((current) => ({ ...current, [kind]: current[kind].map((item) => item.row_key === row.row_key ? { ...item, unit_weight: unitWeight, total_weight: nextTotal } : item) })); }} className="mt-1 w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-sm text-sg-text outline-none focus:border-sg-accent" /></label>
              <label className="text-[11px] font-semibold text-sg-text-soft">Adet<input value={row.count} onChange={(event) => { const count = normalizeTextInput(event.target.value); const nextTotal = formatDecimalFixed(parseDecimalValue(row.unit_weight) * parseDecimalValue(count)); setCalculators((current) => ({ ...current, [kind]: current[kind].map((item) => item.row_key === row.row_key ? { ...item, count, total_weight: nextTotal } : item) })); }} className="mt-1 w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-sm text-sg-text outline-none focus:border-sg-accent" /></label>
              <div><span className="block text-[11px] font-semibold text-sg-text-soft">Toplam</span><span className="mt-1 block rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-sm font-semibold text-sg-text">{total} g</span></div>
              <label className="text-[11px] font-semibold text-sg-text-soft">Hedef satır<select value={row.target_row_key || ''} onChange={(event) => setCalculators((current) => ({ ...current, [kind]: current[kind].map((item) => item.row_key === row.row_key ? { ...item, target_row_key: event.target.value } : item) }))} className="mt-1 w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-sm text-sg-text outline-none focus:border-sg-accent"><option value="">Seçin</option>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
              <button type="button" onClick={() => row.target_row_key ? onApply(row.target_row_key, total) : undefined} disabled={!row.target_row_key} className={shellButtonClass('secondary')}>Aktar</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-semibold text-sg-text-soft">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10" />
    </label>
  );
}

function PurchaseFilters({
  state,
  filters,
  onChange,
  onReset,
}: {
  state: ModernAlisViewModel['state'];
  filters: ModernAlisListFilters;
  onChange: (next: Partial<ModernAlisListFilters>) => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,0.7fr))_auto]">
      <div className="flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2">
        <Search className="h-4 w-4 text-sg-text-soft" />
        <input value={filters.query} onChange={(event) => { onChange({ query: event.target.value }); state.setPurchaseSearchTerm(event.target.value); }} placeholder="Belge no / müşteri / CPR ara" className="w-full bg-transparent text-sm text-sg-text outline-none" />
      </div>
      <label className="flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-xs font-semibold text-sg-text-soft">
        <CalendarDays className="h-4 w-4" />
        <span className="sr-only">Başlangıç tarihi</span>
        <input type="date" value={filters.startDate} onChange={(event) => { onChange({ startDate: event.target.value }); state.setPurchaseDate(event.target.value); }} className="bg-transparent text-sm font-normal text-sg-text outline-none" />
      </label>
      <label className="flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-xs font-semibold text-sg-text-soft">
        <CalendarDays className="h-4 w-4" />
        <span className="sr-only">Bitiş tarihi</span>
        <input type="date" value={filters.endDate} onChange={(event) => onChange({ endDate: event.target.value })} className="bg-transparent text-sm font-normal text-sg-text outline-none" />
      </label>
      <div className="flex flex-wrap gap-2 lg:col-span-4 xl:col-span-1">
        <input inputMode="decimal" value={filters.minAmountDkk} onChange={(event) => onChange({ minAmountDkk: event.target.value })} placeholder="Min DKK" className="min-w-0 flex-1 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent" />
        <input inputMode="decimal" value={filters.maxAmountDkk} onChange={(event) => onChange({ maxAmountDkk: event.target.value })} placeholder="Max DKK" className="min-w-0 flex-1 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent" />
        <select value={`${filters.sort}:${filters.direction}`} onChange={(event) => { const [sort, direction] = event.target.value.split(':') as [ModernAlisListFilters['sort'], ModernAlisListFilters['direction']]; onChange({ sort, direction }); }} className="min-w-0 flex-1 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text outline-none focus:border-sg-accent">
          <option value="purchaseDate:desc">Yeni tarih</option>
          <option value="purchaseDate:asc">Eski tarih</option>
          <option value="sequence:desc">AFG no ↓</option>
          <option value="sequence:asc">AFG no ↑</option>
          <option value="customer:asc">Müşteri A-Z</option>
          <option value="amount:desc">Tutar yüksek</option>
          <option value="amount:asc">Tutar düşük</option>
        </select>
        <button type="button" onClick={onReset} className={shellButtonClass('ghost')}>Sıfırla</button>
      </div>
    </div>
  );
}

function DocumentList({ state, documents }: { state: ModernAlisViewModel['state']; documents: PosSavedPurchaseListItem[] }) {
  return (
    <>
      <div className="mt-4 hidden overflow-x-auto xl:block">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-sg-border text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
              <th className="px-3 py-2">Belge</th>
              <th className="px-3 py-2">Müşteri</th>
              <th className="px-3 py-2">Gold</th>
              <th className="px-3 py-2">Silver</th>
              <th className="px-3 py-2">Gram</th>
              <th className="px-3 py-2">DKK</th>
              <th className="px-3 py-2">Durum</th>
              <th className="px-3 py-2">Zaman</th>
              <th className="px-3 py-2">Aksiyon</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-sg-text-soft">Filtreye uyan alış bulunamadı.</td></tr>
            ) : documents.map((document) => (
              <tr key={document.sequence_no} className="border-b border-sg-border-soft align-top transition-colors hover:bg-sg-accent-soft/40">
                <td className="px-3 py-3 font-medium text-sg-text"><PreviewPopover label={document.document_number}><p className="font-semibold">AFG {document.document_number}</p><p className="mt-1 text-xs text-sg-text-soft">{document.line_count} satır · {formatRelativeTime(document.issued_at)}</p></PreviewPopover></td>
                <td className="px-3 py-3 text-sg-text-soft"><PreviewPopover label={document.customer_name || 'Müşteri yok'}><p className="font-semibold">{document.customer_name || 'Müşteri yok'}</p><p className="mt-1 text-xs">{document.customer_phone || 'Telefon yok'}</p><p className="text-xs">{document.customer_email || 'E-posta yok'}</p></PreviewPopover></td>
                <td className="px-3 py-3 text-sg-text-soft"><PreviewPopover label={`${document.gold_preview_items?.length || 0} satır`}><PreviewRows rows={document.gold_preview_items} /></PreviewPopover></td>
                <td className="px-3 py-3 text-sg-text-soft"><PreviewPopover label={`${document.silver_preview_items?.length || 0} satır`}><PreviewRows rows={document.silver_preview_items} /></PreviewPopover></td>
                <td className="px-3 py-3 text-sg-text-soft">{formatNumber(document.total_weight_grams, ' g')}</td>
                <td className="px-3 py-3 text-sg-text-soft">{formatMoney(document.gross_amount_dkk)}</td>
                <td className="px-3 py-3 text-xs text-sg-text-soft"><PreviewPopover label={document.uniconta_sync_status || '—'}>{document.uniconta_sync_error ? <p className="text-sg-red">{document.uniconta_sync_error}</p> : <p>Invoice: {document.uniconta_invoice_number || '—'}</p>}</PreviewPopover></td>
                <td className="whitespace-nowrap px-3 py-3 text-sg-text-soft">{formatRelativeTime(document.issued_at)}</td>
                <td className="px-3 py-3"><DocumentActions state={state} document={document} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid gap-3 xl:hidden">
        {documents.length === 0 ? <p className="rounded-sg-lg border border-dashed border-sg-border px-4 py-8 text-center text-sm text-sg-text-soft">Filtreye uyan alış bulunamadı.</p> : documents.map((document) => (
          <div key={document.sequence_no} className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-sm font-semibold text-sg-text">{document.document_number}</p><p className="mt-1 text-xs text-sg-text-soft">{document.customer_name || 'Müşteri yok'}</p></div>
              <span className="text-xs text-sg-text-soft">{formatRelativeTime(document.issued_at)}</span>
            </div>
            <dl className="mt-3 grid gap-2 text-sm"><MobileRow label="Gold" value={`${document.gold_preview_items?.length || 0} satır`} /><MobileRow label="Silver" value={`${document.silver_preview_items?.length || 0} satır`} /><MobileRow label="Gram" value={formatNumber(document.total_weight_grams, ' g')} /><MobileRow label="DKK" value={formatMoney(document.gross_amount_dkk)} /><MobileRow label="Durum" value={document.uniconta_sync_status || '—'} /></dl>
            <div className="mt-3"><DocumentActions state={state} document={document} /></div>
          </div>
        ))}
      </div>
    </>
  );
}

function PreviewPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button type="button" aria-expanded={open} className="rounded-sg-sm text-left underline decoration-dotted underline-offset-2 transition hover:text-sg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent/40">{label}</button>
      {open ? <span role="dialog" className="absolute left-0 top-full z-30 mt-2 min-w-56 max-w-80 rounded-sg-md border border-sg-border bg-sg-surface p-3 text-xs text-sg-text shadow-xl">{children}</span> : null}
    </span>
  );
}

function PreviewRows({ rows }: { rows: PosSavedPurchaseListItem['gold_preview_items'] }) {
  if (!rows?.length) return <p className="text-sg-text-soft">Satır yok.</p>;
  return <div className="space-y-1">{rows.map((row) => <div key={`${row.line_no}-${row.type_label}`} className="flex items-center justify-between gap-3"><span>{row.type_label}</span><span className="font-semibold">{formatNumber(row.weight_grams, ' g')} · {formatMoney(row.line_total_dkk)}</span></div>)}</div>;
}

function DocumentActions({ state, document }: { state: ModernAlisViewModel['state']; document: PosSavedPurchaseListItem }) {
  const busy = state.actionPendingSequenceNo === document.sequence_no;
  const canRetry = document.uniconta_sync_status === 'failed' || document.uniconta_sync_status === 'skipped';
  const canCancelInvoice = document.uniconta_sync_status === 'synced' && Boolean(document.uniconta_invoice_number);
  return (
    <div className="flex min-w-[220px] flex-wrap gap-1.5">
      <button type="button" onClick={() => state.onViewDocument(document)} className={shellButtonClass('ghost')}>Detay</button>
      <button type="button" onClick={() => state.onOpenDocumentExcelPreview(document)} className={shellButtonClass('ghost')}><FileSpreadsheet className="h-3.5 w-3.5" />Office</button>
      <button type="button" onClick={() => state.onExportDocument(document)} disabled={busy} className={shellButtonClass('ghost')}><Download className="h-3.5 w-3.5" />Dışa aktar</button>
      <button type="button" onClick={() => state.onPrintDocument(document)} disabled={busy} className={shellButtonClass('ghost')}><Printer className="h-3.5 w-3.5" />Yazdır</button>
      <button type="button" onClick={() => state.onOpenCustomer(document)} disabled={busy || !document.customer_id} title={!document.customer_id ? 'Bu belgede müşteri bağlantısı yok' : undefined} className={shellButtonClass('ghost')}>Müşteri</button>
      <button type="button" onClick={() => state.onStartFromCustomer(document)} disabled={busy || !document.customer_id} title={!document.customer_id ? 'Yeni alış için müşteri bağlantısı gerekli' : undefined} className={shellButtonClass('ghost')}><Plus className="h-3.5 w-3.5" />Yeni</button>
      <button type="button" onClick={() => state.onEditDocument(document)} disabled={busy || !document.can_edit} title={!document.can_edit ? 'Bu belge düzenlenebilir değil' : undefined} className={shellButtonClass('ghost')}><Pencil className="h-3.5 w-3.5" />Düzenle</button>
      <button type="button" onClick={() => state.onDeleteDocument(document)} disabled={busy || !document.can_delete} title={!document.can_delete ? 'Bu belge silinebilir değil' : undefined} className={shellButtonClass('ghost')}><Trash2 className="h-3.5 w-3.5" />Sil</button>
      {canRetry ? <button type="button" onClick={() => state.onRetryUnicontaSync(document)} disabled={state.retryPendingSequenceNo === document.sequence_no} className={shellButtonClass('ghost')}>Uniconta tekrar</button> : null}
      {canCancelInvoice ? <button type="button" disabled title="Uniconta fatura iptal servisi hazır değil" className={shellButtonClass('ghost')}>Fatura iptal · hazır değil</button> : null}
    </div>
  );
}

function EditableRowsCard({ title, rows, onGramChange, onAvanceChange }: { title: string; rows: Array<{ key: string; name: string; type: string; purity: string; karat: string; lodighed: string; rate: string; unitPrice: string; gram: string; avance: string; total: string }>; onGramChange: (key: string, value: string) => void; onAvanceChange: (key: string, value: string) => void }) {
  return (
    <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">{title}</p>
      <div className="mt-3 grid gap-3">
        {rows.length === 0 ? <p className="text-sm text-sg-text-soft">Satır yok.</p> : rows.map((row) => (
          <div key={row.key} className="rounded-sg-lg border border-sg-border bg-sg-surface p-3">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-sg-text">{row.name}</p><p className="text-xs text-sg-text-soft">Tip {row.type} · {row.karat}K · {row.lodighed} · {row.purity || '—'}%</p></div><p className="text-sm font-semibold text-sg-text-soft">{formatMoney(row.total)}</p></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-[11px] font-semibold text-sg-text-soft">Gram<input value={row.gram} onChange={(event) => onGramChange(row.key, event.target.value)} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10" /></label>
              <label className="text-[11px] font-semibold text-sg-text-soft">Avance %<input value={row.avance} onChange={(event) => onAvanceChange(row.key, event.target.value)} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10" /></label>
              <div className="text-[11px] font-semibold text-sg-text-soft">Birim fiyat<span className="mt-1 block rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2 text-sm text-sg-text">{formatMoney(row.unitPrice)}</span></div>
              <div className="text-[11px] font-semibold text-sg-text-soft">Toplam<span className="mt-1 block rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2 text-sm text-sg-text">{formatMoney(row.total)}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModernDetailModal({ source, detail, loading, error, onClose, onEdit, onDelete, onPreview, onExport, onPrint, actionPending, onRetry }: { source: PosSavedPurchaseListItem | null; detail: PosDocumentDetail | null; loading: boolean; error?: string | null; onClose: () => void; onEdit: () => void; onDelete: () => void; onPreview: () => void; onExport: () => void; onPrint: () => void; actionPending: boolean; onRetry?: () => void }) {
  const address = [detail?.customer_address, detail?.customer_city || source?.customer_city, detail?.customer_postal_code || source?.customer_postal_code].filter(Boolean).join(', ');
  const cpr = detail?.customer_cpr || source?.customer_cpr || detail?.customer_cpr_masked || source?.customer_cpr_masked || '—';
  const identity = detail?.customer_identity_doc_number || source?.customer_identity_doc_number || detail?.customer_identity_doc_number_masked || '—';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sg-text/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-sg-xl border border-sg-border bg-sg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-sg-border bg-sg-surface px-5 py-4">
          <div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Afregningsbilag</p><h2 className="mt-1 text-xl font-bold text-sg-text">{detail?.document_number || source?.document_number || 'Belge detayı'}</h2></div>
          <button type="button" onClick={onClose} className={shellButtonClass('ghost')} aria-label="Detayı kapat"><X className="h-5 w-5" /></button>
        </div>
        {error ? (
          <div className="px-5 py-12 text-center"><p className="text-sm font-semibold text-sg-red">Belge detayı yüklenemedi.</p><p className="mt-2 text-xs text-sg-text-soft">{error}</p><div className="mt-4 flex justify-center gap-2"><button type="button" onClick={onRetry} className={shellButtonClass('secondary')}><RefreshCcw className="h-4 w-4" />Tekrar dene</button><button type="button" onClick={onClose} className={shellButtonClass('ghost')}>Kapat</button></div></div>
        ) : loading || !detail ? <div className="px-5 py-12 text-center text-sm text-sg-text-soft">Belge detayları yükleniyor...</div> : (
          <div className="space-y-5 p-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Müşteri</p><dl className="mt-3 grid gap-2 text-sm"><MobileRow label="Ad" value={detail.customer_name || '—'} /><MobileRow label="CPR" value={cpr} /><MobileRow label="Telefon" value={detail.customer_phone || '—'} /><MobileRow label="E-posta" value={detail.customer_email || '—'} /><MobileRow label="Kimlik" value={identity} /><MobileRow label="Adres" value={address || '—'} /></dl></div>
              <div className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Ödeme ve işlem</p><dl className="mt-3 grid gap-2 text-sm"><MobileRow label="Toplam" value={formatMoney(detail.gross_amount_dkk)} /><MobileRow label="Ödeme" value={detail.payment_method || 'bank'} /><MobileRow label="Reg.nr." value={detail.bank_reg_number || '—'} /><MobileRow label="Kontonr." value={detail.bank_account_number || '—'} /><MobileRow label="Tarih" value={new Date(detail.issued_at).toLocaleString('tr-TR')} /></dl></div>
            </div>
            <div className="overflow-x-auto rounded-sg-lg border border-sg-border"><table className="min-w-full text-sm"><thead className="bg-sg-surface-soft"><tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft"><th className="px-3 py-2">Tür</th><th className="px-3 py-2">Saflık</th><th className="px-3 py-2">Avance</th><th className="px-3 py-2">Gram</th><th className="px-3 py-2">Tutar</th></tr></thead><tbody>{detail.lines.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-sg-text-soft">Ürün satırı yok.</td></tr> : detail.lines.map((line) => <tr key={line.id} className="border-t border-sg-border-soft"><td className="px-3 py-3 font-semibold text-sg-text">{line.metal_type || line.product_type || '—'}</td><td className="px-3 py-3 text-sg-text-soft">{line.purity_karat || line.purity_percentage || '—'}</td><td className="px-3 py-3 text-sg-text-soft">{line.margin_percent || '0'}%</td><td className="px-3 py-3 text-sg-text-soft">{formatNumber(line.weight_grams, ' g')}</td><td className="px-3 py-3 text-sg-text-soft">{formatMoney(line.line_total_dkk)}</td></tr>)}</tbody></table></div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-sg-border-soft pt-4"><button type="button" onClick={onPreview} className={shellButtonClass('secondary')}><FileSpreadsheet className="h-4 w-4" />Office</button><button type="button" onClick={onExport} className={shellButtonClass('secondary')}><Download className="h-4 w-4" />Dışa aktar</button><button type="button" onClick={onPrint} className={shellButtonClass('secondary')}><Printer className="h-4 w-4" />Yazdır</button><button type="button" onClick={onDelete} disabled={!detail.can_delete || actionPending} className={shellButtonClass('danger')}><Trash2 className="h-4 w-4" />Sil</button><button type="button" onClick={onEdit} disabled={!detail.can_edit || actionPending} className={shellButtonClass('primary')}><Pencil className="h-4 w-4" />Düzenle</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3"><dt className="font-semibold text-sg-text-soft">{label}</dt><dd className="text-right text-sg-text">{value}</dd></div>;
}
