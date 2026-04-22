'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { apiRequest } from '@/lib/api';
import { labelIdentityDocType } from '@/lib/labels';
import { CustomerDetail } from '@/types';

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      if (!params.id) return;
      try {
        const result = await apiRequest<CustomerDetail>(`/api/customers/${params.id}`);
        setCustomer(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Müşteri alınamadı');
      }
    }
    load();
  }, [params.id]);

  if (error) return <p className="text-sm font-semibold text-red-700">{error}</p>;
  if (!customer) return <div className="card p-4 text-sm text-brand-700">Müşteri yükleniyor...</div>;

  const riskTone =
    customer.risk.level === 'high'
      ? 'bg-red-100 text-red-800 border-red-300'
      : customer.risk.level === 'medium'
        ? 'bg-amber-100 text-amber-800 border-amber-300'
        : 'bg-emerald-100 text-emerald-800 border-emerald-300';

  const riskLabel =
    customer.risk.level === 'high'
      ? 'Yüksek Risk'
      : customer.risk.level === 'medium'
        ? 'Orta Risk'
        : 'Düşük Risk';

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="text-xl font-semibold text-brand-900">{customer.name}</h3>
        <p className="mt-1 text-sm text-brand-700">{customer.email}</p>
        <div className="mt-4 grid gap-2 text-sm text-brand-800 md:grid-cols-2">
          <p>Telefon: {customer.phone || '-'}</p>
          <p>CPR: {customer.cpr_number_masked || '-'}</p>
          <p>Kimlik Tipi: {labelIdentityDocType(customer.identity_doc_type)}</p>
          <p>Kimlik No: {customer.identity_doc_number_masked || '-'}</p>
          <p>Kimlik Ülkesi: {customer.identity_doc_country || '-'}</p>
          <p>Adres: {customer.address || '-'}</p>
          <p>Aktif: {customer.is_active ? 'Evet' : 'Hayır'}</p>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-base font-semibold text-brand-900">Risk Analizi (Son 30 Gün)</h4>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskTone}`}>
            {riskLabel} · Skor: {customer.risk.score}
          </span>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-brand-700 md:grid-cols-2">
          <p>İşlem sayısı: {customer.risk.transactions_30d}</p>
          <p>Farklı adres: {customer.risk.distinct_addresses_30d}</p>
          <p>Farklı kimlik no: {customer.risk.distinct_identity_docs_30d}</p>
          <p>Eritilen ürün: {customer.risk.melted_items_30d}</p>
        </div>
        {customer.risk.warnings.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-brand-800">
            {customer.risk.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-brand-700">Bu müşteri için kritik risk uyarısı bulunmadı.</p>
        )}
      </div>

      <div className="card p-5">
        <h4 className="text-base font-semibold text-brand-900">İşlem Geçmişi</h4>
        <ul className="mt-3 space-y-1 text-sm text-brand-700">
          <li>Mağazaya satılan ürün: {customer.stats.total_sold_to_shop} adet</li>
          <li>Mağazadan alınan ürün: {customer.stats.total_bought_from_shop} adet</li>
          <li>Toplam alım tutarı: {customer.stats.total_purchase_value_dkk} DKK</li>
          <li>Toplam satış tutarı: {customer.stats.total_sale_value_dkk} DKK</li>
        </ul>
      </div>
    </div>
  );
}
