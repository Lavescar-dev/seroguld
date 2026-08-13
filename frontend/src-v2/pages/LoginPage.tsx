import { MakeLoginPage } from '@/make/login/LoginPage';
import { useLoginMakeState } from '@/make/login/useLoginMakeState';
import { ModernLoginPage } from '@/modern/pages';
import { useUiVariant } from '@/ui-variants';
import { LanguageSelector } from '@/i18n';

export function LoginPage() {
  const state = useLoginMakeState();
  const { variant } = useUiVariant();
  const page = variant === 'modern' ? (
    <ModernLoginPage
      runtime={[
        { label: 'Frontend', value: __SERO_FRONTEND_MODE__, tone: 'info' },
        { label: 'Build', value: __SERO_FRONTEND_BUILT_AT__, tone: 'neutral' },
      ]}
      form={{
        email: state.email,
        password: state.password,
        remember: state.remember,
        isSubmitting: state.isPending,
        errorMessage: state.errorMessage,
        credentialWarning: state.credentialWarning,
        onPasswordChange: state.onPasswordChange,
        onRememberChange: state.onRememberChange,
        onSubmit: state.onSubmitAction,
      }}
    />
  ) : <MakeLoginPage {...state} />;
  return <><div className="fixed right-4 top-4 z-[90] rounded border border-brand-200 bg-white/95 p-1 shadow-sm"><LanguageSelector className="text-brand-700" /></div>{page}</>;
}
