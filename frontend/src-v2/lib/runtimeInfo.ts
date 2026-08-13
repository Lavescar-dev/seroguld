import { resolveApiBaseUrl } from '@/lib/api';
import { getActiveLocale } from '@/i18n';

export type FrontendRuntimeInfo = {
  frontend_mode: string;
  frontend_built_at: string;
  api_base_url: string;
};

export function getFrontendRuntimeInfo(): FrontendRuntimeInfo {
  return {
    frontend_mode: __SERO_FRONTEND_MODE__,
    frontend_built_at: __SERO_FRONTEND_BUILT_AT__,
    api_base_url: resolveApiBaseUrl(),
  };
}

export function formatRuntimeLabel(value?: string | null): string {
  if (!value) return '—';
  if (value === 'vite-dev') return 'Vite Dev';
  if (value === 'embedded-dist') return 'Embedded Dist';
  if (value === 'tauri-dev-url') return 'Tauri Dev URL';
  if (value === 'embedded-app') return 'Embedded App';
  if (value === 'desktop-dev') return 'Desktop Dev';
  return value;
}

export function formatRuntimeDateTime(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—';
  const parsed =
    typeof value === 'number'
      ? new Date(value)
      : new Date(String(value).trim().match(/^\d+$/) ? Number(value) : String(value));
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  const locale = getActiveLocale();
  return parsed.toLocaleString(locale === 'en' ? 'en-GB' : locale === 'da' ? 'da-DK' : 'tr-TR');
}
