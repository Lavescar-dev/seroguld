'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';
import { AntiFraudOrder, AntiFraudOrdersResponse } from '@/types';

function levelBadge(level: string): string {
  if (level === 'high') return 'bg-red-100 text-red-800 border-red-200';
  if (level === 'medium') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (level === 'low') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function levelLabel(level: string): string {
  if (level === 'high') return 'Yüksek';
  if (level === 'medium') return 'Orta';
  if (level === 'low') return 'Düşük';
  return 'Belirsiz';
}

function statusBadge(status: string): string {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (status === 'processing') return 'bg-sky-100 text-sky-800 border-sky-200';
  if (status === 'on-hold') return 'bg-amber-100 text-amber-800 border-amber-200';
  if (status === 'failed' || status === 'cancelled' || status === 'refunded') {
    return 'bg-red-100 text-red-800 border-red-200';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function statusLabel(status: string): string {
  if (status === 'completed') return 'Tamamlandı';
  if (status === 'processing') return 'İşleniyor';
  if (status === 'on-hold') return 'Beklemede';
  if (status === 'pending') return 'Ödeme Bekliyor';
  if (status === 'failed') return 'Başarısız';
  if (status === 'cancelled') return 'İptal';
  if (status === 'refunded') return 'İade';
  return status || '-';
}

export default function AntiFraudPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [days, setDays] = useState(() => searchParams.get('days') || '30');
  const [limit, setLimit] = useState(() => searchParams.get('limit') || '25');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<AntiFraudOrdersResponse | null>(null);

  function goToDetail(orderId: number) {
    router.push(
      `/admin/antifraud/${orderId}?days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}&include_notes=1`,
    );
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const daysNum = Math.max(1, Math.min(365, Number(days) || 30));
      const limitNum = Math.max(1, Math.min(100, Number(limit) || 25));
      const response = await apiRequest<AntiFraudOrdersResponse>(
        `/api/antifraud/recent-orders?days=${daysNum}&per_page=${limitNum}&detail_mode=false`,
      );
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dolandırıcılık verisi alınamadı.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const items = data?.items || [];
  const summary = data?.summary;

  const manualReviewOrders = useMemo(
    () => items.filter((item) => item.requires_manual_review || item.risk_level === 'high'),
    [items],
  );

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="text-lg font-semibold text-brand-900">OPMC Dolandırıcılık İzleme</h3>
        <p className="mt-1 text-sm text-brand-700">
          Woo siparişlerinden risk sinyalleri çekilir. Bir satıra tıklayarak detay analiz ekranına geçebilirsiniz.
        </p>
        {data?.generated_at && (
          <p className="mt-1 text-xs text-brand-600">
            Son güncelleme: {new Date(data.generated_at).toLocaleString('tr-TR')}
          </p>
        )}
      </div>

      <div className="card p-4">
        <div className="grid gap-3 md:grid-cols-[130px_130px_auto] md:items-end">
          <div>
            <label className="mb-1 block text-sm font-medium text-brand-700">Gün Aralığı</label>
            <Input type="number" min={1} max={365} value={days} onChange={(event) => setDays(event.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-brand-700">Sipariş Adedi</label>
            <Input type="number" min={1} max={100} value={limit} onChange={(event) => setLimit(event.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? 'Yenileniyor...' : 'Veriyi Yenile'}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-brand-600">
          Liste performansı için yalnızca özet veriler yüklenir. Notlar ve detay sinyaller sipariş detay sayfasında açılır.
        </p>
        {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      </div>

      {summary && (
        <div className="grid gap-3 md:grid-cols-6">
          <div className="card p-3">
            <p className="text-xs text-brand-700">Toplam</p>
            <p className="text-xl font-semibold text-brand-900">{summary.total_orders}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-brand-700">Yüksek Risk</p>
            <p className="text-xl font-semibold text-red-700">{summary.high_risk_count}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-brand-700">Orta Risk</p>
            <p className="text-xl font-semibold text-amber-700">{summary.medium_risk_count}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-brand-700">Düşük Risk</p>
            <p className="text-xl font-semibold text-emerald-700">{summary.low_risk_count}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-brand-700">Belirsiz</p>
            <p className="text-xl font-semibold text-slate-700">{summary.unknown_risk_count}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-brand-700">Manuel İnceleme</p>
            <p className="text-xl font-semibold text-brand-900">{summary.manual_review_count}</p>
          </div>
        </div>
      )}

      {!!manualReviewOrders.length && (
        <div className="card p-4">
          <h4 className="text-base font-semibold text-brand-900">Hızlı İnceleme Listesi</h4>
          <div className="mt-3 flex flex-wrap gap-2">
            {manualReviewOrders.map((order) => (
              <button
                key={order.order_id}
                type="button"
                onClick={() => goToDetail(order.order_id)}
                className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
              >
                #{order.order_number} · {levelLabel(order.risk_level)} · {order.risk_score ?? '-'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-brand-50 text-brand-700">
            <tr>
              <th className="px-3 py-2 text-left">Sipariş</th>
              <th className="px-3 py-2 text-left">Tarih</th>
              <th className="px-3 py-2 text-left">Durum</th>
              <th className="px-3 py-2 text-left">Toplam</th>
              <th className="px-3 py-2 text-left">Risk</th>
              <th className="px-3 py-2 text-left">Müşteri</th>
              <th className="px-3 py-2 text-left">İnceleme</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: AntiFraudOrder) => (
              <tr
                key={item.order_id}
                className="cursor-pointer border-t border-brand-100 align-top transition hover:bg-brand-50/70"
                onClick={() => goToDetail(item.order_id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    goToDetail(item.order_id);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Sipariş ${item.order_number} detayını aç`}
              >
                <td className="px-3 py-2 font-semibold text-brand-900">#{item.order_number}</td>
                <td className="px-3 py-2 text-brand-700">
                  {item.date_created ? new Date(item.date_created).toLocaleString('tr-TR') : '-'}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${statusBadge(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-brand-700">
                  {item.total ?? '-'} {item.currency || ''}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <span className={`w-fit rounded border px-2 py-0.5 text-xs font-semibold ${levelBadge(item.risk_level)}`}>
                      {levelLabel(item.risk_level)} · {item.risk_score ?? '-'}
                    </span>
                    {item.requires_manual_review && (
                      <span className="w-fit rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        Manuel İnceleme
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-brand-700">
                  <p>{item.customer_name || '-'}</p>
                  <p className="text-xs">{item.customer_email || '-'}</p>
                </td>
                <td className="px-3 py-2 text-brand-700">
                  <p className="text-xs font-semibold text-brand-900">{item.risk_reasons.length} neden</p>
                  <p className="text-xs text-brand-600">Detay sayfasını aç</p>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-brand-600">
                  Risk verisi bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
