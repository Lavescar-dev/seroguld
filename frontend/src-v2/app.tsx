import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import {
  Navigate,
  Outlet,
  RouterProvider,
  createHashRouter,
  useLocation,
} from 'react-router-dom';

import { AppShell } from '@/components/AppShell';
import { getAccessToken } from '@/lib/auth';

const desktopSmokeEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DESKTOP_SMOKE === '1';

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

const router = createHashRouter([
  { path: '/login', element: renderLazyPage(<LoginPage />) },
  { path: '/display/idle', element: renderLazyPage(<DisplayIdlePage />) },
  { path: '/display/:token', element: renderLazyPage(<DisplayPage />) },
  { path: '/gdpr/privacy', element: renderLazyPage(<GdprPublicPrivacyPage />) },
  { path: '/gdpr/cookies', element: renderLazyPage(<GdprPublicCookiesPage />) },
  { path: '/gdpr/request', element: renderLazyPage(<GdprPublicRequestPage />) },
  { path: '/gdpr/request/:token', element: renderLazyPage(<GdprPublicRequestStatusPage />) },
  ...(desktopSmokeEnabled && DesktopSmokePage
    ? [{ path: '/desktop-smoke', element: renderLazyPage(<DesktopSmokePage />) }]
    : []),
  {
    element: <RequireAuth />,
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
  return <RouterProvider router={router} />;
}
