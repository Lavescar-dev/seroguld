import { MakeRoot } from '@/make/root/Root';
import { useRootMakeState } from '@/make/root/useRootMakeState';

export function AppShell() {
  const state = useRootMakeState();
  return <MakeRoot {...state} />;
}
