import { DepolamaPage as MakeDepolamaPage } from '@/make/depolama/DepolamaPage';
import { useDepolamaMakeState } from '@/make/depolama/useDepolamaMakeState';

export function InventoryPage() {
  const depolamaState = useDepolamaMakeState();
  return <MakeDepolamaPage {...depolamaState} />;
}
