'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';
import { Product, ProductPublishResponse } from '@/types';

type Props = {
  product: Product;
  onUpdated: (product: Product) => void;
};

type SeoBundle = {
  seo_title?: string;
  short_description?: string;
  long_description_html?: string;
  meta_description?: string;
  url_slug?: string;
};

const seoLabels: Record<keyof SeoBundle, string> = {
  seo_title: 'SEO Title',
  short_description: 'Kısa Açıklama',
  long_description_html: 'Uzun Açıklama (HTML)',
  meta_description: 'Meta Description',
  url_slug: 'URL Slug',
};

function parseSeoBundle(text: string): SeoBundle {
  const result: SeoBundle = {};
  if (!text.trim()) return result;

  const map: Record<string, keyof SeoBundle> = {
    SEO_TITLE: 'seo_title',
    SHORT_DESCRIPTION: 'short_description',
    LONG_DESCRIPTION_HTML: 'long_description_html',
    META_DESCRIPTION: 'meta_description',
    URL_SLUG: 'url_slug',
  };

  let activeKey: keyof SeoBundle | null = null;
  let buffer: string[] = [];
  const lines = text.split('\n');

  function flush() {
    if (!activeKey) return;
    const value = buffer.join('\n').trim();
    if (value) result[activeKey] = value;
  }

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const match = line.match(
      /^\s*(SEO_TITLE|SHORT_DESCRIPTION|LONG_DESCRIPTION_HTML|META_DESCRIPTION|URL_SLUG)\s*:\s*(.*)$/,
    );

    if (match) {
      flush();
      activeKey = map[match[1]];
      buffer = [];
      if (match[2].trim()) buffer.push(match[2].trim());
      continue;
    }

    if (activeKey) buffer.push(line);
  }

  flush();
  return result;
}

function compactHtmlToText(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function AIDescriptionPanel({ product, onUpdated }: Props) {
  const [description, setDescription] = useState(product.ai_description || '');
  const [approved, setApproved] = useState(Boolean(product.ai_description_approved));
  const [regularPrice, setRegularPrice] = useState(product.sale_price_dkk || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setDescription(product.ai_description || '');
    setApproved(Boolean(product.ai_description_approved));
    setRegularPrice(product.sale_price_dkk || '');
  }, [product.id, product.ai_description, product.ai_description_approved, product.sale_price_dkk]);

  const seoBundle = useMemo(() => parseSeoBundle(description), [description]);
  const requiredSeoKeys: Array<keyof SeoBundle> = [
    'seo_title',
    'short_description',
    'long_description_html',
    'meta_description',
    'url_slug',
  ];
  const missingSeoKeys = requiredSeoKeys.filter((key) => !seoBundle[key]?.trim());
  const hasSeoBundle = missingSeoKeys.length === 0;
  const publishBlockedByManualReview = Boolean(product.manual_review_required);
  const longDescriptionPreview = useMemo(() => {
    const plain = compactHtmlToText(seoBundle.long_description_html);
    if (!plain) return '-';
    return plain.length > 280 ? `${plain.slice(0, 280)}...` : plain;
  }, [seoBundle.long_description_html]);

  async function generateDescription() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const updated = await apiRequest<Product>(`/api/products/${product.id}/ai-describe`, {
        method: 'POST',
      });
      onUpdated(updated);
      setMessage('AI açıklama üretildi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI açıklama üretilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDescription() {
    const clean = description.trim();
    if (clean.length < 10) {
      setError('Açıklama en az 10 karakter olmalı.');
      return;
    }

    setError('');
    setMessage('');
    setBusy(true);
    try {
      const updated = await apiRequest<Product>(`/api/products/${product.id}/ai-describe`, {
        method: 'PUT',
        body: JSON.stringify({
          ai_description: clean,
          ai_description_approved: approved,
        }),
      });
      onUpdated(updated);
      setMessage(approved ? 'Açıklama kaydedildi ve onaylandı.' : 'Açıklama kaydedildi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Açıklama kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function publishToWoo() {
    const parsed = Number(regularPrice);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Yayınlama için geçerli bir satış fiyatı girin.');
      return;
    }

    setError('');
    setMessage('');
    setBusy(true);
    try {
      const response = await apiRequest<ProductPublishResponse>(`/api/products/${product.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ regular_price_dkk: parsed }),
      });
      onUpdated(response.product);
      setMessage(
        response.wc_permalink
          ? `Ürün siteye yayınlandı. URL: ${response.wc_permalink}`
          : 'Ürün siteye yayınlandı.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yayınlama başarısız.');
    } finally {
      setBusy(false);
    }
  }

  async function unpublishFromWoo() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const updated = await apiRequest<Product>(`/api/products/${product.id}/unpublish`, {
        method: 'POST',
      });
      onUpdated(updated);
      setMessage('Ürün WooCommerce yayından kaldırıldı.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Yayından kaldırma başarısız.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h4 className="text-base font-semibold text-brand-900">AI Açıklama + WooCommerce</h4>
      <p className="mt-2 text-sm text-brand-700">
        Önce Danca SEO paketi üretin (başlık, kısa açıklama, uzun HTML, meta, slug), düzenleyip onaylayın.
        Ardından statik fiyatla WooCommerce&apos;e yayınlayın.
      </p>

      {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      {message && <p className="mt-3 text-sm font-semibold text-emerald-700">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={generateDescription} disabled={busy}>
          AI Açıklama Üret
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        <textarea
          className="w-full rounded-md border border-brand-200 p-3 text-sm"
          rows={10}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Danca ürün açıklaması..."
        />
        <label className="inline-flex items-center gap-2 text-sm text-brand-800">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
          />
          Açıklamayı onayla
        </label>
        <div>
          <Button onClick={saveDescription} disabled={busy}>
            Açıklamayı Kaydet
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-brand-900">SEO Paket Kontrolü</p>
          {missingSeoKeys.length ? (
            <p className="text-xs font-semibold text-amber-700">
              Eksik alan: {missingSeoKeys.map((key) => seoLabels[key]).join(', ')}
            </p>
          ) : (
            <p className="text-xs font-semibold text-emerald-700">Tüm SEO alanları mevcut.</p>
          )}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <p className="text-xs text-brand-700">
            <strong>SEO Title:</strong> {seoBundle.seo_title || '-'}
          </p>
          <p className="text-xs text-brand-700">
            <strong>Slug:</strong> {seoBundle.url_slug || '-'}
          </p>
          <p className="text-xs text-brand-700">
            <strong>Kısa Açıklama:</strong> {seoBundle.short_description || '-'}
          </p>
          <p className="text-xs text-brand-700">
            <strong>Meta:</strong> {seoBundle.meta_description || '-'}
          </p>
          <p className="text-xs text-brand-700 md:col-span-2">
            <strong>Uzun Açıklama Önizleme:</strong> {longDescriptionPreview}
          </p>
        </div>
        <p className="mt-3 text-xs text-brand-600">
          Not: Site ziyaretçisi SEO alanlarını "ham" görmez. Müşterinin gördüğü ana içerik ürün adı ve ürün
          açıklamasıdır. SEO title/meta/slug arama motoru ve URL optimizasyonu içindir.
        </p>
      </div>

      <div className="mt-5 grid gap-2 md:grid-cols-[220px_auto_auto] md:items-end">
        <div>
          <label className="mb-1 block text-sm font-medium text-brand-700">Site Satış Fiyatı (DKK)</label>
          <Input
            value={regularPrice}
            onChange={(event) => setRegularPrice(event.target.value)}
            placeholder="Örn: 12500"
          />
        </div>
        <Button onClick={publishToWoo} disabled={busy || !approved || !hasSeoBundle || publishBlockedByManualReview}>
          Siteye Yayınla
        </Button>
        <Button variant="ghost" onClick={unpublishFromWoo} disabled={busy || !product.is_published_to_site}>
          Yayından Kaldır
        </Button>
      </div>
      {(!approved || !hasSeoBundle || publishBlockedByManualReview) && (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          Yayınlama kilitli: {approved ? '' : 'Açıklamayı onaylayın.'}{' '}
          {hasSeoBundle ? '' : `SEO paketi eksik (${missingSeoKeys.map((key) => seoLabels[key]).join(', ')}).`}{' '}
          {publishBlockedByManualReview ? 'Önce manuel inceleme bayrağını çözün.' : ''}
        </p>
      )}
    </div>
  );
}
