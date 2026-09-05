import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { apiRequest } from '@/lib/api';
import { setAuth } from '@/lib/auth';
import {
  deleteStoredLoginPassword,
  getBootstrapLoginPassword,
  getStoredLoginPassword,
  isTauriRuntime,
  saveStoredLoginPassword,
} from '@/lib/desktop';
import type { AuthBootstrapState, AuthTokenResponse } from '@/types';
import { getLocale, t } from '@/lib/locale';
import { useToast } from '@/lib/toast';

const DEMO_LOGIN_EMAIL = 'info@seroguld.dk';

export function useLoginMakeState() {
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState(DEMO_LOGIN_EMAIL);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [credentialWarning, setCredentialWarning] = useState<string | null>(null);
  const emailTouched = useRef(false);
  const passwordTouched = useRef(false);

  useEffect(() => {
    let active = true;

    const loadBootstrapAndCredential = async () => {
      let bootstrap: AuthBootstrapState | null = null;
      try {
        bootstrap = await apiRequest<AuthBootstrapState>('/api/auth/bootstrap-state', { auth: false });
      } catch {
        // The login form remains usable if an older backend has no bootstrap
        // endpoint yet; the packaged runtime supplies it in production.
      }

      const bootstrapEmail = bootstrap?.email?.trim() || DEMO_LOGIN_EMAIL;
      // Kimlik doğrulamasız sunucu ucu e-postayı maskeli döndürür (ör.
      // "i***@seroguld.dk"); maskeli değer login payload'ına giremez.  Tam
      // adres yalnız desktop env'de gelir ve alana kilitli olarak basılır;
      // maskeli ipucu placeholder olarak gösterilir, kullanıcı tam adresini
      // yazar.
      const maskedHint = bootstrapEmail.includes('***') ? bootstrapEmail : null;
      // The account identity comes from the backend and does not depend on
      // Credential Manager being available.  In particular, a renamed
      // bootstrap admin must remain usable even when the secure store is
      // temporarily locked; only password prefill is blocked in that case.
      if (active && !emailTouched.current) {
        setEmail(maskedHint ? '' : bootstrapEmail);
        setEmailHint(maskedHint);
      }
      let storedPassword: string | null = null;
      if (!maskedHint) {
        try {
          storedPassword = await getStoredLoginPassword(bootstrapEmail);
        } catch {
          // A locked/unavailable Credential Manager is not the same as an empty
          // entry.  Stop here so the bootstrap password is never silently
          // substituted for a credential that could not be read.
          if (active) setCredentialWarning(t('auth.remember.readFailed', getLocale()));
          return;
        }
      }
      if (!active) return;

      if (!passwordTouched.current) {
        if (storedPassword) {
          setPassword(storedPassword);
        } else if (bootstrap?.initial_login_pending) {
          const bootstrapPassword = await getBootstrapLoginPassword();
          if (active && bootstrapPassword) {
            setPassword(bootstrapPassword);
          }
        }
      }
    };

    void loadBootstrapAndCredential();
    return () => {
      active = false;
    };
  }, []);

  const loginMutation = useMutation({
    mutationFn: (payload: { email: string; password: string; remember: boolean }) =>
      apiRequest<AuthTokenResponse>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email: payload.email, password: payload.password }),
      }),
    onSuccess: async (data, variables) => {
      setCredentialWarning(null);
      let effectiveRemember = false;
      if (variables.remember && isTauriRuntime()) {
        const saved = await saveStoredLoginPassword(variables.email, variables.password);
        effectiveRemember = saved;
        if (!saved) {
          const warning = t('auth.remember.failed', getLocale());
          setCredentialWarning(warning);
          toast.warning(warning);
        }
      } else {
        const deleted = await deleteStoredLoginPassword(variables.email);
        if (!deleted && isTauriRuntime()) {
          const warning = t('auth.remember.deleteFailed', getLocale());
          setCredentialWarning(warning);
          toast.warning(warning);
        }
      }
      setAuth(data.access_token, data.refresh_token, data.user, effectiveRemember);
      navigate(data.user.must_change_password ? '/change-password' : '/dashboard', { replace: true });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitLogin();
  };

  const submitLogin = () => {
    loginMutation.mutate({ email: email.trim(), password, remember });
  };

  return {
    email,
    emailHint,
    password,
    remember,
    onEmailChange: (value: string) => {
      emailTouched.current = true;
      setEmail(value);
    },
    onPasswordChange: (value: string) => {
      passwordTouched.current = true;
      setPassword(value);
    },
    onRememberChange: setRemember,
    onSubmit: handleSubmit,
    onSubmitAction: submitLogin,
    errorMessage: loginMutation.error?.message ?? null,
    credentialWarning,
    isPending: loginMutation.isPending,
  };
}
