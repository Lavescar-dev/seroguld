import { useEffect } from 'react';
import { X } from 'lucide-react';

type HtmlDocumentModalProps = {
  open: boolean;
  html: string | null;
  title?: string;
  subtitle?: string;
  onClose: () => void;
};

/// R2-13 — HTML belgeleri Tauri webview'ı içinde görüntülemek için.
/// `window.open` Tauri'de sessizce yutulduğu için belge modal içindeki
/// iframe'de render edilir. sandbox script'leri engeller; statik belge
/// HTML'i (AFG fişi/belgesi) yalnızca stil içerir.
export function HtmlDocumentModal({ open, html, title, subtitle, onClose }: HtmlDocumentModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || !html) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-4 print:hidden">
      <div className="relative flex h-full w-full max-w-6xl flex-col border border-brand-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-2.5">
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-sm font-black uppercase tracking-widest text-brand-800">
              {title || 'Belge Görüntüleyici'}
            </p>
            {subtitle ? (
              <p className="mono truncate text-[10px] text-brand-500">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 border border-brand-300 bg-white px-3 py-1.5 text-xs font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100"
          >
            <X className="h-3.5 w-3.5" />
            Kapat (Esc)
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden bg-neutral-100">
          <iframe
            title={title || 'Belge'}
            srcDoc={html}
            sandbox=""
            className="h-full w-full border-0 bg-white"
          />
        </div>
      </div>
    </div>
  );
}
