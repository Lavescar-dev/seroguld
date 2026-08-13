import { CustomerDisplayIdleView, CustomerDisplayLiveView } from '@/components/CustomerDisplayCanvas';
import { CustomerDisplayEmergencyClose } from '@/components/CustomerDisplayEmergencyClose';
import type { PosDisplaySnapshot } from '@/types';

type MakeDisplayPageProps = {
  snapshot: PosDisplaySnapshot | null;
  connection: 'connecting' | 'live' | 'offline';
};

export function MakeDisplayPage({ snapshot, connection }: MakeDisplayPageProps) {
  return (
    <>
      {snapshot ? <CustomerDisplayLiveView snapshot={snapshot} connection={connection} /> : <CustomerDisplayIdleView />}
      <CustomerDisplayEmergencyClose />
    </>
  );
}
