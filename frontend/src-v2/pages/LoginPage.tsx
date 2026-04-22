import { MakeLoginPage } from '@/make/login/LoginPage';
import { useLoginMakeState } from '@/make/login/useLoginMakeState';

export function LoginPage() {
  const state = useLoginMakeState();
  return <MakeLoginPage {...state} />;
}
