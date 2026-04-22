import { clearAuth, getAccessToken, getRefreshToken, setAuth } from '@/lib/auth';
import { TokenResponse } from '@/types';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function resolveConfiguredOrigin(configured: string, browserOrigin: string): string {
  try {
    const configuredUrl = new URL(configured);
    const mixedContent = browserOrigin.startsWith('https://') && configuredUrl.protocol === 'http:';
    const browserIsLocal = typeof window !== 'undefined' && isLocalHost(window.location.hostname);
    const targetIsLocal = isLocalHost(configuredUrl.hostname);

    if (mixedContent || (targetIsLocal && !browserIsLocal)) {
      return trimTrailingSlash(browserOrigin);
    }

    return trimTrailingSlash(configuredUrl.origin);
  } catch {
    return trimTrailingSlash(configured);
  }
}

export function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';

  if (typeof window === 'undefined') {
    return trimTrailingSlash(configured || 'http://localhost:8000');
  }

  const browserOrigin = window.location.origin;
  if (!configured || configured === 'auto') {
    return trimTrailingSlash(browserOrigin);
  }

  return resolveConfiguredOrigin(configured, browserOrigin);
}

export function resolveWsBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_BASE_URL?.trim() || '';

  if (typeof window === 'undefined') {
    return trimTrailingSlash(configured || resolveApiBaseUrl());
  }

  const browserOrigin = window.location.origin;
  if (!configured || configured === 'auto') {
    return resolveApiBaseUrl();
  }

  return resolveConfiguredOrigin(configured, browserOrigin);
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${resolveApiBaseUrl()}${normalizedPath}`;
}

export function buildWsUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = resolveWsBaseUrl();
  const parsed = new URL(base);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${trimTrailingSlash(parsed.origin)}${normalizedPath}`;
}

export async function openAuthedDocument(path: string): Promise<void> {
  const popup =
    typeof window !== 'undefined' ? window.open('', '_blank', 'noopener,noreferrer') : null;

  try {
    const blob = await apiRequest<Blob>(path);
    const objectUrl = URL.createObjectURL(blob);

    if (popup) {
      popup.location.replace(objectUrl);
    } else if (typeof window !== 'undefined') {
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
    }

    if (typeof window !== 'undefined') {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
  } catch (error) {
    popup?.close();
    throw error;
  }
}

export async function downloadAuthedDocument(path: string, filename: string): Promise<void> {
  const blob = await apiRequest<Blob>(path);
  if (typeof window === 'undefined') return;

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(buildApiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      clearAuth();
      return null;
    }

    const payload = (await response.json()) as TokenResponse;
    if (!payload.access_token || !payload.refresh_token || !payload.user) {
      clearAuth();
      return null;
    }

    setAuth(payload.access_token, payload.refresh_token, payload.user);
    return payload.access_token;
  } catch {
    return null;
  }
}

type RequestOptions = RequestInit & {
  auth?: boolean;
};

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseHeaders = new Headers(options.headers || {});
  const authEnabled = options.auth !== false;
  if (options.body && !(options.body instanceof FormData) && !baseHeaders.has('Content-Type')) {
    baseHeaders.set('Content-Type', 'application/json');
  }

  const url = buildApiUrl(path);

  async function runRequest(withAccessToken: string | null): Promise<Response> {
    const headers = new Headers(baseHeaders);
    if (authEnabled && withAccessToken) {
      headers.set('Authorization', `Bearer ${withAccessToken}`);
    }

    try {
      return await fetch(url, {
        ...options,
        headers,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'bilinmeyen ağ hatası';
      throw new Error(`API bağlantısı kurulamadı. Sunucu erişilebilir değil (${detail}).`);
    }
  }

  const currentAccessToken = authEnabled ? getAccessToken() : null;
  let response = await runRequest(currentAccessToken);

  if (response.status === 401 && authEnabled) {
    const refreshedAccessToken = await refreshAccessToken();
    if (refreshedAccessToken) {
      response = await runRequest(refreshedAccessToken);
    }
  }

  if (response.status === 401 && authEnabled) {
    clearAuth();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.replace('/');
    }
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.detail) message = payload.detail;
    } catch {
      // ignore parse failure
    }
    throw new Error(message);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.blob()) as unknown as T;
}
