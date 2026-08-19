'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest, openAuthedDocument } from '@/lib/api';
import {
  labelMetalType,
  labelPosStatus,
  labelPosTradeSide,
  labelProductStatus,
  labelProductType,
} from '@/lib/labels';
import { formatKaratFinhed, formatMoneyDkk, formatWeight, toLodighed } from '@/lib/pos-mappers';
import type { PosDocumentDetail, PosDocumentListItem, ProductStatus } from '@/types';

type OperationFilter = 'all' | 'awaiting_decision' | 'in_inventory' | 'undecided' | 'melted' | 'mixed';

function formatTs(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getOperationLabel(state: PosDocumentListItem['operation_state']): string {
  if (state === 'awaiting_decision') return 'Karar bekliyor';
  if (state === 'mixed') return 'Karma operasyon';
  return labelProductStatus(state);
}

function getOperationBadgeClass(state: PosDocumentListItem['operation_state']): string {
  if (state === 'awaiting_decision') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (state === 'in_inventory') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (state === 'melted') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (state === 'undecided') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (state === 'mixed') return 'border-[#d8c29a] bg-[#fbf4e7] text-[#6d5428]';
  return 'border-[#e0cfaa] bg-white text-[#6d5428]';
}

function getFilterLabel(filter: OperationFilter): string {
  if (filter === 'awaiting_decision') return 'Karar Bekleyen';
  if (filter === 'in_inventory') return 'Envantere Alinan';
  if (filter === 'undecided') return 'Kararsiz';
  if (filter === 'melted') return 'Eritilen';
  if (filter === 'mixed') return 'Karma';
  return 'Tum Belgeler';
}

function productStatusSummary(document: Pick<PosDocumentListItem, 'product_status_counts'>): string {
  const items = Object.entries(document.product_status_counts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([status, count]) => `${labelProductStatus(status as ProductStatus)} ${count}`);
  return items.length > 0 ? items.join(' · ') : 'Urun durumu bekleniyor';
}

function SummaryCard({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={
        muted
          ? 'rounded-[1.4rem] border border-[#e8dcc7] bg-[#fcfaf7] px-4 py-4'
          : 'rounded-[1.4rem] border border-[#d6bf8f] bg-[#1f1a14] px-4 py-4 text-[#f6e7c3]'
      }
    >
      <p className={muted ? 'text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b7b41]' : 'text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d9bd81]'}>
        {label}
      </p>
      <p className={muted ? 'mt-2 text-2xl font-semibold text-[#2f2416]' : 'mt-2 text-2xl font-semibold'}>{value}</p>
    </div>
  );
}

function DetailMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[#ece1d0] bg-[#fcfaf7] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b7b41]">{label}</p>
      <p className="mt-1 text-base font-semibold text-[#2f2416]">{value}</p>
    </div>
  );
}

export default function AfregningsbilagPage() {
  const [documents, setDocuments] = useState<PosDocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<OperationFilter>('all');
  const [reloadTick, setReloadTick] = useState(0);
  const [actingSequence, setActingSequence] = useState<number | null>(null);
  const [selectedSequence, setSelectedSequence] = useState<number | null>(null);
  const [detailMap, setDetailMap] = useState<Record<number, PosDocumentDetail | undefined>>({});
  const [loadingDetailSequence, setLoadingDetailSequence] = useState<number | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run(showLoading: boolean) {
      if (showLoading) setLoading(true);
      try {
        const query = new URLSearchParams();
        query.set('limit', '120');
        query.set('kind', 'afregningsbilag');
        if (search.trim()) query.set('q', search.trim());
        const result = await apiRequest<PosDocumentListItem[]>(`/api/pos/documents?${query.toString()}`);
        if (!cancelled) {
          setDocuments(result);
          setLastSyncedAt(new Date().toISOString());
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setDocuments([]);
          setError(err instanceof Error ? err.message : 'Afregningsbilag listesi yuklenemedi.');
        }
      } finally {
        if (!cancelled && showLoading) {
          setLoading(false);
        }
      }
    }

    const timer = window.setTimeout(() => {
      void run(true);
    }, 150);
    const interval = window.setInterval(() => {
      void run(false);
    }, 5000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [reloadTick, search]);

  const summary = useMemo(() => {
    const awaitingDecision = documents.filter((item) => item.operation_state === 'awaiting_decision' || item.operation_state === 'mixed').length;
    const totalPureGold = documents.reduce((sum, item) => sum + Number(item.total_pure_gold_grams || 0), 0);
    const totalGross = documents.reduce((sum, item) => sum + Number(item.gross_amount_dkk || 0), 0);

    return {
      total: documents.length,
      awaitingDecision,
      totalPureGold,
      totalGross,
    };
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    if (activeFilter === 'all') return documents;
    return documents.filter((item) => item.operation_state === activeFilter);
  }, [activeFilter, documents]);

  useEffect(() => {
    if (filteredDocuments.length === 0) {
      setSelectedSequence(null);
      return;
    }

    setSelectedSequence((current) => {
      if (current !== null && filteredDocuments.some((item) => item.sequence_no === current)) {
        return current;
      }
      return filteredDocuments[0].sequence_no;
    });
  }, [filteredDocuments]);

  useEffect(() => {
    if (selectedSequence === null) return;
    let cancelled = false;
    const sequenceNo = selectedSequence;

    async function loadDetail() {
      setLoadingDetailSequence(sequenceNo);
      try {
        const detail = await apiRequest<PosDocumentDetail>(`/api/pos/documents/${sequenceNo}`);
        if (!cancelled) {
          setDetailMap((current) => ({ ...current, [sequenceNo]: detail }));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Belge detayi yuklenemedi.');
        }
      } finally {
        if (!cancelled) {
          setLoadingDetailSequence((current) => (current === sequenceNo ? null : current));
        }
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedSequence, reloadTick]);

  const selectedDocument = useMemo(
    () => filteredDocuments.find((item) => item.sequence_no === selectedSequence) ?? null,
    [filteredDocuments, selectedSequence],
  );

  const selectedDetail = selectedSequence !== null ? detailMap[selectedSequence] : undefined;
  const selectedIsBusy = selectedSequence !== null && actingSequence === selectedSequence;

  const filterClass = (filter: OperationFilter) =>
    activeFilter === filter
      ? 'border-[#cda86a] bg-[#fff7ea] text-[#3d2b10]'
      : 'border-[#e4d3b2] bg-white text-[#7d6540] hover:bg-[#fbf4e7]';

  async function applyDisposition(document: PosDocumentListItem, target: ProductStatus) {
    if (!document.product_ids.length) {
      setError('Bu belgeye bagli urun bulunamadi.');
      return;
    }

    // GDPR 14 gun penceresi eritmeyi engellemez (0.3.8: yalniz bilgi rozeti).

    let meltReason: string | undefined;
    if (target === 'melted') {
      const input = window.prompt('Eritme nedeni', 'Afregningsbilag operasyon karari');
      if (input === null) return;
      const cleaned = input.trim();
      if (!cleaned) {
        setError('Eritme nedeni bos olamaz.');
        return;
      }
      meltReason = cleaned;
    }

    const actionLabel =
      target === 'in_inventory'
        ? 'envantere alinacak'
        : target === 'undecided'
          ? 'kararsiz operasyon havuzuna alinacak'
          : 'eritmeye ayrilacak';

    const confirmed = window.confirm(`${document.document_number} icindeki urunler ${actionLabel}. Devam edilsin mi?`);
    if (!confirmed) return;

    setActingSequence(document.sequence_no);
    setError('');
    setSuccess('');

    try {
      for (const productId of document.product_ids) {
        await apiRequest(`/api/products/${productId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: target,
            ...(meltReason ? { melt_reason: meltReason } : {}),
          }),
        });
      }

      setSuccess(`${document.document_number} icin operasyon karari guncellendi.`);
      setReloadTick((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operasyon karari uygulanamadi.');
    } finally {
      setActingSequence(null);
    }
  }

  async function openReceipt(sessionId: string) {
    setError('');
    try {
      await openAuthedDocument(`/api/pos/sessions/${sessionId}/receipt?audience=admin&format=html`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Belge acilamadi.');
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-[#dcccae] bg-[linear-gradient(180deg,#fffdf9_0%,#f7f0e2_100%)] p-6 shadow-[0_16px_34px_rgba(92,62,24,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8b6b38]">Belge Merkezi</p>
            <h1 className="mt-2 text-3xl font-semibold text-[#2f2416]">Afregningsbilag Operasyon Merkezi</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#6d5531]">
              Alis islemi onaylandiginda belge bu ekrana dusuyor. Burada belge secilir, saf altin ve satir detaylari incelenir, sonra istenirse envantere, kararsiz havuza veya eritme akisine yonlendirilir.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/admin/pos">
              <Button>Yeni POS Islemi</Button>
            </Link>
            <Link href="/admin/products">
              <Button variant="ghost">Envanteri Ac</Button>
            </Link>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-xs font-semibold text-[#6d5531]">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Canli takip acik</span>
          <span>5 saniyede bir otomatik yenilenir.</span>
          <span>Son senkron: {formatTs(lastSyncedAt)}</span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Toplam AFG" value={String(summary.total)} muted />
          <SummaryCard label="Karar Bekleyen" value={String(summary.awaitingDecision)} muted />
          <SummaryCard label="Toplam Saf Altin" value={`${formatWeight(summary.totalPureGold)} g`} muted />
          <SummaryCard label="Toplam Alis" value={`${formatMoneyDkk(summary.totalGross)} DKK`} />
        </div>
      </section>

      <section className="rounded-[2rem] border border-[#dcccae] bg-white p-5 shadow-[0_12px_28px_rgba(92,62,24,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'awaiting_decision', 'in_inventory', 'undecided', 'melted', 'mixed'] as OperationFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${filterClass(filter)}`}
              >
                {getFilterLabel(filter)}
              </button>
            ))}
          </div>

          <div className="w-full max-w-md">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Belge no, musteri, telefon, e-posta veya session code ile ara"
            />
          </div>
        </div>

        {error ? <p className="mt-4 text-sm font-semibold text-red-700">{error}</p> : null}
        {success ? <p className="mt-4 text-sm font-semibold text-emerald-700">{success}</p> : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[360px,minmax(0,1fr)]">
          <aside className="rounded-[1.6rem] border border-[#e8dcc7] bg-[#fcfaf7] p-4">
            <div className="flex items-center justify-between gap-3 border-b border-[#efe2ce] pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b7b41]">Belge Listesi</p>
                <p className="mt-1 text-sm text-[#6d5531]">{filteredDocuments.length} belge goruntuleniyor</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-[#e9dcc8] bg-white px-4 py-6 text-sm text-[#6d5531]">
                  Afregningsbilag listesi yukleniyor...
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="rounded-2xl border border-[#e9dcc8] bg-white px-4 py-6 text-sm text-[#6d5531]">
                  Bu filtrede afregningsbilag bulunamadi.
                </div>
              ) : (
                filteredDocuments.map((document) => {
                  const selected = document.sequence_no === selectedSequence;
                  return (
                    <button
                      key={document.sequence_no}
                      type="button"
                      onClick={() => setSelectedSequence(document.sequence_no)}
                      className={`w-full rounded-[1.4rem] border px-4 py-4 text-left transition ${
                        selected
                          ? 'border-[#cda86a] bg-[#fff8ec] shadow-[0_12px_24px_rgba(106,77,30,0.08)]'
                          : 'border-[#eadfcb] bg-white hover:border-[#dcc59a] hover:bg-[#fffaf2]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-[#2f2416]">{document.document_number}</p>
                          <p className="mt-1 text-xs text-[#7a6542]">{document.customer_name || '-'}</p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${getOperationBadgeClass(document.operation_state)}`}>
                          {getOperationLabel(document.operation_state)}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[#9b7b41]">Toplam</p>
                          <p className="mt-1 font-semibold text-[#2f2416]">{formatMoneyDkk(document.gross_amount_dkk)} DKK</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[#9b7b41]">Saf Altin</p>
                          <p className="mt-1 font-semibold text-[#2f2416]">{formatWeight(document.total_pure_gold_grams)} g</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[#9b7b41]">Kalem</p>
                          <p className="mt-1 font-semibold text-[#2f2416]">{document.line_count}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[#9b7b41]">Tarih</p>
                          <p className="mt-1 font-semibold text-[#2f2416]">{formatTs(document.issued_at)}</p>
                        </div>
                      </div>

                      <p className="mt-4 text-xs text-[#7a6542]">{productStatusSummary(document)}</p>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {!selectedDocument ? (
              <div className="rounded-[1.6rem] border border-[#e8dcc7] bg-[#fcfaf7] px-6 py-10 text-center text-sm text-[#6d5531]">
                Incelemek icin soldan bir afregningsbilag secin.
              </div>
            ) : loadingDetailSequence === selectedSequence && !selectedDetail ? (
              <div className="rounded-[1.6rem] border border-[#e8dcc7] bg-[#fcfaf7] px-6 py-10 text-sm text-[#6d5531]">
                Belge detayi yukleniyor...
              </div>
            ) : selectedDetail ? (
              <div className="space-y-4">
                <section className="rounded-[1.6rem] border border-[#e8dcc7] bg-white p-5 shadow-[0_10px_24px_rgba(92,62,24,0.05)]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b7b41]">Secili Belge</p>
                      <h2 className="mt-1 text-2xl font-semibold text-[#2f2416]">{selectedDetail.document_number}</h2>
                      <p className="mt-2 text-sm text-[#6d5531]">
                        {selectedDetail.customer_name || '-'} · {labelPosTradeSide((selectedDetail.trade_side as Parameters<typeof labelPosTradeSide>[0]) || null)} · {formatTs(selectedDetail.confirmed_at)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getOperationBadgeClass(selectedDetail.operation_state)}`}>
                        {getOperationLabel(selectedDetail.operation_state)}
                      </span>
                      <span className="rounded-full border border-[#e0cfaa] bg-white px-3 py-1 text-xs font-semibold text-[#6d5428]">
                        {labelPosStatus((selectedDetail.status as Parameters<typeof labelPosStatus>[0]) || null)}
                      </span>
                      {selectedDocument.has_locked_products ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                          14 gun kilidi var
                        </span>
                      ) : null}
                    </div>
                  </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => void openReceipt(selectedDetail.session_id)}>
                      Belgeyi Ac
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={selectedIsBusy || selectedDocument.operation_state === 'in_inventory'}
                      onClick={() => applyDisposition(selectedDocument, 'in_inventory')}
                    >
                      Envantere Al
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={selectedIsBusy || selectedDocument.operation_state === 'undecided'}
                      onClick={() => applyDisposition(selectedDocument, 'undecided')}
                    >
                      Kararsiz
                    </Button>
                    <Button
                      variant="danger"
                      disabled={selectedIsBusy || selectedDocument.operation_state === 'melted' || selectedDocument.has_locked_products}
                      onClick={() => applyDisposition(selectedDocument, 'melted')}
                    >
                      Erit
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailMetric label="Toplam Teklif" value={`${formatMoneyDkk(selectedDetail.gross_amount_dkk)} DKK`} />
                    <DetailMetric label="Toplam Gram" value={`${formatWeight(selectedDetail.total_weight_grams)} g`} />
                    <DetailMetric label="Saf Altin" value={`${formatWeight(selectedDetail.total_pure_gold_grams)} g`} />
                    <DetailMetric label="Kalem / Urun" value={`${selectedDetail.line_count} kalem · ${selectedDetail.product_numbers.length} urun`} />
                  </div>
                </section>

                <section className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
                  <div className="rounded-[1.6rem] border border-[#e8dcc7] bg-white p-5 shadow-[0_10px_24px_rgba(92,62,24,0.04)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b7b41]">Musteri ve Belge Bilgisi</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <DetailMetric label="Musteri" value={selectedDetail.customer_name || '-'} />
                      <DetailMetric label="Telefon" value={selectedDetail.customer_phone || '-'} />
                      <DetailMetric label="E-posta" value={selectedDetail.customer_email || '-'} />
                      <DetailMetric label="Durum" value={productStatusSummary(selectedDetail)} />
                    </div>
                    <div className="mt-3 rounded-2xl border border-[#ece1d0] bg-[#fcfaf7] px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b7b41]">Adres</p>
                      <p className="mt-1 text-sm text-[#2f2416]">{selectedDetail.customer_address || '-'}</p>
                    </div>
                    {selectedDetail.notes ? (
                      <div className="mt-3 rounded-2xl border border-[#ece1d0] bg-[#fcfaf7] px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b7b41]">Belge Notu</p>
                        <p className="mt-1 text-sm text-[#2f2416]">{selectedDetail.notes}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-[1.6rem] border border-[#e8dcc7] bg-white p-5 shadow-[0_10px_24px_rgba(92,62,24,0.04)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b7b41]">Operasyon Ozeti</p>
                    <div className="mt-4 space-y-3">
                      <DetailMetric label="Belge Tarihi" value={formatTs(selectedDetail.issued_at)} />
                      <DetailMetric label="Onay Zamanı" value={formatTs(selectedDetail.confirmed_at)} />
                      <DetailMetric label="Urun Numaralari" value={selectedDetail.product_numbers.length ? selectedDetail.product_numbers.join(', ') : '-'} />
                      <DetailMetric label="Session" value={selectedDetail.session_code} />
                    </div>
                  </div>
                </section>

                <section className="rounded-[1.6rem] border border-[#e8dcc7] bg-white p-5 shadow-[0_10px_24px_rgba(92,62,24,0.04)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9b7b41]">Belge Kalemleri</p>
                      <p className="mt-1 text-sm text-[#6d5531]">Bu afregningsbilag icindeki tum satirlar burada operasyon seviyesinde gorunur.</p>
                    </div>
                  </div>

                  {selectedDetail.lines.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-[#ece1d0] bg-[#fcfaf7] px-4 py-6 text-sm text-[#6d5531]">
                      Bu belge icin satir detayi bulunamadi.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {selectedDetail.lines.map((line) => (
                        <article key={line.id} className="rounded-[1.4rem] border border-[#ece1d0] bg-[#fcfaf7] p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-[#2f2416]">
                                Satir {line.line_no} · {labelProductType((line.product_type as Parameters<typeof labelProductType>[0]) || null)} ·{' '}
                                {labelMetalType((line.metal_type as Parameters<typeof labelMetalType>[0]) || null)}
                              </p>
                              <p className="mt-1 text-xs text-[#7a6542]">
                                Urun no: {line.product_number || '-'} · Ref: {line.reference_number || '-'}
                              </p>
                            </div>

                            <div className="text-right">
                              <p className="text-sm font-semibold text-[#2f2416]">{formatMoneyDkk(line.line_total_dkk)} DKK</p>
                              <p className="mt-1 text-xs text-[#7a6542]">
                                {labelProductStatus((line.product_status as ProductStatus | null) || null)}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                            <DetailMetric label="Karat / Finhed" value={formatKaratFinhed(line.purity_karat, line.purity_percentage)} />
                            <DetailMetric label="Lodighed" value={toLodighed(line.purity_karat, line.purity_percentage)} />
                            <DetailMetric label="Gram" value={`${formatWeight(line.weight_grams)} g`} />
                            <DetailMetric label="Saf Altin" value={`${formatWeight(line.pure_gold_grams)} g`} />
                            <DetailMetric label="Birim Fiyat" value={`${formatMoneyDkk(line.rate_dkk)} DKK/g`} />
                          </div>

                          {line.is_gdpr_locked || line.product_notes ? (
                            <div className="mt-4 flex flex-wrap gap-2 text-xs">
                              {line.is_gdpr_locked ? (
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-800">
                                  14 gun kilidi
                                </span>
                              ) : null}
                              {line.product_notes ? (
                                <span className="rounded-full border border-[#e0cfaa] bg-white px-3 py-1 font-semibold text-[#6d5428]">
                                  Not mevcut
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          {line.product_notes ? (
                            <div className="mt-3 rounded-2xl border border-[#ece1d0] bg-white px-4 py-3 text-sm text-[#6d5531]">
                              {line.product_notes}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <div className="rounded-[1.6rem] border border-[#e8dcc7] bg-[#fcfaf7] px-6 py-10 text-sm text-[#6d5531]">
                Belge detayi bulunamadi.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
