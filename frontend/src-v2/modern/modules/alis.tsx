import { AFG_DECLARATION_HEADER, AFG_DECLARATION_ITEMS, FIRMA_FOOTER_LINE } from '@/lib/firma';
import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import {
  Ban,
  Calculator,
  Camera,
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
  Repeat2,
  Search,
  SlidersHorizontal,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';

import { formatMoney, formatNumber, formatRelativeTime, labelProductType, labelMetalType } from '@/lib/format';
import { validateCpr } from '@/lib/cpr';
import { ALIS_SHORTCUT_HINT } from '@/lib/shortcutHints';
import { useConfirm } from '@/components/ConfirmDialog';
import { GOLD_MATRIX_ROWS, SILVER_MATRIX_ROWS, formatDecimalFixed, parseDecimalValue, syncMarketRateState } from '@/make/alis/marketRates';
import { RelinkCustomerModal } from '@/make/alis/RelinkCustomerModal';
import { resolveCustomerPanelView } from '@/make/alis/customerPanelState';
import type { AlisPageProps } from '@/make/alis/AlisPage';
import { EmbeddedWorkbookPanel } from '@/make/embedded/EmbeddedWorkbookPanel';
import { useAddressAutocomplete } from '@/make/alis/addressAutocomplete';
import { useCustomerMatch } from '@/make/alis/customerMatch';
import { type IdentityFieldName, useIdentityScan } from '@/make/alis/identityScan';
import type { PosDocumentDetail, PosSavedPurchaseListItem } from '@/types';
import type { EditableCustomer } from '@/make/alis/types';
import type { ModernAlisViewModel } from '@/modern/adapters/alis';
import type { UnsupportedControlDescriptor } from '@/modern/adapters/types';
import { CommittedNumericInput } from '@/shared/forms/CommittedNumericInput';

import { DataPill, EmptyState, LoadingState, ModernModuleShell, shellButtonClass } from './shared';
import { ModernDialog, ModernDrawer } from '@/modern/design-system';
import { HistoricalAfgImportDrawer } from './alis/HistoricalAfgImportDrawer';
import { useAlisLayoutMode, type AlisLayoutMode } from './alis/useAlisLayoutMode';

const customerFields: Array<{ key: keyof EditableCustomer; label: string; type?: 'text' | 'email' }> = [
  { key: 'name', label: 'Ad Soyad' },
  { key: 'cpr_number', label: 'CPR nr.' },
  { key: 'identity_doc_number', label: 'Kimlik / Pasaport' },
  { key: 'identity_doc_type', label: 'Belge türü' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'E-posta', type: 'email' },
  { key: 'address', label: 'Adres' },
  { key: 'postal_code', label: 'Posta kodu' },
  { key: 'city', label: 'Şehir' },
];

type ModernAlisDisplayBridge = Pick<AlisPageProps, 'desktopDisplayState' | 'expectedDisplayRoute' | 'routeMatches' | 'onOpenCustomerDisplay' | 'onCloseCustomerDisplay'>;

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
  const confirm = useConfirm();
  const [pane, setPane] = useState<ModernAlisPane>('workspace');
  const [tool, setTool] = useState<ModernAlisTool>(null);
  const [historicalImportOpen, setHistoricalImportOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<'gold' | 'silver' | 'ptpd'>>(() => new Set(['gold']));
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
      if (listFilters.sort === 'customer') comparison = String(left.customer_name || '').localeCompare(String(right.customer_name || ''), document.documentElement.lang);
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

  // Düzenleme kipinde (çalışma alanında kaydedilmemiş değişiklik varken) detay
  // kapama yolu arka plan tıklamasıyla sessizce iptal edemez; onay ister.
  function closeDetail() {
    if (!viewModel.blocker?.when) {
      state.onCloseDetail();
      return;
    }
    void confirm({
      title: 'Kaydedilmemiş değişiklikler',
      message: 'Alış çalışma alanında kaydedilmemiş değişiklikler var. Detay ekranı yine de kapatılsın mı?',
      confirmText: 'Kapat',
      cancelText: 'Vazgeç',
      variant: 'warning',
    }).then((approved) => {
      if (approved === true) state.onCloseDetail();
    });
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
          <DataPill label="Yüzey" value={state.activeWorkspaceView === 'excel' ? 'Excel' : 'Sistem'} tone={state.activeWorkspaceView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Taslak" value={state.draftWorkspace ? state.draftWorkspace.session.session_code : 'Yok'} tone={state.draftWorkspace ? 'warning' : 'neutral'} />
          <DataPill label="Müşteri" value={hasWorkspace ? (hasSelectedCustomer ? 'Seçili' : 'Bekliyor') : '—'} tone={hasSelectedCustomer ? 'success' : 'warning'} />
          <DataPill label="Kısayol" value={ALIS_SHORTCUT_HINT} tone="neutral" />
        </>
      }
      actions={
        <>
          <button type="button" onClick={() => setHistoricalImportOpen(true)} className={shellButtonClass('secondary')}>
            <FileSpreadsheet className="h-4 w-4" />
            Tarihsel AFG içe aktar
          </button>
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
        </>
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
                      onOpenTool={(nextTool) => { if (nextTool === 'customer' && !state.customerMode) state.setCustomerMode('existing'); setTool(nextTool); }}
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
              <AlisToolDrawer
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
                onClose={closeDetail}
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
      <HistoricalAfgImportDrawer
        open={historicalImportOpen}
        onClose={() => setHistoricalImportOpen(false)}
        onImported={() => { void state.onRetryDocuments?.(); setPane('history'); }}
      />
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
  return (
    <div className="flex min-h-0 h-full flex-1 flex-col overflow-hidden rounded-sg-xl border border-sg-border bg-sg-surface shadow-sg-md">
      <EmbeddedWorkbookPanel kind="alis-workspace" artifactKey={workspaceId} layoutMode="workspace" onClose={onClose} variant="modern" />
    </div>
  );
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
          <p className="mt-2 max-w-xl text-sm text-sg-text-soft">Müşteri, metal satırları ve ödeme bilgileri gerçek çalışma alanı durumu ile kaydedilir.</p>
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

function AlisWorkbench({ state, workspace, hasSelectedCustomer, displayBridge, displayLabel, layoutMode, expandedGroups, onToggleGroup, onOpenTool, onCancel }: { state: ModernAlisState; workspace: NonNullable<ModernAlisState['workspace']>; hasSelectedCustomer: boolean; displayBridge?: ModernAlisDisplayBridge; displayLabel: string; layoutMode: AlisLayoutMode; expandedGroups: Set<'gold' | 'silver' | 'ptpd'>; onToggleGroup: (group: 'gold' | 'silver' | 'ptpd') => void; onOpenTool: (tool: Exclude<ModernAlisTool, null>) => void; onCancel: () => void }) {
  const barRowsAll = state.barRows || [];
  const goldBarRows: ModernAlisRow[] = barRowsAll.filter((row) => row.bar_type === 'gold').map((row) => ({ key: row.row_key, name: row.label, type: 'Bar', purity: row.purity_percentage, karat: '24', lodighed: row.lodighed, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }));
  const silverBarRows: ModernAlisRow[] = barRowsAll.filter((row) => row.bar_type === 'silver').map((row) => ({ key: row.row_key, name: row.label, type: 'Bar', purity: row.purity_percentage, karat: '—', lodighed: row.lodighed, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }));
  const ptpdRows: ModernAlisRow[] = (state.ptpdRows || []).map((row) => ({ key: row.row_key, name: row.label, type: row.metal === 'platinum' ? '8' : '9', purity: row.purity_percentage, karat: '—', lodighed: row.lodighed, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }));
  // R2-01: dinamik kniv/ceyrek satirlari metal bazinda mevcut gruplara dagitilir.
  // R2-10 takip: '22b' karatli satir "Altın" tipinde görünür (Çeyrek değil).
  const extraAll = state.extraRows || [];
  const extraGoldRows: ModernAlisRow[] = extraAll.filter((row) => row.metal === 'gold').map((row) => ({ key: row.row_key, name: row.label, type: row.karat === '22b' ? 'Altın' : row.kind === 'quarter' ? 'Çeyrek' : 'Kniv', purity: row.purity_percentage, karat: row.karat, lodighed: '—', unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }));
  const extraSilverRows: ModernAlisRow[] = extraAll.filter((row) => row.metal === 'silver').map((row) => ({ key: row.row_key, name: row.label, type: row.kind === 'quarter' ? 'Çeyrek' : 'Kniv', purity: row.purity_percentage, karat: '—', lodighed: row.karat, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }));
  const goldRows: ModernAlisRow[] = [
    ...state.goldRows.map((row) => ({ key: row.row_key, name: row.label || row.karat || 'Altın', type: 'Altın', purity: row.purity_percentage, karat: row.karat, lodighed: row.lodighed, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk })),
    ...goldBarRows,
    ...extraGoldRows,
  ];
  const silverRows: ModernAlisRow[] = [
    ...state.silverRows.map((row) => ({ key: row.row_key, name: row.label || row.type_code || 'Gümüş', type: row.type_code, purity: row.purity_percentage, karat: '—', lodighed: row.lodighed, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk })),
    ...silverBarRows,
    ...extraSilverRows,
  ];
  // R2-10 takip / roadmap madde 2: sabit grid backend karat eşleşmesi yüzünden
  // 22b taşımaz; 22K-2 burada dropdown'a suni gizli satır olarak sunulur.
  // Seçilince boş (gram 0) quarter-extra satırı (karat '22b') oluşturulur.
  if (!extraAll.some((row) => row.metal === 'gold' && row.karat === '22b')) {
    goldRows.push({ key: 'extra:add-22b', name: '22K-2', type: 'Altın', purity: '91.67', karat: '22', lodighed: '916', unitPrice: state.marketRates.gold_rates_dkk?.['22b'] || '0', gram: '0', avance: '0', total: '0' });
  }
  const totalGram = [...goldRows, ...silverRows, ...ptpdRows].reduce((sum, row) => sum + parseDecimalValue(row.gram), 0);
  const totalOffer = [...goldRows, ...silverRows, ...ptpdRows].reduce((sum, row) => sum + parseDecimalValue(row.total), 0);
  const vatAmount = state.purchaseVatEnabled ? Math.round(totalOffer * 0.25 * 100) / 100 : 0;
  const grossOffer = totalOffer + vatAmount;
  const isWide = layoutMode === 'wide' || layoutMode === 'ultrawide';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sg-border pb-3">
        <div className="flex min-w-0 items-center gap-3"><span className="h-2.5 w-2.5 rounded-full bg-sg-amber" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-sg-text">{workspace.customer.name || 'Müşteri bekleniyor'}</p><p className="text-xs text-sg-text-soft">{state.finalizePending ? 'Kaydediliyor...' : 'Taslak otomatik kaydediliyor'} · {displayLabel}</p></div></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenTool('customer')} className={shellButtonClass(hasSelectedCustomer ? 'secondary' : 'warning')}><Users className="h-4 w-4" />{hasSelectedCustomer ? 'Müşteri' : 'Müşteri seç'}</button>
          {(() => {
            // Klasikteki "Çalışma Dosyası" butonuyla parite: dosya adı görünür,
            // kilitliyken nedeni tooltip'te söylenir.
            const workbookName = `${workspace.numbering_preview.afregnings_number_next || workspace.session.session_code}.xlsm`;
            const syncPending = Boolean(state.hasPendingWorkspaceSync?.());
            return (
              <button
                type="button"
                onClick={state.onOpenWorkspaceExcelPreview}
                disabled={syncPending}
                title={syncPending
                  ? 'Otomatik kayıt sürüyor — senkron bitince Excel görünümü açılabilir.'
                  : `Çalışma alanını Excel görünümünde aç (${workbookName})`}
                className={shellButtonClass('secondary')}
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span className="flex min-w-0 flex-col text-left leading-tight">
                  <span>Excel görünümü</span>
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-sg-text-soft">{workbookName}</span>
                </span>
              </button>
            );
          })()}
          <button type="button" onClick={state.onPrintWorkspace} className={shellButtonClass('ghost')}><Printer className="h-4 w-4" />Yazdır</button>
          {displayBridge?.onOpenCustomerDisplay && !isWide ? <button type="button" onClick={() => void displayBridge.onOpenCustomerDisplay?.()} className={shellButtonClass('ghost')}>Müşteri ekranı</button> : null}
          <button type="button" onClick={() => onOpenTool('roadmap')} className={shellButtonClass('ghost')}><Ellipsis className="h-4 w-4" />Diğer</button>
        </div>
      </div>

      <div className={isWide ? 'grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_336px] 2xl:grid-cols-[minmax(0,1fr)_400px]' : 'flex min-w-0 flex-col gap-4'}>
        <main className="min-w-0 border border-sg-border bg-sg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sg-border px-4 py-3">
            <div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">AFG satırları</p><p className="mt-1 text-sm text-sg-text-soft">Gram ve avance alanlarını düzenleyin; fiyatlar oranlardan hesaplanır.</p></div>
            <button type="button" onClick={() => onOpenTool('calculator')} className={shellButtonClass('ghost')}><Calculator className="h-4 w-4" />Kniv beregner</button>
          </div>
          <AlisLedger title="Altın" tone="gold" rows={goldRows} expanded={expandedGroups.has('gold')} onToggle={() => onToggleGroup('gold')} onGramChange={(key, value) => (key.startsWith('extra:') ? state.onUpdateExtraRow(key, 'gram', value) : key.startsWith('bar:') ? state.onUpdateBarRow(key, 'gram', value) : state.onUpdateGoldRow(key, 'gram', value))} onAvanceChange={(key, value) => (key.startsWith('extra:') ? state.onUpdateExtraRow(key, 'avance_percent', value) : key.startsWith('bar:') ? state.onUpdateBarRow(key, 'avance_percent', value) : state.onUpdateGoldRow(key, 'avance_percent', value))} onAddPresetRow={() => state.onAddExtraRows([{ kind: 'quarter', metal: 'gold', karat: '22b', label: '22K-2', gram: 0, allowEmptyGram: true }])} layoutMode={layoutMode} />
          <AlisLedger title="Gümüş" tone="silver" rows={silverRows} expanded={expandedGroups.has('silver')} onToggle={() => onToggleGroup('silver')} onGramChange={(key, value) => (key.startsWith('extra:') ? state.onUpdateExtraRow(key, 'gram', value) : key.startsWith('bar:') ? state.onUpdateBarRow(key, 'gram', value) : state.onUpdateSilverRow(key, 'gram', value))} onAvanceChange={(key, value) => (key.startsWith('extra:') ? state.onUpdateExtraRow(key, 'avance_percent', value) : key.startsWith('bar:') ? state.onUpdateBarRow(key, 'avance_percent', value) : state.onUpdateSilverRow(key, 'avance_percent', value))} layoutMode={layoutMode} />
          <AlisLedger title="Platin / Palladium" tone="silver" rows={ptpdRows} expanded={expandedGroups.has('ptpd')} onToggle={() => onToggleGroup('ptpd')} onGramChange={(key, value) => state.onUpdatePtPdRow(key, 'gram', value)} onAvanceChange={(key, value) => state.onUpdatePtPdRow(key, 'avance_percent', value)} layoutMode={layoutMode} />

          {/* Belgenin resmî alt bloğu — klasik AFG sheet'iyle aynı içerik:
              hedef hesap teyidi, imza alanı ve yasal beyan. */}
          <div className="border-t border-sg-border px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-sg-md bg-sg-green px-4 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">Overføres til konto</p>
              <p className="text-sm font-bold text-white">
                {state.bankInfo.reg_number && state.bankInfo.account_number
                  ? `${state.bankInfo.reg_number} — ${state.bankInfo.account_number}`
                  : state.bankInfo.reg_number || state.bankInfo.account_number || '—'}
              </p>
            </div>
            <div className="mt-4 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Underskrift</p>
                <div className="mb-2 mt-4 h-12 border-b-2 border-sg-border" />
                <p className="text-xs text-sg-text-soft">{state.customerForm.name || 'Müşteri adı'} — {new Date().toLocaleDateString('da-DK')}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Erklæring</p>
                {/* R2-09: belgeyle birebir 3 maddelik beyan (PEP dahil); X3: gerçek Tlf/CVR. */}
                <p className="mt-2 text-xs font-semibold text-sg-text">{AFG_DECLARATION_HEADER}</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-sg-text-soft">
                  {AFG_DECLARATION_ITEMS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-sg-text-soft">{FIRMA_FOOTER_LINE}</p>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 z-sticky flex flex-wrap items-center justify-between gap-3 border-t border-sg-border bg-sg-surface/95 px-4 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"><span><span className="text-sg-text-soft">Gram </span><strong className="text-sg-text">{formatNumber(totalGram, ' g')}</strong></span><span><span className="text-sg-text-soft">Net </span><strong className="text-sg-text">{formatMoney(String(totalOffer))}</strong></span>{state.purchaseVatEnabled ? <span><span className="text-sg-text-soft">KDV (tarihsel) </span><strong className="text-sg-text">{formatMoney(String(vatAmount))}</strong></span> : null}<span><span className="text-sg-text-soft">Ödenecek </span><strong className="text-sg-accent">{formatMoney(String(grossOffer))}</strong></span></div>
            <div className="flex gap-2"><button type="button" onClick={onCancel} disabled={state.cancelPending} title={ALIS_SHORTCUT_HINT} className={shellButtonClass('danger')}>İptal</button><button type="button" onClick={() => void state.onFinalizeWorkspace()} disabled={state.finalizePending || !hasSelectedCustomer} title={!hasSelectedCustomer ? 'Kesinleştirmek için önce müşteri seçin veya oluşturun' : ALIS_SHORTCUT_HINT} className={shellButtonClass('primary')}>{state.finalizePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}Alışı tamamla</button></div>
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
      <div className="border-b border-sg-border px-4 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Müşteri</p><div className="mt-2 flex items-start justify-between gap-3"><div className="min-w-0"><p className={`truncate text-base font-semibold ${hasSelectedCustomer ? 'text-sg-text' : 'text-sg-amber'}`}>{hasSelectedCustomer ? workspace.customer.name : 'Müşteri seçilmedi'}</p><p className="mt-1 text-xs text-sg-text-soft">{hasSelectedCustomer ? state.customerForm.phone || 'Telefon yok' : 'Kesinleştirme öncesi gerekli'}</p></div><DataPill label="Ödeme" value={state.paymentMethod.toUpperCase()} tone="success" /></div>{hasSelectedCustomer ? <button type="button" onClick={() => onOpenTool('customer')} className={`${shellButtonClass('secondary')} mt-3 w-full justify-center`}>Müşteriyi düzenle</button> : null}</div>
      <div className="border-b border-sg-border px-4 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Piyasa oranları</p><p className="mt-1 text-sm font-semibold text-sg-text">Au {formatDecimalFixed(state.marketRates.gold_24k_dkk)} DKK/g</p><p className="mt-0.5 text-xs text-sg-text-soft">FX {formatDecimalFixed(state.marketRates.eur_dkk_fx)} · satır fiyatlarına otomatik uygulanır</p></div><button type="button" onClick={() => onOpenTool('rates')} className={shellButtonClass('ghost')}><SlidersHorizontal className="h-4 w-4" />Düzenle</button></div></div>
      <div className="border-b border-sg-border px-4 py-4">
        {state.purchaseVatEnabled ? <p className="text-sm font-semibold text-sg-text">%25 alış KDV'si (tarihsel belge)</p> : null}
        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">AFG notu<textarea value={state.afgNote} onChange={(event) => state.setAfgNote(event.target.value)} rows={3} maxLength={1000} placeholder="İşlem ve fatura notu" className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal normal-case tracking-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10" /></label>
      </div>
      <div className="border-b border-sg-border px-4 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Müşteri ekranı</p><p className="mt-1 text-sm text-sg-text">{displayLabel}</p></div><div className="flex items-center gap-2">{displayBridge?.desktopDisplayState?.window_open && displayBridge.onCloseCustomerDisplay ? <button type="button" onClick={() => void displayBridge.onCloseCustomerDisplay?.()} className={shellButtonClass('ghost')}>Kapat</button> : null}{displayBridge?.onOpenCustomerDisplay ? <button type="button" onClick={() => void displayBridge.onOpenCustomerDisplay?.()} className={shellButtonClass('ghost')}>Aç</button> : null}</div></div></div>
      <div className="px-4 py-4"><button type="button" onClick={() => onOpenTool('roadmap')} className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-sg-text transition hover:text-sg-accent"><span>Hazır olmayan entegrasyonlar</span><ChevronDown className="h-4 w-4" /></button></div>
    </div>
  );
}

function AlisLedger({ title, tone, rows, expanded, onToggle, onGramChange, onAvanceChange, layoutMode, onAddPresetRow }: { title: string; tone: 'gold' | 'silver'; rows: ModernAlisRow[]; expanded: boolean; onToggle: () => void; onGramChange: (key: string, value: string) => void; onAvanceChange: (key: string, value: string) => void; layoutMode: AlisLayoutMode; onAddPresetRow?: (preset: string) => void }) {
  const [revealedRows, setRevealedRows] = useState<Set<string>>(() => new Set());
  const totalGram = rows.reduce((sum, row) => sum + parseDecimalValue(row.gram), 0);
  const activeRows = rows.filter((row) => parseDecimalValue(row.gram) > 0).length;
  const visibleRows = rows.filter((row) => parseDecimalValue(row.gram) > 0 || revealedRows.has(row.key));
  const hiddenRows = rows.filter((row) => parseDecimalValue(row.gram) <= 0 && !revealedRows.has(row.key));
  const wide = layoutMode === 'wide' || layoutMode === 'ultrawide';
  return (
    <section className="border-b border-sg-border last:border-b-0">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-sg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sg-accent/50"><span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${tone === 'gold' ? 'bg-sg-amber' : 'bg-slate-400'}`} /><span className="text-sm font-semibold text-sg-text">{title}</span><span className="text-xs text-sg-text-soft">{activeRows} aktif · {formatNumber(totalGram, ' g')}</span></span><ChevronDown className={`h-4 w-4 text-sg-text-soft transition ${expanded ? 'rotate-180' : ''}`} /></button>
      {expanded ? <div className="px-4 pb-3"><div className="flex flex-wrap items-center justify-between gap-2 border-y border-sg-border-soft py-2"><div className={`min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft ${wide ? 'grid grid-cols-[minmax(0,1.4fr)_88px_96px_120px_132px] gap-3' : 'grid grid-cols-[minmax(0,1fr)_84px_92px_minmax(160px,200px)] gap-3'}`}><span>Malzeme</span><span>Gram</span><span>Mer pris</span><span className={wide ? 'text-right' : undefined}>{wide ? 'Birim fiyat' : 'Hesap'}</span>{wide ? <span className="text-right">Toplam</span> : null}</div>{hiddenRows.length > 0 ? <label className="w-36 shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-sg-text-soft"><span className="sr-only">Satır ekle</span><select aria-label={`${title} satırı ekle`} value="" onChange={(event) => { const key = event.target.value; if (!key) return; if (key.startsWith('add:')) { onAddPresetRow?.(key.slice(4)); return; } setRevealedRows((current) => new Set(current).add(key)); }} className="w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-sg-text"><option value="">+ Satır ekle</option>{hiddenRows.map((row) => <option key={row.key} value={row.key}>{row.name}</option>)}</select></label> : wide ? <span className="w-36 shrink-0" aria-hidden="true" /> : null}</div><div className="divide-y divide-sg-border-soft">{visibleRows.length > 0 ? visibleRows.map((row) => <AlisLedgerRow key={row.key} row={row} wide={wide} onGramChange={onGramChange} onAvanceChange={onAvanceChange} />) : <p className="py-4 text-sm text-sg-text-soft">Aktif satır yok. Yukarıdan bir satır ekleyin.</p>}</div></div> : null}
    </section>
  );
}

function AlisLedgerRow({ row, wide, onGramChange, onAvanceChange }: { row: ModernAlisRow; wide: boolean; onGramChange: (key: string, value: string) => void; onAvanceChange: (key: string, value: string) => void }) {
  const inputClass = 'w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2.5 py-2 text-sm text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/15';
  if (!wide) {
    return <div className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_100px]"><div className="min-w-0"><p className="truncate text-sm font-semibold text-sg-text">{row.name}</p><p className="mt-1 text-xs text-sg-text-soft">{row.type} · {row.karat}K · {row.lodighed} · {row.purity || '—'}%</p><p className="mt-2 text-xs text-sg-text-soft">Birim {formatMoney(row.unitPrice)}</p></div><div className="text-right"><p className="text-sm font-semibold text-sg-text">{formatMoney(row.total)}</p><label className="mt-2 block text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-sg-text-soft">Gram<CommittedNumericInput value={row.gram} rules={{ kind: 'decimal', required: false, allowNegative: false, min: 0, precision: 3 }} onCommit={(_, canonical) => onGramChange(row.key, canonical)} className={inputClass} /></label><label className="mt-2 block text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-sg-text-soft">Mer pris<CommittedNumericInput value={row.avance} rules={{ kind: 'decimal', required: false, allowNegative: true, precision: 2 }} onCommit={(_, canonical) => onAvanceChange(row.key, canonical)} className={inputClass} /></label></div></div>;
  }
  return <div className="grid grid-cols-[minmax(0,1.4fr)_88px_96px_120px_132px] items-center gap-3 py-2.5 pr-[152px]"><div className="min-w-0"><p className="truncate text-sm font-semibold text-sg-text">{row.name}</p><p className="mt-1 truncate text-xs text-sg-text-soft">{row.type} · {row.karat}K · {row.lodighed} · {row.purity || '—'}%</p></div><CommittedNumericInput aria-label={`${row.name} gram`} value={row.gram} rules={{ kind: 'decimal', required: false, allowNegative: false, min: 0, precision: 3 }} onCommit={(_, canonical) => onGramChange(row.key, canonical)} className={inputClass} /><CommittedNumericInput aria-label={`${row.name} avance`} value={row.avance} rules={{ kind: 'decimal', required: false, allowNegative: true, precision: 2 }} onCommit={(_, canonical) => onAvanceChange(row.key, canonical)} className={inputClass} /><span className="text-right text-sm text-sg-text-soft">{formatMoney(row.unitPrice)}</span><span className="text-right text-sm font-semibold text-sg-text">{formatMoney(row.total)}</span></div>;
}

function AlisHistory({ state, documents, filters, onChange, onReset }: { state: ModernAlisState; documents: PosSavedPurchaseListItem[]; filters: ModernAlisListFilters; onChange: (next: Partial<ModernAlisListFilters>) => void; onReset: () => void }) {
  const total = documents.reduce((sum, document) => sum + parseDecimalValue(document.gross_amount_dkk), 0);
  return <section className="border-y border-sg-border py-4"><div className="flex flex-wrap items-center justify-between gap-4 rounded-sg-lg border border-sg-border bg-sg-surface-soft px-4 py-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Belge geçmişi</p><h2 className="mt-1 text-xl font-bold text-sg-text">Alış kayıtları</h2></div><dl className="flex overflow-hidden rounded-sg-md border border-sg-border bg-sg-surface shadow-sm"><div className="min-w-24 px-4 py-2"><dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">Kayıt</dt><dd className="mt-1 text-sm font-bold text-sg-text">{documents.length} belge</dd></div><div className="min-w-36 border-l border-sg-border px-4 py-2 text-right"><dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">Toplam</dt><dd className="mt-1 whitespace-nowrap text-sm font-bold text-sg-text">{formatMoney(String(total))}</dd></div></dl></div><div className="mt-4"><PurchaseFilters state={state} filters={filters} onChange={onChange} onReset={onReset} /></div><DocumentList state={state} documents={documents} /></section>;
}

function AlisToolDrawer({ tool, state, hasSelectedCustomer, filters, onFilterChange, onFilterReset, unsupportedControls, onClose }: { tool: Exclude<ModernAlisTool, null>; state: ModernAlisState; hasSelectedCustomer: boolean; filters: ModernAlisListFilters; onFilterChange: (next: Partial<ModernAlisListFilters>) => void; onFilterReset: () => void; unsupportedControls: UnsupportedControlDescriptor[]; onClose: () => void }) {
  const title = tool === 'customer' ? 'Müşteri' : tool === 'rates' ? 'Piyasa oranları' : tool === 'calculator' ? 'Kniv beregner' : tool === 'filters' ? 'Geçmiş filtreleri' : 'Hazır olmayan entegrasyonlar';
  return (
    <ModernDrawer open onClose={onClose} title={title} description="Alış araçları">
      {tool === 'customer' ? <ModernCustomerDrawerBody state={state} hasSelectedCustomer={hasSelectedCustomer} /> : null}
      {tool === 'rates' ? <WorkspaceControls state={state} /> : null}
      {tool === 'calculator' ? <KnivCalculators state={state} /> : null}
      {tool === 'filters' ? <PurchaseFilters state={state} filters={filters} onChange={onFilterChange} onReset={onFilterReset} /> : null}
      {tool === 'roadmap' ? <div className="space-y-3">{unsupportedControls.length ? unsupportedControls.map((item) => <div key={item.id} className="border-b border-sg-border-soft pb-3 last:border-b-0"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-sg-text">{item.label}</p><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sg-amber">Hazır değil</span></div><p className="mt-1 text-xs text-sg-text-soft">{item.reason}</p></div>) : <p className="text-sm text-sg-text-soft">Bu görünümde hazır olmayan kontrol bulunmuyor.</p>}</div> : null}
    </ModernDrawer>
  );
}

// Müşteri drawer gövdesi: resolveCustomerPanelView'in dört karşılıklı dışlanan
// görünümü — kart + form + OCR üst üste ASLA render edilmez (klasik AlisPage
// sağ paneliyle aynı sözleşme; bkz. customerPanelState.ts başlığı).
export function ModernCustomerDrawerBody({ state, hasSelectedCustomer }: { state: ModernAlisState; hasSelectedCustomer: boolean }) {
  const confirm = useConfirm();
  const [replacingCustomer, setReplacingCustomer] = useState(false);
  // Klasik AlisPage sözleşmesi: replacing reset'i aksiyon tıklama anında yapılır
  // (hasSelectedCustomer effect'ine bırakılmaz — "Değiştir"de müşteri zaten
  // bağlı olduğundan değer değişmez, bayrak takılı kalır).
  const handlePickExisting = (customerId: string) => {
    setReplacingCustomer(false);
    state.onSelectExistingCustomer(customerId);
  };
  const handleCreateNew = (event: FormEvent) => {
    setReplacingCustomer(false);
    state.onCreateNewCustomer(event);
  };

  const view = resolveCustomerPanelView(state.customerMode, hasSelectedCustomer, replacingCustomer);
  const customer = state.workspace?.customer;

  if (view === 'attached') {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Seçili müşteri</p>
            <p className="mt-1 truncate text-base font-semibold text-sg-text">{customer?.name || '—'}</p>
            <p className="mt-1 text-xs text-sg-text-soft">{state.customerForm.phone || 'Telefon yok'}</p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              type="button"
              className={shellButtonClass('secondary')}
              onClick={() => { setReplacingCustomer(true); state.setCustomerSearchTerm(''); state.setCustomerMode('existing'); }}
            >
              <Repeat2 className="h-4 w-4" />
              Değiştir
            </button>
            <button
              type="button"
              className={shellButtonClass('danger')}
              disabled={state.detachCustomerPending}
              onClick={() => {
                void confirm({
                  title: 'Müşteri seçimi kaldırılsın mı?',
                  message: 'Bu taslak çalışma alanından müşteri bağlantısı koparılır. Yalnızca taslak alanına girilmiş müşteri bilgileri silinir; metal satırları ve notlar korunur.',
                  confirmText: 'Bağlantıyı kaldır',
                  cancelText: 'Vazgeç',
                  variant: 'danger',
                }).then((approved) => {
                  if (approved === true) state.onDetachCustomer();
                });
              }}
            >
              <UserMinus className="h-4 w-4" />
              {state.detachCustomerPending ? 'Kaldırılıyor...' : 'Seçimi kaldır'}
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <EditableCustomerFields customer={state.customerForm} setCustomer={state.setCustomerForm} onBlur={state.onCustomerBlur} compact />
        </div>
      </div>
    );
  }

  const segment = (
    <div className="flex gap-1 border-b border-sg-border" role="tablist" aria-label="Müşteri seçim yöntemi">
      <button type="button" role="tab" aria-selected={view === 'search-existing' || view === 'pick-action'} onClick={() => state.setCustomerMode('existing')} className={`border-b-2 px-3 py-3 text-sm font-semibold transition ${view === 'search-existing' || view === 'pick-action' ? 'border-sg-accent text-sg-accent' : 'border-transparent text-sg-text-soft hover:text-sg-text'}`}>
        Mevcut müşteri
      </button>
      <button type="button" role="tab" aria-selected={view === 'create-new'} onClick={() => state.setCustomerMode('new')} className={`border-b-2 px-3 py-3 text-sm font-semibold transition ${view === 'create-new' ? 'border-sg-accent text-sg-accent' : 'border-transparent text-sg-text-soft hover:text-sg-text'}`}>
        Yeni müşteri
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {segment}
      {view === 'create-new' ? <NewCustomerForm state={state} onSubmit={handleCreateNew} /> : <SearchExistingPanel state={state} onPick={handlePickExisting} />}
    </div>
  );
}

function KnivCalculators({ state }: { state: ModernAlisState }) {
  return (
    <div className="grid gap-3">
      <p className="text-sm text-sg-text-soft">Birim gram × adet hesaplanır; "Aktar" sonucu seçilen alış satırının gramına yazar.</p>
      <ModernCalculatorPanel
        title="Kniv beregner"
        kind="gold_rows"
        rows={state.calculators.gold_rows}
        targets={GOLD_MATRIX_ROWS.map((row) => ({ value: `gold:${row.key}`, label: row.label }))}
        setCalculators={state.setCalculators}
        // R2-10 takip: 'gold:22b' sabit satırda yoktur — hook 22K-2 extra satırına yönlendirir.
        onApply={(rowKey, total) => state.onApplyGoldCalculatorTarget(rowKey, total)}
      />
      <ModernCalculatorPanel
        title="Beregner (sølv)"
        kind="silver_rows"
        rows={state.calculators.silver_rows}
        targets={SILVER_MATRIX_ROWS.map((row, index) => ({ value: `silver:${index + 2}`, label: row.label }))}
        setCalculators={state.setCalculators}
        onApply={(rowKey, total) => state.onUpdateSilverRow(rowKey, 'gram', total)}
      />
    </div>
  );
}

function SearchExistingPanel({ state, onPick }: { state: ModernAlisState; onPick: (customerId: string) => void }) {
  return (
    <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <p className="text-sm text-sg-text">Gerçek müşteri kaydını seçin.</p>
      <div className="mt-4 flex items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2">
        <Search className="h-4 w-4 text-sg-text-soft" />
        <input autoFocus value={state.customerSearchTerm} onChange={(event) => state.setCustomerSearchTerm(event.target.value)} placeholder="İsim, CPR, telefon..." className="w-full bg-transparent text-sm text-sg-text outline-none" />
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto rounded-sg-md border border-sg-border bg-sg-surface">
        {state.candidateCustomers.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-sg-text-soft">Kayıtlı müşteri bulunamadı.</p>
        ) : (
          state.candidateCustomers.map((customer) => (
            <button key={customer.id} type="button" disabled={state.customerSelecting} onClick={() => onPick(customer.id)} className="flex w-full items-center justify-between gap-3 border-b border-sg-border-soft px-4 py-3 text-left transition last:border-b-0 hover:bg-sg-accent-soft disabled:cursor-wait disabled:opacity-60">
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

function NewCustomerForm({ state, onSubmit }: { state: ModernAlisState; onSubmit: (event: FormEvent) => void }) {
  const hasValidNewCustomer =
    state.newCustomer.name.trim().length >= 2 &&
    state.newCustomer.phone.trim().length >= 7 &&
    state.newCustomer.cpr_number.replace(/\D/g, '').length >= 10 &&
    state.newCustomer.identity_doc_number.trim().length >= 4;
  const newPostal = state.newCustomer.postal_code.replace(/\D/g, '');
  const hasValidPostal = newPostal.length === 0 || newPostal.length === 4;

  return (
    <form onSubmit={onSubmit} className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-sg-text">Zorunlu kimlik alanlarını tamamlayın.</p>
        <button type="button" onClick={() => state.setCustomerMode('existing')} className={shellButtonClass('ghost')}>Kapat</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ModernIdentityScanner customer={state.newCustomer} setCustomer={state.setNewCustomer} />
        <EditableCustomerFields customer={state.newCustomer} setCustomer={state.setNewCustomer} />
      </div>
      <ModernCustomerMatch customer={state.newCustomer} onSelect={(customerId) => state.onSelectExistingCustomer(customerId)} />
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
  const address = useAddressAutocomplete({ customer, setCustomer, onApplied: onBlur });
  return (
    <>
      {customerFields.map((field) => (
        <label key={field.key} className={compact ? 'text-xs font-semibold text-sg-text-soft' : 'text-sm font-semibold text-sg-text-soft'}>
          {field.label}
          {field.key === 'identity_doc_type' ? (
            <select value={customer.identity_doc_type} onChange={(event) => setCustomer((current) => ({ ...current, identity_doc_type: event.target.value }))} onBlur={onBlur} className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10">
              <option value="">Seçin</option><option value="passport">Pasaport</option><option value="id_card">Kimlik kartı</option><option value="driver_license">Ehliyet</option>
            </select>
          ) : (
            <input
              type={field.type || 'text'}
              value={customer[field.key]}
              onChange={(event) => setCustomer((current) => ({
                ...current,
                [field.key]: field.key === 'postal_code'
                  ? event.target.value.replace(/\D/g, '').slice(0, 4)
                  : field.key === 'identity_doc_country'
                    ? event.target.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 3)
                  : event.target.value,
              }))}
              onBlur={onBlur}
              className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10"
            />
          )}
          {field.key === 'cpr_number' && customer.cpr_number && cprValidation.formatOk && cprValidation.mod11Ok ? (
            <span className="mt-1 block text-[10px] font-semibold text-sg-green-strong">CPR mod-11 doğrulandı</span>
          ) : null}
        </label>
      ))}
      <ModernAddressSuggestions address={address} />
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
  const identity = useIdentityScan({ customer, setCustomer });
  const [identityDragActive, setIdentityDragActive] = useState(false);

  return (
    <div className="rounded-sg-md border border-sg-border bg-sg-surface p-3 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-xs font-semibold text-sg-text">Kimlik fotoğrafı / tarama (OCR)</p><p className="mt-1 text-[11px] text-sg-text-soft">Yerel tarayıcı veya kimlik dosyasıyla alınan metin cihazda ayrıştırılır. CPR doğum tarihinden türetilmez.</p></div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${identity.status === 'applied' ? 'bg-sg-green-soft text-sg-green-strong' : identity.status === 'error' ? 'bg-sg-red-soft text-sg-red' : 'bg-sg-surface-soft text-sg-text-soft'}`}>
          {identity.status === 'applied' ? 'Alanlar uygulandı' : identity.status === 'review' ? 'İnceleme gerekli' : identity.status === 'acquiring' ? 'Okunuyor' : identity.status === 'unavailable' ? 'Destek yok' : 'Hazır'}
        </span>
      </div>
      <div
        className={`mt-3 rounded-sg-md border-2 border-dashed bg-sg-surface-soft p-4 text-center ${identityDragActive ? 'border-sg-accent ring-2 ring-sg-accent/40' : 'border-sg-border'}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (identity.capabilities.file) setIdentityDragActive(true);
        }}
        onDragLeave={() => setIdentityDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIdentityDragActive(false);
          const file = Array.from(event.dataTransfer?.files || []).find((item) => /\.(jpe?g|png|tiff?|bmp)$/i.test(item.name));
          if (file) void identity.dropFile(file, 'front');
        }}
        title="Kimlik görüntüsünü buraya sürükleyip bırakabilirsiniz"
      >
        <Camera className="mx-auto h-6 w-6 text-sg-accent" />
        <p className="mt-2 text-xs text-sg-text">Kimlik fotoğrafını yükleyin veya tarayıcıdan okutun — alanlar otomatik dolar.</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2"><button type="button" disabled={!identity.capabilities.file || identity.status === 'acquiring'} onClick={() => void identity.pickFile('front')} className={shellButtonClass('secondary')}>Fotoğraf yükle (ön yüz)</button><button type="button" disabled={!identity.capabilities.scanner || identity.status === 'acquiring'} onClick={() => void identity.acquire('front')} className={shellButtonClass('secondary')}>Tarayıcıdan tara</button><button type="button" onClick={() => void identity.refreshCapabilities()} className={shellButtonClass('ghost')}>Yenile</button>{identity.result?.documentType === 'id_card' ? <><button type="button" disabled={!identity.capabilities.file || identity.status === 'acquiring'} onClick={() => void identity.pickFile('back')} className={shellButtonClass('ghost')}>Fotoğraf yükle (arka yüz)</button><button type="button" disabled={!identity.capabilities.scanner || identity.status === 'acquiring'} onClick={() => void identity.acquire('back')} className={shellButtonClass('ghost')}>Arka yüz tara</button></> : null}</div>
      </div>
      {identity.ocrNotice ? <p className="mt-2 rounded-sg-sm border border-sg-amber/40 bg-sg-amber-soft px-2 py-1.5 text-[11px] font-semibold text-sg-amber">{identity.ocrNotice}</p> : null}
      {identity.error ? <p className="mt-2 text-xs font-semibold text-sg-red">{identity.error}</p> : null}
      {identity.error && identity.diagnostic ? <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-line rounded-sg-sm border border-sg-border bg-sg-surface-soft px-2 py-1.5 font-mono text-[10px] text-sg-text-soft">{identity.diagnostic}</pre> : null}
      {identity.result ? <div className="mt-3 rounded-sg-md border border-sg-green-soft bg-sg-green-soft p-3"><p className="text-xs font-semibold text-sg-green-strong">Okunan alanlar — doğrulanmayanları inceleyin</p><div className="mt-2 grid gap-1 sm:grid-cols-2">{Object.entries(identity.result.fields).map(([field, parsed]) => parsed ? <p key={field} className="text-xs text-sg-text"><span className="font-semibold">{modernIdentityFieldLabel(field as IdentityFieldName)}:</span> {parsed.value} <span className={parsed.review === 'validated' ? 'text-sg-green-strong' : 'text-sg-amber'}>({parsed.review === 'validated' ? 'doğrulandı' : 'inceleyin'})</span></p> : null)}</div>{identity.scanMeta ? <p className="mt-2 text-[10px] text-sg-text-soft">OCR teşhisi: {identity.scanMeta.language || 'dil bilinmiyor'} · {identity.scanMeta.lineCount} satır{identity.scanMeta.scaled === undefined ? '' : identity.scanMeta.scaled ? ' · ölçeklendi' : ' · ölçeklenmedi'}{identity.scanMeta.fieldKeys.includes('name') ? '' : ' · İSİM OKUNAMADI'}</p> : null}{identity.diagnostic ? <details className="mt-1"><summary className="cursor-pointer text-[10px] text-sg-text-soft">Maskeli ham satırlar (kişisel veri içermez)</summary><pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-line rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1 font-mono text-[10px] text-sg-text-soft">{identity.diagnostic}</pre></details> : null}{Object.keys(identity.previews).length ? <div className="mt-3 flex gap-2">{(['front', 'back'] as const).map((side) => identity.previews[side] ? <img key={side} src={identity.previews[side]} alt={`Kimlik ${side === 'front' ? 'ön' : 'arka'} yüz önizlemesi`} className="h-20 max-w-32 rounded-sg-sm border border-sg-border object-cover" /> : null)}</div> : null}<div className="mt-3 flex justify-end gap-2"><button type="button" onClick={identity.clear} className={shellButtonClass('ghost')}>Vazgeç</button><button type="button" onClick={identity.confirm} className={shellButtonClass('primary')}>İnceledim, alanları uygula</button></div></div> : null}
    </div>
  );
}

function modernIdentityFieldLabel(field: IdentityFieldName): string {
  return { name: 'Ad', identity_doc_number: 'Belge no', identity_doc_type: 'Belge türü', identity_doc_country: 'Ülke', address: 'Adres', postal_code: 'Posta kodu', city: 'Şehir', cpr_number: 'CPR (ilk 6)' }[field];
}

function ModernAddressSuggestions({ address }: { address: ReturnType<typeof useAddressAutocomplete> }) {
  if (address.status === 'idle') return null;
  return <div className="sm:col-span-2"><p className="text-xs font-semibold text-sg-text-soft">{address.status === 'loading' ? 'Adres aranıyor...' : address.status === 'resolving' ? 'Adres çözülüyor...' : address.status === 'empty' ? 'Bu posta kodu ve sokak için öneri bulunamadı.' : address.status === 'unavailable' ? 'Adres servisi kullanılamıyor.' : 'Adres önerileri'}</p>{address.status === 'ready' ? <div className="mt-2 grid gap-1">{address.suggestions.map((suggestion) => <button key={suggestion.id} type="button" disabled={address.selectedId === suggestion.id} onClick={() => address.selectSuggestion(suggestion)} className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-left text-xs text-sg-text hover:border-sg-accent disabled:opacity-60">{suggestion.title}</button>)}</div> : null}</div>;
}

function ModernCustomerMatch({ customer, onSelect }: { customer: EditableCustomer; onSelect: (customerId: string) => void }) {
  const match = useCustomerMatch(customer);
  if (!match.loading && !match.response && !match.error) return null;
  const tone = match.response?.status === 'conflict' || match.error ? 'border-sg-amber bg-sg-amber-soft text-sg-amber' : 'border-sg-border bg-sg-surface text-sg-text-soft';
  return <div className={`mt-3 rounded-sg-md border px-3 py-2 text-xs ${tone}`}>{match.loading ? 'Müşteri eşleşmesi kontrol ediliyor...' : match.error ? 'Müşteri eşleşmesi şu an kontrol edilemedi.' : match.response?.status === 'none' ? 'Mevcut müşteri eşleşmesi yok; yeni kayıt yalnız operatör onayıyla oluşturulur.' : match.response?.status === 'single' ? <span>Eşleşen müşteri: <strong>{match.response.matches[0]?.name}</strong>{match.response.matches[0] ? <button type="button" onClick={() => onSelect(match.response!.matches[0].id)} className="ml-2 underline">Mevcut müşteriyi seç</button> : null}</span> : <span><strong>Çakışan kayıtlar:</strong> {match.response?.matches.map((item) => item.name).join(', ')}. Kaydı seçip inceleyin.</span>}</div>;
}

function WorkspaceControls({ state }: { state: ModernAlisViewModel['state'] }) {
  return (
    <div className="mt-4 rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">İşlem ayarları</p>
          <p className="mt-1 text-sm text-sg-text">AFG numarası, tam oran matrisi ve hesaplayıcılar gerçek çalışma alanı durumuna bağlıdır.</p>
        </div>
        <div className="inline-flex rounded-sg-md border border-sg-border bg-sg-surface p-1">
          {(['system', 'excel'] as const).map((view) => (
            <button key={view} type="button" onClick={() => void state.setActiveWorkspaceView(view)} className={`rounded-sg-sm px-3 py-1.5 text-xs font-semibold transition ${state.activeWorkspaceView === view ? 'bg-sg-accent text-white' : 'text-sg-text-soft hover:bg-sg-surface-soft'}`}>
              {view === 'system' ? 'Sistem' : 'Excel'}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <WorkspaceInput label="AFG numarası" value={state.numbering.afregnings_number_next} onCommit={(value) => state.onUpdateNumbering('afregnings_number_next', value)} />
        <WorkspaceInput label="Fatura numarası" value={state.numbering.invoice_number_next} onCommit={(value) => state.onUpdateNumbering('invoice_number_next', value)} />
        <WorkspaceInput label="Şube no." value={state.bankInfo.reg_number || ''} onCommit={(value) => state.setBankInfo((current) => ({ ...current, reg_number: value }))} />
        <WorkspaceInput label="Hesap no." value={state.bankInfo.account_number || ''} onCommit={(value) => state.setBankInfo((current) => ({ ...current, account_number: value }))} />
        <div className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-xs text-sg-text-soft">
          <span className="block font-semibold uppercase tracking-[0.14em]">Ödeme</span>
          <span className="mt-1 block text-sm font-semibold text-sg-text">Bankoverførsel</span>
        </div>
        {state.purchaseVatEnabled ? (
          <div className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-semibold text-sg-text">
            <span className="block">%25 alış KDV'si (tarihsel belge)</span>
            <span className="mt-0.5 block text-[11px] font-normal text-sg-text-soft">Yeni alışlarda KDV uygulanmaz; net tutar ödenir.</span>
          </div>
        ) : null}
      </div>
      <ModernRatesPanel state={state} />
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <ModernCalculatorPanel
          title="Kniv beregner"
          kind="gold_rows"
          rows={state.calculators.gold_rows}
          targets={GOLD_MATRIX_ROWS.map((row) => ({ value: `gold:${row.key}`, label: row.label }))}
          setCalculators={state.setCalculators}
          onApply={(rowKey, total) => state.onUpdateGoldRow(rowKey, 'gram', total)}
        />
        <ModernCalculatorPanel
          title="Beregner"
          kind="silver_rows"
          rows={state.calculators.silver_rows}
          targets={SILVER_MATRIX_ROWS.map((row, index) => ({ value: `silver:${index + 2}`, label: row.label }))}
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
          <p className="mt-1 text-xs text-sg-text-soft">Tüm alış fiyatları doğrudan DKK/g girilir. Altın ve gümüş alanları matrisle birlikte güncellenir.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DataPill label="Au 24K" value={`${formatDecimalFixed(state.marketRates.gold_24k_dkk)} DKK/g`} tone="warning" />
          <DataPill label="FX" value={formatDecimalFixed(state.marketRates.eur_dkk_fx)} tone="neutral" />
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-sg-md border border-sg-border-soft bg-sg-surface-soft p-3">
          <p className="text-xs font-semibold text-sg-text">Altın DKK / gram</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {GOLD_MATRIX_ROWS.map((row) => (
              <RateInput
                key={row.key}
                label={`${row.label} · ${row.lodighed}`}
                value={state.marketRates.gold_rates_dkk?.[row.key] || ''}
                onCommit={(value) => state.setMarketRates((current) => syncMarketRateState(current, { gold_rates_dkk: { ...current.gold_rates_dkk, [row.key]: value === null ? '' : String(value) } }))}
              />
            ))}
          </div>
        </div>
        <div className="rounded-sg-md border border-sg-border-soft bg-sg-surface-soft p-3">
          <p className="text-xs font-semibold text-sg-text">Gümüş DKK / gram</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {SILVER_MATRIX_ROWS.map((row) => (
              <RateInput
                key={row.key}
                label={`${row.label} · ${row.lodighed}`}
                value={state.marketRates.silver_rates_dkk?.[row.key] || ''}
                onCommit={(value) => state.setMarketRates((current) => syncMarketRateState(current, { silver_rates_dkk: { ...current.silver_rates_dkk, [row.key]: value === null ? '' : String(value) } }))}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <WorkspaceInput label="EUR / DKK kuru (bilgi amaçlı)" value={state.marketRates.eur_dkk_fx} onCommit={(value) => state.setMarketRates((current) => syncMarketRateState(current, { eur_dkk_fx: value }))} />
        <CommittedRateInput
          label="Au 24K DKK/g · tüm karatlara uygula"
          value={state.marketRates.gold_24k_dkk}
          onCommit={(value) => state.setMarketRates((current) => syncMarketRateState(current, { gold_24k_dkk: value }))}
        />
        <ReadOnlyMetric label="Gümüş DKK" value={state.marketRates.silver_dkk} />
      </div>
    </div>
  );
}

function RateInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  return (
    <label className="rounded-sg-md border border-sg-border bg-sg-surface p-2 text-[11px] font-semibold text-sg-text-soft">
      <span className="flex items-center justify-between gap-2"><span>{label}</span><span className="font-normal text-sg-text-soft">DKK/g</span></span>
      <CommittedNumericInput
        value={value}
        rules={{ kind: 'decimal', required: true, allowNegative: false, min: 0, precision: 2 }}
        onCommit={(_, canonical) => onCommit(canonical)}
        className="mt-1 w-full rounded-sg-sm border border-sg-border bg-sg-surface-soft px-2 py-1.5 text-sm font-normal text-sg-text outline-none focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10"
      />
    </label>
  );
}

function ReadOnlyMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-sg-md border border-sg-border bg-sg-surface-soft px-3 py-2"><span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">{label}</span><span className="mt-1 block text-sm font-semibold text-sg-text">{value} DKK/g</span></div>;
}

function CommittedRateInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-sg-text-soft">
      {label}
      <CommittedNumericInput
        value={value}
        rules={{ kind: 'decimal', required: true, allowNegative: false, min: 0, precision: 2 }}
        onCommit={(_, canonical) => onCommit(canonical)}
        className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10"
      />
    </label>
  );
}

function CalculatorNumericInput({ value, onCommit, className }: { value: string; onCommit: (value: string) => void; className: string }) {
  return (
    <CommittedNumericInput
      value={value}
      rules={{ kind: 'decimal', required: false, allowNegative: false, min: 0, precision: 3 }}
      onCommit={(_, canonical) => onCommit(canonical)}
      className={className}
    />
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
              <label className="text-[11px] font-semibold text-sg-text-soft">Birim gram<CalculatorNumericInput value={row.unit_weight} onCommit={(unitWeight) => { const nextTotal = formatDecimalFixed(parseDecimalValue(unitWeight) * parseDecimalValue(row.count)); setCalculators((current) => ({ ...current, [kind]: current[kind].map((item) => item.row_key === row.row_key ? { ...item, unit_weight: unitWeight, total_weight: nextTotal } : item) })); }} className="mt-1 w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-sm text-sg-text outline-none focus:border-sg-accent" /></label>
              <label className="text-[11px] font-semibold text-sg-text-soft">Adet<CalculatorNumericInput value={row.count} onCommit={(count) => { const nextTotal = formatDecimalFixed(parseDecimalValue(row.unit_weight) * parseDecimalValue(count)); setCalculators((current) => ({ ...current, [kind]: current[kind].map((item) => item.row_key === row.row_key ? { ...item, count, total_weight: nextTotal } : item) })); }} className="mt-1 w-full rounded-sg-sm border border-sg-border bg-sg-surface px-2 py-1.5 text-sm text-sg-text outline-none focus:border-sg-accent" /></label>
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

function WorkspaceInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  return (
    <label className="text-xs font-semibold text-sg-text-soft">
      {label}
      <CommittedNumericInput
        value={value}
        rules={{ kind: 'decimal', required: true, allowNegative: false, min: 0, precision: 2 }}
        onCommit={(_, canonical) => onCommit(canonical)}
        className="mt-1 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2 text-sm font-normal text-sg-text outline-none transition focus:border-sg-accent focus:ring-2 focus:ring-sg-accent/10"
      />
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
      <div className="mt-4 hidden rounded-sg-lg border border-sg-border bg-sg-surface xl:block">
        <table className="w-full table-fixed text-sm">
          <colgroup><col className="w-[86px]" /><col className="w-[150px]" /><col className="w-[76px]" /><col className="w-[76px]" /><col className="w-[88px]" /><col className="w-[118px]" /><col className="w-[104px]" /><col className="w-[112px]" /><col className="w-[246px]" /></colgroup>
          <thead className="bg-sg-surface-soft">
            <tr className="border-b border-sg-border text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">
              <th className="px-3 py-2">Belge</th>
              <th className="px-3 py-2">Müşteri</th>
              <th className="px-3 py-2">Altın</th>
              <th className="px-3 py-2">Gümüş</th>
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
              <tr key={document.sequence_no} className="border-b border-sg-border-soft align-middle transition-colors last:border-b-0 hover:bg-sg-accent-soft/40">
                <td className="px-3 py-4 font-medium text-sg-text"><PreviewPopover label={document.document_number}><p className="font-semibold">AFG {document.document_number}</p><p className="mt-1 text-xs text-sg-text-soft">{document.line_count} satır · {formatRelativeTime(document.issued_at)}</p></PreviewPopover></td>
                <td className="px-3 py-4 font-semibold text-sg-text"><PreviewPopover label={document.customer_name || 'Müşteri yok'}><p className="font-semibold">{document.customer_name || 'Müşteri yok'}</p><p className="mt-1 text-xs text-sg-text-soft">{document.customer_phone || 'Telefon yok'}</p><p className="text-xs text-sg-text-soft">{document.customer_email || 'E-posta yok'}</p></PreviewPopover></td>
                <td className="px-3 py-3 text-sg-text-soft"><PreviewPopover label={`${document.gold_preview_items?.length || 0} satır`}><PreviewRows rows={document.gold_preview_items} /></PreviewPopover></td>
                <td className="px-3 py-3 text-sg-text-soft"><PreviewPopover label={`${document.silver_preview_items?.length || 0} satır`}><PreviewRows rows={document.silver_preview_items} /></PreviewPopover></td>
                <td className="whitespace-nowrap px-3 py-4 font-medium text-sg-text">{formatNumber(document.total_weight_grams, ' g')}</td>
                <td className="whitespace-nowrap px-3 py-4 font-semibold text-sg-text">{formatMoney(document.gross_amount_dkk)}</td>
                <td className="px-3 py-4 text-xs"><PreviewPopover label={ucStatusLabel(document)}><span className="inline-flex rounded-full bg-sg-surface-soft px-2 py-1 font-semibold text-sg-text-soft">{ucStatusLabel(document)}</span>{document.uniconta_sync_error ? <p className="mt-2 text-sg-red">{document.uniconta_sync_error}</p> : <p className="mt-2 text-sg-text-soft">Fatura: {document.uniconta_invoice_number || '—'}{document.uniconta_credit_note_number ? ` · KN#${document.uniconta_credit_note_number}` : ''}</p>}</PreviewPopover></td>
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
            <dl className="mt-3 grid gap-2 text-sm"><MobileRow label="Altın" value={`${document.gold_preview_items?.length || 0} satır`} /><MobileRow label="Gümüş" value={`${document.silver_preview_items?.length || 0} satır`} /><MobileRow label="Gram" value={formatNumber(document.total_weight_grams, ' g')} /><MobileRow label="DKK" value={formatMoney(document.gross_amount_dkk)} /><MobileRow label="Durum" value={ucStatusLabel(document)} /></dl>
            <div className="mt-3"><DocumentActions state={state} document={document} /></div>
          </div>
        ))}
      </div>
    </>
  );
}

// Klasikteki UnicontaSyncBadge ile aynı sözlük — ham enum kullanıcıya gösterilmez.
function ucStatusLabel(document: PosSavedPurchaseListItem): string {
  const status = document.uniconta_sync_status;
  if (!status) return 'UC —';
  if (status === 'synced') return document.uniconta_invoice_number ? `UC ${document.uniconta_invoice_number}` : 'UC senkron';
  if (status === 'failed') return 'UC HATA';
  if (status === 'skipped') return 'UC ATLANDI';
  if (status === 'cancelled') return document.uniconta_credit_note_number ? `İptal · KN#${document.uniconta_credit_note_number}` : 'İptal edildi';
  return `UC ${status}`;
}

function PreviewPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button type="button" aria-expanded={open} className="rounded-sg-sm text-left underline decoration-dotted underline-offset-2 transition hover:text-sg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent/40">{label}</button>
      {open ? <span role="dialog" className="absolute left-0 top-full z-dropdown mt-2 min-w-56 max-w-80 rounded-sg-md border border-sg-border bg-sg-surface p-3 text-xs text-sg-text shadow-xl">{children}</span> : null}
    </span>
  );
}

function PreviewRows({ rows }: { rows: PosSavedPurchaseListItem['gold_preview_items'] }) {
  if (!rows?.length) return <p className="text-sg-text-soft">Satır yok.</p>;
  return <div className="space-y-1">{rows.map((row) => <div key={`${row.line_no}-${row.type_label}`} className="flex items-center justify-between gap-3"><span>{labelProductType(String(row.type_label || '').toLowerCase())}</span><span className="font-semibold">{formatNumber(row.weight_grams, ' g')} · {formatMoney(row.line_total_dkk)}</span></div>)}</div>;
}

function DocumentActions({ state, document }: { state: ModernAlisViewModel['state']; document: PosSavedPurchaseListItem }) {
  const busy = state.actionPendingSequenceNo === document.sequence_no;
  const canRetry = document.uniconta_sync_status === 'failed' || document.uniconta_sync_status === 'skipped';
  const menuButton = 'flex w-full items-center gap-2 rounded-sg-sm px-3 py-2 text-left text-sm font-medium text-sg-text transition hover:bg-sg-surface-soft disabled:cursor-not-allowed disabled:opacity-40';
  const closeMenu = (element: HTMLElement) => element.closest('details')?.removeAttribute('open');
  // md10/R2-17: müşteri bağlantısı olmayan (ör. tarihsel içe aktarılmış) belgede
  // "Müşteriyi aç" / "Yeni alış başlat" yerine belgeyi müşteriye bağlama modalı açılır.
  const [relinkOpen, setRelinkOpen] = useState(false);
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <button type="button" onClick={() => state.onViewDocument(document)} className={shellButtonClass('secondary')}>Detay</button>
      <button type="button" onClick={() => state.onOpenDocumentExcelPreview(document)} className={shellButtonClass('ghost')}><FileSpreadsheet className="h-3.5 w-3.5" />Office</button>
      <details className="relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open'); }}>
        <summary className={`${shellButtonClass('ghost')} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><Ellipsis className="h-4 w-4" />İşlemler</summary>
        <div className="absolute right-0 top-full z-dropdown mt-2 w-52 rounded-sg-md border border-sg-border bg-sg-surface p-1.5 shadow-xl">
          <button type="button" onClick={(event) => { closeMenu(event.currentTarget); state.onExportDocument(document); }} disabled={busy} className={menuButton}><Download className="h-4 w-4" />Dışa aktar</button>
          <button type="button" onClick={(event) => { closeMenu(event.currentTarget); state.onPrintDocument(document); }} disabled={busy} className={menuButton}><Printer className="h-4 w-4" />Yazdır</button>
          <button type="button" onClick={(event) => { closeMenu(event.currentTarget); if (document.customer_id) state.onOpenCustomer(document); else setRelinkOpen(true); }} disabled={busy} title={document.customer_id ? undefined : 'Müşteri bağlantısı yok — önce belgeyi müşteriye bağlayın'} className={menuButton}><Users className="h-4 w-4" />Müşteriyi aç</button>
          <button type="button" onClick={(event) => { closeMenu(event.currentTarget); if (document.customer_id) state.onStartFromCustomer(document); else setRelinkOpen(true); }} disabled={busy} title={document.customer_id ? undefined : 'Yeni alış için önce belgeyi müşteriye bağlayın'} className={menuButton}><Plus className="h-4 w-4" />Yeni alış başlat</button>
          <button type="button" onClick={(event) => { closeMenu(event.currentTarget); state.onEditDocument(document); }} disabled={busy || !document.can_edit} title={!document.can_edit ? 'Bu belge düzenlenebilir değil' : undefined} className={menuButton}><Pencil className="h-4 w-4" />Düzenle</button>
          <button type="button" onClick={(event) => { closeMenu(event.currentTarget); state.onDeleteDocument(document); }} disabled={busy || !document.can_delete} title={!document.can_delete ? 'Bu belge silinebilir değil' : undefined} className={`${menuButton} text-sg-red`}><Trash2 className="h-4 w-4" />Sil</button>
          {canRetry ? <button type="button" onClick={(event) => { closeMenu(event.currentTarget); state.onRetryUnicontaSync(document); }} disabled={state.retryPendingSequenceNo === document.sequence_no} className={menuButton}><RefreshCcw className="h-4 w-4" />Uniconta tekrar</button> : null}
          {document.uniconta_sync_status === 'synced' && document.uniconta_invoice_number ? (
            <button
              type="button"
              onClick={(event) => { closeMenu(event.currentTarget); void state.onCancelUnicontaInvoice(document); }}
              disabled={state.cancelPendingSequenceNo === document.sequence_no}
              title={`Uniconta faturasını iptal et — kreditnota oluşturur (Faktura #${document.uniconta_invoice_number})`}
              className={`${menuButton} text-sg-red`}
            >
              <Ban className="h-4 w-4" />
              Fatura iptal (kreditnota)
            </button>
          ) : null}
        </div>
      </details>
      </div>
      {relinkOpen ? <RelinkCustomerModal document={document} onClose={() => setRelinkOpen(false)} /> : null}
    </>
  );
}

function ModernDetailModal({ source, detail, loading, error, onClose, onEdit, onDelete, onPreview, onExport, onPrint, actionPending, onRetry }: { source: PosSavedPurchaseListItem | null; detail: PosDocumentDetail | null; loading: boolean; error?: string | null; onClose: () => void; onEdit: () => void; onDelete: () => void; onPreview: () => void; onExport: () => void; onPrint: () => void; actionPending: boolean; onRetry?: () => void }) {
  const address = [detail?.customer_address, detail?.customer_city || source?.customer_city, detail?.customer_postal_code || source?.customer_postal_code].filter(Boolean).join(', ');
  // Veri minimizasyonu (klasikle aynı): modalda tam CPR gösterilmez; yalnız
  // doğum tarihi bölümü (ilk 6 hane) ya da maskeli değer.
  const cprBirthPart = (value?: string | null) => (value || '').replace(/\D/g, '').slice(0, 6);
  const cpr = cprBirthPart(detail?.customer_cpr || source?.customer_cpr) || detail?.customer_cpr_masked || source?.customer_cpr_masked || '—';
  const identity = detail?.customer_identity_doc_number || source?.customer_identity_doc_number || detail?.customer_identity_doc_number_masked || '—';
  const title = detail?.document_number || source?.document_number || 'Belge detayı';
  const footer = error || loading || !detail ? undefined : (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onPreview} className={shellButtonClass('secondary')}><FileSpreadsheet className="h-4 w-4" />Office</button>
      <button type="button" onClick={onExport} className={shellButtonClass('secondary')}><Download className="h-4 w-4" />Dışa aktar</button>
      <button type="button" onClick={onPrint} className={shellButtonClass('secondary')}><Printer className="h-4 w-4" />Yazdır</button>
      <button type="button" onClick={onDelete} disabled={!detail.can_delete || actionPending} className={shellButtonClass('danger')}><Trash2 className="h-4 w-4" />Sil</button>
      <button type="button" onClick={onEdit} disabled={!detail.can_edit || actionPending} className={shellButtonClass('primary')}><Pencil className="h-4 w-4" />Düzenle</button>
    </div>
  );
  return (
    <ModernDialog
      open={Boolean(source)}
      onClose={onClose}
      title={title}
      description="Afregningsbilag"
      footer={footer}
    >
      {error ? (
        <div className="py-12 text-center"><p className="text-sm font-semibold text-sg-red">Belge detayı yüklenemedi.</p><p className="mt-2 text-xs text-sg-text-soft">{error}</p><div className="mt-4 flex justify-center gap-2"><button type="button" onClick={onRetry} className={shellButtonClass('secondary')}><RefreshCcw className="h-4 w-4" />Tekrar dene</button><button type="button" onClick={onClose} className={shellButtonClass('ghost')}>Kapat</button></div></div>
      ) : loading || !detail ? <div className="py-12 text-center text-sm text-sg-text-soft">Belge detayları yükleniyor...</div> : (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Müşteri</p><dl className="mt-3 grid gap-2 text-sm"><MobileRow label="Ad" value={detail.customer_name || '—'} /><MobileRow label="CPR" value={cpr} /><MobileRow label="Telefon" value={detail.customer_phone || '—'} /><MobileRow label="E-posta" value={detail.customer_email || '—'} /><MobileRow label="Kimlik" value={identity} /><MobileRow label="Adres" value={address || '—'} /></dl></div>
            <div className="rounded-sg-lg border border-sg-border bg-sg-surface-soft p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Ödeme ve işlem</p><dl className="mt-3 grid gap-2 text-sm"><MobileRow label="Net alış" value={formatMoney(detail.net_amount_dkk)} /><MobileRow label={`KDV (%${detail.vat_rate_percent})`} value={formatMoney(detail.vat_amount_dkk)} /><MobileRow label="Ödenecek toplam" value={formatMoney(detail.gross_amount_dkk)} /><MobileRow label="Ödeme" value={detail.payment_method || 'bank'} /><MobileRow label="Reg.nr." value={detail.bank_reg_number || '—'} /><MobileRow label="Kontonr." value={detail.bank_account_number || '—'} /><MobileRow label="Tarih" value={new Date(detail.issued_at).toLocaleString(document.documentElement.lang)} /></dl></div>
          </div>
          <div className="overflow-x-auto rounded-sg-lg border border-sg-border"><table className="min-w-full text-sm"><thead className="bg-sg-surface-soft"><tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft"><th className="px-3 py-2">Tür</th><th className="px-3 py-2">Saflık</th><th className="px-3 py-2">Avance</th><th className="px-3 py-2">Gram</th><th className="px-3 py-2">Tutar</th></tr></thead><tbody>{detail.lines.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-center text-sg-text-soft">Ürün satırı yok.</td></tr> : detail.lines.map((line) => <tr key={line.id} className="border-t border-sg-border-soft"><td className="px-3 py-3 font-semibold text-sg-text">{line.metal_type ? labelMetalType(line.metal_type) : line.product_type || '—'}</td><td className="px-3 py-3 text-sg-text-soft">{line.purity_karat || line.purity_percentage || '—'}</td><td className="px-3 py-3 text-sg-text-soft">{line.margin_percent || '0'}%</td><td className="px-3 py-3 text-sg-text-soft">{formatNumber(line.weight_grams, ' g')}</td><td className="px-3 py-3 text-sg-text-soft">{formatMoney(line.line_total_dkk)}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </ModernDialog>
  );
}

function MobileRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3"><dt className="font-semibold text-sg-text-soft">{label}</dt><dd className="text-right text-sg-text">{value}</dd></div>;
}
