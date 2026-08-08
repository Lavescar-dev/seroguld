import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, LayoutGrid, Menu, UserCircle2 } from 'lucide-react';

import {
  ModernDrawer,
  cn,
  type ModernTone,
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

export interface ModernShellRuntimeRow {
  label: string;
  value: string;
  tone?: ModernTone;
}

export interface ModernRootShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  navGroups: ModernShellNavGroup[];
  statusPills?: ModernShellStatusPill[];
  runtimeRows?: ModernShellRuntimeRow[];
  user: {
    name: string;
    email?: string;
  };
  variantSlot?: ReactNode;
  inboxSlot?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}

const toneDotClasses: Record<NonNullable<ModernShellStatusPill['tone']>, string> = {
  neutral: 'bg-sg-text-soft/50',
  primary: 'bg-sg-accent',
  success: 'bg-sg-green',
  warning: 'bg-sg-amber',
  danger: 'bg-sg-red',
  info: 'bg-sg-blue',
};

const runtimeToneDotClasses: Record<ModernTone, string> = toneDotClasses;

function BrandBlock() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-sg-md bg-sg-surface ring-1 ring-sg-border">
        <img
          src="/seroguld-logo.png"
          alt="Sero Guld"
          className="h-full w-full scale-[1.35] object-cover object-left"
        />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-bold tracking-[0.08em] text-sg-text">SERO GULD</span>
          <span className="rounded-sg-sm bg-sg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-sg-accent-dark">V1</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-sg-text-soft">Kuyumcu Operasyon ERP&apos;si</span>
      </span>
    </div>
  );
}

function NavItems({ navGroups }: { navGroups: ModernShellNavGroup[] }) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-text-soft/80">{group.label}</p>
          <div className="mt-1.5 space-y-0.5">
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onSelect}
                className={cn(
                  'flex w-full items-center justify-between rounded-sg-md px-2.5 py-2 text-left transition motion-reduce:transition-none',
                  item.active
                    ? 'bg-sg-surface-accent text-sg-accent-dark shadow-[inset_0_0_0_1px_var(--sg-accent-soft)]'
                    : 'text-sg-text hover:bg-sg-surface-soft',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className={cn('shrink-0', item.active ? 'text-sg-accent' : 'text-sg-text-soft')}>
                    {item.icon ?? <LayoutGrid className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    {item.caption ? <span className="block truncate text-xs text-sg-text-soft">{item.caption}</span> : null}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {item.badge !== undefined ? (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4',
                        item.active ? 'bg-sg-accent-soft text-sg-accent-dark' : 'bg-sg-bg-strong text-sg-text-soft',
                      )}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                  <ChevronRight className={cn('h-3.5 w-3.5', item.active ? 'text-sg-accent/60' : 'text-sg-text-soft/40')} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function RuntimeBlock({ rows }: { rows: ModernShellRuntimeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1.5 border-t border-sg-border-soft px-5 py-3.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-sg-text-soft">
            <span className={cn('h-1.5 w-1.5 rounded-full', runtimeToneDotClasses[row.tone ?? 'neutral'])} />
            {row.label}
          </span>
          <span className="truncate font-medium text-sg-text">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function StatusChip({ pill }: { pill: ModernShellStatusPill }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3 text-xs">
      <span className={cn('h-1.5 w-1.5 rounded-full', toneDotClasses[pill.tone ?? 'neutral'])} />
      <span className="text-sg-text-soft">{pill.label}</span>
      {pill.value ? <span className="font-semibold text-sg-text">{pill.value}</span> : null}
    </span>
  );
}

export function ModernRootShell({
  eyebrow,
  title,
  description,
  navGroups,
  statusPills = [],
  runtimeRows = [],
  user,
  variantSlot,
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
    <div data-ui-variant="modern" className="min-h-screen overflow-x-hidden bg-sg-bg font-sg text-sg-text">
      <div className="flex min-h-screen">
        {/* Sol sabit gezinme (V15 sidebar: 256-272px) */}
        <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-sg-border bg-sg-surface lg:flex">
          <div className="flex h-[72px] shrink-0 items-center border-b border-sg-border-soft px-5">
            <BrandBlock />
          </div>
          <NavItems navGroups={navGroups} />
          <RuntimeBlock rows={runtimeRows} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Üst bar (V15 topbar: 72px, gerçek durum çipleri) */}
          <header className="sticky top-0 z-30 flex h-[72px] shrink-0 items-center gap-3 border-b border-sg-border bg-sg-surface/95 px-4 backdrop-blur sm:px-5">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-sg-md border border-sg-border bg-sg-surface text-sg-text-soft lg:hidden"
              aria-label="Gezinmeyi aç"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              {eyebrow ? <p className="truncate text-[11px] font-medium text-sg-text-soft">{eyebrow}</p> : null}
              <p className="truncate text-sm font-semibold text-sg-text">{title}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center gap-2 md:flex">
                {statusPills.map((pill) => (
                  <StatusChip key={`${pill.label}-${pill.value ?? ''}`} pill={pill} />
                ))}
              </div>
              {variantSlot}
              <div className="flex items-center gap-2.5 rounded-sg-md border border-sg-border bg-sg-surface px-3 py-1.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sg-accent-soft text-xs font-semibold text-sg-accent-dark">
                  {userInitials || <UserCircle2 className="h-4 w-4" />}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block truncate text-sm font-medium leading-5 text-sg-text">{user.name}</span>
                  {user.email ? <span className="block truncate text-xs leading-4 text-sg-text-soft">{user.email}</span> : null}
                </span>
              </div>
            </div>
          </header>

          {/* Sayfa başlığı + içerik */}
          <div className="flex-1 px-4 py-5 sm:px-5 lg:px-6">
            <div className="mx-auto w-full max-w-[1440px]">
              <div className="mb-5 max-w-4xl">
                {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sg-accent">{eyebrow}</p> : null}
                <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] text-sg-text sm:text-[28px]">{title}</h1>
                {description ? <p className="mt-2 text-sm leading-6 text-sg-text-soft">{description}</p> : null}
              </div>

              {inboxSlot}

              <div className={cn('grid grid-cols-1 gap-5', aside ? '2xl:grid-cols-[minmax(0,1fr)_360px]' : '')}>
                <main className="min-w-0">{children}</main>
                {aside ? <aside className="min-w-0">{aside}</aside> : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ModernDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        title="Gezinme"
        description="Modül geçişleri."
      >
        <div className="mb-4">
          <BrandBlock />
        </div>
        <NavItems navGroups={navGroups} />
      </ModernDrawer>
    </div>
  );
}
