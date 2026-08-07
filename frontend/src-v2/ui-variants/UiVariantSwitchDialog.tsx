import { useEffect, useRef } from 'react';

import { useConfirm } from '@/components/ConfirmDialog';

import { useUiVariant } from './UiVariantProvider';

export function UiVariantSwitchDialog() {
  const confirm = useConfirm();
  const { pendingRequest, confirmRequestedChange, cancelRequestedChange } = useUiVariant();
  const activeRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!pendingRequest || activeRequestIdRef.current === pendingRequest.id) {
      return;
    }

    let closed = false;
    activeRequestIdRef.current = pendingRequest.id;

    void (async () => {
      const confirmed = await confirm({
        title: pendingRequest.copy.title,
        message: pendingRequest.copy.message,
        confirmText: pendingRequest.copy.confirmText,
        cancelText: pendingRequest.copy.cancelText,
      });

      if (closed) return;
      if (confirmed) {
        await confirmRequestedChange();
      } else {
        cancelRequestedChange();
      }
      activeRequestIdRef.current = null;
    })();

    return () => {
      closed = true;
    };
  }, [cancelRequestedChange, confirm, confirmRequestedChange, pendingRequest]);

  return null;
}
