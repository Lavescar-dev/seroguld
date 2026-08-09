import { useEffect, useRef } from 'react';
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router-dom';

import { writeUiDiagnostic } from '@/lib/desktop';
import { useUiVariant } from '@/ui-variants';

function routeErrorDetails(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return {
      name: `RouteError${error.status}`,
      message: error.statusText || 'Sayfa yüklenemedi.',
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Sayfa yüklenemedi.',
    };
  }
  return {
    name: 'Error',
    message: 'Sayfa yüklenemedi.',
  };
}

function frontendBuild() {
  return typeof __SERO_FRONTEND_BUILT_AT__ === 'string' ? __SERO_FRONTEND_BUILT_AT__ : 'unknown';
}

export function AuthenticatedRouteErrorElement() {
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();
  const { variant, reportModernBootstrapFailure } = useUiVariant();
  const recoveryStartedRef = useRef(false);
  const details = routeErrorDetails(error);
  const route = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (variant !== 'modern' || recoveryStartedRef.current) return;

    const timestamp = new Date().toISOString();
    const diagnostic = {
      variant: 'modern' as const,
      hash: window.location.hash,
      route,
      fingerprint: `variant:modern|route:${route}`,
      timestamp,
      error: {
        name: details.name,
        message: details.message,
      },
    };
    let timer: number | null = null;
    let cancelled = false;

    const recoverToClassic = (supportPath?: string | null) => {
      if (cancelled || recoveryStartedRef.current) return;
      recoveryStartedRef.current = true;
      reportModernBootstrapFailure({
        diagnostic,
        supportPath: supportPath || null,
        hash: window.location.hash,
      });
      navigate(route, { replace: true });
    };

    timer = window.setTimeout(() => recoverToClassic(), 2500);
    void writeUiDiagnostic({
      occurredAt: timestamp,
      route,
      uiVariant: 'modern',
      frontendBuild: frontendBuild(),
      errorCode: 'MODERN_ROUTE_RENDER_FAILURE',
    }).then((result) => recoverToClassic(result?.path));

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [details.message, details.name, navigate, reportModernBootstrapFailure, route, variant]);

  return (
    <section className="flex min-h-[60vh] items-center justify-center bg-sg-surface-soft px-6 py-10 text-sg-text">
      <div className="w-full max-w-2xl rounded-sg-lg border border-sg-border bg-sg-surface p-6 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sg-accent">Sayfa güvenli şekilde durduruldu</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Bu ekran yüklenemedi</h1>
        <p className="mt-3 text-sm leading-6 text-sg-text-soft">
          Açık workspace ve kaydedilmiş veriler korunuyor. {variant === 'modern' ? 'Klasik arayüze dönülüyor.' : 'Sayfayı yeniden yükleyebilirsiniz.'}
        </p>
        <p className="mt-4 rounded-sg-md border border-sg-border-soft bg-sg-surface-soft px-3 py-2 text-xs text-sg-text-soft">{details.message}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={() => window.location.reload()} className="rounded-sg-md bg-sg-accent px-4 py-2 text-sm font-semibold text-white">
            Sayfayı yeniden yükle
          </button>
          <button type="button" onClick={() => navigate('/')} className="rounded-sg-md border border-sg-border px-4 py-2 text-sm font-semibold text-sg-text">
            Ana ekrana dön
          </button>
        </div>
      </div>
    </section>
  );
}
