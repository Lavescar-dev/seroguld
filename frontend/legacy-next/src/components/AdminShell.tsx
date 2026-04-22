'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PropsWithChildren, useEffect, useMemo, useState } from 'react';

import { clearAuth, getAccessToken, getUser } from '@/lib/auth';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/admin', label: t('admin.dashboard') },
  { href: '/admin/pos', label: t('admin.pos') },
  { href: '/admin/afregningsbilag', label: t('admin.afregningsbilag') },
  { href: '/admin/products', label: t('admin.inventory') },
  { href: '/admin/customers', label: t('admin.customers') },
  { href: '/admin/reports', label: t('admin.reports') },
  { href: '/admin/antifraud', label: t('admin.antifraud') },
  { href: '/admin/ai', label: t('admin.ai') },
];

export function AdminShell({ children }: PropsWithChildren) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    const user = getUser();
    const token = getAccessToken();
    if (!user || user.role !== 'admin' || !token) {
      clearAuth();
      router.replace('/');
      return;
    }
    setName(user.name);
    setReady(true);
  }, [router]);

  const title = useMemo(() => {
    if (pathname === '/admin') return t('admin.dashboard');
    if (pathname.startsWith('/admin/pos')) return t('admin.pos');
    if (pathname.startsWith('/admin/afregningsbilag')) return t('admin.afregningsbilag');
    if (pathname.startsWith('/admin/products')) return t('admin.inventory');
    if (pathname.startsWith('/admin/ai')) return t('admin.ai');
    if (pathname.startsWith('/admin/customers')) return t('admin.customers');
    if (pathname.startsWith('/admin/reports')) return t('admin.reports');
    if (pathname.startsWith('/admin/antifraud')) return t('admin.antifraud');
    return 'Yönetim';
  }, [pathname]);

  function logout() {
    clearAuth();
    router.replace('/');
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-brand-700">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-brand-200 bg-brand-900 p-5 text-brand-50 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          <div className="mb-8">
            <h1 className="text-xl font-bold tracking-wide">SERO GULD CRM</h1>
            <p className="mt-2 text-sm text-brand-200">{t('admin.welcome')}, {name}</p>
          </div>

          <nav className="space-y-2 lg:flex-1 lg:overflow-y-auto">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-lg px-3 py-2 text-sm ${
                    active ? 'bg-brand-100 text-brand-900' : 'text-brand-100 hover:bg-brand-800'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Button className="mt-8 w-full" variant="ghost" onClick={logout}>
            {t('admin.logout')}
          </Button>
        </div>
      </aside>

      <main className="min-w-0 p-4 md:p-8">
        <header className="mb-6">
          <h2 className="text-2xl font-semibold text-brand-900">{title}</h2>
        </header>
        {children}
      </main>
    </div>
  );
}
