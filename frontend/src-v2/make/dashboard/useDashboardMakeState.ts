import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

export interface DashboardData {
  alisSayisi: number;
  alisToplamKr: number;
  sonAlislar: { id: string; afregningsnr: string; dato: string; musteri: string; total: number; paymentMethod?: string }[];
  aylikAlis: { ay: string; adet: number; kr: number }[];
  musteriSayisi: number;
  sonMusteriler: { id: string; navn: string; kayitTarihi: string }[];
  depoToplamItem: number;
  depoSpotDeger: number;
  depoAlisDeger: number;
  depoByCat: { name: string; gram: number; spot: number; color: string }[];
  wooHazir: number;
  wooFoto: number;
  wooLisitlendi: number;
  logSayisi: number;
  ayirmaSayisi: number;
  eritmeSayisi: number;
  eritmeToplamHasAltin: number;
  eritmeToplamPayout: number;
  goldPrice: number;
  silverPrice: number;
  platinPrice: number;
  palladyumPrice: number;
  opmcYuksek: number;
  opmcOrta: number;
  opmcDusuk: number;
  opmcBelirsiz: number;
  opmcManuel: number;
  faturaAdedi: number;
  faturaToplamKr: number;
}

const EMPTY_DASHBOARD_DATA: DashboardData = {
  alisSayisi: 0,
  alisToplamKr: 0,
  sonAlislar: [],
  aylikAlis: [],
  musteriSayisi: 0,
  sonMusteriler: [],
  depoToplamItem: 0,
  depoSpotDeger: 0,
  depoAlisDeger: 0,
  depoByCat: [],
  wooHazir: 0,
  wooFoto: 0,
  wooLisitlendi: 0,
  logSayisi: 0,
  ayirmaSayisi: 0,
  eritmeSayisi: 0,
  eritmeToplamHasAltin: 0,
  eritmeToplamPayout: 0,
  goldPrice: 0,
  silverPrice: 0,
  platinPrice: 0,
  palladyumPrice: 0,
  opmcYuksek: 0,
  opmcOrta: 0,
  opmcDusuk: 0,
  opmcBelirsiz: 0,
  opmcManuel: 0,
  faturaAdedi: 0,
  faturaToplamKr: 0,
};

export function useDashboardMakeState() {
  const navigate = useNavigate();
  const dashboardQuery = useQuery({
    queryKey: ['dashboard-v2'],
    queryFn: () => apiRequest<DashboardData>('/api/v2/dashboard'),
    refetchInterval: 5000,
  });

  return {
    data: dashboardQuery.data ?? EMPTY_DASHBOARD_DATA,
    lastRefresh: dashboardQuery.dataUpdatedAt ? new Date(dashboardQuery.dataUpdatedAt) : new Date(),
    isRefreshing: dashboardQuery.isFetching,
    onRefresh: () => {
      void dashboardQuery.refetch();
    },
    onNavigate: (path: string) => navigate(path),
  };
}
