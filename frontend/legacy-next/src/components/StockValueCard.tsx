import { DashboardStock } from '@/types';

type Props = {
  data: DashboardStock | null;
};

export function StockValueCard({ data }: Props) {
  if (!data) {
    return <div className="card p-4 text-sm text-brand-700">Stok değeri yükleniyor...</div>;
  }

  const positive = Number(data.today_change_dkk) >= 0;

  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-brand-600">Toplam Stok Değeri</p>
      <p className="mt-1 text-2xl font-bold text-brand-900">{data.total_stock_value_dkk} DKK</p>
      <p className={`mt-2 text-sm ${positive ? 'text-emerald-700' : 'text-red-700'}`}>
        Bugün: {positive ? '+' : ''}
        {data.today_change_dkk} DKK
      </p>
    </div>
  );
}
