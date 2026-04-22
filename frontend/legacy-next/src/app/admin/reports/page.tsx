'use client';

import { useState } from 'react';

import { ExportMenu } from '@/components/ExportMenu';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import { ReportSummary } from '@/types';

export default function ReportsPage() {
  const [data, setData] = useState<ReportSummary | null>(null);
  const [label, setLabel] = useState<'daily' | 'weekly' | 'monthly' | null>(null);
  const [error, setError] = useState('');

  async function load(kind: 'daily' | 'weekly' | 'monthly') {
    setError('');
    try {
      const response = await apiRequest<ReportSummary>(`/api/reports/${kind}`);
      setData(response);
      setLabel(kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rapor alınamadı');
    }
  }

  const labelMap: Record<'daily' | 'weekly' | 'monthly', string> = {
    daily: 'Günlük',
    weekly: 'Haftalık',
    monthly: 'Aylık',
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap gap-2 p-4">
        <Button onClick={() => load('daily')}>Günlük</Button>
        <Button onClick={() => load('weekly')}>Haftalık</Button>
        <Button onClick={() => load('monthly')}>Aylık</Button>
      </div>

      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

      {data && (
        <div className="card p-5">
          <h3 className="text-lg font-semibold text-brand-900">{label ? `${labelMap[label]} Raporu` : 'Rapor'}</h3>
          <div className="mt-4 grid gap-2 text-sm text-brand-700 md:grid-cols-2">
            <p>Alım: {data.purchased_count}</p>
            <p>Satış: {data.sold_count}</p>
            <p>Eritilen: {data.melted_count}</p>
            <p>Toplam alım değeri: {data.total_purchase_value_dkk} DKK</p>
            <p>Toplam satış değeri: {data.total_sale_value_dkk} DKK</p>
            <p>Toplam kâr: {data.total_profit_dkk} DKK</p>
          </div>
        </div>
      )}

      <ExportMenu />
    </div>
  );
}
