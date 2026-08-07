import { MakeLoginPage } from '@/make/login/LoginPage';
import { useLoginMakeState } from '@/make/login/useLoginMakeState';
import { ModernLoginPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';

export function LoginPage() {
  const state = useLoginMakeState();
  const { variant } = useUiVariant();
  return variant === 'modern' ? (
    <ModernLoginPage
      runtime={[
        { label: 'Frontend', value: __SERO_FRONTEND_MODE__, tone: 'info' },
        { label: 'Build', value: __SERO_FRONTEND_BUILT_AT__, tone: 'neutral' },
        { label: 'Oturum', value: 'Tek operasyon kullanıcısı', tone: 'success' },
      ]}
      form={{
        email: state.email,
        password: state.password,
        remember: true,
        isSubmitting: state.isPending,
        errorMessage: state.errorMessage,
        onPasswordChange: state.onPasswordChange,
        onSubmit: state.onSubmitAction,
      }}
    />
  ) : <MakeLoginPage {...state} />;
}
