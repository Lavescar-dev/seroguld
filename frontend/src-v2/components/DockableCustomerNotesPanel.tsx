import { useState } from 'react';
import { ChevronDown, StickyNote, X } from 'lucide-react';

import { CustomerNotesPanel } from '@/components/CustomerNotesPanel';

type DockableCustomerNotesPanelProps = {
  customerId: string;
  customerName: string;
  manage?: boolean;
};

export function DockableCustomerNotesPanel({ customerId, customerName, manage = false }: DockableCustomerNotesPanelProps) {
  // Roadmap madde 1: panel sağ alttaki değer/afregning sheet editörlerinin ve
  // PDF hata toast'ının ÜZERİNE biniyordu (fixed overlay). Varsayılan kapalı
  // başlar — tek tıkla açılır, çalışan editörü kapatmaz.
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-dropdown inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-[0_14px_40px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:border-amber-400 hover:bg-amber-50"
        aria-label={`${customerName} için müşteri notlarını aç`}
      >
        <StickyNote className="h-4 w-4 text-amber-600" />
        Müşteri notları
      </button>
    );
  }

  return (
    <aside className="fixed bottom-5 right-5 z-dropdown w-[min(430px,calc(100vw-2rem))]" aria-label={`${customerName} müşteri notları`}>
      <div className="mb-1 flex items-center justify-end gap-1 rounded-t-xl border border-b-0 border-amber-300 bg-amber-50/95 px-2 py-1.5 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white hover:text-slate-950"
          title="Paneli aşağı indir"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          Küçült
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-50 hover:text-red-600"
          title="Paneli kapat"
          aria-label="Müşteri notları panelini kapat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[min(68vh,620px)] overflow-auto rounded-b-xl [&>div]:!static [&>div]:!w-full [&>div]:!max-w-none">
        <CustomerNotesPanel customerId={customerId} customerName={customerName} manage={manage} dock />
      </div>
    </aside>
  );
}
