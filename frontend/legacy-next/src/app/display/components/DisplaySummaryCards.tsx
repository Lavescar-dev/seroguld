'use client';

type DisplaySummaryCardsProps = {
  customerName?: string | null;
  tradeLabel: string;
  documentLabel: string;
  activeRateText: string;
  totalAmountText: string;
  lineCount: number;
  totalWeightText: string;
  totalPureGoldText: string;
};

function isEmptyMetric(value: string, lineCount: number): boolean {
  if (lineCount <= 0) return true;
  return value.startsWith('0,00') || value.startsWith('-');
}

function summaryCard(
  label: string,
  value: string,
  tone: 'default' | 'accent' = 'default',
  helper?: string,
) {
  const toneClass =
    tone === 'accent'
      ? 'border-[#8d6f3b] bg-[linear-gradient(135deg,#312515_0%,#221b12_100%)]'
      : 'border-[#5a4d38] bg-[#201a13]';
  const valueClass = tone === 'accent' ? 'text-[#f5db9f]' : 'text-[#f4efe3]';
  const labelClass = tone === 'accent' ? 'text-[#d8bd84]' : 'text-[#c7ad78]';

  return (
    <div className={`rounded-2xl border px-5 py-4 shadow-[0_12px_24px_rgba(0,0,0,0.3)] ${toneClass}`}>
      <p className={`text-xs uppercase tracking-[0.16em] ${labelClass}`}>{label}</p>
      <p className={`mt-2 text-xl font-semibold md:text-3xl ${valueClass}`}>{value}</p>
      {helper ? <p className="mt-2 text-sm text-[#cdbf9f] md:text-base">{helper}</p> : null}
    </div>
  );
}

export function DisplaySummaryCards({
  customerName,
  tradeLabel,
  documentLabel,
  activeRateText,
  totalAmountText,
  lineCount,
  totalWeightText,
  totalPureGoldText,
}: DisplaySummaryCardsProps) {
  const safeCustomer = customerName?.trim() ? customerName : 'Musteri secimi bekleniyor';
  const safeRateText = activeRateText.startsWith('-') ? 'Kur bekleniyor' : activeRateText;
  const safeTotalText = totalAmountText.startsWith('-') ? 'Teklif bekleniyor' : totalAmountText;
  const safeLineValue = lineCount > 0 ? `${lineCount} kalem` : 'Kalem bekleniyor';
  const safeWeightText = isEmptyMetric(totalWeightText, lineCount) ? 'Gram hesaplanacak' : totalWeightText;
  const safePureGoldText = isEmptyMetric(totalPureGoldText, lineCount) ? 'Has altin hesaplanacak' : totalPureGoldText;

  return (
    <section className="grid gap-3 xl:grid-cols-12">
      <div className="rounded-[1.75rem] border border-[#5a4d38] bg-[linear-gradient(135deg,#211a13_0%,#17130f_100%)] px-6 py-5 shadow-[0_16px_30px_rgba(0,0,0,0.32)] xl:col-span-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[#c7ad78]">Musteri</p>
            <p className="mt-2 text-2xl font-semibold text-[#f4efe3] md:text-4xl">{safeCustomer}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-[#6b5a40] bg-[#251e16] px-4 py-2 text-sm font-semibold text-[#e4d3b0]">
              {tradeLabel}
            </span>
            <span className="rounded-full border border-[#6b5a40] bg-[#251e16] px-4 py-2 text-sm font-semibold text-[#e4d3b0]">
              {documentLabel}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {summaryCard('Aktif Kur', safeRateText, 'default')}
          {summaryCard('Kalem Durumu', safeLineValue, 'default', lineCount > 0 ? 'Satirlar canli senkronize ediliyor.' : 'Satici ekranindan satir bekleniyor.')}
          {summaryCard('Toplam Teklif', safeTotalText, 'accent', safeTotalText === 'Teklif bekleniyor' ? 'Kalemler eklendikce toplam tutar burada guncellenir.' : 'Canli toplam teklif tutari.')}
        </div>
      </div>

      <div className="grid gap-3 xl:col-span-5">
        {summaryCard('Toplam Gram', safeWeightText, 'default', safeWeightText === 'Gram hesaplanacak' ? 'Satirlar geldikten sonra net agirlik burada gosterilir.' : 'Belgedeki tum satirlarin toplam agirligi.')}
        {summaryCard('Has Altin', safePureGoldText, 'default', safePureGoldText === 'Has altin hesaplanacak' ? 'Saflik verisi geldiginde otomatik hesaplanir.' : 'Saf metal karsiligi otomatik hesaplanir.')}
      </div>
    </section>
  );
}
