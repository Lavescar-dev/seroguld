import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';

import { apiRequest } from '@/lib/api';
import { formatMoney, formatNumber } from '@/lib/format';
import { ModernBadge, ModernButton, ModernCard, ModernDrawer, ModernNotice } from '@/modern/design-system';

type PreviewItem = {
  source_hash: string;
  file_name: string;
  status: 'ready' | 'blocked' | 'already_imported';
  legacy_document_number?: string | null;
  issued_at?: string | null;
  customer_name?: string | null;
  customer_action: string;
  line_count: number;
  total_weight_grams: string;
  total_amount_dkk: string;
  warnings: string[];
  errors: string[];
};

type PreviewResponse = {
  items: PreviewItem[];
  ready_count: number;
  blocked_count: number;
  already_imported_count: number;
};

type ApplyResponse = {
  imported_count: number;
  skipped_count: number;
  failed_count: number;
};

function makeForm(files: File[], selectedHashes?: string[]) {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  if (selectedHashes) form.append('selected_hashes_json', JSON.stringify(selectedHashes));
  return form;
}

function labelForStatus(status: string) {
  const labels: Record<string, string> = {
    ready: 'Hazır',
    blocked: 'Engelli',
    already_imported: 'Zaten içe aktarıldı',
  };
  return labels[status] || status;
}

function toneForStatus(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'ready') return 'success';
  if (status === 'already_imported') return 'warning';
  return 'danger';
}

export function HistoricalAfgImportDrawer({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'danger' | null>(null);

  const selectedReadyCount = useMemo(
    () => preview?.items.filter((item) => item.status === 'ready' && selectedHashes.has(item.source_hash)).length || 0,
    [preview, selectedHashes],
  );

  async function previewFiles() {
    if (!files.length) return;
    setBusy('preview');
    setMessage(null);
    try {
      const result = await apiRequest<PreviewResponse>('/api/v2/alis/historical-import/preview', {
        method: 'POST',
        body: makeForm(files),
      });
      setPreview(result);
      setSelectedHashes(new Set(result.items.filter((item) => item.status === 'ready').map((item) => item.source_hash)));
    } catch (error) {
      setPreview(null);
      setSelectedHashes(new Set());
      setMessage(error instanceof Error ? error.message : 'Dosyalar analiz edilemedi.');
      setMessageTone('danger');
    } finally {
      setBusy(null);
    }
  }

  async function applyImport() {
    if (!selectedReadyCount) return;
    setBusy('apply');
    setMessage(null);
    try {
      const result = await apiRequest<ApplyResponse>('/api/v2/alis/historical-import/apply', {
        method: 'POST',
        body: makeForm(files, [...selectedHashes]),
      });
      setMessage(
        String(result.imported_count) +
          ' belge içe aktarıldı. ' +
          String(result.skipped_count) +
          ' dosya atlandı, ' +
          String(result.failed_count) +
          ' dosya başarısız oldu.',
      );
      setMessageTone(result.failed_count ? 'danger' : 'success');
      if (result.imported_count) onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'İçe aktarma tamamlanamadı.');
      setMessageTone('danger');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ModernDrawer
      open={open}
      onClose={busy ? undefined : onClose}
      title="Tarihsel AFG içe aktar"
      description="Önce dosyaları analiz edin; yalnız hazır olanlar yerel geçmiş kaydına dönüşür."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <ModernButton tone="ghost" onClick={onClose} disabled={Boolean(busy)}>Kapat</ModernButton>
          {!preview ? (
            <ModernButton tone="primary" icon={Upload} onClick={previewFiles} disabled={!files.length || Boolean(busy)}>
              {busy === 'preview' ? 'Analiz ediliyor' : 'Dosyaları analiz et'}
            </ModernButton>
          ) : (
            <ModernButton tone="success" icon={CheckCircle2} onClick={applyImport} disabled={!selectedReadyCount || Boolean(busy)}>
              {busy === 'apply' ? 'İçe aktarılıyor' : String(selectedReadyCount) + ' dosyayı içe aktar'}
            </ModernButton>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <ModernNotice
          tone="warning"
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Dış entegrasyonlar kapalı"
          description="Uniconta, WooCommerce, e-posta ve diğer harici sistemlere istek gönderilmez. Yalnız belge, işlem ve satır kayıtları oluşturulur."
        />
        <ModernCard>
          <label htmlFor="historical-afg-files" className="block text-sm font-semibold text-sg-text">AFG Excel dosyaları</label>
          <p className="mt-1 text-sm text-sg-text-soft">XLSX veya XLSM, en fazla 100 dosya. Dosyalar yalnız bu çekmece açıkken tarayıcı belleğinde tutulur.</p>
          <input
            id="historical-afg-files"
            type="file"
            multiple
            accept=".xlsx,.xlsm"
            disabled={Boolean(busy)}
            onChange={(event) => {
              setFiles(Array.from(event.currentTarget.files || []));
              setPreview(null);
              setSelectedHashes(new Set());
              setMessage(null);
            }}
            className="mt-3 block w-full text-sm text-sg-text-soft file:mr-4 file:rounded-sg-md file:border-0 file:bg-sg-accent-soft file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sg-accent-dark"
          />
          {files.length ? <p className="mt-3 text-sm text-sg-text">{files.length} dosya seçildi.</p> : null}
        </ModernCard>
        {message && messageTone ? <ModernNotice tone={messageTone} title={messageTone === 'success' ? 'İçe aktarma tamamlandı' : 'İşlem tamamlanamadı'} description={message} /> : null}
        {preview ? (
          <section className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <ModernBadge tone="success">{preview.ready_count} hazır</ModernBadge>
              <ModernBadge tone="danger">{preview.blocked_count} engelli</ModernBadge>
              <ModernBadge tone="warning">{preview.already_imported_count} daha önce işlendi</ModernBadge>
            </div>
            {preview.items.map((item) => {
              const selectable = item.status === 'ready';
              return (
                <ModernCard key={item.source_hash} className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-sg-accent" />
                        <p className="truncate text-sm font-semibold text-sg-text">{item.file_name}</p>
                        <ModernBadge tone={toneForStatus(item.status)}>{labelForStatus(item.status)}</ModernBadge>
                      </div>
                      <p className="mt-2 text-sm text-sg-text-soft">
                        AFG: {item.legacy_document_number || '—'} · {item.customer_name || 'Müşteri okunamadı'} · {item.issued_at ? new Date(item.issued_at).toLocaleDateString(document.documentElement.lang) : 'Tarih yok'}
                      </p>
                      <p className="mt-1 text-xs text-sg-text-soft">
                        {item.line_count} satır · {formatNumber(item.total_weight_grams, ' g')} · {formatMoney(item.total_amount_dkk)} · Müşteri: {item.customer_action}
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-sm font-medium text-sg-text">
                      <input
                        type="checkbox"
                        checked={selectedHashes.has(item.source_hash)}
                        disabled={!selectable || Boolean(busy)}
                        onChange={(event) => setSelectedHashes((current) => {
                          const next = new Set(current);
                          if (event.currentTarget.checked) next.add(item.source_hash);
                          else next.delete(item.source_hash);
                          return next;
                        })}
                      />
                      İçe aktar
                    </label>
                  </div>
                  {item.errors.length ? <div className="rounded-sg-md bg-sg-red-soft px-3 py-2 text-xs text-sg-red">{item.errors.join(' ')}</div> : null}
                  {item.warnings.length ? <div className="rounded-sg-md bg-sg-amber-soft px-3 py-2 text-xs text-sg-amber">{item.warnings.join(' ')}</div> : null}
                </ModernCard>
              );
            })}
          </section>
        ) : null}
      </div>
    </ModernDrawer>
  );
}
