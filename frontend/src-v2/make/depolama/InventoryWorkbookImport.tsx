import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, Upload, X } from 'lucide-react';

import { apiRequest } from '@/lib/api';
import { isTauriRuntime, pickDocumentImportFile } from '@/lib/desktop';
import type { DocumentArtifactReconcilePreview } from '@/types';

type InventoryWorkbookImportProps = {
  variant: 'classic' | 'modern';
};

type ImportStatus = {
  tone: 'error' | 'success';
  message: string;
};

function fileFromPickedImport(fileName: string, dataBase64: string): File {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, {
    type: fileName.toLowerCase().endsWith('.xlsm')
      ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function readImportError(error: unknown): string {
  if (!(error instanceof Error) || !error.message) return 'Depolama Excel importu tamamlanamadı.';
  try {
    const parsed = JSON.parse(error.message) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (parsed.detail && typeof parsed.detail === 'object' && 'message' in parsed.detail) {
      return String(parsed.detail.message);
    }
  } catch {
    // apiRequest hata metni zaten kullanıcıya gösterilebilir olabilir.
  }
  return error.message;
}

export function InventoryWorkbookImport({ variant }: InventoryWorkbookImportProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<DocumentArtifactReconcilePreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  async function previewFile(file: File) {
    const extension = file.name.toLowerCase().split('.').pop();
    if (extension !== 'xlsx' && extension !== 'xlsm') {
      setStatus({ tone: 'error', message: 'Yalnızca .xlsx veya .xlsm Depolama çalışma kitabı seçilebilir.' });
      return;
    }

    setBusy(true);
    setStatus(null);
    setFileName(file.name);
    setPendingFile(file);
    try {
      const formData = new FormData();
      formData.append('workbook', file);
      const result = await apiRequest<DocumentArtifactReconcilePreview>('/api/v2/depolama/workbook/reconcile-preview', {
        method: 'POST',
        body: formData,
      });
      setPreview(result);
    } catch (error) {
      setPreview(null);
      setStatus({ tone: 'error', message: readImportError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile() {
    if (busy) return;
    setStatus(null);
    if (isTauriRuntime()) {
      try {
        const picked = await pickDocumentImportFile();
        if (picked) await previewFile(fileFromPickedImport(picked.file_name, picked.data_base64));
      } catch (error) {
        setStatus({ tone: 'error', message: readImportError(error) });
      }
      return;
    }
    inputRef.current?.click();
  }

  async function applyImport() {
    if (!preview || !pendingFile || !preview.editable || (preview.blocking_errors || []).length > 0 || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const formData = new FormData();
      formData.append('workbook', pendingFile);
      await apiRequest('/api/v2/depolama/workbook/import', {
        method: 'POST',
        body: formData,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['depolama'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['office-document-launch', 'depolama'] }),
        queryClient.invalidateQueries({ queryKey: ['office-document-status', 'depolama'] }),
        queryClient.invalidateQueries({ queryKey: ['excel-preview', 'depolama'] }),
      ]);
      setPreview(null);
      setPendingFile(null);
      setStatus({ tone: 'success', message: `${fileName || 'Çalışma kitabı'} içe aktarıldı. Depolama listesi yenilendi.` });
      setFileName(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (error) {
      setStatus({ tone: 'error', message: readImportError(error) });
    } finally {
      setBusy(false);
    }
  }

  function cancelPreview() {
    setPreview(null);
    setPendingFile(null);
    setFileName(null);
    setStatus(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const modern = variant === 'modern';
  const blockingErrors = preview?.blocking_errors || [];
  const buttonClass = modern
    ? 'inline-flex min-h-9 items-center justify-center gap-2 rounded-sg-md border border-sg-border bg-sg-surface px-3.5 text-xs font-medium text-sg-text transition hover:bg-sg-surface-soft disabled:cursor-not-allowed disabled:opacity-50'
    : 'inline-flex items-center justify-center gap-2 border border-brand-300 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-brand-800 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void previewFile(file);
          event.currentTarget.value = '';
        }}
        aria-label="Depolama Excel dosyası seç"
      />
      <button
        type="button"
        onClick={() => void chooseFile()}
        disabled={busy}
        className={`${buttonClass} ${dragActive ? 'ring-2 ring-sg-accent' : ''}`}
        title="Excel dosyasını sürükleyip bırakabilir veya tıklayıp seçebilirsiniz"
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (busy) return;
          const file = Array.from(event.dataTransfer?.files || []).find((f) => /\.(xlsx|xlsm)$/i.test(f.name));
          if (file) void previewFile(file);
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? 'Hazırlanıyor' : dragActive ? 'Bırakın' : 'Excel içe aktar'}
      </button>

      {status ? (
        <div className={`fixed bottom-4 right-4 z-toast flex max-w-md items-start gap-2 rounded-sg-md border px-4 py-3 text-sm shadow-lg ${status.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`} role={status.tone === 'error' ? 'alert' : 'status'}>
          {status.tone === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{status.message}</span>
          <button type="button" onClick={() => setStatus(null)} className="ml-2 shrink-0" aria-label="Bildirimi kapat"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/45 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="inventory-import-title">
          <div className="flex max-h-[min(84vh,54rem)] w-full max-w-3xl flex-col overflow-hidden rounded-sg-lg border border-sg-border bg-sg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-sg-border-soft px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sg-accent">Depolama Excel import</p>
                <h2 id="inventory-import-title" className="mt-1 text-lg font-semibold text-sg-text">Değişiklikleri kontrol et</h2>
                <p className="mt-1 text-sm text-sg-text-soft">{fileName || 'Seçilen çalışma kitabı'} henüz uygulanmadı.</p>
              </div>
              <button type="button" onClick={cancelPreview} className="rounded-sg-md border border-sg-border p-2 text-sg-text-soft hover:bg-sg-surface-soft" aria-label="Import önizlemesini kapat"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {blockingErrors.length > 0 ? <div className="rounded-sg-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><p className="font-semibold">Import engellendi</p>{blockingErrors.map((error) => <p key={error} className="mt-1">{error}</p>)}</div> : null}
              {preview.warnings.length > 0 ? <div className="rounded-sg-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><p className="font-semibold">Uyarılar</p>{preview.warnings.map((warning) => <p key={warning} className="mt-1">{warning}</p>)}</div> : null}
              <div className="rounded-sg-md border border-sg-border bg-sg-surface-soft px-4 py-3">
                <p className="text-sm font-semibold text-sg-text">{preview.changes.length} kontrollü değişiklik</p>
                <div className="mt-3 divide-y divide-sg-border-soft">
                  {preview.changes.slice(0, 50).map((change) => <div key={`${change.sheet}:${change.cell_ref}:${change.label}`} className="grid gap-2 py-3 text-sm sm:grid-cols-[1.2fr_1fr_1fr]"><span className="font-medium text-sg-text">{change.label}</span><span className="text-sg-text-soft">{change.old_value || '—'}</span><span className="font-medium text-sg-text">{change.new_value || '—'}</span></div>)}
                </div>
                {preview.changes.length > 50 ? <p className="mt-3 text-xs text-sg-text-soft">İlk 50 değişiklik gösteriliyor.</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-sg-border-soft px-5 py-4">
              <button type="button" onClick={cancelPreview} className={modern ? 'inline-flex min-h-9 items-center justify-center rounded-sg-md border border-sg-border px-3.5 text-xs font-medium text-sg-text' : 'inline-flex items-center justify-center border border-brand-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-brand-800'}>Vazgeç</button>
              <button type="button" onClick={() => void applyImport()} disabled={busy || !preview.editable || blockingErrors.length > 0} className={modern ? 'inline-flex min-h-9 items-center justify-center gap-2 rounded-sg-md bg-sg-accent px-3.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50' : 'inline-flex items-center justify-center gap-2 border border-brand-900 bg-brand-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-50'}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {busy ? 'Uygulanıyor' : 'İçe aktar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
