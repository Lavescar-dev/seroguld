import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, History, NotebookTabs, Printer, ReceiptText, ShoppingBag } from 'lucide-react';

import { CustomerNotesPanel } from '@/components/CustomerNotesPanel';
import { apiRequest, fetchAuthedPdfBlob, openAuthedDocument } from '@/lib/api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';

type Workspace = { purchase_count: number; purchase_amount_dkk: string; sale_count: number; sale_amount_dkk: string; total_gold_grams: string; total_silver_grams: string; document_count: number; note_count: number; last_transaction_at?: string | null; customer: { risk?: { level: string; score: number; warnings: string[] }; gdpr_status: string } };
type Transaction = { id: string; side: string; product_number: string; reference_number?: string | null; product_type: string; metal_type: string; weight_grams: string; purity_karat?: string | null; amount_dkk: string; status: string; transaction_at: string };
type TransactionList = { items: Transaction[]; total: number };
type DocumentItem = { sequence_no: number; session_id: string; document_number: string; document_title: string; document_type: string; gross_amount_dkk: string; total_weight_grams?: string | null; issued_at: string; historical_imported_at?: string | null; uniconta_invoice_number?: string | null; uniconta_sync_status?: string | null; uniconta_pdf_available?: boolean };

type Tab = 'overview' | 'transactions' | 'documents' | 'notes';

export function CustomerWorkspacePanel({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [side, setSide] = useState('all');
  const workspaceQuery = useQuery({ queryKey: ['customer-workspace', customerId], queryFn: () => apiRequest<Workspace>(`/api/customers/${customerId}/workspace`) });
  const transactionsQuery = useQuery({ queryKey: ['customer-transactions', customerId, side], queryFn: () => apiRequest<TransactionList>(`/api/customers/${customerId}/transactions?side=${side}&page_size=100`) });
  const documentsQuery = useQuery({ queryKey: ['customer-documents', customerId], queryFn: () => apiRequest<DocumentItem[]>(`/api/customers/${customerId}/documents?limit=300`) });
  const workspace = workspaceQuery.data;
  const tabs: Array<{ id: Tab; label: string; icon: typeof History }> = [
    { id: 'overview', label: 'Genel bakış', icon: History },
    { id: 'transactions', label: `İşlemler (${transactionsQuery.data?.total || 0})`, icon: ShoppingBag },
    { id: 'documents', label: `Belgeler (${documentsQuery.data?.length || 0})`, icon: FileText },
    { id: 'notes', label: `Notlar (${workspace?.note_count || 0})`, icon: NotebookTabs },
  ];
  const openStatement = async () => {
    const result = await fetchAuthedPdfBlob(`/api/customers/${customerId}/statement.pdf`);
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="mt-4 overflow-hidden rounded-sg-lg border border-sg-border bg-sg-surface">
      <div className="flex flex-col gap-3 border-b border-sg-border bg-sg-surface-soft p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-1 overflow-x-auto">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} className={tab === id ? 'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-sg-accent shadow-sm' : 'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-sg-text-soft hover:bg-white'}><Icon className="h-3.5 w-3.5" />{label}</button>)}</div>
        <div className="flex shrink-0 gap-2"><button type="button" onClick={() => { window.location.hash = `/?customer=${encodeURIComponent(customerId)}&start=1`; }} className="rounded-lg bg-sg-accent px-3 py-2 text-xs font-semibold text-white">Yeni alış başlat</button><button type="button" onClick={() => void openStatement()} className="inline-flex items-center gap-1.5 rounded-lg border border-sg-border bg-white px-3 py-2 text-xs font-semibold text-sg-text"><Printer className="h-3.5 w-3.5" />Hesap özeti</button></div>
      </div>
      <div className="p-4">
        {workspaceQuery.isLoading ? <p className="text-sm text-sg-text-soft">Müşteri dosyası yükleniyor…</p> : null}
        {tab === 'overview' && workspace ? <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
          ['Müşteriden alış', `${workspace.purchase_count} işlem`, formatMoney(workspace.purchase_amount_dkk)],
          ['Müşteriye satış', `${workspace.sale_count} işlem`, formatMoney(workspace.sale_amount_dkk)],
          ['Altın / gümüş', `${formatNumber(workspace.total_gold_grams)} g`, `${formatNumber(workspace.total_silver_grams)} g`],
          ['Son işlem', workspace.last_transaction_at ? formatDate(workspace.last_transaction_at) : '—', `${workspace.document_count} belge`],
        ].map(([label, value, meta]) => <div key={label} className="rounded-lg border border-sg-border-soft bg-sg-surface-soft p-3"><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-sg-text-soft">{label}</p><p className="mt-2 text-lg font-semibold text-sg-text">{value}</p><p className="mt-1 text-xs text-sg-text-soft">{meta}</p></div>)}</div>{workspace.customer.risk?.warnings?.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-900">Risk uyarıları · {workspace.customer.risk.level}</p>{workspace.customer.risk.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-800">{warning}</p>)}</div> : null}</div> : null}
        {tab === 'transactions' ? <div><div className="mb-3 flex gap-2">{[['all', 'Tümü'], ['buy_from_customer', 'Müşteriden alış'], ['sell_to_customer', 'Müşteriye satış']].map(([value, label]) => <button key={value} type="button" onClick={() => setSide(value)} className={side === value ? 'rounded-full bg-sg-accent px-3 py-1.5 text-xs font-semibold text-white' : 'rounded-full border border-sg-border px-3 py-1.5 text-xs text-sg-text-soft'}>{label}</button>)}</div><div className="space-y-2">{(transactionsQuery.data?.items || []).map((item) => <div key={item.id} className="grid gap-2 rounded-lg border border-sg-border-soft px-3 py-3 text-sm sm:grid-cols-[1fr_auto_auto]"><div><p className="font-semibold text-sg-text">#{item.product_number} · {item.product_type}</p><p className="mt-1 text-xs text-sg-text-soft">{item.side === 'buy_from_customer' ? 'Müşteriden alış' : 'Müşteriye satış'} · {item.metal_type} · {item.purity_karat || '—'}</p></div><p className="text-sg-text-soft">{formatNumber(item.weight_grams)} g</p><div className="text-right"><p className="font-semibold text-sg-text">{formatMoney(item.amount_dkk)}</p><p className="text-xs text-sg-text-soft">{formatDate(item.transaction_at)}</p></div></div>)}{!transactionsQuery.isLoading && !(transactionsQuery.data?.items.length) ? <p className="py-6 text-center text-sm text-sg-text-soft">Bu filtrede işlem bulunmuyor.</p> : null}</div></div> : null}
        {tab === 'documents' ? <div className="space-y-2">{(documentsQuery.data || []).map((document) => <div key={document.sequence_no} className="flex flex-col gap-3 rounded-lg border border-sg-border-soft px-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-sg-text">{document.document_number}</p><span className="rounded-full bg-sg-surface-soft px-2 py-1 text-[10px] font-semibold uppercase text-sg-text-soft">{document.document_title}</span>{document.historical_imported_at ? <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">Tarihsel içe aktarma</span> : null}{document.uniconta_invoice_number ? <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">Fatura #{document.uniconta_invoice_number}</span> : null}</div><p className="mt-1 text-xs text-sg-text-soft">{formatDate(document.issued_at)} · {formatNumber(document.total_weight_grams || 0)} g · {formatMoney(document.gross_amount_dkk)}</p></div><div className="flex gap-2"><button type="button" onClick={() => { window.location.hash = `/log?document=${document.sequence_no}`; }} className="rounded-md border border-sg-border px-2.5 py-1.5 text-xs">Detay</button><button type="button" onClick={() => { window.location.hash = `/office-document/alis-document/${document.sequence_no}`; }} className="inline-flex items-center gap-1 rounded-md border border-sg-border px-2.5 py-1.5 text-xs"><FileSpreadsheet className="h-3.5 w-3.5" />Office</button><button type="button" onClick={() => void openAuthedDocument(`/api/pos/sessions/${document.session_id}/receipt?audience=admin&format=pdf`)} className="inline-flex items-center gap-1 rounded-md border border-sg-border px-2.5 py-1.5 text-xs"><ReceiptText className="h-3.5 w-3.5" />PDF</button></div></div>)}{!documentsQuery.isLoading && !(documentsQuery.data?.length) ? <p className="py-6 text-center text-sm text-sg-text-soft">Bu müşteriye bağlı AFG veya fatura bulunmuyor.</p> : null}</div> : null}
        {tab === 'notes' ? <CustomerNotesPanel customerId={customerId} customerName={customerName} manage /> : null}
      </div>
    </section>
  );
}
