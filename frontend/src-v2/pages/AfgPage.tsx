import { LogPage } from '@/make/log/LogPage';
import { useLogMakeState } from '@/make/log/useLogMakeState';

export function AfgPage() {
  const state = useLogMakeState();
  return <LogPage {...state} />;
}
