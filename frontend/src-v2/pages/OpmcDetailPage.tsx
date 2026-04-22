import { MakeOpmcDetailPage } from '@/make/opmc/OpmcDetailPage';
import { useOpmcDetailMakeState } from '@/make/opmc/useOpmcDetailMakeState';

export function OpmcDetailPage() {
  const state = useOpmcDetailMakeState();
  return <MakeOpmcDetailPage {...state} />;
}
