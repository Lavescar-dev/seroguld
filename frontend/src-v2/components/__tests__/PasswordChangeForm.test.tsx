import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PasswordChangeForm, generateSecurePassword } from '../PasswordChangeForm';
import { setLocale, t, type Locale } from '@/lib/locale';

const apiRequest = vi.fn();
const saveStoredLoginPassword = vi.fn();
const deleteStoredLoginPassword = vi.fn();
const setAuth = vi.fn();
let remembered = true;

vi.mock('@/lib/api', () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => ({ email: 'info@seroguld.dk' }),
  isAuthRemembered: () => remembered,
  setAuth: (...args: unknown[]) => setAuth(...args),
}));
vi.mock('@/lib/desktop', () => ({
  saveStoredLoginPassword: (...args: unknown[]) => saveStoredLoginPassword(...args),
  deleteStoredLoginPassword: (...args: unknown[]) => deleteStoredLoginPassword(...args),
}));

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PasswordChangeForm />
    </QueryClientProvider>,
  );
}

describe('generateSecurePassword', () => {
  it('uses Web Crypto and returns 20 characters from all required classes', () => {
    let value = 0;
    const cryptoSource = {
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        const bytes = array as unknown as Uint8Array;
        bytes[0] = value % 128;
        value += 17;
        return array;
      },
    } as Pick<Crypto, 'getRandomValues'>;

    const password = generateSecurePassword(cryptoSource);

    expect(password).toHaveLength(20);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@#$%&*+\-=?]/);
  });
});

describe('PasswordChangeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remembered = true;
    setLocale('tr');
    saveStoredLoginPassword.mockResolvedValue(true);
    apiRequest.mockResolvedValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      user: { email: 'info@seroguld.dk', must_change_password: false },
    });
  });

  it('generates and fills the same 20-character password into both fields', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: t('auth.password.generate', 'tr') }));

    const generated = screen.getByLabelText(t('auth.password.new', 'tr')) as HTMLInputElement;
    const confirmation = screen.getByLabelText(t('auth.password.confirm', 'tr')) as HTMLInputElement;
    expect(generated.value).toHaveLength(20);
    expect(confirmation.value).toBe(generated.value);
  });

  it('changes password, updates Credential Manager and replaces session tokens', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(t('auth.password.current', 'tr')), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText(t('auth.password.new', 'tr')), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText(t('auth.password.confirm', 'tr')), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth.password.saveSettings', 'tr') }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/auth/change-password', expect.objectContaining({ method: 'POST' })));
    const request = apiRequest.mock.calls[0][1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({
      current_password: 'old-password',
      new_password: 'new-password',
      new_password_confirmation: 'new-password',
    });
    expect(saveStoredLoginPassword).toHaveBeenCalledWith('info@seroguld.dk', 'new-password');
    expect(setAuth).toHaveBeenCalledWith('new-access', 'new-refresh', expect.objectContaining({ email: 'info@seroguld.dk' }), true);
    expect(saveStoredLoginPassword.mock.invocationCallOrder[0]).toBeLessThan(setAuth.mock.invocationCallOrder[0]);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('new-password');
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('new-password');
    expect(screen.getByText(t('auth.password.changed', 'tr'))).toBeInTheDocument();
  });

  it('removes a stale device credential when remember me is disabled', async () => {
    remembered = false;
    deleteStoredLoginPassword.mockResolvedValue(true);
    renderForm();
    fireEvent.change(screen.getByLabelText(t('auth.password.current', 'tr')), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText(t('auth.password.new', 'tr')), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText(t('auth.password.confirm', 'tr')), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: t('auth.password.saveSettings', 'tr') }));

    await waitFor(() => expect(deleteStoredLoginPassword).toHaveBeenCalledWith('info@seroguld.dk'));
    expect(saveStoredLoginPassword).not.toHaveBeenCalled();
    expect(setAuth).toHaveBeenCalledWith('new-access', 'new-refresh', expect.any(Object), false);
  });

  it.each(['tr', 'en', 'da'] as Locale[])('renders localized security labels in %s', (locale) => {
    setLocale(locale);
    renderForm();

    expect(screen.getByLabelText(t('auth.password.current', locale))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('auth.password.generate', locale) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('auth.password.saveSettings', locale) })).toBeInTheDocument();
  });
});
