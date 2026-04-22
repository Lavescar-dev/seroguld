import { CustomerDisplayIdleView, CustomerDisplayLiveView } from '@/components/CustomerDisplayCanvas';
import type { PosDisplaySnapshot } from '@/types';

type MakeDisplayPageProps = {
  snapshot: PosDisplaySnapshot | null;
  connection: 'connecting' | 'live' | 'offline';
};

export function MakeDisplayPage({ snapshot, connection }: MakeDisplayPageProps) {
  if (!snapshot) {
    return <CustomerDisplayIdleView />;
  }

  return <CustomerDisplayLiveView snapshot={snapshot} connection={connection} />;
}
