import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MakeLoginPage } from '../LoginPage';
import { ModernLoginPage } from '@/modern/pages/ModernLoginPage';

function classicProps(overrides: Partial<React.ComponentProps<typeof MakeLoginPage>> = {}) {
  return {
    email: 'info@seroguld.dk',
    password: '',
    onPasswordChange: vi.fn(),
    onSubmit: vi.fn(),
    errorMessage: null,
    isPending: false,
    ...overrides,
  };
}

function modernProps(overrides: Partial<React.ComponentProps<typeof ModernLoginPage>> = {}) {
  return {
    runtime: [
      { label: 'Frontend', value: 'vite-dev', tone: 'info' as const },
      { label: 'Build', value: '2026-08-10T02:27:26.352Z', tone: 'neutral' as const },
    ],
    form: {
      email: 'info@seroguld.dk',
      password: '',
      isSubmitting: false,
      errorMessage: null,
      onPasswordChange: vi.fn(),
      onSubmit: vi.fn(),
    },
    ...overrides,
  };
}

describe('login surfaces', () => {
  it('keeps the classic login bright and makes password visibility and submit real', () => {
    const props = classicProps();
    render(<MakeLoginPage {...props} />);

    expect(screen.getByRole('heading', { name: 'Operasyon paneline giriş' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('info@seroguld.dk')).toHaveAttribute('readonly');
    const password = screen.getByLabelText('Şifre');
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Şifreyi göster' }));
    expect(password).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Şifreyi gizle' }));
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.submit(screen.getByRole('button', { name: /Giriş Yap/ }).closest('form')!);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps modern login compact and removes fake dashboard affordances', () => {
    const props = modernProps();
    render(<ModernLoginPage {...props} />);

    expect(screen.getByRole('heading', { name: 'Masaüstü girişi' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('info@seroguld.dk')).toHaveAttribute('readonly');
    expect(screen.getByText(/Frontend: vite-dev/)).toBeInTheDocument();
    expect(screen.queryByText('V1 başlangıç çerçevesi')).not.toBeInTheDocument();
    expect(screen.queryByText('Bu cihazda oturumu koru')).not.toBeInTheDocument();

    const password = screen.getByLabelText('Şifre');
    fireEvent.click(screen.getByRole('button', { name: 'Şifreyi göster' }));
    expect(password).toHaveAttribute('type', 'text');
    fireEvent.submit(screen.getByRole('button', { name: /Giriş Yap/ }).closest('form')!);
    expect(props.form.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('exposes login errors and disables the modern action while submitting', () => {
    const props = modernProps({
      form: {
        ...modernProps().form,
        isSubmitting: true,
        errorMessage: 'Şifre geçersiz.',
      },
    });
    render(<ModernLoginPage {...props} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Şifre geçersiz.');
    expect(screen.getByLabelText('Şifre')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: /Giriş yapılıyor/ })).toBeDisabled();
  });
});
