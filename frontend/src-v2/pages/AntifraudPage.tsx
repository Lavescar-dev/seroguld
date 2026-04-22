import { MakeOpmcPage } from '@/make/opmc/OpmcPage';
import { useOpmcMakeState } from '@/make/opmc/useOpmcMakeState';

export function AntifraudPage() {
  const state = useOpmcMakeState();
  return <MakeOpmcPage {...state} />;
}
