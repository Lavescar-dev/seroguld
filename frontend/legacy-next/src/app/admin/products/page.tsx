'use client';

import { useEffect, useMemo, useState } from 'react';

import { ProductTable } from '@/components/ProductTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { apiRequest } from '@/lib/api';
import { Paginated, Product, ProductStatus, ProductWooImportResponse } from '@/types';

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [importingWoo, setImportingWoo] = useState(false);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [metal, setMetal] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (metal) params.set('metal_type', metal);
    params.set('page', '1');
    params.set('page_size', '50');
    return params.toString();
  }, [search, status, metal]);

  async function loadProducts() {
    setLoading(true);
    if (!importingWoo) {
      setError('');
    }
    try {
      const result = await apiRequest<Paginated<Product>>(`/api/products?${query}`);
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ürünler alınamadı');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, [query]);

  async function onStatusChange(id: string, newStatus: ProductStatus) {
    const confirmed = window.confirm(`Durum "${newStatus}" olarak değiştirilsin mi?`);
    if (!confirmed) return;

    try {
      const body: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'melted') {
        const reason = prompt('Eritme nedeni:');
        if (reason === null) return;
        const clean = reason.trim();
        if (!clean) {
          alert('Eritme nedeni boş bırakılamaz.');
          return;
        }
        body.melt_reason = clean;
      }
      if (newStatus === 'sold') {
        const salePrice = prompt('Satış fiyatı (DKK):');
        if (salePrice === null) return;
        const parsed = Number(salePrice.trim());
        if (!Number.isFinite(parsed) || parsed <= 0) {
          alert('Geçerli bir satış fiyatı girin.');
          return;
        }
        body.sale_price_dkk = parsed;
      }
      await apiRequest(`/api/products/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      await loadProducts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Durum güncellemesi başarısız');
    }
  }

  async function importLiveWooProducts() {
    const confirmed = window.confirm(
      "WooCommerce'den son 100 canlı ürünü çekip envantere almak istiyor musunuz?\n\nNot: Mock seed ürünleri temizlenecek.",
    );
    if (!confirmed) return;

    setImportingWoo(true);
    setError('');
    setSyncMessage('');
    try {
      // Silme artık yalnız açık ID listesiyle: önce adayları preview'dan al,
      // operatörün zaten onayladığı import akışına bu ID'leri ekle.
      const preview = await apiRequest<{ count: number; product_ids: string[] }>('/api/products/mock-seed/preview');
      const result = await apiRequest<ProductWooImportResponse>('/api/products/import/woocommerce-live', {
        method: 'POST',
        body: JSON.stringify({
          limit: 100,
          replace_mock_seed: true,
          mock_seed_product_ids: preview.product_ids.join(','),
        }),
      });
      setSyncMessage(
        `Woo import tamamlandı · Çekilen: ${result.fetched}, Yeni: ${result.created}, Güncellenen: ${result.updated}, Atlanan: ${result.skipped}, Silinen mock: ${result.deleted_mock_seed}`,
      );
      if (result.errors.length) {
        setError(`Import sırasında ${result.errors.length} kayıt hata verdi. İlk hata: ${result.errors[0]}`);
      }
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Woo ürün importu başarısız');
    } finally {
      setImportingWoo(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 p-4 md:grid-cols-4">
        <Input placeholder="Numara veya müşteri adı ara" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tüm durumlar</option>
          <option value="purchased">Alındı</option>
          <option value="in_inventory">Envanterde</option>
          <option value="for_sale">Satışta</option>
          <option value="sold">Satıldı</option>
          <option value="melted">Eritildi</option>
          <option value="undecided">Kararsız</option>
        </Select>
        <Select value={metal} onChange={(e) => setMetal(e.target.value)}>
          <option value="">Tüm metaller</option>
          <option value="yellow_gold">Sarı altın</option>
          <option value="white_gold">Beyaz altın</option>
          <option value="silver">Gümüş</option>
          <option value="platinum">Platin</option>
          <option value="palladium">Palladium</option>
        </Select>
        <Button onClick={loadProducts}>Yenile</Button>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold text-brand-900">WooCommerce Canlı Ürün Importu</p>
          <p className="text-xs text-brand-700">Canlı yayındaki son 100 ürünü gerçek fotoğraflarıyla içeri alır.</p>
        </div>
        <Button onClick={importLiveWooProducts} disabled={importingWoo}>
          {importingWoo ? "Woo'dan Çekiliyor..." : "Woo'dan Son 100 Ürünü Çek"}
        </Button>
      </div>

      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
      {syncMessage && <p className="text-sm font-semibold text-emerald-700">{syncMessage}</p>}
      {loading ? (
        <div className="card p-5 text-sm text-brand-700">Ürünler yükleniyor...</div>
      ) : (
        <ProductTable
          items={items}
          onStatusChange={onStatusChange}
          returnTo={query ? `/admin/products?${query}` : '/admin/products'}
        />
      )}
    </div>
  );
}
