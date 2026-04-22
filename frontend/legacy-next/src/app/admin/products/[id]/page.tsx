'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { AIDescriptionPanel } from '@/components/AIDescriptionPanel';
import { ProductPhotoManager } from '@/components/ProductPhotoManager';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import { labelMetalType, labelProductStatus, labelProductType } from '@/lib/labels';
import { getManualReviewReasons, isCoinSourceProduct, isManualReviewRequired } from '@/lib/productFlags';
import { Product, ProductHistoryEntry, WooProductRawResponse, WooSyncLogEntry } from '@/types';

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<ProductHistoryEntry[]>([]);
  const [syncLogs, setSyncLogs] = useState<WooSyncLogEntry[]>([]);
  const [wooRaw, setWooRaw] = useState<WooProductRawResponse | null>(null);
  const [loadingWooRaw, setLoadingWooRaw] = useState(false);
  const [wooRawError, setWooRawError] = useState('');
  const [approvingManualReview, setApprovingManualReview] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [syncingSale, setSyncingSale] = useState(false);
  const autoSyncAttemptedRef = useRef<string | null>(null);

  async function loadWooRawData(target: Product, options?: { silent?: boolean }) {
    if (!target.woocommerce_product_id) {
      setWooRaw(null);
      setWooRawError('');
      return;
    }
    setLoadingWooRaw(true);
    if (!options?.silent) setWooRawError('');
    try {
      const payload = await apiRequest<WooProductRawResponse>(`/api/products/${target.id}/woocommerce-raw`);
      setWooRaw(payload);
      setWooRawError('');
    } catch (err) {
      setWooRaw(null);
      const msg = err instanceof Error ? err.message : 'Woo ham verisi alınamadı.';
      setWooRawError(msg);
    } finally {
      setLoadingWooRaw(false);
    }
  }

  async function load() {
    if (!params.id) return;
    try {
      const [data, timeline, logs] = await Promise.all([
        apiRequest<Product>(`/api/products/${params.id}`),
        apiRequest<ProductHistoryEntry[]>(`/api/products/${params.id}/history?limit=60`),
        apiRequest<WooSyncLogEntry[]>(`/api/products/${params.id}/sync-log?limit=25`),
      ]);
      setProduct(data);
      setHistory(timeline);
      setSyncLogs(logs);
      setError('');
      if (data.woocommerce_product_id) {
        void loadWooRawData(data, { silent: true });
      } else {
        setWooRaw(null);
        setWooRawError('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ürün alınamadı');
    }
  }

  useEffect(() => {
    load();
  }, [params.id]);

  async function markAsSold() {
    if (!product) return;
    const value = prompt('Satış fiyatı (DKK):');
    if (value === null) return;
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      alert('Geçerli bir satış fiyatı girin.');
      return;
    }
    try {
      setMessage('');
      await apiRequest(`/api/products/${product.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sold', sale_price_dkk: parsed }),
      });
      await load();
      setMessage('Ürün manuel olarak satıldı durumuna alındı.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Durum güncellenemedi');
    }
  }

  async function markMelted() {
    if (!product) return;
    const reason = prompt('Eritme nedeni:');
    if (reason === null) return;
    const clean = reason.trim();
    if (!clean) {
      alert('Eritme nedeni boş bırakılamaz.');
      return;
    }
    try {
      setMessage('');
      await apiRequest(`/api/products/${product.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'melted', melt_reason: clean }),
      });
      await load();
      setMessage('Ürün eritildi durumuna alındı.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Durum güncellenemedi');
    }
  }

  async function syncSaleStatusFromWoo(options?: { silent?: boolean }) {
    if (!product?.id || !product.woocommerce_product_id) return;
    setSyncingSale(true);
    if (!options?.silent) {
      setMessage('');
      setError('');
    }
    try {
      const result = await apiRequest<{
        ok: boolean;
        matched: boolean;
        updated: boolean;
        message: string;
      }>(`/api/products/${product.id}/sync-sale-status?days=30&per_page=100`, {
        method: 'POST',
      });
      await load();
      setMessage(result.message);
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : 'Woo satış kontrolü başarısız.');
      }
    } finally {
      setSyncingSale(false);
    }
  }

  async function approveManualReview() {
    if (!product?.id) return;
    const confirmed = window.confirm('Manuel inceleme bayrağını kaldırıp ürünü normal akışa almak istiyor musunuz?');
    if (!confirmed) return;
    setApprovingManualReview(true);
    setError('');
    setMessage('');
    try {
      await apiRequest<Product>(`/api/products/${product.id}/manual-review/approve`, {
        method: 'POST',
      });
      await load();
      setMessage('Manuel inceleme bayrağı kaldırıldı.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Manuel inceleme onayı başarısız.');
    } finally {
      setApprovingManualReview(false);
    }
  }

  useEffect(() => {
    if (!product?.id) return;
    if (autoSyncAttemptedRef.current === product.id) return;
    if (product.status !== 'for_sale') return;
    if (!product.is_published_to_site) return;
    if (!product.woocommerce_product_id) return;

    autoSyncAttemptedRef.current = product.id;
    void syncSaleStatusFromWoo({ silent: true });
  }, [
    product?.id,
    product?.status,
    product?.is_published_to_site,
    product?.woocommerce_product_id,
  ]);

  if (error) return <p className="text-sm font-semibold text-red-700">{error}</p>;
  if (!product) return <div className="card p-4 text-sm text-brand-700">Ürün yükleniyor...</div>;
  const manualReview = isManualReviewRequired(product);
  const manualReviewReasons = getManualReviewReasons(product);
  const typeLabel = isCoinSourceProduct(product)
    ? `${labelProductType(product.product_type)} (Coin)`
    : labelProductType(product.product_type);

  function handleProductUpdated(updated: Product) {
    setProduct(updated);
  }

  const returnToRaw = searchParams.get('return_to') || '';
  const returnTo =
    returnToRaw.startsWith('/admin/') && !returnToRaw.startsWith('//')
      ? returnToRaw
      : '/admin/products';

  return (
    <div className="space-y-4">
      {message && <p className="text-sm font-semibold text-emerald-700">{message}</p>}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => router.push(returnTo)}>
            ← Envantere Dön
          </Button>
          <Button variant="ghost" onClick={() => router.push('/admin')}>
            Panele Dön
          </Button>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-xl font-semibold text-brand-900">
          Ürün #{product.product_number}
        </h3>
        <p className="mt-2 text-sm text-brand-700">
          Durum: <strong>{labelProductStatus(product.status)}</strong>
        </p>

        {manualReview && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">Manuel İnceleme Gerekli</p>
            <p className="mt-1 text-xs text-amber-800">
              Bu kayıt Woo import sırasında belirsiz alan içerdiği için işaretlendi.
              {manualReviewReasons.length ? ` Neden: ${manualReviewReasons.join(', ')}` : ''}
            </p>
            <div className="mt-2">
              <Button variant="ghost" onClick={() => void approveManualReview()} disabled={approvingManualReview}>
                {approvingManualReview ? 'Onaylanıyor...' : 'Manuel İnceleme Onayı Ver'}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <p>Tip: {typeLabel}</p>
          <p>Metal: {labelMetalType(product.metal_type)}</p>
          <p>Ağırlık: {product.weight_grams} g</p>
          <p>Ayar: {product.purity_karat || '-'}</p>
          <p>Alım Fiyatı: {product.purchase_price_dkk} DKK</p>
          <p>Saf Altın: {product.pure_gold_grams || '-'} g</p>
          <p>Satıcı: {product.seller_name || '-'}</p>
          <p>GDPR Kilitli: {product.is_gdpr_locked ? 'Evet' : 'Hayır'}</p>
        </div>

        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-900">Durum Senkronizasyonu</p>
          <p className="mt-1 text-xs text-brand-700">
            Satışlar normalde POS ve WooCommerce webhook ile otomatik düşer.
            Buradan ürün bazlı manuel satış kontrolü tetikleyebilirsiniz.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => void syncSaleStatusFromWoo()}
              disabled={syncingSale || !product.woocommerce_product_id}
            >
              {syncingSale ? 'Kontrol ediliyor...' : 'Woo Satışını Kontrol Et'}
            </Button>
            {!product.woocommerce_product_id && (
              <p className="text-xs font-semibold text-brand-700">
                Bu üründe Woo ID olmadığı için otomatik kontrol yapılamıyor.
              </p>
            )}
          </div>
        </div>

        <details className="mt-4 rounded-lg border border-brand-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-900">
            Gelişmiş Manuel Müdahale
          </summary>
          <p className="mt-2 text-xs text-brand-700">
            Sadece istisna durumlarda kullanın.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={markAsSold} disabled={product.is_gdpr_locked || product.status !== 'for_sale'}>
              Elle Satıldı İşaretle
            </Button>
            <Button variant="danger" onClick={markMelted} disabled={product.is_gdpr_locked}>
              Eritildi Olarak İşaretle
            </Button>
          </div>
        </details>
        <div className="mt-2 text-xs text-brand-600">
          Not: Woo satış kontrolü son 30 gün siparişlerini tarar.
        </div>
      </div>

      <ProductPhotoManager product={product} onUpdated={handleProductUpdated} />
      <AIDescriptionPanel product={product} onUpdated={handleProductUpdated} />

      <div className="card p-4">
        <h4 className="text-base font-semibold text-brand-900">Woo Ham Veri (Canlı)</h4>
        <p className="mt-1 text-sm text-brand-700">
          Bu bölüm WooCommerce API&apos;den anlık çekilen ürün detayını gösterir. Buradaki alanlar Woo&apos;daki
          gerçek verinin birebir yansımasıdır.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => void loadWooRawData(product)}
            disabled={!product.woocommerce_product_id || loadingWooRaw}
          >
            {loadingWooRaw ? 'Woo Ham Veri Çekiliyor...' : 'Woo Ham Veriyi Yenile'}
          </Button>
          {!product.woocommerce_product_id && (
            <span className="text-xs font-semibold text-brand-700">Woo ID olmadığı için canlı veri çekilemez.</span>
          )}
        </div>

        {wooRawError && <p className="mt-3 text-sm font-semibold text-red-700">{wooRawError}</p>}

        {wooRaw && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
              <p className="text-xs text-brand-700">
                Son çekim: <strong>{new Date(wooRaw.fetched_at).toLocaleString('tr-TR')}</strong>
              </p>
              <div className="mt-2 grid gap-2 text-sm text-brand-900 md:grid-cols-2">
                <p>
                  <strong>Woo ID:</strong> {wooRaw.summary.id ?? '-'}
                </p>
                <p>
                  <strong>Ad:</strong> {wooRaw.summary.name || '-'}
                </p>
                <p>
                  <strong>Slug:</strong> {wooRaw.summary.slug || '-'}
                </p>
                <p>
                  <strong>Permalink:</strong> {wooRaw.summary.permalink || '-'}
                </p>
                <p>
                  <strong>Durum:</strong> {wooRaw.summary.status || '-'}
                </p>
                <p>
                  <strong>SKU:</strong> {wooRaw.summary.sku || '-'}
                </p>
                <p>
                  <strong>Fiyat:</strong> {wooRaw.summary.price || '-'}
                </p>
                <p>
                  <strong>Regular Price:</strong> {wooRaw.summary.regular_price || '-'}
                </p>
                <p>
                  <strong>Sale Price:</strong> {wooRaw.summary.sale_price || '-'}
                </p>
                <p>
                  <strong>Stok Durumu:</strong> {wooRaw.summary.stock_status || '-'}
                </p>
                <p>
                  <strong>Ağırlık:</strong> {wooRaw.summary.weight || '-'}
                </p>
                <p>
                  <strong>Toplam Satış:</strong> {String(wooRaw.summary.total_sales ?? '-')}
                </p>
                <p className="md:col-span-2">
                  <strong>Kategoriler:</strong>{' '}
                  {(wooRaw.summary.categories || [])
                    .map((item) => item.name || item.slug)
                    .filter(Boolean)
                    .join(', ') || '-'}
                </p>
                <p className="md:col-span-2">
                  <strong>Etiketler:</strong>{' '}
                  {(wooRaw.summary.tags || [])
                    .map((item) => item.name || item.slug)
                    .filter(Boolean)
                    .join(', ') || '-'}
                </p>
              </div>
            </div>

            <details className="rounded-lg border border-brand-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand-900">
                Ham JSON (tüm Woo alanları)
              </summary>
              <pre className="mt-3 max-h-96 overflow-auto rounded bg-brand-50 p-3 text-xs text-brand-800">
                {JSON.stringify(wooRaw.raw, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>

      <div className="card p-4">
        <h4 className="text-base font-semibold text-brand-900">İşlem Geçmişi</h4>
        <div className="mt-3 space-y-3">
          {history.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-brand-200 bg-brand-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-brand-900">{entry.action}</p>
                <p className="text-xs text-brand-600">{new Date(entry.created_at).toLocaleString('tr-TR')}</p>
              </div>
              {entry.notes && <p className="mt-1 text-sm text-brand-700">{entry.notes}</p>}
              {entry.new_value && (
                <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-brand-700">
                  {JSON.stringify(entry.new_value, null, 2)}
                </pre>
              )}
            </div>
          ))}
          {!history.length && <p className="text-sm text-brand-700">Bu ürüne ait geçmiş kaydı bulunamadı.</p>}
        </div>
      </div>

      <div className="card p-4">
        <h4 className="text-base font-semibold text-brand-900">WooCommerce Senkron Geçmişi</h4>
        <div className="mt-3 space-y-3">
          {syncLogs.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-brand-200 bg-brand-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-brand-900">
                  {entry.action} ·{' '}
                  <span className={entry.status === 'success' ? 'text-emerald-700' : 'text-red-700'}>
                    {entry.status}
                  </span>
                </p>
                <p className="text-xs text-brand-600">{new Date(entry.created_at).toLocaleString('tr-TR')}</p>
              </div>
              {entry.wc_product_id && (
                <p className="mt-1 text-sm text-brand-700">Woo ID: {entry.wc_product_id}</p>
              )}
              {entry.error_message && (
                <p className="mt-1 text-sm font-semibold text-red-700">{entry.error_message}</p>
              )}
            </div>
          ))}
          {!syncLogs.length && (
            <p className="text-sm text-brand-700">Bu ürüne ait WooCommerce senkron kaydı bulunamadı.</p>
          )}
        </div>
      </div>
    </div>
  );
}
