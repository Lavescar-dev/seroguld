'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { DashboardCharts } from '@/types';

type Props = {
  data: DashboardCharts | null;
};

const STATUS_COLORS = ['#b88b3e', '#1f4f8a', '#2f7a4d', '#0f8f8f', '#9e2b25', '#6c4b7a'];
const METAL_COLORS = ['#c49a3a', '#d1d5db', '#8ca3b3', '#7d8b94', '#c48f7a'];

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function DashboardChartsPanel({ data }: Props) {
  const stockFlow = (data?.stock_flow_30d || []).map((item) => ({
    day: item.day.slice(5),
    stock: toNumber(item.stock_value_dkk),
    purchases: toNumber(item.purchases_dkk),
    removals: toNumber(item.removals_dkk),
  }));

  const monthlyProfit = (data?.monthly_profit_12m || []).map((item) => ({
    month: item.month.slice(2),
    profit: toNumber(item.profit_dkk),
    soldCount: item.sold_count,
  }));

  const statusData = data?.status_distribution || [];
  const metalData = data?.active_metal_distribution || [];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="card p-4">
        <h3 className="text-base font-semibold text-brand-900">30 Gün Stok Değeri Trendi</h3>
        <p className="mt-1 text-xs text-brand-600">Envanter maliyet bazlı stok değeri (DKK)</p>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stockFlow}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e0d4" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value: number) => `${value.toLocaleString('tr-TR')} DKK`} />
              <Legend />
              <Line
                type="monotone"
                dataKey="stock"
                name="Stok Değeri"
                stroke="#b88b3e"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-base font-semibold text-brand-900">30 Gün Giriş / Çıkış Akışı</h3>
        <p className="mt-1 text-xs text-brand-600">Günlük alım (giriş) ve satış/eritme (çıkış) toplamı</p>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stockFlow}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e0d4" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value: number) => `${value.toLocaleString('tr-TR')} DKK`} />
              <Legend />
              <Bar dataKey="purchases" name="Giriş (Alım)" fill="#2f7a4d" radius={[4, 4, 0, 0]} />
              <Bar dataKey="removals" name="Çıkış (Satış/Eritme)" fill="#9e2b25" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-base font-semibold text-brand-900">Stok Durum Dağılımı</h3>
        <p className="mt-1 text-xs text-brand-600">Ürünlerin yaşam döngüsüne göre adet dağılımı</p>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusData} dataKey="count" nameKey="label" outerRadius={95} innerRadius={45} paddingAngle={2}>
                {statusData.map((entry, idx) => (
                  <Cell key={`status-${entry.key}`} fill={STATUS_COLORS[idx % STATUS_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => `${value} adet`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-base font-semibold text-brand-900">Aylık Kâr ve Satış Adedi</h3>
        <p className="mt-1 text-xs text-brand-600">Son 12 ay kâr trendi ve satılan ürün sayısı</p>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyProfit}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6e0d4" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="profit" name="Kâr (DKK)" fill="#b88b3e" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="soldCount" name="Satış Adedi" stroke="#1f4f8a" strokeWidth={2} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <h4 className="text-sm font-semibold text-brand-900">Aktif Metal Dağılımı</h4>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {metalData.map((item, idx) => (
              <span
                key={item.key}
                className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-3 py-1 text-brand-800"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: METAL_COLORS[idx % METAL_COLORS.length] }}
                />
                {item.label}: {item.count}
              </span>
            ))}
            {!metalData.length && <span className="text-brand-600">Veri yok</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
