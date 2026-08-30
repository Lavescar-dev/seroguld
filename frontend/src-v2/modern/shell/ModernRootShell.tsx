import { useState, type ReactNode } from 'react';
import { ChevronRight, LayoutGrid, Menu } from 'lucide-react';

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
  onSelect?: () => void;
  ariaLabel?: string;
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
    <div className="flex w-full flex-col items-center justify-center gap-1.5">
      <img src="/seroguld-logo.png" alt="Sero Guld" className="h-9 w-auto object-contain" />
      <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-sg-text-soft">CRM</span>
    </div>
  );
}

function NavItems({ navGroups }: { navGroups: ModernShellNavGroup[] }) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
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
  const content = (
    <>
      <span className={cn('h-1.5 w-1.5 rounded-full', toneDotClasses[pill.tone ?? 'neutral'])} />
      <span className="text-sg-text-soft">{pill.label}</span>
      {pill.value ? <span className="font-semibold text-sg-text">{pill.value}</span> : null}
    </>
  );
  if (pill.onSelect) {
    return <button type="button" onClick={pill.onSelect} aria-label={pill.ariaLabel || `${pill.label} düzenle`} className="inline-flex min-h-8 items-center gap-2 rounded-sg-sm border-0 bg-transparent px-2.5 text-xs transition hover:bg-sg-surface-soft">{content}</button>;
  }
  return <span className="inline-flex min-h-8 items-center gap-2 rounded-sg-sm border-0 bg-transparent px-2.5 text-xs">{content}</span>;
}

export function ModernRootShell({
  eyebrow,
  title,
  description,
  navGroups,
  statusPills = [],
  runtimeRows = [],
  variantSlot,
  inboxSlot,
  aside,
  children,
}: ModernRootShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div data-ui-variant="modern" className="h-dvh min-h-0 overflow-hidden bg-sg-bg font-sg text-sg-text">
      <div className="flex h-full min-h-0">
        {/* Sol sabit gezinme (V15 sidebar: 256-272px) */}
        <aside className="hidden h-dvh min-h-0 w-[264px] shrink-0 flex-col border-r border-sg-border bg-sg-surface lg:flex">
          <div className="flex h-[72px] shrink-0 items-center border-b-2 border-sg-accent/15 bg-sg-surface px-5">
            <BrandBlock />
          </div>
          <NavItems navGroups={navGroups} />
          <RuntimeBlock rows={runtimeRows} />
        </aside>

        <div className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col">
          {/* Üst bar: rota kimliği, operasyon durumu ve oturum araçları */}
          <header className="sticky top-0 z-header flex h-[76px] shrink-0 items-center gap-3 border-b border-sg-border bg-sg-surface/95 px-4 shadow-[0_1px_0_rgba(15,23,42,0.02)] backdrop-blur sm:px-5">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-sg-md border border-sg-border bg-sg-surface text-sg-text-soft lg:hidden"
              aria-label="Gezinmeyi aç"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 items-center gap-3">
              <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-sg-lg border border-sg-accent/15 bg-sg-accent-soft text-sg-accent sm:flex">
                <LayoutGrid className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                {eyebrow ? <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-sg-accent">{eyebrow}</p> : null}
                <p className="mt-0.5 truncate text-[15px] font-bold tracking-[-0.01em] text-sg-text">{title}</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden h-10 items-center gap-1 rounded-sg-md border border-sg-border bg-sg-surface px-1 shadow-sm md:flex">
                {statusPills.map((pill) => (
                  <StatusChip key={`${pill.label}-${pill.value ?? ''}`} pill={pill} />
                ))}
              </div>
              {variantSlot}
            </div>
          </header>

          {/* Sayfa başlığı + içerik */}
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-5 lg:px-6">
            <div className="w-full min-w-0">
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
