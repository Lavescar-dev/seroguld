import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RefreshCcw,
  Search,
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

import { DataPill, EmptyState, LoadingState, ModernModuleShell, ModernSection, ModernStatGrid, shellButtonClass } from './shared';
import { ModernOfficeSurface } from './ModernOfficeSurface';

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
  const officeState = useOfficeDocumentState({
    kind: 'alis-workspace',
    artifactKey: workspace?.session.id || '',
    disableReopen: true,
    enabled: state.activeWorkspaceView === 'excel' && Boolean(workspace),
  });

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
      title={hasWorkspace ? `Açık Workspace ${activeWorkspace.session.session_code}` : 'AFG Alış Akışı'}
      subtitle="Gerçek DKK, gram ve AFG numbering semantiğini koruyan modern shell. Müşteri, belge ve finalize akışları mevcut hook callback'lerine bağlıdır."
      blocker={viewModel.blocker}
      unsupportedControls={state.activeWorkspaceView === 'excel' ? [] : viewModel.unsupportedControls}
      badges={
        <>
          <DataPill label="Yüzey" value={state.activeWorkspaceView === 'excel' ? 'Excel' : 'System'} tone={state.activeWorkspaceView === 'excel' ? 'warning' : 'neutral'} />
          <DataPill label="Draft" value={state.draftWorkspace ? state.draftWorkspace.session.session_code : 'Yok'} tone={state.draftWorkspace ? 'warning' : 'neutral'} />
          <DataPill label="Müşteri" value={hasWorkspace ? (hasSelectedCustomer ? 'Seçili' : 'Bekliyor') : '—'} tone={hasSelectedCustomer ? 'success' : 'warning'} />
          <DataPill label="Müşteri ekranı" value={displayLabel} tone={displayTone} />
          <DataPill label="Finalize" value={state.finalizePending ? 'Çalışıyor' : hasSelectedCustomer ? 'Hazır' : 'Müşteri gerekli'} tone={state.finalizePending ? 'warning' : hasSelectedCustomer ? 'success' : 'danger'} />
        </>
      }
      actions={
        <>
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
          {workspace ? (
            <>
              <button type="button" onClick={state.onOpenWorkspaceExcelPreview} disabled={Boolean(state.hasPendingWorkspaceSync?.())} className={shellButtonClass('secondary')}>
                <FileSpreadsheet className="h-4 w-4" />
                Office
              </button>
              <button type="button" onClick={state.onPrintWorkspace} className={shellButtonClass('secondary')}>
                <Printer className="h-4 w-4" />
                Print
              </button>
              <button
                type="button"
                onClick={() => void state.onFinalizeWorkspace()}
                disabled={state.finalizePending || !hasSelectedCustomer}
                title={!hasSelectedCustomer ? 'Finalize için önce müşteri seçin veya oluşturun' : undefined}
                className={shellButtonClass('primary')}
              >
                {state.finalizePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                Finalize
              </button>
              {displayBridge?.onOpenCustomerDisplay ? (
                <button type="button" onClick={() => void displayBridge.onOpenCustomerDisplay?.()} className={shellButtonClass('secondary')} title="Müşteri ekranını aç veya öne getir">
                  Müşteri ekranı
                </button>
              ) : null}
            </>
          ) : null}
        </>
      }
    >
      {state.activeWorkspaceView === 'excel' && workspace ? (
        <ModernOfficeSurface state={officeState} mode="workspace" onClose={() => void state.setActiveWorkspaceView('system')} />
      ) : (
        <>
      <ModernStatGrid items={hasWorkspace ? viewModel.workspaceSummary : viewModel.documentsSummary} />

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
          message="AFG listesi boş. İsterseniz yeni alış başlatabilir veya açık draft varsa ona dönebilirsiniz."
          action={
            <button type="button" onClick={startBlankWorkspace} disabled={state.startPending} className={shellButtonClass('primary')}>
              <Plus className="h-4 w-4" />
              {state.startPending ? 'Hazırlanıyor' : 'Yeni Alış Başlat'}
            </button>
          }
        />
      ) : null}

      {hasWorkspace ? (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <ModernSection
            title="Müşteri ve Satırlar"
            subtitle="Müşteri seçimi, müşteri kartı ve metal satırları aynı gerçek workspace state'i ile güncellenir."
            actions={
              <>
                <button
                  type="button"
                  onClick={() => state.setCustomerMode(state.customerMode ? null : 'existing')}
                  className={shellButtonClass('secondary')}
                >
                  <Users className="h-4 w-4" />
                  {state.customerMode ? 'Müşteri Seçimini Kapat' : hasSelectedCustomer ? 'Müşteri Değiştir' : 'Müşteri Seç'}
                </button>
                <button type="button" onClick={cancelWorkspace} disabled={state.cancelPending} className={shellButtonClass('danger')}>
                  İptal
                </button>
              </>
            }
          >
            {!hasSelectedCustomer || state.customerMode ? <CustomerPicker state={state} hasSelectedCustomer={hasSelectedCustomer} /> : null}

            {hasSelectedCustomer ? (
              <div className="rounded-sg-xl border border-sg-border bg-sg-surface-soft p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Seçili müşteri</p>
                    <p className="mt-1 text-base font-semibold text-sg-text">{activeWorkspace.customer.name || 'İsimsiz müşteri'}</p>
                  </div>
                  <DataPill label="Ödeme" value={state.paymentMethod.toUpperCase()} tone="success" />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <EditableCustomerFields customer={state.customerForm} setCustomer={state.setCustomerForm} onBlur={state.onCustomerBlur} compact />
                </div>
                <PostalLookupHint customer={state.customerForm} setCustomer={state.setCustomerForm} onBlur={state.onCustomerBlur} />
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <EditableRowsCard
                title="Gold Rows"
                rows={state.goldRows.map((row) => ({ key: row.row_key, name: row.label || row.karat || 'Gold', type: 'Gold', purity: row.purity_percentage, karat: row.karat, lodighed: row.lodighed, rate: row.rate_dkk, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }))}
                onGramChange={(key, value) => state.onUpdateGoldRow(key, 'gram', value)}
                onAvanceChange={(key, value) => state.onUpdateGoldRow(key, 'avance_percent', value)}
              />
              <EditableRowsCard
                title="Silver Rows"
                rows={state.silverRows.map((row) => ({ key: row.row_key, name: row.label || row.type_code || 'Silver', type: row.type_code, purity: row.purity_percentage, karat: '—', lodighed: row.lodighed, rate: row.rate_dkk, unitPrice: row.unit_price_dkk, gram: row.gram, avance: row.avance_percent, total: row.line_total_dkk }))}
                onGramChange={(key, value) => state.onUpdateSilverRow(key, 'gram', value)}
                onAvanceChange={(key, value) => state.onUpdateSilverRow(key, 'avance_percent', value)}
              />
            </div>

            <WorkspaceControls state={state} />
          </ModernSection>

          <ModernSection title="Kayıtlar ve Yardımcı Durumlar" subtitle="Taslak resume ve kayıt detayları gerçek callback'lerle bağlıdır.">
            {state.draftWorkspace ? (
              <div className="rounded-sg-xl border border-sg-amber/20 bg-sg-amber-soft p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-amber">Açık Draft</p>
                    <p className="mt-1 text-sm text-sg-amber">{state.draftWorkspace.session.session_code}</p>
                  </div>
                  <button type="button" onClick={state.onResumeDraft} className={shellButtonClass('secondary')}>
                    Devam Et
                  </button>
                </div>
              </div>
            ) : null}
            <PurchaseFilters state={state} filters={listFilters} onChange={updateListFilters} onReset={resetListFilters} />
            <DocumentList state={state} documents={filteredDocuments.slice(0, 8)} />
          </ModernSection>
        </div>
      ) : null}

      {!hasWorkspace && (phase === 'ready' || phase === 'draft') ? (
        <ModernSection title="Son Alışlar" subtitle="Belge geçmişi; detay, Office, dışa aktarma, yazdırma, düzenleme ve kayıt aksiyonlarını aynı satırda sunar.">
          {state.draftWorkspace ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sg-lg border border-sg-amber/30 bg-sg-amber-soft p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-amber">Açık taslak</p>
                <p className="mt-1 text-sm font-semibold text-sg-text">{state.draftWorkspace.session.session_code}</p>
                <p className="mt-1 text-xs text-sg-text-soft">Yeni boş alış başlatmadan önce bu taslağa dönün.</p>
              </div>
              <button type="button" onClick={state.onResumeDraft} className={shellButtonClass('primary')}>Taslağa devam et</button>
            </div>
          ) : null}
          <PurchaseFilters state={state} filters={listFilters} onChange={updateListFilters} onReset={resetListFilters} />
          <DocumentList state={state} documents={filteredDocuments} />
        </ModernSection>
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
    </ModernModuleShell>
  );
}

function CustomerPicker({ state, hasSelectedCustomer }: { state: ModernAlisViewModel['state']; hasSelectedCustomer: boolean }) {
  const mode = state.customerMode;
  const hasValidNewCustomer =
    state.newCustomer.name.trim().length >= 2 &&
    state.newCustomer.phone.trim().length >= 7 &&
    state.newCustomer.cpr_number.replace(/\D/g, '').length >= 10 &&
    state.newCustomer.identity_doc_number.trim().length >= 4;

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
        <button type="submit" disabled={!hasValidNewCustomer || state.customerSelecting} className={shellButtonClass('primary')}>
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
            onChange={(event) => setCustomer((current) => ({ ...current, [field.key]: event.target.value }))}
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
      postal_code: result.postnr || current.postal_code,
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
          setCustomer((current) => current.city.trim() ? current : { ...current, city: result.postal_district || '' });
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
        <DataPill label="FX" value={formatDecimalFixed(state.marketRates.eur_dkk_fx)} tone="neutral" />
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
        <ReadOnlyMetric label="Gold 24K DKK" value={state.marketRates.gold_24k_dkk} />
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
