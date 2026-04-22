'use client';

import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { apiRequest } from '@/lib/api';
import { labelMetalType, labelProductStatus, labelProductType } from '@/lib/labels';
import { CustomerPortalProduct, Paginated } from '@/types';

const sideLabels: Record<'sold_to_shop' | 'bought_from_shop', string> = {
  sold_to_shop: 'Mağazaya Satış',
  bought_from_shop: 'Mağazadan Alım',
};

export default function CustomerProductsPage() {
  const [items, setItems] = useState<CustomerPortalProduct[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [side, setSide] = useState('all');
  const [status, setStatus] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('page_size', '100');
    params.set('side', side);
    if (status) {
      params.set('status', status);
    }
    if (search.trim()) {
      params.set('search', search.trim());
    }
    return params.toString();
  }, [search, side, status]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await apiRequest<Paginated<CustomerPortalProduct>>(`/api/customer/me/products?${query}`);
        setItems(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ürünler alınamadı');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [query]);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h1 className="text-xl font-semibold text-brand-900">Ürün ve İşlem Geçmişi</h1>
        <p className="mt-1 text-sm text-brand-700">Size ait satış ve alım kayıtlarını filtreleyip inceleyebilirsiniz.</p>
      </div>

      <div className="card grid gap-3 p-4 md:grid-cols-3">
        <Input placeholder="Ürün no / referans ara" value={search} onChange={(event) => setSearch(event.target.value)} />
        <Select value={side} onChange={(event) => setSide(event.target.value)}>
          <option value="all">Tüm işlemler</option>
          <option value="sold_to_shop">Mağazaya satışlarım</option>
          <option value="bought_from_shop">Mağazadan alımlarım</option>
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Tüm durumlar</option>
          <option value="purchased">Alındı</option>
          <option value="in_inventory">Envanterde</option>
          <option value="for_sale">Satışta</option>
          <option value="sold">Satıldı</option>
          <option value="melted">Eritildi</option>
          <option value="undecided">Kararsız</option>
        </Select>
      </div>

      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-5 text-sm text-brand-700">Yükleniyor...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-brand-50 text-brand-700">
                <tr>
                  <th className="px-4 py-3 text-left">Tarih</th>
                  <th className="px-4 py-3 text-left">Yön</th>
                  <th className="px-4 py-3 text-left">Ürün</th>
                  <th className="px-4 py-3 text-left">Ayar</th>
                  <th className="px-4 py-3 text-left">Durum</th>
                  <th className="px-4 py-3 text-left">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.id}-${item.side}`} className="border-t border-brand-100">
                    <td className="px-4 py-3">{new Date(item.transaction_at).toLocaleString('tr-TR')}</td>
                    <td className="px-4 py-3">{sideLabels[item.side]}</td>
                    <td className="px-4 py-3">
                      #{item.product_number} · {labelProductType(item.product_type)} / {labelMetalType(item.metal_type)}
                    </td>
                    <td className="px-4 py-3">
                      {item.purity_karat || '-'} / {item.purity_percentage || '-'}%
                    </td>
                    <td className="px-4 py-3">{labelProductStatus(item.status)}</td>
                    <td className="px-4 py-3 font-semibold text-brand-900">{item.amount_dkk} DKK</td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-brand-600">
                      Bu filtrelerde kayıt bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
