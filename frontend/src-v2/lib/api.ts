import { clearAuth, getAccessToken, getRefreshToken, isAuthRemembered, setAuth } from '@/lib/auth';
import type { AuthTokenResponse } from '@/types';

export class ApiError extends Error {
  status: number;
  requestId?: string;

  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

export function localizeApiError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
}

function toTransportError(error: unknown): TransportError {
  if (error instanceof TransportError) {
    return error;
  }

  const rawMessage = error instanceof Error ? error.message.trim() : '';
  const normalized = rawMessage.toLowerCase();
  if (
    normalized.includes('load failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network request failed')
  ) {
    return new TransportError('Yerel backend bağlantısı kurulamadı.');
  }

  return new TransportError(rawMessage || 'Yerel backend bağlantısı kurulamadı.');
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured === 'auto' && typeof window !== 'undefined') {
    return trimSlash(window.location.origin);
  }
  return trimSlash(configured || 'http://127.0.0.1:8100');
}

export function resolveWsBaseUrl(): string {
  const configured = import.meta.env.VITE_WS_BASE_URL?.trim();
  if (configured === 'auto') {
    return resolveApiBaseUrl();
  }
  return trimSlash(configured || resolveApiBaseUrl());
}

export function buildApiUrl(path: string): string {
  return `${resolveApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildWsUrl(path: string): string {
  const base = new URL(resolveWsBaseUrl());
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${trimSlash(base.origin)}${path.startsWith('/') ? path : `/${path}`}`;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  refreshPromise = (async () => {
    const response = await fetch(buildApiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      clearAuth();
      return null;
    }

    const payload = (await response.json()) as AuthTokenResponse;
    setAuth(payload.access_token, payload.refresh_token, payload.user, isAuthRemembered());
    return payload.access_token;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

type RequestOptions = RequestInit & {
  auth?: boolean;
};

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const authEnabled = options.auth !== false;
  const baseHeaders = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !baseHeaders.has('Content-Type')) {
    baseHeaders.set('Content-Type', 'application/json');
  }

  async function runRequest(accessToken: string | null): Promise<Response> {
    const headers = new Headers(baseHeaders);
    if (authEnabled && accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    try {
      return await fetch(buildApiUrl(path), { ...options, headers });
    } catch (error) {
      throw toTransportError(error);
    }
  }

  let response = await runRequest(authEnabled ? getAccessToken() : null);
  if (response.status === 401 && authEnabled) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      response = await runRequest(refreshedToken);
    }
  }

  if (response.status === 401 && authEnabled) {
    clearAuth();
    window.location.hash = '/login';
    throw new Error('Oturum süresi doldu.');
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let requestId = response.headers.get('X-Request-ID') || undefined;
    const rawBody = await response.text().catch(() => '');
    try {
      const payload = rawBody ? JSON.parse(rawBody) as { detail?: unknown; request_id?: unknown } : null;
      if (typeof payload?.detail === 'string') {
        message = payload.detail;
      } else if (
        payload?.detail &&
        typeof payload.detail === 'object' &&
        'message' in payload.detail &&
        typeof payload.detail.message === 'string'
      ) {
        message = payload.detail.message;
      }
      if (typeof payload?.request_id === 'string') {
        requestId = payload.request_id;
      }
    } catch {
      if (rawBody.trim()) message = rawBody.trim().slice(0, 240);
    }
    throw new ApiError(response.status, requestId ? `${message} (Kod: ${requestId})` : message, requestId);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.blob()) as T;
}

export async function openAuthedDocument(path: string): Promise<void> {
  const blob = await apiRequest<Blob>(path);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadAuthedDocument(path: string, filename: string): Promise<void> {
  const blob = await apiRequest<Blob>(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function fetchAuthedPdfBlob(path: string): Promise<{ blob: Blob; url: string }> {
  const blob = await apiRequest<Blob>(path);
  const url = URL.createObjectURL(blob);
  return { blob, url };
}
