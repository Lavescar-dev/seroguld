'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import { labelIdentityDocType } from '@/lib/labels';
import { Customer, CustomerWooImportResponse, Paginated } from '@/types';

export default function CustomersPage() {
  const [items, setItems] = useState<Customer[]>([]);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [importing, setImporting] = useState(false);

  async function load() {
    try {
      const result = await apiRequest<Paginated<Customer>>('/api/customers?page=1&page_size=100');
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Müşteriler alınamadı');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function importLiveWooCustomers() {
    const confirmed = window.confirm(
      "WooCommerce'deki müşteri rolündeki kullanıcıları CRM'e çekmek istiyor musunuz?\n\nNot: Mock/test müşteriler temizlenecek.",
    );
    if (!confirmed) return;

    setImporting(true);
    setError('');
    setSyncMessage('');
    try {
      const result = await apiRequest<CustomerWooImportResponse>('/api/customers/import/woocommerce-live', {
        method: 'POST',
        body: JSON.stringify({
          limit: 5000,
          replace_mock_seed: true,
        }),
      });
      setSyncMessage(
        `Müşteri import tamamlandı · Çekilen: ${result.fetched}, Yeni: ${result.created}, Güncellenen: ${result.updated}, Atlanan: ${result.skipped}, Silinen mock: ${result.deleted_mock_seed}`,
      );
      if (result.errors.length) {
        setError(`Import sırasında ${result.errors.length} kayıt hata verdi. İlk hata: ${result.errors[0]}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Müşteri importu başarısız');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold text-brand-900">WooCommerce Müşteri Importu</p>
          <p className="text-xs text-brand-700">Sitedeki müşteri rolündeki kullanıcıları CRM'e senkronize eder.</p>
        </div>
        <Button onClick={importLiveWooCustomers} disabled={importing}>
          {importing ? "Woo'dan Çekiliyor..." : "Woo'dan Müşterileri Çek"}
        </Button>
      </div>

      <div className="card overflow-hidden">
        {error && <p className="p-4 text-sm font-semibold text-red-700">{error}</p>}
        {syncMessage && <p className="px-4 pt-4 text-sm font-semibold text-emerald-700">{syncMessage}</p>}
        <table className="min-w-full text-sm">
          <thead className="bg-brand-50 text-brand-700">
            <tr>
              <th className="px-4 py-3 text-left">Ad Soyad</th>
              <th className="px-4 py-3 text-left">Telefon</th>
              <th className="px-4 py-3 text-left">E-posta</th>
              <th className="px-4 py-3 text-left">CPR</th>
              <th className="px-4 py-3 text-left">Kimlik Tipi</th>
              <th className="px-4 py-3 text-left">Kimlik No</th>
            </tr>
          </thead>
          <tbody>
            {items.map((customer) => (
              <tr key={customer.id} className="border-t border-brand-100">
                <td className="px-4 py-3 font-semibold text-brand-900">
                  <Link href={`/admin/customers/${customer.id}`} className="hover:underline">
                    {customer.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{customer.phone || '-'}</td>
                <td className="px-4 py-3">{customer.email}</td>
                <td className="px-4 py-3">{customer.cpr_number_masked || '-'}</td>
                <td className="px-4 py-3">{labelIdentityDocType(customer.identity_doc_type)}</td>
                <td className="px-4 py-3">{customer.identity_doc_number_masked || '-'}</td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-brand-600">
                  Kayıtlı müşteri bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
