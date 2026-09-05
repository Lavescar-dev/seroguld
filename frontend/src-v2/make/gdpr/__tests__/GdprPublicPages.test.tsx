import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.fn();
vi.mock('@/lib/api', () => ({
  apiRequest: (path: string, options?: unknown) => apiRequestMock(path, options),
  localizeApiError: (e: unknown) => String(e),
  downloadAuthedDocument: vi.fn(),
}));

import { GdprPublicRequestPage, GdprPublicRequestStatusPage } from '../GdprPublicPages';

const SITE_CONFIG = {
  company_name: 'Sero Guld',
  company_email: 'info@seroguld.dk',
  company_phone: null,
  company_address: null,
  company_cvr: null,
  website_url: null,
  wordpress_url: null,
  privacy_email: 'privacy@seroguld.dk',
  privacy_request_url: 'https://seroguld.dk/gdpr/request',
  privacy_policy_url: 'https://seroguld.dk/gdpr/privacy',
  cookies_url: 'https://seroguld.dk/gdpr/cookies',
};

const REQUEST_STATUS = {
  reference_number: 'GDPR-2026-0009',
  request_type: 'access_export',
  status: 'identity_pending',
  submitted_at: '2026-09-01T10:00:00Z',
  due_at: '2026-09-08T10:00:00Z',
  completed_at: null,
  last_message: 'Talebiniz alındı.',
};

function renderTracking() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/gdpr/request/token-1']}>
        <Routes>
          <Route path="/gdpr/request/:token" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(<GdprPublicRequestStatusPage />, { wrapper: Wrapper });
}

describe('GdprPublicRequestStatusPage etiket haritası', () => {
  it('ham enum yerine okunur etiket gösterir', async () => {
    apiRequestMock.mockImplementation(async (url: string) => {
      if (String(url).includes('site-config')) return SITE_CONFIG;
      if (String(url).includes('/request/')) return REQUEST_STATUS;
      throw new Error(`unexpected url: ${url}`);
    });

    renderTracking();

    await waitFor(() => expect(screen.getByText('Erişim / Export')).toBeInTheDocument());
    expect(screen.getByText('Kimlik doğrulaması bekliyor')).toBeInTheDocument();
    // Ham enum değerleri metin olarak sızmasın.
    expect(screen.queryByText('access_export')).not.toBeInTheDocument();
    expect(screen.queryByText('identity_pending')).not.toBeInTheDocument();
  });
});

describe('GdprPublicRequestPage rıza ve takip linki', () => {
  it('rıza kutusu varsayılan işaretsiz ve zorunlu; işaretleyince submit gönderilir', async () => {
    apiRequestMock.mockImplementation(async (url: string, options?: { body?: string; method?: string }) => {
      if (String(url).includes('site-config')) return SITE_CONFIG;
      if (String(url).endsWith('/request') && options?.method === 'POST') {
        return { reference_number: 'GDPR-2026-0100', tracking_token: 'tok-100', status: 'identity_pending', due_at: '2026-10-05T10:00:00Z' };
      }
      throw new Error(`unexpected call: ${url}`);
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    render(<GdprPublicRequestPage />, { wrapper: Wrapper });

    const consent = await screen.findByRole('checkbox');
    // Rıza varsayılan kapalı ve zorunlu — backend de alanı zorunlu bekliyor.
    expect(consent).not.toBeChecked();
    expect(consent).toBeRequired();

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Test Kişi' } });

    // Rıza işaretlenince form gönderilir ve success'te form gizlenir.
    // (Test ortamında t() anahtarın kendisini döndürür; regex iki hali de yakalar.)
    fireEvent.click(consent);
    fireEvent.click(screen.getByRole('button', { name: /request\.submit|Talep oluştur/ }));
    await waitFor(() => expect(screen.getByText('GDPR-2026-0100')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /request\.submit|Talep oluştur/ })).not.toBeInTheDocument();
    // Takip linkini kopyalama yolu sunulur.
    expect(screen.getByRole('button', { name: 'Takip linkini kopyala' })).toBeInTheDocument();
  });
});
