import { type FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { apiRequest } from '@/lib/api';
import { setAuth } from '@/lib/auth';
import type { AuthTokenResponse } from '@/types';

const DEMO_LOGIN_EMAIL = 'info@seroguld.dk';

export function useLoginMakeState() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      apiRequest<AuthTokenResponse>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      setAuth(data.access_token, data.refresh_token, data.user);
      navigate('/');
    },
  });

  const submitLogin = () => {
    loginMutation.mutate({ email: DEMO_LOGIN_EMAIL, password });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitLogin();
  };

  return {
    email: DEMO_LOGIN_EMAIL,
    password,
    onPasswordChange: setPassword,
    onSubmit: handleSubmit,
    onSubmitAction: submitLogin,
    errorMessage: loginMutation.error?.message ?? null,
    isPending: loginMutation.isPending,
  };
}
