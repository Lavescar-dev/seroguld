'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';

type PosActiveSessionCardProps = {
  isBuyLinesFocusScreen: boolean;
  sessionCode: string;
  sessionStatusLabel: string;
  tradeSideLabel: string;
  saleModeLabel?: string | null;
  customerName?: string | null;
  displayToken: string;
  showAdvancedTools: boolean;
  onOpenDisplayActive: () => void;
  onOpenDisplayStandby: () => void;
};

export function PosActiveSessionCard({
  isBuyLinesFocusScreen,
  sessionCode,
  sessionStatusLabel,
  tradeSideLabel,
  saleModeLabel,
  customerName,
  displayToken,
  showAdvancedTools,
  onOpenDisplayActive,
  onOpenDisplayStandby,
}: PosActiveSessionCardProps) {
  return (
    <div className={isBuyLinesFocusScreen ? 'card mx-auto w-full max-w-[1400px] rounded-2xl border-[#ddccab] bg-[#fffdf8] p-6 shadow-[0_10px_24px_rgba(92,62,24,0.08)] md:p-8' : 'card rounded-2xl border-[#ddccab] bg-[#fffdf8] p-4 shadow-[0_10px_24px_rgba(92,62,24,0.08)]'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold uppercase tracking-[0.06em] text-[#8b6b38]">2) Aktif POS Oturumu</h3>
          <p className="text-sm text-brand-700">
            Kod: <strong>{sessionCode}</strong> · Durum: <strong>{sessionStatusLabel}</strong>
          </p>
          <p className="text-sm text-brand-700">
            İşlem Türü: <strong>{tradeSideLabel}</strong>
          </p>
          {saleModeLabel && (
            <p className="text-sm text-brand-700">
              Satış Yöntemi: <strong>{saleModeLabel}</strong>
            </p>
          )}
          <p className="text-sm text-brand-700">
            Müşteri: <strong>{customerName || '-'}</strong>
          </p>
          <p className="mt-1 text-xs text-brand-600">Bu oturumdaki kalemler müşteri ekranına canlı yansıtılır.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onOpenDisplayActive}>
            Müşteri Ekranı (Aktif)
          </Button>
          <Button variant="ghost" onClick={onOpenDisplayStandby}>
            Müşteri Ekranı (Standby)
          </Button>
          {showAdvancedTools && (
            <Link href={`/display/${displayToken}`} target="_blank" className="text-sm text-brand-700 underline">
              /display/{displayToken}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
