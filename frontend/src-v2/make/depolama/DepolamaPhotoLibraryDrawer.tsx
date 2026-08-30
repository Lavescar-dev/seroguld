import { useEffect, useMemo, useState } from 'react';
import { Check, Images, Loader2, Search, X } from 'lucide-react';

import { buildMediaUrl } from '@/lib/media';

const POOL_BASE = '/media/seed-library/depolama';

type ManifestEntry = {
  file: string;
  gallery_number?: string | null;
  source_image?: string;
  reused?: boolean;
};

/**
 * Depolama foto havuzu seçici. Seed ile gelen 266 AVIF fotoyu (ürüne bağlı
 * DEĞİL — havuz) gösterir; operatör doğru fotoyu seçip ürüne iliştirir.
 * Manifest /media altından statik olarak sunulur (auth gerekmez).
 */
export function DepolamaPhotoLibraryDrawer({
  open,
  onClose,
  onSelect,
  attaching,
  attachedUrls,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (file: string) => void;
  attaching: boolean;
  attachedUrls: string[];
}) {
  const [entries, setEntries] = useState<ManifestEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || entries) return;
    let cancelled = false;
    setError(null);
    fetch(buildMediaUrl(`${POOL_BASE}/manifest.json`))
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data: ManifestEntry[]) => {
        if (cancelled) return;
        // Tekilleştir: aynı dosya birden çok kez anchor'lanmış olabilir.
        const seen = new Set<string>();
        const unique = data.filter((entry) => {
          if (!entry.file || seen.has(entry.file)) return false;
          seen.add(entry.file);
          return true;
        });
        setEntries(unique);
      })
      .catch(() => {
        if (!cancelled) setError('Foto havuzu yüklenemedi. Seed henüz kurulmamış olabilir.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, entries]);

  const attached = useMemo(() => new Set(attachedUrls), [attachedUrls]);
  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        String(entry.gallery_number ?? '').toLowerCase().includes(q) ||
        entry.file.toLowerCase().includes(q),
    );
  }, [entries, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col border border-brand-300 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-brand-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Images className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-black uppercase tracking-widest text-brand-700">Depolama foto havuzu</h3>
            {entries ? (
              <span className="mono text-[10px] font-bold text-brand-400">{filtered.length} / {entries.length}</span>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="border border-brand-300 bg-white p-1 text-brand-600 hover:bg-brand-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-brand-200 px-4 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-400" />
            <input
              type="text"
              placeholder="Galeri numarası veya dosya adı ile ara…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full border border-brand-300 bg-white py-1 pl-7 pr-2 text-xs text-brand-900 focus:border-brand-700 focus:outline-none"
            />
          </div>
          <p className="mt-1 text-[10px] text-brand-400">
            Fotolar ürünlere bağlı gelmez — doğru fotoyu seçip bu ürüne iliştirin.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="border border-red-200 bg-red-50 px-4 py-6 text-center text-xs text-red-600">{error}</div>
          ) : !entries ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-brand-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Foto havuzu yükleniyor…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-brand-400">Eşleşen foto yok.</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {filtered.map((entry) => {
                const url = `${POOL_BASE}/${entry.file}`;
                const isAttached = attached.has(url);
                return (
                  <button
                    key={entry.file}
                    type="button"
                    disabled={attaching || isAttached}
                    onClick={() => onSelect(entry.file)}
                    className={`group relative overflow-hidden border transition ${
                      isAttached ? 'border-emerald-400 opacity-60' : 'border-brand-200 hover:border-brand-600'
                    } disabled:cursor-not-allowed`}
                    title={isAttached ? 'Zaten iliştirilmiş' : `Galeri #${entry.gallery_number ?? '?'} — iliştir`}
                  >
                    <img
                      src={buildMediaUrl(url)}
                      alt={`Galeri ${entry.gallery_number ?? ''}`}
                      loading="lazy"
                      className="h-24 w-full object-cover"
                    />
                    <span className="absolute left-1 top-1 bg-black/60 px-1 text-[9px] font-bold text-white">
                      #{entry.gallery_number ?? '?'}
                    </span>
                    {isAttached ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-emerald-500/20">
                        <Check className="h-6 w-6 text-emerald-700" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
