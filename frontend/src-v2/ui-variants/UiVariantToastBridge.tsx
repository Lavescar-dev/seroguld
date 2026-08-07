import { useEffect, useRef } from 'react';

import { useToast } from '@/lib/toast';

import { useUiVariant } from './UiVariantProvider';

export function UiVariantToastBridge() {
  const toast = useToast();
  const { notice, consumeNotice } = useUiVariant();
  const shownNoticeIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!notice || shownNoticeIdRef.current === notice.id) {
      return;
    }

    shownNoticeIdRef.current = notice.id;
    const description = notice.description;
    if (notice.tone === 'success') {
      toast.success(notice.message, description);
    } else if (notice.tone === 'warning') {
      toast.warning(notice.message, description);
    } else if (notice.tone === 'error') {
      toast.error(notice.message, description);
    } else {
      toast.info(notice.message, description);
    }
    consumeNotice(notice.id);
  }, [consumeNotice, notice, toast]);

  return null;
}
