import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.fn();
vi.mock('@/lib/api', () => ({
  apiRequest: (path: string, options?: unknown) => apiRequestMock(path, options),
  localizeApiError: (e: unknown) => String(e),
  downloadAuthedDocument: vi.fn(),
}));

import { GdprPublicRequestStatusPage } from '../GdprPublicPages';

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
