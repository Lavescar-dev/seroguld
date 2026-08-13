import { useSettingsMakeState } from '@/make/settings/useSettingsMakeState';
import { UiVariantSettingsCards, useUiVariant } from '@/ui-variants';
import { CustomerDisplayMonitorSettings } from '@/components/CustomerDisplayMonitorSettings';
import { LanguagePreferencePanel } from '@/i18n';
import { SettingsWorkspace } from '@/components/SettingsWorkspace';

export function SettingsPage() {
  const state = useSettingsMakeState();
  const { variant } = useUiVariant();
  return (
    <SettingsWorkspace
      {...state}
      variant={variant}
      uiVariantSlot={<UiVariantSettingsCards />}
      languageSlot={<LanguagePreferencePanel variant={variant} />}
      monitorSlot={<CustomerDisplayMonitorSettings variant={variant} />}
    />
  );
}
