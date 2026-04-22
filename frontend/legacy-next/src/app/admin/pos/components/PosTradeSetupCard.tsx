'use client';

import { Button } from '@/components/ui/button';
import type { PosTradeSide } from '@/types';
import type { SaleMode } from '../pos-types';

type PosTradeSetupCardProps = {
  tradeSide: PosTradeSide;
  saleMode: SaleMode;
  sessionExists: boolean;
  onSetTradeSide: (side: PosTradeSide) => void;
  onSetSaleMode: (mode: SaleMode) => void;
};

export function PosTradeSetupCard({
  tradeSide,
  saleMode,
  sessionExists,
  onSetTradeSide,
  onSetSaleMode,
}: PosTradeSetupCardProps) {
  return (
    <div className="card p-4">
      <h3 className="text-base font-semibold text-brand-900">0) İşlem Türü (Hızlı Başlangıç)</h3>
      <p className="mt-1 text-sm text-brand-700">
        Önce işlem türünü seçin. Bu seçim müşteri ekranındaki akışı belirler.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant={tradeSide === 'buy_from_customer' ? 'primary' : 'ghost'}
          onClick={() => onSetTradeSide('buy_from_customer')}
          disabled={sessionExists}
        >
          Canlı Alış
        </Button>
        <Button
          variant={tradeSide === 'sell_to_customer' ? 'primary' : 'ghost'}
          onClick={() => onSetTradeSide('sell_to_customer')}
          disabled={sessionExists}
        >
          Canlı Satış
        </Button>
      </div>

      {tradeSide === 'sell_to_customer' && (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-900">Satış Yöntemi</p>
          <p className="mt-1 text-xs text-brand-700">
            Envanterden hazır ürün satabilir veya manuel satış kaydı açabilirsiniz.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant={saleMode === 'inventory' ? 'primary' : 'ghost'}
              onClick={() => onSetSaleMode('inventory')}
              disabled={sessionExists}
            >
              Envanterden Satış
            </Button>
            <Button
              variant={saleMode === 'manual' ? 'primary' : 'ghost'}
              onClick={() => onSetSaleMode('manual')}
              disabled={sessionExists}
            >
              Manuel Satış
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
