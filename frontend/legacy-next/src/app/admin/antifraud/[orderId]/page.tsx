'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import { AntiFraudOrder } from '@/types';

type RiskTheme = {
  hero: string;
  badge: string;
  scoreRing: string;
  scoreText: string;
  accentText: string;
  reasonChip: string;
};

function riskTheme(level: string): RiskTheme {
  if (level === 'high') {
    return {
      hero: 'border-red-200 bg-gradient-to-br from-red-50 via-red-50 to-rose-100',
      badge: 'border-red-200 bg-red-100 text-red-800',
      scoreRing: 'border-red-300 bg-white',
      scoreText: 'text-red-700',
      accentText: 'text-red-800',
      reasonChip: 'border-red-200 bg-red-50 text-red-800',
    };
  }
  if (level === 'medium') {
    return {
      hero: 'border-amber-200 bg-gradient-to-br from-amber-50 via-amber-50 to-orange-100',
      badge: 'border-amber-200 bg-amber-100 text-amber-900',
      scoreRing: 'border-amber-300 bg-white',
      scoreText: 'text-amber-800',
      accentText: 'text-amber-900',
      reasonChip: 'border-amber-200 bg-amber-50 text-amber-900',
    };
  }
  if (level === 'low') {
    return {
      hero: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-emerald-50 to-teal-100',
      badge: 'border-emerald-200 bg-emerald-100 text-emerald-800',
      scoreRing: 'border-emerald-300 bg-white',
      scoreText: 'text-emerald-700',
      accentText: 'text-emerald-900',
      reasonChip: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    };
  }
  return {
    hero: 'border-slate-200 bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100',
    badge: 'border-slate-200 bg-slate-100 text-slate-800',
    scoreRing: 'border-slate-300 bg-white',
    scoreText: 'text-slate-700',
    accentText: 'text-slate-900',
    reasonChip: 'border-slate-200 bg-slate-50 text-slate-900',
  };
}

function levelLabel(level: string): string {
  if (level === 'high') return 'Yüksek';
  if (level === 'medium') return 'Orta';
  if (level === 'low') return 'Düşük';
  return 'Belirsiz';
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

function formatMetaValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AntiFraudOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const orderId = Number(params.orderId || 0);

  const includeNotesParam = searchParams.get('include_notes');
  const includeNotes = includeNotesParam !== '0';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [item, setItem] = useState<AntiFraudOrder | null>(null);

  const backHref = useMemo(() => {
    const raw = searchParams.toString();
    if (!raw) return '/admin/antifraud';
    return `/admin/antifraud?${raw}`;
  }, [searchParams]);

  async function load() {
    if (!orderId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest<AntiFraudOrder>(
        `/api/antifraud/orders/${orderId}?include_notes=${includeNotes ? 'true' : 'false'}&notes_per_order=10`,
      );
      setItem(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sipariş detayı alınamadı.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [orderId, includeNotes]);

  if (!item && !error) {
    return (
      <div className="space-y-4">
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-brand-900">OPMC Risk Detayı</h3>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => router.push(backHref)}>
                ← Listeye Dön
              </Button>
              <Button onClick={() => void load()} disabled={loading}>
                {loading ? 'Yenileniyor...' : 'Detayı Yenile'}
              </Button>
            </div>
          </div>
        </div>
        <div className="card p-6 text-sm text-brand-700">{loading ? 'Sipariş yükleniyor...' : 'Sipariş bulunamadı.'}</div>
      </div>
    );
  }

  const theme = riskTheme(item?.risk_level || 'unknown');

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-brand-900">OPMC Risk Detayı</h3>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => router.push(backHref)}>
              ← Listeye Dön
            </Button>
            <Button onClick={() => void load()} disabled={loading}>
              {loading ? 'Yenileniyor...' : 'Detayı Yenile'}
            </Button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      </div>

      {item && (
        <>
          <div className={`card border p-6 ${theme.hero}`}>
            <div className="mx-auto max-w-6xl">
              <div className="flex flex-wrap items-center justify-center gap-3 text-center">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${theme.badge}`}>
                  Sipariş #{item.order_number}
                </span>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${theme.badge}`}>
                  {statusLabel(item.status)}
                </span>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${theme.badge}`}>
                  Manuel İnceleme: {item.requires_manual_review ? 'Evet' : 'Hayır'}
                </span>
              </div>

              <div className="mt-5 flex flex-col items-center justify-center gap-3 text-center">
                <p className={`text-sm font-medium ${theme.accentText}`}>Risk Özeti</p>
                <div className={`flex h-28 w-28 items-center justify-center rounded-full border-4 shadow-sm ${theme.scoreRing}`}>
                  <span className={`text-3xl font-bold ${theme.scoreText}`}>{item.risk_score ?? '-'}</span>
                </div>
                <p className={`text-xl font-semibold ${theme.accentText}`}>Risk Seviyesi: {levelLabel(item.risk_level)}</p>
                <p className="text-sm text-brand-700">
                  Toplam tutar: <strong>{item.total ?? '-'} {item.currency || ''}</strong> · Ödeme: <strong>{item.payment_method || '-'}</strong>
                </p>
              </div>
            </div>
          </div>

          <div className="card p-6 md:p-8">
            <div className="mx-auto max-w-5xl text-center">
              <h4 className="text-2xl font-semibold text-brand-900 md:text-3xl">Neden Bu Risk Skoru?</h4>
              <p className="mt-2 text-sm text-brand-700">
                Aşağıdaki maddeler OPMC/AI sinyallerinden otomatik üretilmiş açıklamalardır.
              </p>
            </div>
            <ol className="mx-auto mt-6 grid max-w-5xl gap-3 md:grid-cols-2">
              {item.risk_reasons.map((reason, index) => (
                <li key={reason.code} className={`rounded-xl border p-4 text-left shadow-sm ${theme.reasonChip}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Neden {index + 1}</p>
                  <p className="mt-1 text-base font-medium leading-relaxed">{reason.reason}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <div className="card p-4">
              <h4 className="text-base font-semibold text-brand-900">Müşteri ve Sipariş Bilgisi</h4>
              <div className="mt-3 grid gap-2 text-sm text-brand-800">
                <p><strong>Müşteri:</strong> {item.customer_name || '-'}</p>
                <p><strong>E-posta:</strong> {item.customer_email || '-'}</p>
                <p><strong>IP:</strong> {item.ip_address || '-'}</p>
                <p><strong>Fatura Ülkesi:</strong> {item.billing_country || '-'}</p>
                <p><strong>Teslimat Ülkesi:</strong> {item.shipping_country || '-'}</p>
              </div>
            </div>

            <div className="card p-4">
              <h4 className="text-base font-semibold text-brand-900">AI Değerlendirmesi</h4>
              {item.ai_explanations_human.length ? (
                <ul className="mt-3 space-y-2 text-sm text-brand-800">
                  {item.ai_explanations_human.map((line, idx) => (
                    <li key={`ai-${idx}`} className="rounded-lg border border-brand-200 bg-brand-50 p-2">• {line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-brand-700">AI açıklaması bulunamadı.</p>
              )}
            </div>

            <div className="card p-4">
              <h4 className="text-base font-semibold text-brand-900">Risk Notları</h4>
              {item.notes_human.length ? (
                <ul className="mt-3 space-y-2 text-sm text-brand-800">
                  {item.notes_human.map((note, idx) => (
                    <li key={`note-${idx}`} className="rounded-lg border border-brand-200 bg-brand-50 p-2">• {note}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-brand-700">Risk notu bulunamadı.</p>
              )}
            </div>
          </div>

          <div className="card p-4">
            <h4 className="text-base font-semibold text-brand-900">OPMC Alanları (İnsan Dili)</h4>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {item.risk_meta_human.map((meta) => (
                <div key={meta.key} className="rounded-lg border border-brand-200 bg-brand-50 p-3">
                  <p className="text-xs font-semibold text-brand-700">{meta.label}</p>
                  <p className="mt-1 text-sm text-brand-900">{meta.value || '-'}</p>
                </div>
              ))}
              {!item.risk_meta_human.length && (
                <p className="text-sm text-brand-700">OPMC meta alanı bulunamadı.</p>
              )}
            </div>
          </div>

          <div className="card p-4">
            <h4 className="text-base font-semibold text-brand-900">Ham Meta (Teknik)</h4>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-medium text-brand-800">Teknik veriyi göster</summary>
              <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-brand-200 bg-brand-50 p-2">
                {item.risk_meta.length ? (
                  item.risk_meta.map((meta) => (
                    <pre key={`raw-${meta.key}`} className="mb-2 whitespace-pre-wrap break-words text-xs text-brand-800">
{`${meta.key}: ${formatMetaValue(meta.value)}`}
                    </pre>
                  ))
                ) : (
                  <p className="text-xs text-brand-700">Ham meta yok.</p>
                )}
              </div>
            </details>
          </div>
        </>
      )}
    </div>
  );
}
