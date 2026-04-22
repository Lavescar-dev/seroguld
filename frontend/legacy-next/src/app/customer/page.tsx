'use client';

import { useEffect, useState } from 'react';

import { apiRequest } from '@/lib/api';
import { labelMetalType, labelProductStatus, labelProductType } from '@/lib/labels';
import { CustomerPortalSummary } from '@/types';

const SIDE_LABEL: Record<'sold_to_shop' | 'bought_from_shop', string> = {
  sold_to_shop: 'Mağazaya Satış',
  bought_from_shop: 'Mağazadan Alım',
};

export default function CustomerHomePage() {
  const [summary, setSummary] = useState<CustomerPortalSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const data = await apiRequest<CustomerPortalSummary>('/api/customer/me/summary');
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Müşteri özeti alınamadı');
      }
    }
    load();
  }, []);

  if (error) {
    return <p className="text-sm font-semibold text-red-700">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h1 className="text-xl font-semibold text-brand-900">Genel Bakış</h1>
        <p className="mt-1 text-sm text-brand-700">
          {summary ? `${summary.customer_name} için işlem özeti` : 'Yükleniyor...'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">Toplam İşlem</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{summary?.total_transactions ?? '-'}</p>
          <p className="mt-2 text-sm text-brand-700">
            Satış: {summary?.sold_to_shop_count ?? '-'} · Alım: {summary?.bought_from_shop_count ?? '-'}
          </p>
        </div>

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">Mağazaya Satış Tutarı</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{summary?.sold_to_shop_value_dkk ?? '-'} DKK</p>
        </div>

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">Mağazadan Alım Tutarı</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{summary?.bought_from_shop_value_dkk ?? '-'} DKK</p>
        </div>

        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-brand-600">Yayındaki Ürünler</p>
          <p className="mt-1 text-2xl font-bold text-brand-900">{summary?.active_site_listings_count ?? '-'}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="card p-4">
          <h3 className="text-base font-semibold text-brand-900">Son İşlemler</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-brand-50 text-brand-700">
                <tr>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-left">Yön</th>
                  <th className="px-3 py-2 text-left">Ürün</th>
                  <th className="px-3 py-2 text-left">Durum</th>
                  <th className="px-3 py-2 text-left">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.recent_transactions || []).map((tx) => (
                  <tr key={`${tx.product_id}-${tx.side}-${tx.transaction_at}`} className="border-t border-brand-100">
                    <td className="px-3 py-2">{new Date(tx.transaction_at).toLocaleString('tr-TR')}</td>
                    <td className="px-3 py-2">{SIDE_LABEL[tx.side]}</td>
                    <td className="px-3 py-2">
                      #{tx.product_number} · {labelProductType(tx.product_type)} / {labelMetalType(tx.metal_type)}
                    </td>
                    <td className="px-3 py-2">{labelProductStatus(tx.status)}</td>
                    <td className="px-3 py-2 font-semibold text-brand-900">{tx.amount_dkk} DKK</td>
                  </tr>
                ))}
                {!summary?.recent_transactions?.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-brand-600">
                      Henüz işlem bulunmuyor.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="text-base font-semibold text-brand-900">Canlı Metal Kurları (DKK/g)</h3>
          <ul className="mt-3 space-y-2 text-sm text-brand-700">
            <li>Altın: {summary?.current_rates_dkk_per_gram?.gold ?? '-'} DKK/g</li>
            <li>Gümüş: {summary?.current_rates_dkk_per_gram?.silver ?? '-'} DKK/g</li>
            <li>Platin: {summary?.current_rates_dkk_per_gram?.platinum ?? '-'} DKK/g</li>
            <li>Palladium: {summary?.current_rates_dkk_per_gram?.palladium ?? '-'} DKK/g</li>
          </ul>
          <p className="mt-3 text-xs text-brand-600">
            Not: Nihai teklif satıcı ekranında belirlenir. Bu alanda sadece görünür kur bilgisi paylaşılır.
          </p>
        </div>
      </div>
    </div>
  );
}
