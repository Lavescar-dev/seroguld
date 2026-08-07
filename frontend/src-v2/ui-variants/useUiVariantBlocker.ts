import { useEffect } from 'react';

import { uiVariantTransitionRegistry } from './runtime';

export function useUiVariantBlocker(
  blocker: { id: string; reasons: string[] } | null | undefined,
) {
  const reason = blocker?.reasons.join(' ') || '';

  useEffect(() => {
    if (!blocker || !reason) return;
    return uiVariantTransitionRegistry.register({
      id: blocker.id,
      evaluate: () => ({ status: 'blocked', reason }),
    });
  }, [blocker?.id, reason]);
}
