import { Component, Suspense, lazy, useEffect, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import {
  Navigate,
  Outlet,
  RouterProvider,
  createHashRouter,
  useLocation,
} from 'react-router-dom';

import { AppShell } from '@/components/AppShell';
import { AuthenticatedRouteErrorElement } from '@/components/AuthenticatedRouteErrorElement';
import { getAccessToken } from '@/lib/auth';
import { writeUiDiagnostic } from '@/lib/desktop';
import {
  UiVariantBoundary,
  UiVariantSwitchDialog,
  UiVariantToastBridge,
} from '@/ui-variants';

const desktopSmokeEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DESKTOP_SMOKE === '1';
const ZEROISH_INPUT_RE = /^[-+]?0+(?:[.,]0+)?$/;
const DECIMAL_ZEROISH_INPUT_RE = /^[-+]?0+[.,]0+$/;

function lazyPage<TModule extends Record<string, unknown>, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  exportName: TKey,
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType };
  });
}

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center bg-brand-50 text-brand-700">
      <div className="border border-brand-300 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.28em]">
        Sayfa yükleniyor
      </div>
    </div>
  );
}

function renderLazyPage(element: ReactNode) {
  return <Suspense fallback={<RouteLoadingFallback />}>{element}</Suspense>;
}

function DisplayRouteLoadingFallback() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--display-surface-page)] text-[var(--display-ink-strong)]">
      <div className="border border-[var(--display-border-subtle)] bg-[var(--display-surface-logo)] px-8 py-6 text-center shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-[var(--display-ink-muted)]">
          Müşteri ekranı
        </p>
        <p className="mt-3 text-lg font-black uppercase tracking-[0.18em]">Yükleniyor</p>
      </div>
    </div>
  );
}

function DisplayRouteErrorFallback({ message }: { message: string }) {
  return (
    <div
      data-testid="customer-display-error"
      className="flex h-screen w-screen items-center justify-center bg-[var(--display-surface-page)] px-8 text-[var(--display-ink-strong)]"
    >
      <div className="max-w-3xl border border-rose-300 bg-rose-50 px-8 py-7 text-center text-rose-900 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.28em] text-rose-700">Müşteri ekranı yüklenemedi</p>
        <p className="mt-3 text-sm leading-6 text-rose-800">
          İkinci ekran içeriği açılamadı. Ana ekranda müşteri ekranını kapatıp tekrar açın.
        </p>
        <p className="mt-4 break-words text-xs font-semibold text-rose-700">{message}</p>
      </div>
    </div>
  );
}

class DisplayRouteErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[display-route]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <DisplayRouteErrorFallback message={this.state.error} />;
    }
    return this.props.children;
  }
}

function renderDisplayPage(element: ReactNode) {
  return (
    <DisplayRouteErrorBoundary>
      <Suspense fallback={<DisplayRouteLoadingFallback />}>{element}</Suspense>
    </DisplayRouteErrorBoundary>
  );
}

const LoginPage = lazyPage(() => import('@/pages/LoginPage'), 'LoginPage');
const DisplayIdlePage = lazyPage(() => import('@/pages/DisplayIdlePage'), 'DisplayIdlePage');
const DisplayPage = lazyPage(() => import('@/pages/DisplayPage'), 'DisplayPage');
const GdprPublicPrivacyPage = lazyPage(() => import('@/pages/GdprPublicPrivacyPage'), 'GdprPublicPrivacyPage');
const GdprPublicCookiesPage = lazyPage(() => import('@/pages/GdprPublicCookiesPage'), 'GdprPublicCookiesPage');
const GdprPublicRequestPage = lazyPage(() => import('@/pages/GdprPublicRequestPage'), 'GdprPublicRequestPage');
const GdprPublicRequestStatusPage = lazyPage(
  () => import('@/pages/GdprPublicRequestStatusPage'),
  'GdprPublicRequestStatusPage',
);
const OfficeDocumentPage = lazyPage(() => import('@/pages/OfficeDocumentPage'), 'OfficeDocumentPage');
const ExcelPreviewPage = lazyPage(() => import('@/pages/ExcelPreviewPage'), 'ExcelPreviewPage');
const PosPage = lazyPage(() => import('@/pages/PosPage'), 'PosPage');
const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'), 'DashboardPage');
const InventoryPage = lazyPage(() => import('@/pages/InventoryPage'), 'InventoryPage');
const AfgPage = lazyPage(() => import('@/pages/AfgPage'), 'AfgPage');
const CustomersPage = lazyPage(() => import('@/pages/CustomersPage'), 'CustomersPage');
const GdprPage = lazyPage(() => import('@/pages/GdprPage'), 'GdprPage');
const DisplayPreviewPage = lazyPage(() => import('@/pages/DisplayPreviewPage'), 'DisplayPreviewPage');
const AntifraudPage = lazyPage(() => import('@/pages/AntifraudPage'), 'AntifraudPage');
const OpmcDetailPage = lazyPage(() => import('@/pages/OpmcDetailPage'), 'OpmcDetailPage');
const WooCommercePage = lazyPage(() => import('@/pages/WooCommercePage'), 'WooCommercePage');
const UnicontaPage = lazyPage(() => import('@/pages/UnicontaPage'), 'UnicontaPage');
const SettingsPage = lazyPage(() => import('@/pages/SettingsPage'), 'SettingsPage');
const ReportsPage = lazyPage(() => import('@/pages/ReportsPage'), 'ReportsPage');
const DesktopSmokePage = desktopSmokeEnabled
  ? lazyPage(() => import('@/pages/DesktopSmokePage'), 'DesktopSmokePage')
  : null;

function RequireAuth() {
  const location = useLocation();

  if (!getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

function ShellLayout() {
  return <AppShell />;
}

function isZeroishEditableNumericInput(input: HTMLInputElement) {
  if (input.disabled || input.readOnly) return false;
  const value = input.value.trim();
  if (!value || !ZEROISH_INPUT_RE.test(value)) return false;

  return (
    input.type === 'number' ||
    input.inputMode === 'decimal' ||
    input.inputMode === 'numeric' ||
    DECIMAL_ZEROISH_INPUT_RE.test(value)
  );
}

function markZeroishInput(input: HTMLInputElement) {
  if (isZeroishEditableNumericInput(input)) {
    input.dataset.zeroishValue = 'true';
  } else {
    delete input.dataset.zeroishValue;
  }
}

function selectInputValue(input: HTMLInputElement) {
  try {
    input.select();
  } catch {
    try {
      input.setSelectionRange(0, input.value.length);
    } catch {
      // Number inputs in some runtimes do not expose text selection APIs.
    }
  }
}

function installZeroishInputErgonomics() {
  let refreshFrame = 0;

  const refreshInputs = () => {
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      document.querySelectorAll<HTMLInputElement>('input').forEach(markZeroishInput);
    });
  };

  const handleEditableInputEvent = (event: Event) => {
    if (event.target instanceof HTMLInputElement) {
      markZeroishInput(event.target);
    }
  };

  const handleFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    markZeroishInput(input);
    if (!isZeroishEditableNumericInput(input)) return;

    window.requestAnimationFrame(() => {
      if (document.activeElement === input && isZeroishEditableNumericInput(input)) {
        selectInputValue(input);
      }
    });
  };

  const handlePointerEnd = (event: Event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    if (document.activeElement !== input || !isZeroishEditableNumericInput(input)) return;

    window.setTimeout(() => {
      if (document.activeElement === input && isZeroishEditableNumericInput(input)) {
        selectInputValue(input);
      }
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    if (isZeroishEditableNumericInput(input)) {
      selectInputValue(input);
    }
  };

  const observer = new MutationObserver(refreshInputs);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['value', 'type', 'inputmode', 'disabled', 'readonly'],
  });

  refreshInputs();
  document.addEventListener('focusin', handleFocusIn, true);
  document.addEventListener('focusout', handleEditableInputEvent, true);
  document.addEventListener('input', handleEditableInputEvent, true);
  document.addEventListener('change', handleEditableInputEvent, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('mouseup', handlePointerEnd, true);
  document.addEventListener('touchend', handlePointerEnd, true);

  return () => {
    if (refreshFrame) {
      window.cancelAnimationFrame(refreshFrame);
    }
    observer.disconnect();
    document.removeEventListener('focusin', handleFocusIn, true);
    document.removeEventListener('focusout', handleEditableInputEvent, true);
    document.removeEventListener('input', handleEditableInputEvent, true);
    document.removeEventListener('change', handleEditableInputEvent, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('mouseup', handlePointerEnd, true);
    document.removeEventListener('touchend', handlePointerEnd, true);
  };
}

const router = createHashRouter([
  { path: '/login', element: renderLazyPage(<LoginPage />) },
  { path: '/display/idle', element: renderDisplayPage(<DisplayIdlePage />) },
  { path: '/display/:token', element: renderDisplayPage(<DisplayPage />) },
  { path: '/gdpr/privacy', element: renderLazyPage(<GdprPublicPrivacyPage />) },
  { path: '/gdpr/cookies', element: renderLazyPage(<GdprPublicCookiesPage />) },
  { path: '/gdpr/request', element: renderLazyPage(<GdprPublicRequestPage />) },
  { path: '/gdpr/request/:token', element: renderLazyPage(<GdprPublicRequestStatusPage />) },
  ...(desktopSmokeEnabled && DesktopSmokePage
    ? [{ path: '/desktop-smoke', element: renderLazyPage(<DesktopSmokePage />) }]
    : []),
  {
    element: <RequireAuth />,
    errorElement: <AuthenticatedRouteErrorElement />,
    children: [
      { path: '/office-document/:kind/:key', element: renderLazyPage(<OfficeDocumentPage />) },
      { path: '/excel-preview/:kind/:key', element: renderLazyPage(<ExcelPreviewPage />) },
      {
        element: <ShellLayout />,
        children: [
          { path: '/', element: renderLazyPage(<PosPage />) },
          { path: '/dashboard', element: renderLazyPage(<DashboardPage />) },
          { path: '/depolama', element: renderLazyPage(<InventoryPage />) },
          { path: '/log', element: renderLazyPage(<AfgPage />) },
          { path: '/musteriler', element: renderLazyPage(<CustomersPage />) },
          { path: '/gdpr', element: renderLazyPage(<GdprPage />) },
          { path: '/musteri-ekran', element: renderLazyPage(<DisplayPreviewPage />) },
          { path: '/opmc', element: renderLazyPage(<AntifraudPage />) },
          { path: '/opmc/:id', element: renderLazyPage(<OpmcDetailPage />) },
          { path: '/woocommerce', element: renderLazyPage(<WooCommercePage />) },
          { path: '/uniconta', element: renderLazyPage(<UnicontaPage />) },
          { path: '/settings', element: renderLazyPage(<SettingsPage />) },
          { path: '/reports', element: renderLazyPage(<ReportsPage />) },
          { path: '/pos', element: <Navigate to="/" replace /> },
          { path: '/afg', element: <Navigate to="/log" replace /> },
          { path: '/inventory', element: <Navigate to="/depolama" replace /> },
          { path: '/customers', element: <Navigate to="/musteriler" replace /> },
          { path: '/antifraud', element: <Navigate to="/opmc" replace /> },
          { path: '/display-control', element: <Navigate to="/musteri-ekran" replace /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

export function App() {
  useEffect(() => installZeroishInputErgonomics(), []);

  return (
    <UiVariantBoundary
      diagnosticAdapter={{
        capture: async (diagnostic) => {
          const result = await writeUiDiagnostic({
            occurredAt: diagnostic.timestamp,
            route: diagnostic.route,
            uiVariant: 'modern',
            frontendBuild: __SERO_FRONTEND_BUILT_AT__,
            errorCode: 'MODERN_RENDER_FAILURE',
          });
          return result ? { supportPath: result.path } : undefined;
        },
      }}
    >
      <UiVariantSwitchDialog />
      <UiVariantToastBridge />
      <RouterProvider router={router} />
    </UiVariantBoundary>
  );
}
