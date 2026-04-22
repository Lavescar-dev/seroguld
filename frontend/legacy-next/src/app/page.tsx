'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';
import { getAccessToken, getUser, setAuth } from '@/lib/auth';
import { t } from '@/i18n';
import { TokenResponse } from '@/types';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('admin@seroguld.dk');
  const [password, setPassword] = useState('Admin123!');

  useEffect(() => {
    const user = getUser();
    const token = getAccessToken();
    if (!token) return;
    if (user?.role === 'admin') {
      router.replace('/admin');
    } else if (user?.role === 'customer') {
      router.replace('/customer');
    }
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = await apiRequest<TokenResponse>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email, password }),
      });
      setAuth(payload.access_token, payload.refresh_token, payload.user);
      if (payload.user.role === 'admin') {
        router.replace('/admin');
      } else {
        router.replace('/customer');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş başarısız');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-2xl font-bold text-brand-900">{t('auth.login.title')}</h1>
        <p className="mt-1 text-sm text-brand-700">{t('auth.login.subtitle')}</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-brand-700">{t('auth.login.email')}</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-brand-700">{t('auth.login.password')}</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('auth.login.loading') : t('auth.login.submit')}
          </Button>
        </form>
      </div>
    </main>
  );
}
