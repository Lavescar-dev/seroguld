import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  Database,
  FileText,
  LayoutDashboard,
  Monitor,
  Package,
  Settings,
  HeartPulse,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Users,
} from 'lucide-react';

import { getCurrentUser } from '@/lib/auth';
import { formatRuntimeLabel } from '@/lib/runtimeInfo';
import { ModernRootShell, type ModernShellNavGroup, type ModernShellRuntimeRow } from '@/modern/shell';
import { ModernOfficeDockPanel } from '@/modern/modules/office';
import { ModernReturnAction, uiVariantTransitionRegistry } from '@/ui-variants';

import type { ReturnTypeOfRootMakeState } from './modernShellTypes';

const routeMeta: Record<string, { eyebrow: string; title: string; description: string }> = {
  '/': { eyebrow: 'Alış / POS / AFG', title: 'Yeni alış çalışma alanı', description: 'Müşteri, metal satırları, teklif, AFG ve teslim zinciri aynı gerçek workspace üzerinde.' },
  '/dashboard': { eyebrow: 'Operasyon Merkezi', title: 'Genel Bakış', description: 'Bugünün kayıtları, bekleyen işler ve entegrasyon sağlığı tek operasyon bağlamında.' },
  '/depolama': { eyebrow: 'Lager', title: 'Depolama', description: 'Stok, ürün ilişkileri ve workbook işlemleri.' },
  '/log': { eyebrow: 'AFG Defteri', title: 'Log ve melt akışı', description: 'AFG satırlarını Depolama, Kararsız ve Eritme hedeflerine yönetin.' },
  '/musteriler': { eyebrow: 'Kundedatabase', title: 'Müşteriler', description: 'Müşteri kayıtları, belge geçmişi ve hassas veri kontrolleri.' },
  '/gdpr': { eyebrow: 'Privacy', title: 'GDPR Merkezi', description: 'Talepler, retention, processor ve audit görünümü.' },
  '/opmc': { eyebrow: 'Risk', title: 'OPMC / Risk', description: 'Risk kuyruğu ve inceleme detayları.' },
  '/woocommerce': { eyebrow: 'Commerce', title: 'WooCommerce', description: 'Ürün, sipariş ve webhook operasyonları.' },
  '/uniconta': { eyebrow: 'ERP', title: 'Uniconta', description: 'Yerel kayıtlar, outbox ve uzak ERP farkları.' },
  '/musteri-ekran': { eyebrow: 'İkinci Ekran', title: 'Müşteri Ekranı', description: 'Public DTO, pencere ve canlı teklif durumu.' },
  '/settings': { eyebrow: 'Sistem', title: 'Ayarlar', description: 'Platform, entegrasyon, güvenlik ve görünüm tercihleri.' },
  '/reports': { eyebrow: 'Health', title: 'Raporlar ve Sağlık', description: 'Modül kapsamı, kontrat durumu ve doğrulama görünümü.' },
};

function activePath(pathname: string, path: string) {
  return path === '/' ? pathname === '/' : pathname.startsWith(path);
}

export function ModernAppShell({ state }: { state: ReturnTypeOfRootMakeState }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = getCurrentUser();
  const meta = routeMeta[location.pathname] ?? routeMeta['/'];

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
        label: 'Operasyon',
        items: [
          item('/dashboard', 'Genel Bakış', 'İş kutusu', LayoutDashboard),
          item('/', 'Alış / AFG', 'AFG workspace', Package, state.stats.alisList),
          item('/musteriler', 'Müşteriler', 'Kundedatabase', Users, state.stats.customerCount),
          item('/depolama', 'Depolama', 'Lager / ürün', Database, state.stats.depoCount),
          item('/log', 'Log / AFG Defteri', 'AFG → melt', FileText, state.stats.logCount),
        ],
      },
      {
        label: 'Belge ve Entegrasyon',
        items: [
          item('/uniconta', 'Uniconta', 'ERP mutabakatı', Building2),
          item('/woocommerce', 'WooCommerce', 'Web operasyonları', ShoppingCart),
          item('/opmc', 'OPMC / Risk', 'Risk izleme', ShieldAlert),
        ],
      },
      {
        label: 'Uyum ve Sistem',
        items: [
          item('/gdpr', 'GDPR Merkezi', 'Privacy merkezi', ShieldCheck),
          item('/musteri-ekran', 'Müşteri Ekranı', 'İkinci pencere', Monitor),
          item('/reports', 'Raporlar ve Sağlık', 'Export ve sağlık', HeartPulse),
          item('/settings', 'Ayarlar', 'Platform ve görünüm', Settings),
        ],
      },
    ];
  }, [location.pathname, navigate, state.stats]);

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
        { label: 'Au', value: `${state.stats.goldPrice} DKK/g`, tone: 'warning' },
        { label: 'Backend', value: state.runtime.backend ? 'Bağlı' : 'Kontrol ediliyor', tone: state.runtime.backend ? 'success' : 'info' },
      ]}
      runtimeRows={runtimeRows}
      user={{
        name: user?.name || user?.email || 'Sero Guld Operasyon',
        email: user?.name ? user?.email : undefined,
      }}
      variantSlot={<ModernReturnAction className="min-h-9 rounded-sg-md border border-sg-accent/20 bg-sg-accent-soft px-3 text-xs font-semibold text-sg-accent-dark transition hover:bg-sg-accent-soft/70" />}
    >
      {office}
      <Outlet />
    </ModernRootShell>
  );
}
