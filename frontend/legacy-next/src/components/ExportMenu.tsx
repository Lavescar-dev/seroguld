'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { getAccessToken } from '@/lib/auth';
import { buildApiUrl } from '@/lib/api';

export function ExportMenu() {
  const [period, setPeriod] = useState<'all' | 'daily' | 'weekly' | 'monthly'>('all');
  const [loadingFormat, setLoadingFormat] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);

  function parseFilename(contentDisposition: string | null, fallback: string): string {
    if (!contentDisposition) return fallback;
    const match = contentDisposition.match(/filename="?([^"]+)"?/i);
    return match?.[1] || fallback;
  }

  async function download(format: 'csv' | 'xlsx' | 'pdf') {
    const token = getAccessToken();
    if (!token) {
      alert('Oturum süresi dolmuş. Lütfen tekrar giriş yapın.');
      return;
    }

    setLoadingFormat(format);
    const response = await fetch(buildApiUrl(`/api/reports/export?format=${format}&period=${period}`), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.detail || 'Dışa aktarma başarısız');
    }

    const blob = await response.blob();
    const fallbackName = `seroguld-report-${period}.${format}`;
    const filename = parseFilename(response.headers.get('content-disposition'), fallbackName);
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    setLoadingFormat(null);
  }

  async function onExportClick(format: 'csv' | 'xlsx' | 'pdf') {
    try {
      await download(format);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Dışa aktarma başarısız');
    } finally {
      setLoadingFormat(null);
    }
  }

  return (
    <div className="card p-4">
      <h4 className="text-base font-semibold text-brand-900">Dışa Aktarım</h4>
      <p className="mt-2 text-sm text-brand-700">
        Rapor periyodunu seçip CSV, XLSX veya PDF olarak indirin.
      </p>

      <div className="mt-3 grid gap-2 md:grid-cols-[220px_1fr] md:items-end">
        <div>
          <label className="mb-1 block text-sm font-medium text-brand-700">Periyot</label>
          <Select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
            <option value="all">Tüm Kayıtlar</option>
            <option value="daily">Günlük</option>
            <option value="weekly">Haftalık</option>
            <option value="monthly">Aylık</option>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onExportClick('csv')} disabled={Boolean(loadingFormat)}>
            {loadingFormat === 'csv' ? 'Hazırlanıyor...' : 'CSV İndir'}
          </Button>
          <Button variant="ghost" onClick={() => onExportClick('xlsx')} disabled={Boolean(loadingFormat)}>
            {loadingFormat === 'xlsx' ? 'Hazırlanıyor...' : 'XLSX İndir'}
          </Button>
          <Button variant="ghost" onClick={() => onExportClick('pdf')} disabled={Boolean(loadingFormat)}>
            {loadingFormat === 'pdf' ? 'Hazırlanıyor...' : 'PDF İndir'}
          </Button>
        </div>
      </div>
    </div>
  );
}
