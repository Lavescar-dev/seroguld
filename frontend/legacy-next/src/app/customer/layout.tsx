'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { clearAuth, getUser } from '@/lib/auth';
import { t } from '@/i18n';

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const user = getUser();
    if (!user || user.role !== 'customer') {
      router.replace('/');
    }
  }, [router]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-brand-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <div className="font-semibold text-brand-900">{t('customer.portal')}</div>
          <nav className="flex items-center gap-3 text-sm text-brand-700">
            <Link href="/customer">{t('customer.overview')}</Link>
            <Link href="/customer/products">{t('customer.products')}</Link>
            <Button
              variant="ghost"
              onClick={() => {
                clearAuth();
                router.replace('/');
              }}
            >
              {t('admin.logout')}
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
