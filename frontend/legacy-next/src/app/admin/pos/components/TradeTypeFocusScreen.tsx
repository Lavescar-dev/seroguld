'use client';

import { Button } from '@/components/ui/button';

type TradeTypeFocusScreenProps = {
  onChooseBuy: () => void;
  onChooseSell: () => void;
};

export function TradeTypeFocusScreen({ onChooseBuy, onChooseSell }: TradeTypeFocusScreenProps) {
  return (
    <div className="card relative min-h-[calc(100vh-180px)] p-6 md:p-10">
      <div className="absolute left-1/2 top-32 w-full max-w-6xl -translate-x-1/2 px-4 text-center md:top-36">
        <p className="text-2xl font-semibold uppercase tracking-[0.2em] text-brand-600 md:text-5xl">
          Canlı Alış/Satış (POS)
        </p>
        <h2 className="mt-4 text-5xl font-bold leading-tight text-brand-900 md:text-7xl">İşlem türünü seçin</h2>
        <p className="mt-4 text-lg leading-relaxed text-brand-700 md:text-2xl">
          Müşterinin karşı ekranda doğru akışı görmesi için önce işlem tipini belirleyin.
        </p>
      </div>
      <div className="flex h-full min-h-[calc(100vh-260px)] items-center justify-center">
        <div className="mt-6 flex w-full max-w-6xl flex-col items-center gap-5 px-4 md:mt-0 md:flex-row md:justify-center">
          <Button
            variant="ghost"
            onClick={onChooseBuy}
            className="h-[82px] w-full max-w-[460px] border-2 border-brand-700 bg-white text-[1.8rem] font-bold text-brand-800 hover:bg-brand-700 hover:text-white md:h-[115px] md:w-[460px] md:text-[2rem]"
          >
            Canlı Alış
          </Button>
          <Button
            variant="ghost"
            onClick={onChooseSell}
            className="h-[82px] w-full max-w-[460px] border-2 border-brand-700 bg-white text-[1.8rem] font-bold text-brand-800 hover:bg-brand-700 hover:text-white md:h-[115px] md:w-[460px] md:text-[2rem]"
          >
            Canlı Satış
          </Button>
        </div>
      </div>
    </div>
  );
}
