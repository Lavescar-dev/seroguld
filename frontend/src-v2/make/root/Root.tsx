import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  Building2,
  Database,
  DatabaseZap,
  FileText,
  Keyboard,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Moon,
  Package,
  Settings,
  ShieldCheck,
  ShieldAlert,
  ShoppingCart,
  Sun,
  Users,
  X,
} from 'lucide-react';

import { closeOfficeDock } from '@/lib/officeDock';
import { formatRuntimeDateTime, formatRuntimeLabel } from '@/lib/runtimeInfo';
import { OfficeDockPanel } from '@/make/office/OfficeDockPanel';
import { GlobalMarketRatesDrawer, toTopbarValue, useGlobalMarketRates } from '@/components/GlobalMarketRatesDrawer';
import { LanguageSelector } from '@/i18n';
import { LegacyMigrationCenter } from '@/components/LegacyMigrationCenter';
import { SessionLogoutControl } from '@/components/SessionLogoutControl';

import type { OfficeDockState, RuntimeDiagnosticsState, SidebarStats } from './useRootMakeState';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;

type MakeRootProps = {
  stats: SidebarStats;
  runtime: RuntimeDiagnosticsState;
  officeDock: OfficeDockState;
  sidebarOpen: boolean;
  darkMode: boolean;
  onOpenSidebar: () => void;
  onCloseSidebar: () => void;
  onToggleDarkMode: () => void;
  onCloseOfficeDock: () => void;
  onResizeOfficeDock: (nextWidth: number) => void;
};

function buildFeedbackMailto(locationHref: string, pathname: string, runtime: RuntimeDiagnosticsState): string {
  const email = import.meta.env.VITE_FEEDBACK_EMAIL?.trim() || 'info@seroguld.dk';
  const channel = import.meta.env.VITE_FEEDBACK_CHANNEL?.trim() || 'desktop-feedback';
  const subject = `Sero Guld CRM feedback - ${pathname || '/'}`;
  const body = [
    'Not:',
    '',
    '',
    '---',
    `Kanal: ${channel}`,
    `Ekran: ${locationHref}`,
    `API: ${runtime.frontend.api_base_url}`,
    `Frontend: ${formatRuntimeLabel(runtime.frontend.frontend_mode)} / ${runtime.frontend.frontend_built_at}`,
    `Desktop: ${runtime.desktop ? formatRuntimeLabel(runtime.desktop.runtime_mode) : 'Web / Yok'}`,
    `Tarih: ${new Date().toISOString()}`,
  ].join('\n');

  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function MakeRoot({
  stats,
  runtime,
  officeDock,
  sidebarOpen,
  darkMode,
  onOpenSidebar,
  onCloseSidebar,
  onToggleDarkMode,
  onCloseOfficeDock,
  onResizeOfficeDock,
}: MakeRootProps) {
  const location = useLocation();
  const [migrationOpen, setMigrationOpen] = useState(false);
  const globalMarketRates = useGlobalMarketRates();
  const isResizingDockRef = useRef(false);
  // Modern kabukla parite: açık Office belgesi sayfa değişiminde kapanmaz;
  // dock kullanıcı "Kapat" diyene kadar her rotada görünür kalır.
  const hasOfficeDock = Boolean(officeDock.document);

  useEffect(() => {
    if (!hasOfficeDock) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingDockRef.current) return;
      const nextWidth = window.innerWidth - event.clientX;
      onResizeOfficeDock(nextWidth);
    };
    const stopResize = () => {
      if (!isResizingDockRef.current) return;
      isResizingDockRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResize);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResize);
      stopResize();
    };
  }, [hasOfficeDock, onResizeOfficeDock]);

  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return false;
  };

  const openFeedback = () => {
    window.location.href = buildFeedbackMailto(window.location.href, location.pathname, runtime);
  };

  const getHoverData = (to: string, currentStats: SidebarStats): Array<{ label: string; value: string; color?: string }> => {
    switch (to) {
      case '/dashboard':
        return [
          { label: 'Toplam Alış', value: `${currentStats.alisList} kayıt`, color: 'text-amber-400' },
          { label: 'Depo Stok', value: `${currentStats.depoCount} ürün`, color: 'text-emerald-400' },
          { label: 'Log Kayıt', value: `${currentStats.logCount} adet`, color: 'text-blue-400' },
          { label: 'Müşteri', value: `${currentStats.customerCount} kişi`, color: 'text-purple-400' },
        ];
      case '/':
        return [
          { label: 'Toplam Alış', value: `${currentStats.alisList} kayıt`, color: 'text-amber-400' },
          { label: 'Au Fiyat', value: `${currentStats.goldPrice} DKK/g`, color: 'text-amber-300' },
          { label: 'Ag Fiyat', value: `${currentStats.silverPrice} DKK/g`, color: 'text-slate-300' },
          { label: 'Kısayol', value: 'Ctrl+N / Ctrl+S', color: 'text-brand-400' },
        ];
      case '/depolama':
        return [
          { label: 'Stok Adet', value: `${currentStats.depoCount} ürün`, color: 'text-emerald-400' },
          ...(currentStats.finguld > 0
            ? [{ label: 'Finguld', value: `${currentStats.finguld.toFixed(1)} g`, color: 'text-amber-400' }]
            : []),
          ...(currentStats.finsolv > 0
            ? [{ label: 'Finsolv', value: `${currentStats.finsolv.toFixed(1)} g`, color: 'text-slate-300' }]
            : []),
        ];
      case '/log':
        return [
          { label: 'Log Kayıt', value: `${currentStats.logCount} adet`, color: 'text-blue-400' },
          ...(currentStats.ayirmaCount > 0
            ? [{ label: 'Ayırma', value: `${currentStats.ayirmaCount} adet`, color: 'text-cyan-400' }]
            : []),
          ...(currentStats.eritmeCount > 0
            ? [{ label: 'Eritme', value: `${currentStats.eritmeCount} lot`, color: 'text-orange-400' }]
            : []),
        ];
      case '/musteriler':
        return [{ label: 'Toplam Müşteri', value: `${currentStats.customerCount} kişi`, color: 'text-purple-400' }];
      case '/gdpr':
        return [
          { label: 'Privacy', value: 'CRM cockpit', color: 'text-emerald-400' },
          { label: 'Retention', value: 'Policies', color: 'text-amber-300' },
          { label: 'Public', value: 'WP bridge', color: 'text-sky-300' },
        ];
      default:
        return [];
    }
  };

  const navItem = (
    to: string,
    icon: ReactNode,
    label: string,
    sublabel: string,
    badge?: number | string,
    badgeColor?: string,
  ) => {
    const active = isActive(to) && (to !== '/' || location.pathname === '/');
    const hoverData = getHoverData(to, stats);

    return (
      <div className="group/nav relative">
        <Link
          to={to}
          className={`group flex items-center justify-between border-b border-brand-200 px-3 py-2 transition-all duration-150 ${
            active
              ? 'border-l-[4px] border-l-amber-600 bg-amber-50'
              : 'border-l-[4px] border-l-transparent hover:border-l-amber-300 hover:bg-white'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`flex-shrink-0 transition-transform duration-150 group-hover/nav:scale-110 ${
                active ? 'text-amber-700' : 'text-brand-500 group-hover:text-amber-700'
              }`}
            >
              {icon}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className={`truncate text-[13px] font-bold ${active ? 'text-brand-950' : 'text-brand-700'}`} style={monoStyle}>
                {label}
              </span>
              <span className="truncate text-[10px] uppercase tracking-widest text-brand-500">{sublabel}</span>
            </div>
          </div>
          {badge !== undefined && badge !== 0 ? (
            <span
              className={`ml-2 flex-shrink-0 border border-brand-200 px-1.5 py-0.5 text-xs font-black transition-transform duration-150 group-hover/nav:scale-105 ${
                badgeColor || 'bg-white text-brand-700'
              }`}
              style={monoStyle}
            >
              {badge}
            </span>
          ) : null}
        </Link>
        {hoverData.length > 0 ? (
          <div
            className="pointer-events-none absolute left-full top-0 z-[60] ml-1 hidden w-52 border border-brand-200 bg-white opacity-0 shadow-xl transition-all duration-200 group-hover/nav:pointer-events-auto group-hover/nav:opacity-100 lg:block"
            style={monoStyle}
          >
            <div className="flex items-center gap-2 border-b border-brand-200 bg-amber-50 px-3 py-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-800">{label}</span>
            </div>
            <div className="space-y-1 px-3 py-2">
              {hoverData.map((item) => (
                <div key={`${to}-${item.label}`} className="flex items-center justify-between">
                  <span className="text-[10px] text-brand-500">{item.label}</span>
                  <span className={`text-[11px] font-black ${item.color || 'text-brand-700'}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between border-b-2 border-brand-200 bg-white px-4 py-4 lg:justify-center">
        <div className="flex flex-col items-center gap-2">
          <img src="/seroguld-logo.png" alt="Sero Guld" className="h-9 w-auto" />
          <span className="text-[10px] font-black uppercase tracking-widest text-brand-500" style={monoStyle}>
            CRM
          </span>
        </div>
        <button onClick={onCloseSidebar} className="p-1 text-brand-500 hover:text-brand-950 lg:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>

      <button type="button" onClick={globalMarketRates.open} className="flex w-full divide-x divide-brand-200 border-b border-brand-200 bg-[#fbfaf6] text-xs transition hover:bg-white" aria-label="Global piyasa oranlarını düzenle">
        <div className="flex flex-1 flex-col items-center justify-center px-2 py-1.5">
          <span className="mb-0.5 text-[10px] font-bold text-amber-500">Au</span>
          <span className="font-black text-brand-900" style={monoStyle}>
            {toTopbarValue(globalMarketRates.profile.gold_24k_dkk)}
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-2 py-1.5">
          <span className="mb-0.5 text-[10px] font-bold text-slate-400">Ag</span>
          <span className="font-black text-brand-900" style={monoStyle}>
            {toTopbarValue(globalMarketRates.profile.silver_dkk)}
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-2 py-1.5">
          <span className="mb-0.5 text-[10px] font-bold text-zinc-400">Pt</span>
          <span className="font-black text-brand-900" style={monoStyle}>
            {toTopbarValue(globalMarketRates.profile.platinum_dkk)}
          </span>
        </div>
      </button>

      <nav className="custom-scrollbar flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <div className="px-3 pb-1 pt-3">
          <p className="mb-1 border-b border-brand-200 pb-1 text-[10px] font-black uppercase tracking-widest text-brand-500">
            Moduller
          </p>
        </div>
        {navItem('/dashboard', <LayoutDashboard className="h-4 w-4" />, 'Dashboard', 'Genel Bakis')}
        {navItem('/', <Package className="h-4 w-4" />, 'Alis', 'Afregningsbilag', stats.alisList, 'border-amber-200 bg-amber-100 text-amber-800')}
        {navItem('/depolama', <Database className="h-4 w-4" />, 'Depolama', 'Lager / Envanter', stats.depoCount)}
        {navItem('/log', <FileText className="h-4 w-4" />, 'Log Sistemi', 'AFG -> Eritme akisi', stats.logCount)}
        {navItem('/musteriler', <Users className="h-4 w-4" />, 'Musteriler', 'Kundedatabase', stats.customerCount)}
        {navItem('/gdpr', <ShieldCheck className="h-4 w-4" />, 'GDPR', 'Retention & Privacy')}

        <div className="px-3 pb-1 pt-4">
          <p className="mb-1 border-b border-brand-200 pb-1 text-[10px] font-black uppercase tracking-widest text-brand-500">
            Entegrasyonlar
          </p>
        </div>
        {navItem('/opmc', <ShieldAlert className="h-4 w-4" />, 'OPMC Izleme', 'Yapim asamasinda', 'YAPIM', 'border-amber-300 bg-amber-100 text-amber-800')}
        {navItem('/woocommerce', <ShoppingCart className="h-4 w-4" />, 'WooCommerce', 'Urun Export & SEO')}
        {navItem('/uniconta', <Building2 className="h-4 w-4" />, 'Uniconta', 'Fatura & ERP')}

        <div className="px-3 pb-1 pt-4">
          <p className="mb-1 border-b border-brand-200 pb-1 text-[10px] font-black uppercase tracking-widest text-brand-500">
            Harici & Sistem
          </p>
        </div>
        {navItem('/settings', <Settings className="h-4 w-4" />, 'Ayarlar', 'API & Sistem Ayarlari')}

        <div className="mt-auto space-y-3 px-3 pb-2 pt-6">
          {stats.finguld > 0 || stats.finsolv > 0 ? (
            <div className="overflow-hidden rounded-sm border border-brand-200 bg-white">
              <div className="border-b border-brand-200 bg-brand-50 px-2 py-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Depo Ozeti</p>
              </div>
              <div className="space-y-1 p-2">
                {stats.finguld > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-500">Finguld</span>
                    <span className="text-xs font-black text-amber-400" style={monoStyle}>
                      {stats.finguld.toFixed(2)} g
                    </span>
                  </div>
                ) : null}
                {stats.finsolv > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">Finsolv</span>
                    <span className="text-xs font-black text-slate-400" style={monoStyle}>
                      {stats.finsolv.toFixed(2)} g
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {stats.ayirmaCount > 0 || stats.eritmeCount > 0 ? (
            <div className="overflow-hidden rounded-sm border border-brand-200 bg-white">
              <div className="border-b border-brand-200 bg-brand-50 px-2 py-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Log Ozeti</p>
              </div>
              <div className="space-y-1 p-2">
                {stats.ayirmaCount > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-brand-600">Ayristirma</span>
                    <span className="text-xs font-black text-brand-800" style={monoStyle}>
                      {stats.ayirmaCount}
                    </span>
                  </div>
                ) : null}
                {stats.eritmeCount > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-orange-500">Eritme Lotu</span>
                    <span className="text-xs font-black text-orange-400" style={monoStyle}>
                      {stats.eritmeCount}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-sm border border-brand-200 bg-white">
            <div className="border-b border-brand-200 bg-brand-50 px-2 py-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Runtime</p>
            </div>
            <div className="space-y-1.5 p-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-widest text-brand-500">Frontend</span>
                <span className="text-right text-[11px] font-black text-brand-800" style={monoStyle}>
                  {formatRuntimeLabel(runtime.frontend.frontend_mode)}
                </span>
              </div>
              <div className="text-[10px] text-brand-500" style={monoStyle}>
                {formatRuntimeDateTime(runtime.frontend.frontend_built_at)}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-widest text-brand-500">Desktop</span>
                <span className="text-right text-[11px] font-black text-brand-800" style={monoStyle}>
                  {runtime.desktop ? formatRuntimeLabel(runtime.desktop.runtime_mode) : 'Web / Yok'}
                </span>
              </div>
              <div className="text-[10px] text-brand-500" style={monoStyle}>
                {runtime.desktop?.binary_mtime_unix_ms
                  ? formatRuntimeDateTime(runtime.desktop.binary_mtime_unix_ms)
                  : 'Binary zamanı yok'}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-widest text-brand-500">Backend</span>
                <span className="text-right text-[11px] font-black text-brand-800" style={monoStyle}>
                  {runtime.backend ? formatRuntimeDateTime(runtime.backend.backend_started_at) : 'Yok'}
                </span>
              </div>
              <div className="text-[10px] text-brand-500" style={monoStyle}>
                {runtime.backend?.desktop_session
                  ? `${formatRuntimeLabel(runtime.backend.desktop_session.mode)} · 3300/8100`
                  : runtime.desktop?.runtime_mode === 'embedded-app'
                    ? 'VPS backend / embedded app'
                    : 'desktop-dev session yok'}
              </div>
              {runtime.warnings.length > 0 ? (
                <div className="space-y-1 border-t border-amber-200 pt-2">
                  {runtime.warnings.map((warning) => (
                    <p key={warning} className="text-[10px] leading-4 text-amber-700">
                      {warning}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="border-t border-brand-200 pt-2 text-[10px] leading-4 text-emerald-700">
                  Runtime zinciri tutarlı görünüyor.
                </p>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="flex items-center justify-between border-t border-brand-200 bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-brand-500">Sero Guld</p>
          <LanguageSelector className="text-brand-600" />
          <button
            onClick={openFeedback}
            className="p-1 text-brand-500 transition-colors hover:text-emerald-700"
            title="Geri Bildirim"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
          <SessionLogoutControl variant="classic" />
          <button
            onClick={onToggleDarkMode}
            className="p-1 text-brand-500 transition-colors hover:text-amber-700"
            title={darkMode ? 'Açık Tema' : 'Koyu Tema'}
          >
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="hidden border border-brand-200 bg-brand-50 px-1 py-0.5 text-[9px] text-brand-600 lg:inline"
            style={monoStyle}
            title="Ctrl+N: Yeni Alış | Ctrl+S: Kaydet"
          >
            <Keyboard className="mr-0.5 inline h-2.5 w-2.5" />
            KB
          </span>
          <p className="text-[10px] text-brand-500" style={monoStyle}>
            {new Date().toLocaleDateString(document.documentElement.lang, { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </p>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#f4efe7]">
      {sidebarOpen ? <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onCloseSidebar} /> : null}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-[260px] flex-shrink-0 transform overflow-hidden border-r-2 border-brand-200 bg-[#f8f3eb] text-brand-900 transition-transform duration-200 ease-in-out lg:static
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{ minHeight: '100vh' }}
      >
        <div className="flex h-full min-w-0 flex-col overflow-hidden">{sidebarContent}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center justify-between border-b-2 border-brand-200 bg-white px-3 py-2 lg:hidden">
          <button onClick={onOpenSidebar} className="p-1 text-brand-600 hover:text-brand-950">
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-center">
            <span className="block text-sm font-black uppercase tracking-[0.15em]" style={{ ...monoStyle, color: '#6f5233' }}>
              SEROGULD
            </span>
            <span className="block text-[9px] uppercase tracking-[0.22em] text-brand-500" style={monoStyle}>
              ERP SYSTEM
            </span>
          </div>
          <button type="button" onClick={globalMarketRates.open} className="flex items-center gap-2 text-[10px]" style={monoStyle} aria-label="Global piyasa oranlarını düzenle">
            <span className="font-black text-amber-500">Au</span>
            <span className="font-black text-brand-800">{toTopbarValue(globalMarketRates.profile.gold_24k_dkk)}</span>
            <span className="font-black text-slate-500">Ag {toTopbarValue(globalMarketRates.profile.silver_dkk)}</span>
          </button>
        </div>

        <div className="min-h-0 flex flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f4efe7]">
            <Outlet />
            {location.pathname === '/depolama' || location.pathname === '/log' ? (
              <>
                <button type="button" onClick={() => setMigrationOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 border border-amber-700 bg-brand-950 px-4 py-3 text-xs font-black uppercase tracking-wider text-white shadow-xl hover:bg-brand-800">
                  <DatabaseZap className="h-4 w-4" /> Eski sistemi taşı
                </button>
                <LegacyMigrationCenter open={migrationOpen} onClose={() => setMigrationOpen(false)} initialPhase={location.pathname === '/log' ? 'log' : 'inventory'} />
              </>
            ) : null}
          </main>
          {hasOfficeDock && officeDock.document ? (
            <aside
              className="relative hidden h-full flex-shrink-0 border-l-2 border-brand-300 bg-stone-100 shadow-[-12px_0_30px_rgba(30,41,59,0.08)] lg:block"
              style={{ width: `${officeDock.widthPx}px` }}
            >
              <button
                type="button"
                aria-label="Office dock genisligini ayarla"
                onMouseDown={() => {
                  isResizingDockRef.current = true;
                  document.body.style.cursor = 'col-resize';
                  document.body.style.userSelect = 'none';
                }}
                className="absolute left-0 top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize bg-transparent"
              />
              <OfficeDockPanel document={officeDock.document} onClose={onCloseOfficeDock} />
            </aside>
          ) : null}
      </div>
      <GlobalMarketRatesDrawer controller={globalMarketRates} variant="classic" />
    </div>

      {hasOfficeDock && officeDock.document ? (
        <div className="fixed inset-0 z-[70] bg-black/45 lg:hidden">
          <button
            type="button"
            aria-label="Office dock kapat"
            className="absolute inset-0"
            onClick={() => {
              closeOfficeDock();
              onCloseOfficeDock();
            }}
          />
          <div className="absolute inset-y-0 right-0 z-10 w-full max-w-[92vw] overflow-hidden border-l-2 border-brand-300 bg-stone-100 shadow-2xl">
            <OfficeDockPanel document={officeDock.document} onClose={onCloseOfficeDock} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
