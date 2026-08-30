// Ayrıştırma Özeti — Classic SplitSummarySection (LogPage.tsx:1198-1273) paritesi:
// grup satırları + "Total Ayrılan" + "− Düşme" + "Net Eritmeye Giden" kapanış satırları.
import { toFloat } from '@/make/log/lineHelpers';
import type { ModernLogSplitTotals } from '@/modern/adapters/log';
import { ModernSection } from '@/modern/modules/shared';
import type { LogBucketWorkspace } from '@/types';

import { SPLIT_GROUP_META } from './labels';

const SPLIT_KEYS: Array<keyof ModernLogSplitTotals> = ['jewelry_cleaning', 'white_gold', 'separate_storage'];

const TH = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-sg-text-soft';
const TD = 'px-3 py-2 text-sm text-sg-text';

export function SplitSummary({
  bucket,
  groupedTotals,
  groupedCounts,
}: {
  bucket: LogBucketWorkspace;
  groupedTotals: ModernLogSplitTotals;
  groupedCounts: Record<string, number>;
}) {
  const totalSplitWeight = SPLIT_KEYS.reduce((sum, key) => sum + groupedTotals[key].weight, 0);
  const totalSplitAmount = SPLIT_KEYS.reduce((sum, key) => sum + groupedTotals[key].amount, 0);
  const totalSplitPure = SPLIT_KEYS.reduce((sum, key) => sum + groupedTotals[key].pure, 0);
  const meltQueue = bucket.melt_queue;

  return (
    <ModernSection
      title="Ayrıştırma Özeti"
      subtitle="Depo rotalı satırların sınıf dağılımı ve eritme kuyruğuna net kalan (staging değerleriyle canlı)."
    >
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm" data-testid="log-split-summary">
          <thead>
            <tr className="border-b border-sg-border bg-sg-surface-soft">
              <th className={TH}>Grup</th>
              <th className={TH}>Gram</th>
              <th className={TH}>Alış Fiyatı (kr.)</th>
              <th className={TH}>Has Altın (g)</th>
              <th className={TH}>Kalem</th>
            </tr>
          </thead>
          <tbody>
            {SPLIT_KEYS.map((key) => {
              const meta = SPLIT_GROUP_META[key];
              const totals = groupedTotals[key];
              return (
                <tr key={key} className="border-b border-sg-border-soft">
                  <td className={TD}>
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-4 w-1 ${meta.barClass}`} />
                      <span className={`rounded-sg-sm border px-2 py-0.5 text-xs font-bold ${meta.badgeClass}`}>{meta.label}</span>
                    </span>
                  </td>
                  <td className={`${TD} tabular-nums`}>{totals.weight.toFixed(2)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{totals.amount.toFixed(0)}</td>
                  <td className={`${TD} font-semibold tabular-nums text-sg-amber`}>{totals.pure.toFixed(3)}</td>
                  <td className={`${TD} text-center text-xs text-sg-text-soft`}>{groupedCounts[key] || 0}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-sg-border bg-sg-surface-soft">
              <td className={`${TD} text-[11px] font-semibold uppercase tracking-[0.14em]`}>Total Ayrılan</td>
              <td className={`${TD} font-semibold tabular-nums`}>{totalSplitWeight.toFixed(2)}</td>
              <td className={`${TD} text-right font-semibold tabular-nums`}>{totalSplitAmount.toFixed(0)}</td>
              <td className={`${TD} font-semibold tabular-nums text-sg-amber`}>{totalSplitPure.toFixed(3)}</td>
              <td />
            </tr>
            <tr className="border-t border-sg-red/20 bg-sg-red-soft">
              <td className={`${TD} text-xs font-semibold text-sg-red`}>− Düşme (Lager/Hvidguld/Spandlager)</td>
              <td className={`${TD} font-semibold tabular-nums text-sg-red`}>−{totalSplitWeight.toFixed(2)}</td>
              <td className={`${TD} text-right font-semibold tabular-nums text-sg-red`}>−{totalSplitAmount.toFixed(0)}</td>
              <td className={`${TD} font-semibold tabular-nums text-sg-red`}>−{totalSplitPure.toFixed(3)}</td>
              <td className={`${TD} text-xs text-sg-text-soft`}>Depoya ayrılan</td>
            </tr>
            <tr className="border-t-2 border-sg-accent/40 bg-sg-accent-soft">
              <td className={`${TD} text-xs font-bold uppercase tracking-[0.14em] text-sg-accent-dark`}>Net Eritmeye Giden</td>
              <td className={`${TD} font-bold tabular-nums text-sg-text`}>{toFloat(meltQueue.total_weight_grams).toFixed(2)}</td>
              <td className={`${TD} text-right font-bold tabular-nums text-sg-text`}>{toFloat(meltQueue.total_amount_dkk).toFixed(0)}</td>
              <td className={`${TD} font-bold tabular-nums text-sg-accent-dark`}>{toFloat(meltQueue.total_pure_gold_grams).toFixed(3)}</td>
              <td className={`${TD} text-xs text-sg-text-soft`}>Net eritme</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ModernSection>
  );
}
