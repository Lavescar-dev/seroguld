import { MakeSettingsPage } from '@/make/settings/SettingsPage';
import { useSettingsMakeState } from '@/make/settings/useSettingsMakeState';
import { ModernSettingsPage } from '@/modern/pages';
import { UiVariantSettingsCards, useUiVariant } from '@/ui-variants';

export function SettingsPage() {
  const state = useSettingsMakeState();
  const { variant } = useUiVariant();
  if (variant === 'classic') {
    return (
      <div>
        <div className="border-b border-brand-200 bg-white px-6 py-5">
          <UiVariantSettingsCards />
        </div>
        <MakeSettingsPage {...state} />
      </div>
    );
  }

  return (
    <ModernSettingsPage
      config={state.config}
      runtime={state.apiStatus.map((item) => ({ label: item.name, value: item.ok ? 'Yapılandırıldı' : 'Eksik', tone: item.ok ? 'success' : 'warning' }))}
      secretFieldKeys={['openai_api_key', 'opmc_api_key', 'opmc_webhook_secret', 'woo_consumer_key', 'woo_consumer_secret', 'woo_webhook_secret', 'wp_app_password', 'uniconta_password', 'uniconta_api_key']}
      uiVariantSlot={<UiVariantSettingsCards />}
      onFieldChange={state.onUpdate}
      onSave={state.onSave}
      isSaving={state.isSaving}
      savedLabel={state.saved ? 'Kaydedildi' : undefined}
      saveAvailability={{ state: 'available' }}
    />
  );
}
