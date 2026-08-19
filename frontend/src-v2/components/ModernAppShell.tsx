import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  Database,
  FileText,
  LayoutDashboard,
  Package,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Users,
} from 'lucide-react';

import { formatRuntimeLabel } from '@/lib/runtimeInfo';
import { ModernRootShell, type ModernShellNavGroup, type ModernShellRuntimeRow } from '@/modern/shell';
import { ModernOfficeDockPanel } from '@/modern/modules/office';
import { ModernReturnAction, uiVariantTransitionRegistry } from '@/ui-variants';
import { GlobalMarketRatesDrawer, toTopbarValue, useGlobalMarketRates } from './GlobalMarketRatesDrawer';
import { LanguageSelector } from '@/i18n';
import { useAppTranslation } from '@/i18n';
import { SessionLogoutControl } from '@/components/SessionLogoutControl';

import type { ReturnTypeOfRootMakeState } from './modernShellTypes';

const routeMeta: Record<string, { eyebrow: string; title: string; description: string }> = {
  '/': { eyebrow: 'Alış / POS / AFG', title: 'Yeni alış çalışma alanı', description: 'Müşteri, metal satırları, teklif ve AFG belgesi tek ekranda.' },
  '/dashboard': { eyebrow: 'Operasyon Merkezi', title: 'Genel Bakış', description: 'Bugünün kayıtları, bekleyen işler ve entegrasyon sağlığı tek operasyon bağlamında.' },
  '/depolama': { eyebrow: 'Lager', title: 'Depolama', description: 'Stok, ürün ilişkileri ve workbook işlemleri.' },
  '/log': { eyebrow: 'AFG Defteri', title: 'Log ve melt akışı', description: 'AFG satırlarını Depolama, Kararsız ve Eritme hedeflerine yönetin.' },
  '/musteriler': { eyebrow: 'Kundedatabase', title: 'Müşteriler', description: 'Müşteri kayıtları, belge geçmişi ve hassas veri kontrolleri.' },
  '/gdpr': { eyebrow: 'Privacy', title: 'GDPR Merkezi', description: 'Talepler, retention, processor ve audit görünümü.' },
  '/opmc': { eyebrow: 'Risk', title: 'OPMC / Risk', description: 'İncelemeye açık risk çalışma alanı; kurallar ve karar akışları geliştirilmektedir.' },
  '/woocommerce': { eyebrow: 'Commerce', title: 'WooCommerce', description: 'Ürün, sipariş ve webhook operasyonları.' },
  '/uniconta': { eyebrow: 'ERP', title: 'Uniconta', description: 'Yerel kayıtlar, outbox ve uzak ERP farkları.' },
  '/settings': { eyebrow: 'Sistem', title: 'Ayarlar', description: 'Platform, entegrasyon, güvenlik ve görünüm tercihleri.' },
};

export function resolveRouteMeta(pathname: string) {
  const exact = routeMeta[pathname];
  if (exact) return exact;

  const parentPath = Object.keys(routeMeta)
    .filter((path) => path !== '/' && pathname.startsWith(`${path}/`))
    .sort((left, right) => right.length - left.length)[0];
  return routeMeta[parentPath ?? '/'];
}

function activePath(pathname: string, path: string) {
  return path === '/' ? pathname === '/' : pathname.startsWith(path);
}

export function ModernAppShell({ state }: { state: ReturnTypeOfRootMakeState }) {
  const location = useLocation();
  const navigate = useNavigate();
  const meta = resolveRouteMeta(location.pathname);
  const marketRates = useGlobalMarketRates();
  const { t } = useAppTranslation();

  useEffect(() => {
    const openMarketRates = () => marketRates.open();
    window.addEventListener('seroguld:open-market-rates', openMarketRates);
    return () => window.removeEventListener('seroguld:open-market-rates', openMarketRates);
  }, [marketRates.open]);

  useEffect(() => {
    if (!state.officeDock.document) return;
    return uiVariantTransitionRegistry.register({
      id: 'embedded-office-dock',
      evaluate: () => ({
        status: 'blocked',
        reason: 'Açık Office belgesinin kaydetme durumu doğrulanmadan arayüz değiştirilemez.',
      }),
    });
  }, [state.officeDock.document]);

  const navGroups = useMemo<ModernShellNavGroup[]>(() => {
    const item = (path: string, label: string, caption: string, Icon: typeof Package, badge?: number) => ({
      key: path,
      label,
      caption,
      icon: <Icon className="h-4 w-4" />,
      badge: badge || undefined,
      active: activePath(location.pathname, path),
      onSelect: () => navigate(path),
    });
    return [
      {
        label: t('navigation.operations'),
        items: [
          item('/dashboard', t('navigation.dashboard'), 'İş kutusu', LayoutDashboard),
          item('/', t('navigation.purchase'), 'AFG workspace', Package, state.stats.alisList),
          item('/musteriler', t('navigation.customers'), 'Kundedatabase', Users, state.stats.customerCount),
          item('/depolama', t('navigation.inventory'), 'Lager / ürün', Database, state.stats.depoCount),
          item('/log', 'Log / AFG Defteri', 'AFG → melt', FileText, state.stats.logCount),
        ],
      },
      {
        label: t('navigation.documents'),
        items: [
          item('/uniconta', 'Uniconta', 'ERP mutabakatı', Building2),
          item('/woocommerce', 'WooCommerce', 'Web operasyonları', ShoppingCart),
          item('/opmc', 'OPMC / Risk', 'Yapım aşamasında', ShieldAlert),
        ],
      },
      {
        label: t('navigation.compliance'),
        items: [
          item('/gdpr', 'GDPR Merkezi', 'Privacy merkezi', ShieldCheck),
          item('/settings', t('navigation.settings'), 'Platform ve görünüm', Settings),
        ],
      },
    ];
  }, [location.pathname, navigate, state.stats, t]);

  const runtimeRows = useMemo<ModernShellRuntimeRow[]>(() => {
    const rows: ModernShellRuntimeRow[] = [];
    const runtimeMode = state.runtime.desktop?.runtime_mode;
    rows.push({
      label: 'Runtime',
      value: runtimeMode ? formatRuntimeLabel(runtimeMode) : 'Web',
      tone: 'success',
    });
    if (state.runtime.backend) {
      rows.push({
        label: 'Backend',
        value: state.runtime.backend.env,
        tone: 'primary',
      });
    }
    rows.push({
      label: 'Frontend',
      value: formatRuntimeLabel(state.runtime.frontend.frontend_mode),
      tone: 'neutral',
    });
    return rows;
  }, [state.runtime]);

  const office = state.officeDock.document ? (
    <section className="relative mb-5 min-h-0 overflow-visible">
      <ModernOfficeDockPanel document={state.officeDock.document} onClose={state.onCloseOfficeDock} />
    </section>
  ) : null;

  return (
    <ModernRootShell
      eyebrow={meta.eyebrow}
      title={meta.title}
      description={meta.description}
      navGroups={navGroups}
      statusPills={[
        { label: 'Au / Ag', value: `24K ${toTopbarValue(marketRates.profile.gold_24k_dkk)} · 999 ${toTopbarValue(marketRates.profile.silver_dkk)} DKK/g`, tone: 'warning', onSelect: marketRates.open, ariaLabel: 'Altın ve gümüş piyasa oranlarını düzenle' },
        { label: 'Backend', value: state.runtime.backend ? 'Bağlı' : 'Kontrol ediliyor', tone: state.runtime.backend ? 'success' : 'info' },
      ]}
      runtimeRows={runtimeRows}
      variantSlot={<div className="flex h-10 items-center rounded-sg-md border border-sg-border bg-sg-surface px-1 shadow-sm"><LanguageSelector className="text-sg-text [&_select]:!min-h-8 [&_select]:!rounded-sg-sm [&_select]:!border-0 [&_select]:!bg-transparent [&_select]:!px-2.5 [&_select]:focus:!bg-sg-surface-soft" /><span className="mx-1 h-5 w-px bg-sg-border" aria-hidden="true" /><ModernReturnAction className="min-h-8 rounded-sg-sm border-0 bg-transparent px-2.5 text-xs font-semibold text-sg-accent-dark transition hover:bg-sg-accent-soft" /><SessionLogoutControl variant="modern" /></div>}
    >
      <GlobalMarketRatesDrawer controller={marketRates} variant="modern" />
      {office}
      <Outlet />
    </ModernRootShell>
  );
}
