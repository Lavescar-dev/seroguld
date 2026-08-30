import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { closeCustomerDisplayWindow, isTauriRuntime } from '@/lib/desktop';

/** Rendered only inside the real fullscreen customer window, never in previews. */
export function CustomerDisplayEmergencyClose() {
  const [closing, setClosing] = useState(false);

  const close = useCallback(async () => {
    if (closing) return;
    setClosing(true);
    const state = await closeCustomerDisplayWindow();
    if (!state) setClosing(false);
  }, [closing]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  if (!isTauriRuntime()) return null;

  return (
    <div className="group fixed right-0 top-0 z-critical p-4">
      <button
        type="button"
        onClick={() => void close()}
        disabled={closing}
        className="inline-flex items-center gap-2 rounded-md border border-white/45 bg-slate-950/75 px-3 py-2 text-sm font-semibold text-white opacity-0 shadow-lg backdrop-blur transition-opacity focus:opacity-100 group-hover:opacity-100 disabled:cursor-wait"
        title="Müşteri ekranını kapat (Esc)"
        aria-label="Müşteri ekranını kapat"
      >
        <X className="h-4 w-4" />
        {closing ? 'Kapatılıyor...' : 'Ekranı kapat'}
      </button>
    </div>
  );
}
