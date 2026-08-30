import { useEffect } from 'react';
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import { X } from 'lucide-react';
// Vite asset import — PDF.js worker'ı uygulamayla aynı origin'den servis et
// (CDN engellenebilir, Tauri CSP'si script-src 'self' http://127.0.0.1:* izinli).
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

type PdfViewerModalProps = {
  open: boolean;
  pdfUrl: string | null;
  filename?: string;
  title?: string;
  onClose: () => void;
};

export function PdfViewerModal({ open, pdfUrl, filename, title, onClose }: PdfViewerModalProps) {
  const layoutPlugin = defaultLayoutPlugin();

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || !pdfUrl) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-4 print:hidden">
      <div className="relative flex h-full w-full max-w-6xl flex-col border border-brand-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-2.5">
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-sm font-black uppercase tracking-widest text-brand-800">
              {title || 'PDF Görüntüleyici'}
            </p>
            {filename ? (
              <p className="mono truncate text-[10px] text-brand-500">{filename}</p>
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
          <Worker workerUrl={pdfWorkerUrl}>
            <Viewer fileUrl={pdfUrl} plugins={[layoutPlugin]} />
          </Worker>
        </div>
      </div>
    </div>
  );
}
