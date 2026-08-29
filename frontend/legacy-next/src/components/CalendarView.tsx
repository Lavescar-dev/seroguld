import { DashboardCalendar } from '@/types';
import { labelMetalType, labelProductType } from '@/lib/labels';

type Props = {
  data: DashboardCalendar | null;
};

export function CalendarView({ data }: Props) {
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-base font-semibold text-brand-900">14 Gün Serbest Kalma Takvimi</h3>
      <div className="space-y-2">
        {!data?.items.length && <p className="text-sm text-brand-600">Yaklaşan serbest kalacak ürün yok.</p>}
        {data?.items.map((item) => (
          <div key={item.product_id} className="rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm">
            <div className="font-semibold text-brand-900">#{item.product_number}</div>
            <div className="text-brand-700">{labelProductType(item.product_type)} · {labelMetalType(item.metal_type)}</div>
            <div className="text-brand-700">{item.days_remaining} gün sonra serbest</div>
          </div>
        ))}
      </div>
    </div>
  );
}
