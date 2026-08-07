import { useMemo, useState, type ReactNode } from 'react';
import {
  Bell,
  ChevronRight,
  LayoutGrid,
  Menu,
  Search,
  Sparkles,
  UserCircle2,
} from 'lucide-react';

import {
  ModernBadge,
  ModernButton,
  ModernDrawer,
  ModernSection,
  cn,
} from '@/modern/design-system';

export interface ModernShellNavItem {
  key: string;
  label: string;
  caption?: string;
  icon?: ReactNode;
  badge?: string | number;
  active?: boolean;
  onSelect?: () => void;
}

export interface ModernShellNavGroup {
  label: string;
  items: ModernShellNavItem[];
}

export interface ModernShellStatusPill {
  label: string;
  value?: string;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

export interface ModernRootShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  navGroups: ModernShellNavGroup[];
  statusPills?: ModernShellStatusPill[];
  user: {
    name: string;
    email?: string;
    location?: string;
  };
  variantSlot?: ReactNode;
  commandSlot?: ReactNode;
  inboxSlot?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}

function NavContent({ navGroups }: { navGroups: ModernShellNavGroup[] }) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-[28px] bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.14),_transparent_42%),linear-gradient(180deg,#ffffff,#eff6ff)] p-5 shadow-[0_24px_64px_-42px_rgba(14,116,144,0.45)] ring-1 ring-sky-100">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[20px] bg-sky-600 text-white shadow-lg shadow-sky-200">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">Yeni Sero Guld</p>
            <p className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950">Operasyon yüzeyi</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Aynı veri ve iş akışları üzerinde daha sakin, yoğun ve görünür bir masaüstü katmanı.
        </p>
      </div>
      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{group.label}</p>
            <div className="mt-2 space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onSelect}
                  className={cn(
                    'flex w-full items-center justify-between rounded-[20px] px-3 py-3 text-left transition motion-reduce:transition-none',
                    item.active ? 'bg-sky-50 text-sky-900 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.18)]' : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className={cn('flex h-10 w-10 items-center justify-center rounded-2xl border', item.active ? 'border-sky-200 bg-white text-sky-700' : 'border-slate-200 bg-white text-slate-500')}>
                      {item.icon ?? <LayoutGrid className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.label}</span>
                      {item.caption ? <span className="block truncate text-xs text-slate-500">{item.caption}</span> : null}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {item.badge !== undefined ? (
                      <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', item.active ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-600')}>
                        {item.badge}
                      </span>
                    ) : null}
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

export function ModernRootShell({
  eyebrow,
  title,
  description,
  navGroups,
  statusPills = [],
  user,
  variantSlot,
  commandSlot,
  inboxSlot,
  aside,
  children,
}: ModernRootShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const userInitials = useMemo(
    () =>
      user.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join(''),
    [user.name],
  );

  return (
    <div
      data-ui-variant="modern"
      className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef4fb_50%,#f8fafc_100%)] text-slate-900"
    >
      <div className="mx-auto grid min-h-screen w-full max-w-[1680px] grid-cols-1 gap-4 px-3 py-3 lg:grid-cols-[280px_minmax(0,1fr)] xl:px-4">
        <aside className="hidden min-h-0 lg:block">
          <div className="sticky top-3 h-[calc(100vh-1.5rem)] overflow-hidden rounded-[32px] border border-white/60 bg-white/78 p-4 shadow-[0_36px_80px_-48px_rgba(15,23,42,0.35)] backdrop-blur">
            <NavContent navGroups={navGroups} />
          </div>
        </aside>
        <div className="flex min-h-0 flex-col gap-4">
          <ModernSection className="rounded-[32px] border-white/70 bg-white/78 shadow-[0_28px_80px_-56px_rgba(15,23,42,0.4)] backdrop-blur">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <ModernButton tone="ghost" size="sm" icon={Menu} onClick={() => setNavOpen(true)} className="lg:hidden">
                  Menü
                </ModernButton>
                {commandSlot ?? (
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-left text-sm text-slate-500"
                  >
                    <Search className="h-4 w-4 text-slate-400" />
                    <span className="truncate">Müşteri, AFG, ürün veya görev ara…</span>
                    <kbd className="ml-auto rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500">Ctrl K</kbd>
                  </button>
                )}
                {variantSlot}
                <button type="button" className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
                  <Bell className="h-4 w-4" />
                  <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-teal-500" />
                </button>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                    {userInitials || <UserCircle2 className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{user.name}</span>
                    <span className="block truncate text-xs text-slate-500">{user.location || user.email || 'Operasyon kullanıcısı'}</span>
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-4xl">
                  {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">{eyebrow}</p> : null}
                  <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">{title}</h1>
                  {description ? <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {statusPills.map((pill) => (
                    <ModernBadge key={`${pill.label}-${pill.value ?? ''}`} tone={pill.tone || 'neutral'}>
                      <span>{pill.label}</span>
                      {pill.value ? <strong className="font-semibold">{pill.value}</strong> : null}
                    </ModernBadge>
                  ))}
                </div>
              </div>
            </div>
          </ModernSection>

          {inboxSlot}

          <div className={cn('grid min-h-0 grid-cols-1 gap-4', aside ? '2xl:grid-cols-[minmax(0,1fr)_360px]' : '')}>
            <main className="min-w-0">{children}</main>
            {aside ? <aside className="min-w-0">{aside}</aside> : null}
          </div>
        </div>
      </div>

      <ModernDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        title="Gezinme"
        description="Modern önizleme yüzeyi içinde modül geçişleri."
      >
        <NavContent navGroups={navGroups} />
      </ModernDrawer>
    </div>
  );
}
