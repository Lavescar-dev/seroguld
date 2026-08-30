import { ChevronDown, ChevronUp, Repeat2, UsersRound } from 'lucide-react';

// R2-takip: seçili müşteri artık sağ kolonda dev bir blok (özet şeridi + tam
// tablo) olarak alt alta açılmaz. Kompakt bar + "Başka müşteri seç" aksiyonu;
// düzenlenebilir tablo yalnız istenince genişler.
export function SelectedCustomerBar({
  name,
  phone,
  detailsOpen,
  onToggleDetails,
  onReplace,
}: {
  name: string;
  phone?: string;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onReplace: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-200 bg-emerald-50 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-emerald-300 bg-white text-emerald-700">
          <UsersRound className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-black uppercase tracking-wide text-brand-900">{name}</p>
          <p className="mono truncate text-[11px] text-brand-500">{phone ? `Tlf. ${phone}` : 'Telefon yok'}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleDetails}
          className="inline-flex items-center gap-1.5 whitespace-nowrap border border-brand-300 bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-50"
        >
          {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {detailsOpen ? 'Bilgileri kapat' : 'Bilgileri aç'}
        </button>
        <button
          type="button"
          onClick={onReplace}
          className="inline-flex items-center gap-1.5 whitespace-nowrap border border-brand-900 bg-brand-800 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white transition hover:bg-brand-900"
        >
          <Repeat2 className="h-3.5 w-3.5" />
          Başka müşteri seç
        </button>
      </div>
    </div>
  );
}
