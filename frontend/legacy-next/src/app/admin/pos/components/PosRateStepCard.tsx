'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PosSession, PosTradeSide } from '@/types';
import type { SaleMode } from '../pos-types';

type PosRateStepCardProps = {
  visible: boolean;
  session: PosSession | null;
  saleMode: SaleMode;
  canEditSession: boolean;
  busy: boolean;
  manualRate: string;
  setManualRate: (value: string) => void;
  onSyncRate: () => void;
  onApplyManualRate: () => void;
};

export function PosRateStepCard({
  visible,
  session,
  saleMode,
  canEditSession,
  busy,
  manualRate,
  setManualRate,
  onSyncRate,
  onApplyManualRate,
}: PosRateStepCardProps) {
  if (!visible) {
    return null;
  }

  const tradeSide = session?.trade_side as PosTradeSide | undefined;
  const isManualSell = tradeSide === 'sell_to_customer' && saleMode === 'manual';

  return (
    <div className="card p-4">
      <h3 className="text-base font-semibold text-brand-900">4) Kur ve Hesap</h3>
      <p className="mt-1 text-sm text-brand-700">
        {isManualSell
          ? 'Manuel satışta kur senkronizasyonu opsiyoneldir. Satış fiyatını elle de verebilirsiniz.'
          : '"Senkronize Et" yalnızca satıcı ekranındadır. Müşteri ekranında sadece aktif kur ve teklif görünür.'}
      </p>

      <div className="mt-3 grid gap-2 text-sm text-brand-800">
        <p>
          <strong>Aktif Kur:</strong> {session?.active_rate_dkk || '-'} DKK/g
        </p>
        <p>
          <strong>Canlı Kur:</strong> {session?.live_rate_dkk || '-'} DKK/g
        </p>
        <p>
          <strong>Manuel Kur:</strong> {session?.manual_rate_dkk || '-'} DKK/g
        </p>
        <p>
          <strong>Kur Kaynağı:</strong> {session?.rate_source === 'manual' ? 'Manuel' : 'Canlı'}
        </p>
        <p>
          <strong>Nihai Teklif:</strong> {session?.final_offer_dkk || '-'} DKK
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onSyncRate} disabled={!canEditSession || busy}>
          {isManualSell ? 'Kur Senkronize Et (Opsiyonel)' : 'Senkronize Et'}
        </Button>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder="Manuel kur (DKK/g)"
          value={manualRate}
          onChange={(event) => setManualRate(event.target.value)}
          disabled={!canEditSession}
        />
        <Button onClick={onApplyManualRate} disabled={!canEditSession || busy}>
          Manuel Kur Uygula
        </Button>
      </div>
    </div>
  );
}
