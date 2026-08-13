import { useState } from 'react';
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router-dom';

import { openRuntimeDiagnostics, writeUiDiagnostic } from '@/lib/desktop';
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
  const [diagnosticOpened, setDiagnosticOpened] = useState(false);
  const details = routeErrorDetails(error);
  const route = `${location.pathname}${location.search}`;

  const timestamp = new Date().toISOString();
  const diagnostic = {
    variant: 'modern' as const,
    hash: window.location.hash,
    route,
    fingerprint: `variant:modern|route:${route}`,
    timestamp,
    error: { name: details.name, message: details.message },
  };

  const openDiagnostics = () => {
    setDiagnosticOpened(true);
    void openRuntimeDiagnostics();
    void writeUiDiagnostic({
      occurredAt: timestamp,
      route,
      uiVariant: 'modern',
      frontendBuild: frontendBuild(),
      errorCode: 'MODERN_ROUTE_RENDER_FAILURE',
    });
  };

  const returnToClassic = () => {
    reportModernBootstrapFailure({ diagnostic, supportPath: null, hash: window.location.hash, explicitClassic: true });
    navigate(route, { replace: true });
  };

  return (
    <section className="flex min-h-[60vh] items-center justify-center bg-sg-surface-soft px-6 py-10 text-sg-text">
      <div className="w-full max-w-2xl rounded-sg-lg border border-sg-border bg-sg-surface p-6 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sg-accent">Sayfa güvenli şekilde durduruldu</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Bu ekran yüklenemedi</h1>
        <p className="mt-3 text-sm leading-6 text-sg-text-soft">
          Açık workspace ve kaydedilmiş veriler korunuyor. {variant === 'modern' ? 'Tekrar deneyebilir, tanı bilgilerini açabilir veya klasik arayüze manuel geçebilirsiniz.' : 'Sayfayı yeniden yükleyebilirsiniz.'}
        </p>
        <p className="mt-4 rounded-sg-md border border-sg-border-soft bg-sg-surface-soft px-3 py-2 text-xs text-sg-text-soft">{details.message}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={() => window.location.reload()} className="rounded-sg-md bg-sg-accent px-4 py-2 text-sm font-semibold text-white">
            Sayfayı yeniden yükle
          </button>
          {variant === 'modern' ? (
            <>
              <button type="button" onClick={openDiagnostics} className="rounded-sg-md border border-sg-border px-4 py-2 text-sm font-semibold text-sg-text">
                Tanı bilgilerini aç
              </button>
              <button type="button" onClick={returnToClassic} className="rounded-sg-md border border-sg-red/30 bg-sg-red-soft px-4 py-2 text-sm font-semibold text-sg-red">
                Klasik arayüze dön
              </button>
            </>
          ) : null}
          <button type="button" onClick={() => navigate('/')} className="rounded-sg-md border border-sg-border px-4 py-2 text-sm font-semibold text-sg-text">
            Ana ekrana dön
          </button>
        </div>
        {diagnosticOpened ? <p className="mt-3 text-xs text-sg-text-soft">Tanı kaydı oluşturuldu.</p> : null}
      </div>
    </section>
  );
}
