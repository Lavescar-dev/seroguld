import { MakeSettingsPage } from '@/make/settings/SettingsPage';
import { useSettingsMakeState } from '@/make/settings/useSettingsMakeState';

export function SettingsPage() {
  const state = useSettingsMakeState();
  return <MakeSettingsPage {...state} />;
}
