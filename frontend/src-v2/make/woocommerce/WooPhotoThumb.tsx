import { useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { buildMediaUrl } from '@/lib/media';

type ThumbPhoto = {
  url?: string | null;
  avif_url?: string | null;
  original_url?: string | null;
  filename?: string | null;
};

/**
 * Ürün thumbnail'ı. WebView2 AVIF çözemezse sessizce boş kalıyordu (önizleme
 * kırılması); AVIF → orijinal (jpeg/webp) → placeholder sırasıyla düşer.
 */
export function WooPhotoThumb({ photo, alt, className }: { photo: ThumbPhoto; alt: string; className?: string }) {
  // AVIF birincil; başarısızsa orijinal formata düş. Aynı URL iki kez denenmez.
  const sources = useMemo(() => {
    const list = [photo.avif_url, photo.url, photo.original_url]
      .map((value) => (value ? buildMediaUrl(value) : ''))
      .filter(Boolean);
    return Array.from(new Set(list));
  }, [photo.avif_url, photo.url, photo.original_url]);
  const [index, setIndex] = useState(0);

  if (sources.length === 0 || index >= sources.length) {
    return (
      <div className={`flex items-center justify-center bg-sg-surface-soft text-sg-text-soft ${className || ''}`} title={photo.filename || 'Fotoğraf'}>
        <ImageOff className="h-6 w-6" />
      </div>
    );
  }

  return (
    <img
      src={sources[index]}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setIndex((current) => current + 1)}
    />
  );
}
