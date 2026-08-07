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
import { OfficeDockPanel } from '@/make/office/OfficeDockPanel';
import { ModernRootShell, type ModernShellNavGroup } from '@/modern/shell';
import { ModernReturnAction, uiVariantTransitionRegistry } from '@/ui-variants';

import type { ReturnTypeOfRootMakeState } from './modernShellTypes';

const routeMeta: Record<string, { eyebrow: string; title: string; description: string }> = {
  '/': { eyebrow: 'Alış / POS / AFG', title: 'Yeni alış çalışma alanı', description: 'Müşteri, metal satırları, teklif, AFG ve teslim zinciri aynı gerçek workspace üzerinde.' },
  '/dashboard': { eyebrow: 'İş Kutusu', title: 'Operasyon merkezi', description: 'Bugünün kayıtları, bekleyen işler ve entegrasyon sağlığı.' },
  '/depolama': { eyebrow: 'Lager', title: 'Depolama ve ürünler', description: 'Stok, ürün ilişkileri ve workbook işlemleri.' },
  '/log': { eyebrow: 'AFG Defteri', title: 'Log ve melt akışı', description: 'AFG satırlarını Depolama, Kararsız ve Eritme hedeflerine yönetin.' },
  '/musteriler': { eyebrow: 'Kundedatabase', title: 'Müşteriler', description: 'Müşteri kayıtları, belge geçmişi ve hassas veri kontrolleri.' },
  '/gdpr': { eyebrow: 'Privacy', title: 'GDPR merkezi', description: 'Talepler, retention, processor ve audit görünümü.' },
  '/opmc': { eyebrow: 'Risk', title: 'OPMC izleme', description: 'Risk kuyruğu ve inceleme detayları.' },
  '/woocommerce': { eyebrow: 'Commerce', title: 'WooCommerce / WordPress', description: 'Ürün, sipariş ve webhook operasyonları.' },
  '/uniconta': { eyebrow: 'ERP', title: 'Uniconta mutabakatı', description: 'Yerel kayıtlar, outbox ve uzak ERP farkları.' },
  '/musteri-ekran': { eyebrow: 'İkinci Ekran', title: 'Müşteri ekranı kontrolü', description: 'Public DTO, pencere ve canlı teklif durumu.' },
  '/settings': { eyebrow: 'Sistem', title: 'Ayarlar', description: 'Platform, entegrasyon, güvenlik ve görünüm tercihleri.' },
  '/reports': { eyebrow: 'Health', title: 'Raporlar ve sistem sağlığı', description: 'Modül kapsamı, kontrat durumu ve doğrulama görünümü.' },
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
          item('/dashboard', 'Dashboard', 'İş kutusu', LayoutDashboard),
          item('/', 'Alış', 'AFG workspace', Package, state.stats.alisList),
          item('/depolama', 'Depolama', 'Lager / ürün', Database, state.stats.depoCount),
          item('/log', 'Log', 'AFG → melt', FileText, state.stats.logCount),
          item('/musteriler', 'Müşteriler', 'Kundedatabase', Users, state.stats.customerCount),
          item('/gdpr', 'GDPR', 'Privacy merkezi', ShieldCheck),
        ],
      },
      {
        label: 'Entegrasyonlar',
        items: [
          item('/opmc', 'OPMC', 'Risk izleme', ShieldAlert),
          item('/woocommerce', 'WooCommerce', 'Web operasyonları', ShoppingCart),
          item('/uniconta', 'Uniconta', 'ERP mutabakatı', Building2),
        ],
      },
      {
        label: 'Sistem',
        items: [
          item('/musteri-ekran', 'Müşteri ekranı', 'İkinci pencere', Monitor),
          item('/settings', 'Ayarlar', 'Platform ve görünüm', Settings),
          item('/reports', 'Raporlar', 'Export ve sağlık', HeartPulse),
        ],
      },
    ];
  }, [location.pathname, navigate, state.stats]);

  const office = state.officeDock.document ? (
    <section className="mb-4 h-[min(72vh,760px)] min-h-[480px] overflow-hidden rounded-[28px] border border-sky-200 bg-white shadow-xl shadow-slate-200/60">
      <OfficeDockPanel document={state.officeDock.document} onClose={state.onCloseOfficeDock} />
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
        { label: 'API', value: state.runtime.backend ? 'Bağlı' : 'Kontrol ediliyor', tone: state.runtime.backend ? 'success' : 'info' },
      ]}
      user={{
        name: user?.name || user?.email || 'Sero Guld Operasyon',
        email: user?.email,
        location: 'København',
      }}
      variantSlot={<ModernReturnAction className="min-h-11 rounded-2xl border border-sky-200 bg-sky-50 px-4 text-xs font-semibold text-sky-800 transition hover:bg-sky-100" />}
    >
      {office}
      <Outlet />
    </ModernRootShell>
  );
}
