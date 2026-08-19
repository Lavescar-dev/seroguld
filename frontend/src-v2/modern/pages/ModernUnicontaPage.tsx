import { useEffect, useState } from 'react';
import { Activity, Building2, CheckCircle2, Download, FileCheck2, Loader2, ReceiptText, RefreshCw, RotateCcw, Search, Send, Settings, X } from 'lucide-react';

import { PdfViewerModal } from '@/components/PdfViewerModal';
import { fetchAuthedPdfBlob } from '@/lib/api';
import type { Fatura } from '@/make/uniconta/types';

import {
  ModernBadge,
  ModernButton,
  ModernCard,
  ModernDataTable,
  ModernDrawer,
  ModernPage,
  ModernSection,
  ModernSectionHeader,
  ModernStat,
  type ModernTone,
} from '@/modern/design-system';

import { AvailabilityBanner, DetailGrid, formatDate, formatMoney, TimelineList, toneForText } from './shared';
import type { ModernUnicontaPageProps } from './types';

type UnicontaTab = 'reconciliation' | 'outbox' | 'delivery' | 'connection';
const INVOICE_PAGE_SIZE = 50;

const tabLabels: Array<{ id: UnicontaTab; label: string }> = [
  { id: 'reconciliation', label: 'Faturalar' },
  { id: 'outbox', label: 'Outbox' },
  { id: 'delivery', label: 'Belge Teslimi' },
  { id: 'connection', label: 'Bağlantı' },
];

function connectionTone(value: string): ModernTone {
  if (value === 'bagli') return 'success';
  if (value === 'hata') return 'danger';
  if (value === 'yukleniyor') return 'info';
  return 'warning';
}

function connectionLabel(value: string): string {
  if (value === 'bagli') return 'Bağlı';
  if (value === 'hata') return 'Hata';
  if (value === 'yukleniyor') return 'Yükleniyor';
  return 'Bağlı değil';
}

function stateBadge(value: string, tone: ModernTone = toneForText(value)) {
  return <ModernBadge tone={tone}>{value}</ModernBadge>;
}

function amountDirectionLabel(invoice: Fatura) {
  if (invoice.amountDirection === 'income') return 'Gelir';
  if (invoice.amountDirection === 'expense') return 'Gider';
  return 'Nötr';
}

function amountDirectionTone(invoice: Fatura): ModernTone {
  if (invoice.amountDirection === 'income') return 'success';
  if (invoice.amountDirection === 'expense') return 'danger';
  return 'neutral';
}

function amountTextClass(invoice: Fatura) {
  if (invoice.amountDirection === 'income') return 'text-sg-green-strong';
  if (invoice.amountDirection === 'expense') return 'text-sg-red';
  return 'text-sg-text-soft';
}

function formatSignedInvoiceAmount(invoice: Fatura) {
  const formatted = new Intl.NumberFormat(document.documentElement.lang || 'tr', {
    style: 'currency',
    currency: invoice.valuta,
    maximumFractionDigits: 2,
  }).format(invoice.signedTotalAmount);
  return invoice.signedTotalAmount > 0 ? `+${formatted}` : formatted;
}

function formatInvoiceDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(document.documentElement.lang || 'tr', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function InvoiceDetailDrawer({
  invoice,
  pdfLoading,
  pdfError,
  onClose,
  onOpenPdf,
}: {
  invoice: Fatura | null;
  pdfLoading: boolean;
  pdfError: string | null;
  onClose: () => void;
  onOpenPdf: (invoice: Fatura) => void;
}) {
  if (!invoice) return null;

  return (
    <ModernDrawer
      open
      onClose={onClose}
      title={`Uniconta fatura #${invoice.fakturanummer}`}
      description={`${invoice.kunde.navn} · ${formatDate(invoice.fakturadato)}`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ModernButton tone="ghost" onClick={onClose}>Kapat</ModernButton>
          <ModernButton tone="primary" icon={pdfLoading ? Loader2 : Download} disabled={pdfLoading} onClick={() => onOpenPdf(invoice)}>
            {pdfLoading ? 'PDF yükleniyor…' : 'Fatura PDF’ini aç'}
          </ModernButton>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <ModernCard className="bg-sg-surface">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Toplam</p>
            <p className={`mt-2 text-lg font-semibold ${amountTextClass(invoice)}`}>{formatSignedInvoiceAmount(invoice)}</p>
            <p className="mt-1 text-xs text-sg-text-soft">{invoice.valuta}</p>
            <div className="mt-2">{stateBadge(amountDirectionLabel(invoice), amountDirectionTone(invoice))}</div>
          </ModernCard>
          <ModernCard className="bg-sg-surface">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Fatura türü</p>
            <div className="mt-2">{stateBadge(invoice.type, invoice.type === 'Kreditnota' ? 'warning' : 'info')}</div>
          </ModernCard>
          <ModernCard className="bg-sg-surface">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-text-soft">Hesap</p>
            <p className="mt-2 font-mono text-sm font-semibold text-sg-text">{invoice.konto}</p>
          </ModernCard>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ModernCard className="bg-sg-surface">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Müşteri</p>
            <p className="mt-2 text-base font-semibold text-sg-text">{invoice.kunde.navn}</p>
            <dl className="mt-3 space-y-2 text-sm text-sg-text-soft">
              {invoice.kunde.email ? <div><dt className="inline font-medium text-sg-text">E-posta: </dt><dd className="inline">{invoice.kunde.email}</dd></div> : null}
              {invoice.kunde.telefon ? <div><dt className="inline font-medium text-sg-text">Telefon: </dt><dd className="inline">{invoice.kunde.telefon}</dd></div> : null}
              {invoice.kunde.adresse ? <div><dt className="inline font-medium text-sg-text">Adres: </dt><dd className="inline">{invoice.kunde.adresse}</dd></div> : null}
              {invoice.kunde.postnr ? <div><dt className="inline font-medium text-sg-text">Posta kodu: </dt><dd className="inline">{invoice.kunde.postnr}</dd></div> : null}
              {invoice.kunde.cvr ? <div><dt className="inline font-medium text-sg-text">CVR: </dt><dd className="inline">{invoice.kunde.cvr}</dd></div> : null}
            </dl>
          </ModernCard>
          <ModernCard className="bg-sg-surface">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Fatura bilgileri</p>
            <dl className="mt-3 space-y-2 text-sm text-sg-text-soft">
              <div><dt className="inline font-medium text-sg-text">Tarih: </dt><dd className="inline">{formatDate(invoice.fakturadato)}</dd></div>
              <div><dt className="inline font-medium text-sg-text">Fatura no: </dt><dd className="inline">#{invoice.fakturanummer}</dd></div>
              {invoice.ordrenummer ? <div><dt className="inline font-medium text-sg-text">Sipariş no: </dt><dd className="inline">{invoice.ordrenummer}</dd></div> : null}
              {invoice.unicontaRef ? <div><dt className="inline font-medium text-sg-text">Uniconta ref: </dt><dd className="inline">{invoice.unicontaRef}</dd></div> : null}
              {invoice.wooOrderId ? <div><dt className="inline font-medium text-sg-text">Woo ref: </dt><dd className="inline">{invoice.wooOrderId}</dd></div> : null}
            </dl>
          </ModernCard>
        </div>

        <ModernCard className="overflow-hidden bg-sg-surface p-0">
          <div className="flex items-center gap-2 border-b border-sg-border-soft px-4 py-3">
            <ReceiptText className="h-4 w-4 text-sg-accent" />
            <h4 className="text-sm font-semibold text-sg-text">Fatura kalemleri</h4>
            <ModernBadge tone="neutral" className="ml-auto">{invoice.kalemler.length} kalem</ModernBadge>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[620px] w-full text-sm">
              <thead className="bg-sg-surface-soft text-[10px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft">
                <tr><th className="px-4 py-2 text-left">Açıklama</th><th className="px-3 py-2 text-left">Tarih</th><th className="px-3 py-2 text-right">Adet</th><th className="px-3 py-2 text-right">Birim</th><th className="px-3 py-2 text-right">İndirim</th><th className="px-3 py-2 text-right">KDV</th><th className="px-4 py-2 text-right">Toplam</th></tr>
              </thead>
              <tbody>
                {invoice.kalemler.map((line) => (
                  <tr key={line.id} className="border-t border-sg-border-soft">
                    <td className="px-4 py-3 font-medium text-sg-text">{line.beskrivelse}</td>
                    <td className="px-3 py-3 text-sg-text-soft">{line.dato ? formatInvoiceDate(line.dato) : formatInvoiceDate(invoice.fakturadato)}</td>
                    <td className="px-3 py-3 text-right text-sg-text-soft">{line.antal}</td>
                    <td className="px-3 py-3 text-right text-sg-text-soft">{formatMoney(line.enhedspris)}</td>
                    <td className="px-3 py-3 text-right text-sg-text-soft">{line.rabat > 0 ? `${line.rabat}%` : '—'}</td>
                    <td className="px-3 py-3 text-right text-sg-text-soft">{line.moms > 0 ? `${line.moms}%` : '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${amountTextClass(invoice)}`}>{(invoice.amountDirection === 'income' ? '+' : invoice.amountDirection === 'expense' ? '−' : '') + formatMoney(Math.abs(line.liniepris))}</td>
                  </tr>
                ))}
                {invoice.kalemler.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-sg-text-soft">Fatura kalemi bulunmuyor.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="ml-auto w-full border-t border-sg-border-soft bg-sg-surface-soft sm:w-72">
            <div className="flex justify-between px-4 py-2 text-sm text-sg-text-soft"><span>Ara toplam</span><span>{formatMoney(invoice.subtotal)}</span></div>
            {invoice.momsTotal > 0 ? <div className="flex justify-between border-t border-sg-border-soft px-4 py-2 text-sm text-sg-text-soft"><span>KDV</span><span>{formatMoney(invoice.momsTotal)}</span></div> : null}
            <div className="flex justify-between border-t border-sg-border px-4 py-3 text-sm font-semibold text-sg-text"><span>Toplam</span><span className={amountTextClass(invoice)}>{formatSignedInvoiceAmount(invoice)}</span></div>
          </div>
        </ModernCard>

        {invoice.note ? <ModernCard className="border-sg-amber/25 bg-sg-amber-soft"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-amber">Not</p><p className="mt-2 text-sm text-sg-text">{invoice.note}</p></ModernCard> : null}

        <ModernCard className="bg-sg-surface">
          <p className="text-sm font-semibold text-sg-text">Belge teslimi</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-sg-md border border-sg-border-soft px-3 py-2"><span className="text-xs text-sg-text-soft">E-posta</span>{stateBadge(invoice.mailSendt ? 'Gönderildi' : 'Bekliyor', invoice.mailSendt ? 'success' : 'warning')}</div>
            <div className="flex items-center justify-between rounded-sg-md border border-sg-border-soft px-3 py-2"><span className="text-xs text-sg-text-soft">E-fatura</span>{stateBadge(invoice.eFakturaSendt ? 'Gönderildi' : 'Bekliyor', invoice.eFakturaSendt ? 'success' : 'warning')}</div>
          </div>
        </ModernCard>

        {pdfError ? <p className="rounded-sg-md border border-sg-red/30 bg-sg-red-soft px-4 py-3 text-sm text-sg-red">{pdfError}</p> : null}
      </div>
    </ModernDrawer>
  );
}

export function ModernUnicontaPage({
  connectionStatus,
  config,
  connectionInfo,
  connectionDraft,
  connectionSettingsOpen,
  loading,
  invoices,
  invoicesLoading,
  invoicesError,
  invoicesTruncated,
  syncSummary,
  failedSyncs,
  health,
  selectedInvoice,
  stats,
  connectAvailability,
  retryAvailability,
  onConnect,
  onOpenConnectionSettings,
  onCloseConnectionSettings,
  searchValue = '',
  onSearchChange,
  typeFilter = 'Tümü',
  onTypeFilterChange,
  mailFilter = 'tümü',
  onMailFilterChange,
  eFaturaFilter = 'tümü',
  onEFaturaFilterChange,
  dateFilter = 'tümü',
  onDateFilterChange,
  sortKey = 'fakturadato',
  sortDir = 'desc',
  onSort,
  onRefresh,
  onSelectInvoice,
  onRetryAll,
  onRetryFailed,
  retryingSingleSeq,
}: ModernUnicontaPageProps) {
  const [activeTab, setActiveTab] = useState<UnicontaTab>('reconciliation');
  const [invoicePage, setInvoicePage] = useState(0);
  const [detailInvoice, setDetailInvoice] = useState<Fatura | null>(null);
  const [connectionDraftLocal, setConnectionDraftLocal] = useState(connectionDraft);
  const [pdfState, setPdfState] = useState<{ url: string | null; filename: string; loading: boolean; error: string | null }>({
    url: null,
    filename: '',
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (connectionDraft) setConnectionDraftLocal(connectionDraft);
  }, [connectionDraft, connectionSettingsOpen]);

  const updateConnectionDraft = (
    key: 'companyId' | 'username' | 'password' | 'sendEmailOnFinalize' | 'sendXmlOnFinalize',
    value: string | boolean,
  ) => {
    setConnectionDraftLocal((current) => current ? { ...current, [key]: value } : current);
  };

  const deliveredCount = stats?.eFakturaGonderildi ?? invoices.filter((invoice) => Boolean(invoice.eFakturaSendt)).length;
  const invoiceCount = stats?.toplam ?? invoices.length;
  const selected = selectedInvoice || invoices[0] || null;
  const invoicePageCount = Math.max(1, Math.ceil(invoices.length / INVOICE_PAGE_SIZE));
  const visibleInvoices = invoices.slice(invoicePage * INVOICE_PAGE_SIZE, (invoicePage + 1) * INVOICE_PAGE_SIZE);

  useEffect(() => {
    setInvoicePage(0);
  }, [searchValue, typeFilter, mailFilter, eFaturaFilter, dateFilter, sortKey, sortDir]);

  useEffect(() => {
    setInvoicePage((current) => Math.min(current, invoicePageCount - 1));
  }, [invoicePageCount]);

  const handlePdfRequest = async (invoice: typeof selected) => {
    if (!invoice) return;
    setPdfState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams({
        invoiceNumber: String(invoice.fakturanummer),
        account: invoice.konto,
        date: invoice.fakturadato,
      });
      const { url } = await fetchAuthedPdfBlob(`/api/v2/uniconta/invoice-pdf?${params.toString()}`);
      setPdfState({ url, filename: `uniconta-${invoice.fakturanummer}.pdf`, loading: false, error: null });
    } catch (error) {
      setPdfState({ url: null, filename: '', loading: false, error: error instanceof Error ? error.message : 'PDF yüklenemedi.' });
    }
  };

  const closePdf = () => {
    setPdfState((current) => {
      if (current.url) URL.revokeObjectURL(current.url);
      return { url: null, filename: '', loading: false, error: null };
    });
  };
  const auditItems = [
    {
      id: 'health',
      title: 'Uniconta health',
      detail: health?.last_call_ok === true ? 'Son çağrı başarılı' : health?.last_call_ok === false ? 'Son çağrı başarısız' : 'Son çağrı sonucu henüz yok',
      timestamp: health?.last_call_at ? formatDate(health.last_call_at) : undefined,
      tone: health?.last_call_ok === true ? 'success' as const : health?.last_call_ok === false ? 'danger' as const : 'warning' as const,
    },
    {
      id: 'outbox',
      title: 'Outbox durumu',
      detail: syncSummary ? `${syncSummary.pending} bekleyen · ${syncSummary.failed} başarısız` : 'Sync özeti bekleniyor',
      timestamp: syncSummary?.last_synced_at ? formatDate(syncSummary.last_synced_at) : undefined,
      tone: (syncSummary?.failed ?? 0) > 0 ? 'danger' as const : 'info' as const,
    },
  ];

  return (
    <ModernPage>
      <ModernSection className="bg-sg-surface-soft">
        <ModernSectionHeader
          eyebrow="Finans ve entegrasyon"
          title="Uniconta"
          description="Uniconta faturalarını tarih ve işaretli toplam tutarıyla doğrudan gösterir."
          action={
            <div className="flex flex-wrap gap-2">
              <ModernButton tone="ghost" icon={Settings} onClick={onOpenConnectionSettings} disabled={!onOpenConnectionSettings || loading}>Ayarlar</ModernButton>
              <ModernButton tone="ghost" icon={RefreshCw} onClick={onRefresh} disabled={!onRefresh || loading || invoicesLoading}>Yenile</ModernButton>
              <ModernButton
                tone="primary"
                icon={Building2}
                onClick={() => connectionDraftLocal && onConnect?.(connectionDraftLocal)}
                disabled={!onConnect || !connectionDraftLocal || loading || connectAvailability?.state === 'unavailable'}
              >
                Bağlantıyı test et
              </ModernButton>
            </div>
          }
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <ModernStat
            label="Mutabık belge"
            value={invoiceCount}
            meta={stats ? `Net toplam ${formatMoney(stats.toplamKredit)}` : 'Gerçek fatura listesi'}
            icon={FileCheck2}
            tone="success"
          />
          <ModernStat
            label="Outbox bekleyen"
            value={syncSummary?.pending ?? 0}
            meta={syncSummary ? `${syncSummary.period_hours} saatlik pencere` : 'Sync özeti bekleniyor'}
            icon={RotateCcw}
            tone={(syncSummary?.pending ?? 0) > 0 ? 'warning' : 'neutral'}
          />
          <ModernStat
            label="Teslim edilen belge"
            value={deliveredCount}
            meta={stats ? `${stats.mailGonderildi} e-posta kaydı` : 'Gerçek teslim alanı'}
            icon={Send}
            tone="info"
          />
        </div>
        <div className="mt-4 space-y-3">
          <AvailabilityBanner availability={connectAvailability} />
          <AvailabilityBanner availability={retryAvailability} />
        </div>
      </ModernSection>

      <div className="flex flex-wrap gap-1 rounded-sg-lg border border-sg-border bg-sg-surface-soft p-1">
        {tabLabels.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'rounded-sg-md bg-sg-surface px-4 py-2 text-xs font-semibold text-sg-accent shadow-sg-sm' : 'rounded-sg-md px-4 py-2 text-xs font-semibold text-sg-text-soft hover:bg-sg-surface'}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'reconciliation' ? (
        <ModernSection className="bg-sg-surface-soft">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="relative xl:col-span-2">
              <span className="sr-only">Fatura ara</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sg-text-soft" />
              <input
                value={searchValue}
                onChange={(event) => onSearchChange?.(event.target.value)}
                placeholder="Fatura, müşteri veya hesap ara"
                className="w-full rounded-sg-md border border-sg-border bg-sg-surface px-9 py-2.5 text-sm text-sg-text outline-none focus:border-sg-accent"
              />
            </label>
            <select value={typeFilter} onChange={(event) => onTypeFilterChange?.(event.target.value as typeof typeFilter)} className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2.5 text-sm text-sg-text">
              <option value="Tümü">Tüm tipler</option>
              <option value="Salgsfaktura">Satış faturası</option>
              <option value="Kreditnota">Kredi notu</option>
              <option value="Forudbetaling">Ön ödeme</option>
              <option value="Rentefaktura">Faiz faturası</option>
            </select>
            <select value={mailFilter} onChange={(event) => onMailFilterChange?.(event.target.value as typeof mailFilter)} className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2.5 text-sm text-sg-text">
              <option value="tümü">E-posta: tümü</option>
              <option value="gonderildi">E-posta gönderildi</option>
              <option value="gonderilmedi">E-posta bekliyor</option>
            </select>
            <select value={eFaturaFilter} onChange={(event) => onEFaturaFilterChange?.(event.target.value as typeof eFaturaFilter)} className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2.5 text-sm text-sg-text">
              <option value="tümü">E-fatura: tümü</option>
              <option value="gonderildi">E-fatura gönderildi</option>
              <option value="gonderilmedi">E-fatura bekliyor</option>
            </select>
            <select value={dateFilter} onChange={(event) => onDateFilterChange?.(event.target.value as typeof dateFilter)} className="rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2.5 text-sm text-sg-text">
              <option value="tümü">Tarih: tümü</option>
              <option value="bu_ay">Bu ay</option>
              <option value="son_3ay">Son 3 ay</option>
              <option value="bu_yil">Bu yıl</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-sg-text-soft">
            <span>{invoices.length} fatura yüklendi</span>
            {invoicesLoading ? <span className="inline-flex items-center gap-1 font-semibold text-sg-accent"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Liste yükleniyor</span> : null}
            {invoicesTruncated ? <span className="font-semibold text-sg-amber">İlk 15.000 fatura gösteriliyor.</span> : null}
            <span>·</span>
            <span>Sıralama:</span>
            {(['fakturadato', 'fakturanummer', 'kunde', 'total'] as const).map((key) => (
              <button key={key} type="button" onClick={() => onSort?.(key)} className={sortKey === key ? 'rounded-full bg-sg-accent px-3 py-1 font-semibold text-white' : 'rounded-full border border-sg-border px-3 py-1 font-semibold text-sg-text-soft hover:bg-sg-surface'}>
                {key === 'fakturadato' ? 'Tarih' : key === 'fakturanummer' ? 'Fatura no' : key === 'kunde' ? 'Müşteri' : 'Toplam'}{sortKey === key ? ` ${sortDir === 'asc' ? '↑' : '↓'}` : ''}
              </button>
            ))}
          </div>
          {invoicesError ? <div className="mt-3 rounded-sg-md border border-sg-red/30 bg-sg-red-soft px-4 py-3 text-sm text-sg-red">{invoicesError}</div> : null}
        </ModernSection>
      ) : null}

      {activeTab === 'reconciliation' ? (
        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <ModernSection className="min-w-0">
            <ModernSectionHeader
              title="Uniconta faturaları"
              description="Tarih ve işaretli toplam, Uniconta fatura kaydından doğrudan okunur."
              action={<ModernBadge tone="info">Canlı ERP verisi</ModernBadge>}
            />
            <div className="mt-4">
              <ModernDataTable
                items={visibleInvoices}
                getRowKey={(item) => item.id}
                emptyTitle="Fatura bulunmuyor"
                emptyDescription="Uniconta fatura endpoint'i satır döndürdüğünde liste burada açılır."
                columns={[
                  {
                    key: 'document',
                    header: 'Fatura',
                    cell: (item) => (
                      <div>
                        <p className="font-semibold text-sg-text">{item.fakturanummer}</p>
                        <p className="mt-1 text-xs text-sg-text-soft">{item.ordrenummer || item.id}</p>
                      </div>
                    ),
                  },
                  {
                    key: 'customer',
                    header: 'Müşteri',
                    cell: (item) => item.kunde.navn || '—',
                  },
                  {
                    key: 'date',
                    header: 'Tarih',
                    cell: (item) => <span className="whitespace-nowrap">{formatInvoiceDate(item.fakturadato)}</span>,
                  },
                  {
                    key: 'amount',
                    header: 'Tutar',
                    align: 'right',
                    cell: (item) => (
                      <div className="flex flex-col items-end gap-1">
                        <span className={`whitespace-nowrap font-semibold ${amountTextClass(item)}`}>{formatSignedInvoiceAmount(item)}</span>
                        {stateBadge(amountDirectionLabel(item), amountDirectionTone(item))}
                      </div>
                    ),
                  },
                  {
                    key: 'detail',
                    header: 'Detay',
                    align: 'right',
                    cell: (item) => onSelectInvoice ? (
                      <ModernButton tone="ghost" size="sm" onClick={() => { onSelectInvoice(item); setDetailInvoice(item); }}>Aç</ModernButton>
                    ) : <ModernBadge tone="neutral">Read-only</ModernBadge>,
                  },
                ]}
              />
            </div>
            {invoices.length > INVOICE_PAGE_SIZE ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-sg-border-soft pt-3 text-xs text-sg-text-soft">
                <span>
                  Faturalar {invoicePage * INVOICE_PAGE_SIZE + 1}–{Math.min((invoicePage + 1) * INVOICE_PAGE_SIZE, invoices.length)} / {invoices.length}
                </span>
                <div className="flex items-center gap-2">
                  <ModernButton tone="ghost" size="sm" onClick={() => setInvoicePage((current) => Math.max(0, current - 1))} disabled={invoicePage === 0}>Önceki</ModernButton>
                  <span aria-live="polite" className="min-w-20 text-center font-semibold text-sg-text">Sayfa {invoicePage + 1} / {invoicePageCount}</span>
                  <ModernButton tone="ghost" size="sm" onClick={() => setInvoicePage((current) => Math.min(invoicePageCount - 1, current + 1))} disabled={invoicePage >= invoicePageCount - 1}>Sonraki</ModernButton>
                </div>
              </div>
            ) : null}
          </ModernSection>

          <div className="space-y-5">
            <DetailGrid
              title={selected ? `Fatura · ${selected.fakturanummer}` : 'Fatura detayı'}
              description="Satır seçimi aynı route içinde detay çalışma alanını günceller."
              items={selected ? [
                { label: 'Müşteri', value: selected.kunde.navn, accent: true },
                { label: 'Tarih', value: formatInvoiceDate(selected.fakturadato) },
                { label: 'Net tutar', value: formatMoney(selected.subtotal) },
                { label: 'Toplam', value: formatSignedInvoiceAmount(selected), accent: true },
                { label: 'Business key', value: selected.ordrenummer || selected.id },
                { label: 'Belge teslimi', value: selected.eFakturaSendt || selected.mailSendt || 'Bekliyor' },
              ] : [{ label: 'Durum', value: 'Fatura seçimi bekleniyor', accent: true }]}
            />
            {selected ? (
              <ModernSection className="bg-sg-surface-soft">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-sg-text">Belge işlemleri</p>
                    <p className="mt-1 text-xs text-sg-text-soft">Uniconta’daki gerçek fatura PDF’ini açın.</p>
                  </div>
                  <ModernButton tone="ghost" icon={pdfState.loading ? Loader2 : Download} onClick={() => void handlePdfRequest(selected)} disabled={pdfState.loading}>
                    {pdfState.loading ? 'Yükleniyor' : 'PDF aç'}
                  </ModernButton>
                </div>
                {pdfState.error ? <p className="mt-3 text-xs text-red-600">{pdfState.error}</p> : null}
              </ModernSection>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === 'outbox' ? (
        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <ModernSection className="min-w-0">
            <ModernSectionHeader title="Outbox ve retry journal" description="Sadece backend'in döndürdüğü başarısız sync satırları aksiyon alabilir." />
            <div className="mt-4">
              <ModernDataTable
                items={failedSyncs}
                getRowKey={(item) => String(item.sequence_no)}
                emptyTitle="Outbox hatası yok"
                emptyDescription="Retry için gerçek hata satırı gerektiğinden boş kuyruk başarı gibi boyanmaz."
                columns={[
                  { key: 'document', header: 'Belge', cell: (item) => <><p className="font-semibold text-sg-text">#{item.sequence_no}</p><p className="mt-1 text-xs text-sg-text-soft">{item.document_number || 'Belge no yok'}</p></> },
                  { key: 'customer', header: 'Müşteri', cell: (item) => item.customer_name || '—' },
                  { key: 'amount', header: 'Tutar', cell: (item) => item.gross_amount_dkk || '—' },
                  { key: 'error', header: 'Hata', cell: (item) => item.uniconta_sync_error || '—' },
                  { key: 'action', header: 'Aksiyon', align: 'right', cell: (item) => onRetryFailed ? <ModernButton tone="ghost" size="sm" onClick={() => onRetryFailed(item.sequence_no)} disabled={retryingSingleSeq !== null}>{retryingSingleSeq === item.sequence_no ? 'Deneniyor…' : 'Tekrar dene'}</ModernButton> : <ModernBadge tone="warning">Read-only</ModernBadge> },
                ]}
              />
            </div>
          </ModernSection>
          <div className="space-y-5">
            <DetailGrid
              title="Sync özeti"
              items={syncSummary ? [
                { label: 'Toplam', value: syncSummary.total, accent: true },
                { label: 'Başarılı', value: syncSummary.synced },
                { label: 'Başarısız', value: syncSummary.failed },
                { label: 'Bekleyen', value: syncSummary.pending },
                { label: 'Atlanan', value: syncSummary.skipped },
                { label: 'Son sync', value: syncSummary.last_synced_at ? formatDate(syncSummary.last_synced_at) : '—' },
              ] : [{ label: 'Durum', value: 'Sync özeti bekleniyor', accent: true }]}
            />
            <AvailabilityBanner availability={retryAvailability} action={onRetryAll ? <ModernButton tone="warning" onClick={onRetryAll}>Tümünü tekrar dene</ModernButton> : undefined} />
          </div>
        </div>
      ) : null}

      {activeTab === 'delivery' ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <ModernSection>
            <ModernSectionHeader title="Belge teslim zinciri" description="Yerel kayıt → Uniconta referansı → belge/e-posta kanıtı." />
            <div className="mt-4 space-y-3">
              {[
                { label: 'Yerel AFG / transaction', value: selected ? 'Mevcut' : 'Bekliyor', tone: selected ? 'success' as const : 'warning' as const, detail: selected ? selected.fakturanummer : 'Fatura seçimi yok' },
                { label: 'Uniconta outbox', value: selected?.unicontaRef ? 'Referans mevcut' : 'DISCOVERY', tone: selected?.unicontaRef ? 'success' as const : 'info' as const, detail: selected?.unicontaRef || 'Stable key / remote ref DTO’da yok' },
                { label: 'PDF / e-fatura', value: selected?.eFakturaSendt || 'DISCOVERY', tone: selected?.eFakturaSendt ? 'success' as const : 'info' as const, detail: selected?.eFakturaSendt ? formatDate(selected.eFakturaSendt) : 'Kanonik PDF teslim alanı expose değil' },
                { label: 'E-posta', value: selected?.mailSendt || 'Kapalı', tone: selected?.mailSendt ? 'success' as const : 'neutral' as const, detail: config?.sendEmailOnFinalize || connectionInfo?.sendEmailOnFinalize ? 'Konfigürasyonda açık' : 'Konfigürasyonda kapalı' },
              ].map((step) => (
                <div key={step.label} className="flex items-center justify-between gap-4 rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sg-surface ring-1 ring-sg-border"><CheckCircle2 className="h-4 w-4 text-sg-green" /></span><div className="min-w-0"><p className="text-sm font-semibold text-sg-text">{step.label}</p><p className="mt-1 truncate text-xs text-sg-text-soft">{step.detail}</p></div></div>
                  {stateBadge(step.value, step.tone)}
                </div>
              ))}
            </div>
          </ModernSection>
          <TimelineList items={auditItems} title="Son denetim" description="Durum denetimi ve eşitleme olayları mevcut işlem çıktısından okunur." />
        </div>
      ) : null}

      {activeTab === 'connection' ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <DetailGrid
            title="Bağlantı durumu"
            items={[
              { label: 'Durum', value: stateBadge(connectionLabel(connectionStatus), connectionTone(connectionStatus)), accent: true },
              { label: 'Company ID', value: connectionInfo?.companyId || config?.companyId || '—' },
              { label: 'Ortam', value: connectionInfo?.env || config?.env || '—' },
              { label: 'E-posta finalize', value: (config?.sendEmailOnFinalize ?? connectionInfo?.sendEmailOnFinalize) ? 'Açık' : 'Kapalı' },
              { label: 'XML finalize', value: (config?.sendXmlOnFinalize ?? connectionInfo?.sendXmlOnFinalize) ? 'Açık' : 'Kapalı' },
            ]}
          />
          <DetailGrid
            title="Token ve durum denetimi"
            items={health ? [
              { label: 'Configured', value: health.configured ? 'Evet' : 'Hayır', accent: true },
              { label: 'Token', value: health.has_token ? 'Mevcut' : 'Yok' },
              { label: 'Son çağrı', value: health.last_call_at ? formatDate(health.last_call_at) : '—' },
              { label: 'Sonuç', value: health.last_call_ok === null || health.last_call_ok === undefined ? '—' : health.last_call_ok ? 'OK' : 'Hata' },
              { label: 'Süre sonu', value: health.access_expires_at ? formatDate(health.access_expires_at) : '—' },
            ] : [{ label: 'Health', value: 'Backend health yanıtı bekleniyor', accent: true }]}
          />
        </div>
      ) : null}

      {activeTab !== 'connection' ? <div className="flex items-center gap-2 text-xs text-sg-text-soft"><Activity className="h-3.5 w-3.5" /> Mutabakat ve teslim aksiyonları gerçek API durumuna göre sınırlıdır.</div> : null}

      {connectionSettingsOpen && connectionDraftLocal ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Uniconta bağlantı ayarları">
          <button type="button" className="absolute inset-0 cursor-default" aria-label="Ayarları kapat" onClick={onCloseConnectionSettings} />
          <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-sg-border bg-sg-surface shadow-sg-lg">
            <div className="flex items-center justify-between border-b border-sg-border px-6 py-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-sg-accent">Uniconta</p>
                <h2 className="mt-1 text-xl font-semibold text-sg-text">Bağlantı ayarları</h2>
              </div>
              <button type="button" onClick={onCloseConnectionSettings} className="rounded-sg-md p-2 text-sg-text-soft hover:bg-sg-surface-soft" aria-label="Kapat"><X className="h-5 w-5" /></button>
            </div>
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                if (onConnect) onConnect(connectionDraftLocal);
              }}
            >
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
                <div className="rounded-sg-md border border-sg-border bg-sg-surface-soft p-4 text-sm text-sg-text-soft">
                  Kimlik bilgileri backend’de doğrulanır. Kayıtlı parola tarayıcıya geri gönderilmez; boş bırakırsanız mevcut parola korunur.
                </div>
                <label className="block text-sm font-semibold text-sg-text">
                  Company ID
                  <input value={connectionDraftLocal.companyId} onChange={(event) => updateConnectionDraft('companyId', event.target.value)} className="mt-2 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2.5 font-mono text-sm outline-none focus:border-sg-accent" />
                </label>
                <label className="block text-sm font-semibold text-sg-text">
                  Kullanıcı adı
                  <input value={connectionDraftLocal.username} onChange={(event) => updateConnectionDraft('username', event.target.value)} className="mt-2 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2.5 text-sm outline-none focus:border-sg-accent" />
                </label>
                <label className="block text-sm font-semibold text-sg-text">
                  Yeni parola <span className="font-normal text-sg-text-soft">(değiştirmeyecekseniz boş bırakın)</span>
                  <input type="password" value={connectionDraftLocal.password} onChange={(event) => updateConnectionDraft('password', event.target.value)} className="mt-2 w-full rounded-sg-md border border-sg-border bg-sg-surface px-3 py-2.5 text-sm outline-none focus:border-sg-accent" autoComplete="new-password" />
                </label>
                <div className="rounded-sg-md border border-sg-border bg-sg-surface-soft p-4 text-sm text-sg-text-soft">
                  Kayıtlı parola: {config?.passwordConfigured ? <span className="font-semibold text-sg-green">Mevcut</span> : <span className="font-semibold text-sg-amber">Eksik</span>}
                </div>
                <label className="flex items-start gap-3 text-sm text-sg-text">
                  <input type="checkbox" checked={Boolean(connectionDraftLocal.sendEmailOnFinalize)} onChange={(event) => updateConnectionDraft('sendEmailOnFinalize', event.target.checked)} className="mt-0.5 h-4 w-4" />
                  <span><strong>Kesinleştirme sonrası e-posta</strong><span className="mt-1 block text-xs text-sg-text-soft">Kesinleştirme sonrasında Uniconta PDF'sini müşteriye gönder.</span></span>
                </label>
                <label className="flex items-start gap-3 text-sm text-sg-text">
                  <input type="checkbox" checked={Boolean(connectionDraftLocal.sendXmlOnFinalize)} onChange={(event) => updateConnectionDraft('sendXmlOnFinalize', event.target.checked)} className="mt-0.5 h-4 w-4" />
                  <span><strong>Kesinleştirme sonrası OIOUBL/XML</strong><span className="mt-1 block text-xs text-sg-text-soft">Kesinleştirme sonrasında e-fatura XML akışını kullan.</span></span>
                </label>
                {config?.message ? <p className={connectionStatus === 'hata' ? 'text-sm text-red-600' : 'text-sm text-sg-text-soft'}>{config.message}</p> : null}
              </div>
              <div className="flex gap-3 border-t border-sg-border bg-sg-surface-soft px-6 py-4">
                <ModernButton type="button" tone="ghost" onClick={onCloseConnectionSettings}>İptal</ModernButton>
                <ModernButton type="submit" tone="primary" icon={loading ? Loader2 : Building2} disabled={Boolean(loading) || !connectionDraftLocal.companyId || !connectionDraftLocal.username}>
                  {loading ? 'Bağlanıyor…' : 'Test et ve kaydet'}
                </ModernButton>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      <InvoiceDetailDrawer
        invoice={detailInvoice}
        pdfLoading={pdfState.loading}
        pdfError={pdfState.error}
        onClose={() => setDetailInvoice(null)}
        onOpenPdf={(invoice) => {
          setDetailInvoice(null);
          void handlePdfRequest(invoice);
        }}
      />
      <PdfViewerModal open={Boolean(pdfState.url)} pdfUrl={pdfState.url} filename={pdfState.filename} title="Uniconta Fatura PDF" onClose={closePdf} />
    </ModernPage>
  );
}
