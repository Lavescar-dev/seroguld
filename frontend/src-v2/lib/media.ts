import { buildApiUrl } from '@/lib/api';

/**
 * Backend'in döndürdüğü göreli `/media/...` yollarını mutlak URL'e çevirir.
 *
 * Paketli masaüstünde sayfa origin'i `tauri.localhost`, medya ise backend'de
 * (127.0.0.1:8100) servis edilir — göreli `<img src="/media/...">` bu yüzden
 * 404 veriyordu (0.3.7 saha bulgusu: foto kartları boş). Mutlak (http/blob/
 * data) URL'ler olduğu gibi geçer; boş değer boş kalır.
 */
export function buildMediaUrl(path: string | null | undefined): string {
  const value = (path || '').trim();
  if (!value) return '';
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  if (value.startsWith('/')) return buildApiUrl(value);
  return value;
}
