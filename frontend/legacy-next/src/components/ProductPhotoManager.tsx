'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiRequest, resolveApiBaseUrl } from '@/lib/api';
import { Product } from '@/types';

type Props = {
  product: Product;
  onUpdated: (product: Product) => void;
};

function toMediaUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('/')) {
    return `${resolveApiBaseUrl()}${url}`;
  }
  return url;
}

export function ProductPhotoManager({ product, onUpdated }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const photoCount = product.photos?.length ?? 0;
  const photoList = useMemo(
    () =>
      [...(product.photos || [])].sort((a, b) => {
        const aPrimary = a.is_primary ? 1 : 0;
        const bPrimary = b.is_primary ? 1 : 0;
        if (aPrimary !== bPrimary) return bPrimary - aPrimary;
        const aTime = a.uploaded_at || '';
        const bTime = b.uploaded_at || '';
        return aTime.localeCompare(bTime);
      }),
    [product.photos],
  );

  async function uploadSelected() {
    if (!files.length) {
      setError('Önce yüklenecek fotoğraf seçin.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const form = new FormData();
      files.forEach((file) => form.append('files', file));

      const updated = await apiRequest<Product>(`/api/products/${product.id}/photos`, {
        method: 'POST',
        body: form,
      });
      onUpdated(updated);
      setFiles([]);
      setMessage(`${files.length} fotoğraf yüklendi. AVIF optimizasyonu otomatik uygulandı.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf yükleme başarısız.');
    } finally {
      setBusy(false);
    }
  }

  async function deletePhoto(photoId: string) {
    const confirmed = window.confirm('Bu fotoğraf silinsin mi?');
    if (!confirmed) return;

    setDeletingId(photoId);
    setError('');
    setMessage('');
    try {
      const updated = await apiRequest<Product>(`/api/products/${product.id}/photos/${photoId}`, {
        method: 'DELETE',
      });
      onUpdated(updated);
      setMessage('Fotoğraf silindi.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf silinemedi.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-brand-900">Fotoğraflar</h4>
          <p className="text-sm text-brand-700">
            Ürün görselleri burada tutulur. Yükleme sonrası otomatik AVIF optimizasyonu yapılır.
          </p>
        </div>
        <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800">
          {photoCount} fotoğraf
        </span>
      </div>

      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
      {message && <p className="text-sm font-semibold text-emerald-700">{message}</p>}

      <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files || []))}
            className="max-w-full text-sm"
          />
          <Button onClick={uploadSelected} disabled={busy || !files.length}>
            {busy ? 'Yükleniyor...' : 'Fotoğraf Yükle'}
          </Button>
        </div>
        {!!files.length && (
          <p className="mt-2 text-xs text-brand-700">
            Seçilen dosyalar: {files.map((file) => file.name).join(', ')}
          </p>
        )}
      </div>

      {!photoList.length && (
        <p className="rounded-lg border border-brand-100 bg-white p-4 text-sm text-brand-700">
          Bu üründe henüz fotoğraf yok.
        </p>
      )}

      {!!photoList.length && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {photoList.map((photo, index) => {
            const id = photo.id || `${index}`;
            const src = toMediaUrl(photo.url);
            const isAvif = (photo.mime_type || '').toLowerCase().includes('avif') || Boolean(photo.avif_url);
            return (
              <div key={id} className="overflow-hidden rounded-xl border border-brand-100 bg-white">
                <div className="relative aspect-square bg-brand-50">
                  <img
                    src={src}
                    alt={photo.filename || `Urun fotografi ${index + 1}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute left-2 top-2 flex gap-2">
                    {photo.is_primary && (
                      <span className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white">
                        Birincil
                      </span>
                    )}
                    {isAvif && (
                      <span className="rounded bg-brand-700 px-2 py-1 text-[10px] font-bold text-white">AVIF</span>
                    )}
                  </div>
                </div>
                <div className="space-y-2 p-3">
                  <p className="truncate text-xs text-brand-700">{photo.filename || 'Fotoğraf'}</p>
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={src}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-brand-700 underline"
                    >
                      Görüntüle
                    </a>
                    <Button
                      variant="ghost"
                      disabled={deletingId === id || !photo.id}
                      onClick={() => photo.id && deletePhoto(photo.id)}
                    >
                      {deletingId === id ? 'Siliniyor...' : 'Sil'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
