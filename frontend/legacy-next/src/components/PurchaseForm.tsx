'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { apiRequest } from '@/lib/api';

const productTypes = [
  { value: 'bracelet', label: 'Bilezik' },
  { value: 'ring', label: 'Yüzük' },
  { value: 'necklace', label: 'Kolye' },
  { value: 'earring', label: 'Küpe' },
  { value: 'chain', label: 'Zincir' },
  { value: 'bar', label: 'Bar' },
  { value: 'jewelry', label: 'Takı' },
];

const metalTypes = [
  { value: 'yellow_gold', label: 'Sarı altın' },
  { value: 'white_gold', label: 'Beyaz altın' },
  { value: 'silver', label: 'Gümüş' },
  { value: 'platinum', label: 'Platin' },
  { value: 'palladium', label: 'Palladium' },
];

export function PurchaseForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    reference_number: '',
    product_type: 'ring',
    metal_type: 'yellow_gold',
    weight_grams: '0',
    purity_karat: '18K',
    purity_percentage: '75',
    purchase_price_dkk: '0',
    gold_rate_at_purchase: '0',
    commission: '0',
    seller_name: '',
    seller_phone: '',
    seller_email: '',
    seller_address: '',
    seller_cpr: '',
    notes: '',
    storage_location: '',
  });

  const derived = useMemo(() => {
    const weight = Number(form.weight_grams || '0');
    const purity = Number(form.purity_percentage || '0');
    const rate = Number(form.gold_rate_at_purchase || '0');
    const commissionPercent = Number(form.commission || '0');

    const pureGold = (weight * purity) / 100;
    const offer = pureGold * rate * (1 - commissionPercent / 100);

    return {
      pureGold: Number.isFinite(pureGold) ? pureGold.toFixed(2) : '0.00',
      offer: Number.isFinite(offer) ? offer.toFixed(2) : '0.00',
    };
  }, [form]);

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const weight = Number(form.weight_grams);
      const purity = Number(form.purity_percentage);
      const rate = Number(form.gold_rate_at_purchase);
      const commission = Number(form.commission);
      const manualPurchasePrice = Number(form.purchase_price_dkk);
      const derivedOffer = Number(derived.offer);

      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error('Ağırlık 0\'dan büyük olmalıdır.');
      }
      if (!Number.isFinite(purity) || purity < 0 || purity > 100) {
        throw new Error('Saflık yüzdesi 0 ile 100 arasında olmalıdır.');
      }
      if (!Number.isFinite(rate) || rate < 0) {
        throw new Error('Kur değeri 0 veya daha büyük olmalıdır.');
      }
      if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
        throw new Error('Komisyon 0 ile 100 arasında olmalıdır.');
      }
      if (form.seller_email.trim() && !isValidEmail(form.seller_email.trim())) {
        throw new Error('Satıcı e-posta formatı geçersiz.');
      }

      const purchasePriceToUse =
        Number.isFinite(manualPurchasePrice) && manualPurchasePrice > 0
          ? manualPurchasePrice
          : Number.isFinite(derivedOffer) && derivedOffer > 0
            ? derivedOffer
            : 0;
      if (purchasePriceToUse <= 0) {
        throw new Error('Ödenen tutar hesaplanamadı. Lütfen kur, ağırlık ve saflık alanlarını kontrol edin.');
      }

      const payload = {
        reference_number: form.reference_number || null,
        product_type: form.product_type,
        metal_type: form.metal_type,
        weight_grams: weight,
        purity_karat: form.purity_karat || null,
        purity_percentage: purity,
        purchase_price_dkk: purchasePriceToUse,
        gold_rate_at_purchase: rate,
        commission: commission,
        seller_new: form.seller_name
          ? {
              name: form.seller_name,
              phone: form.seller_phone || null,
              email: form.seller_email.trim() || null,
              address: form.seller_address || null,
              cpr_number: form.seller_cpr || null,
            }
          : null,
        notes: form.notes || null,
        storage_location: form.storage_location || null,
        needs_cleaning: false,
      };

      const result = await apiRequest<{ id: string }>('/api/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      router.push(`/admin/products/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ürün oluşturulamadı');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card space-y-5 p-6" onSubmit={onSubmit}>
      <h3 className="text-lg font-semibold text-brand-900">Yeni Alım Kaydı</h3>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Referans No</label>
          <Input
            value={form.reference_number}
            onChange={(e) => setForm((s) => ({ ...s, reference_number: e.target.value }))}
            placeholder="9680"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Ürün Tipi</label>
          <Select
            value={form.product_type}
            onChange={(e) => setForm((s) => ({ ...s, product_type: e.target.value }))}
          >
            {productTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Metal Tipi</label>
          <Select
            value={form.metal_type}
            onChange={(e) => setForm((s) => ({ ...s, metal_type: e.target.value }))}
          >
            {metalTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Ağırlık (g)</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.weight_grams}
            onChange={(e) => setForm((s) => ({ ...s, weight_grams: e.target.value }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Ayar (K)</label>
          <Input
            value={form.purity_karat}
            onChange={(e) => setForm((s) => ({ ...s, purity_karat: e.target.value }))}
            placeholder="18K"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Saflık (%)</label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.purity_percentage}
            onChange={(e) => setForm((s) => ({ ...s, purity_percentage: e.target.value }))}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Kur (DKK/g)</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.gold_rate_at_purchase}
            onChange={(e) => setForm((s) => ({ ...s, gold_rate_at_purchase: e.target.value }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Komisyon (%)</label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.commission}
            onChange={(e) => setForm((s) => ({ ...s, commission: e.target.value }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-brand-600">Ödenen Tutar (DKK)</label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.purchase_price_dkk}
            onChange={(e) => setForm((s) => ({ ...s, purchase_price_dkk: e.target.value }))}
          />
          <p className="mt-1 text-xs text-brand-600">
            Boş veya 0 bırakılırsa otomatik teklif ({derived.offer} DKK) kullanılır.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
          <h4 className="mb-2 font-semibold text-brand-800">Otomatik Hesaplama</h4>
          <p className="text-sm text-brand-700">
            Saf altın: <strong>{derived.pureGold} g</strong>
          </p>
          <p className="text-sm text-brand-700">
            Teklif (komisyon dahil): <strong>{derived.offer} DKK</strong>
          </p>
        </div>

        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
          <h4 className="mb-2 font-semibold text-brand-800">Satıcı Bilgileri</h4>
          <div className="space-y-2">
            <Input
              placeholder="Ad Soyad"
              value={form.seller_name}
              onChange={(e) => setForm((s) => ({ ...s, seller_name: e.target.value }))}
            />
            <Input
              placeholder="Telefon"
              value={form.seller_phone}
              onChange={(e) => setForm((s) => ({ ...s, seller_phone: e.target.value }))}
            />
            <Input
              placeholder="E-posta"
              value={form.seller_email}
              onChange={(e) => setForm((s) => ({ ...s, seller_email: e.target.value }))}
            />
            <Input
              placeholder="Adres"
              value={form.seller_address}
              onChange={(e) => setForm((s) => ({ ...s, seller_address: e.target.value }))}
            />
            <Input
              placeholder="CPR / Kimlik No"
              value={form.seller_cpr}
              onChange={(e) => setForm((s) => ({ ...s, seller_cpr: e.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          placeholder="Depolama konumu"
          value={form.storage_location}
          onChange={(e) => setForm((s) => ({ ...s, storage_location: e.target.value }))}
        />
        <Input
          placeholder="Notlar"
          value={form.notes}
          onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
        />
      </div>

      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? 'Kaydediliyor...' : 'Ürünü Kaydet'}
        </Button>
      </div>
    </form>
  );
}
