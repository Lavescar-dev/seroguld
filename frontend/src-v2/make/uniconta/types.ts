export type FaturaTipi = 'Salgsfaktura' | 'Kreditnota' | 'Forudbetaling' | 'Rentefaktura';
export type BaglantiDurumu = 'bagli' | 'bagli_degil' | 'yukleniyor' | 'hata';
export type SortKey = 'fakturanummer' | 'fakturadato' | 'total' | 'kunde' | 'konto';
export type SortDir = 'asc' | 'desc';
export type MailFiltre = 'tümü' | 'gonderildi' | 'gonderilmedi';
export type TarihFiltre = 'tümü' | 'bu_ay' | 'son_3ay' | 'bu_yil';

export interface UnicontaKimlik {
  companyId: string;
  username: string;
  password: string;
  env: 'production' | 'sandbox';
}

export interface UnicontaConfigResponse extends UnicontaKimlik {
  apiUrl: string;
  apiKey: string;
  connectionStatus: BaglantiDurumu;
  configured: boolean;
  lastRefreshedAt?: string | null;
  message?: string | null;
}

export interface UnicontaConnectResponse {
  connectionStatus: BaglantiDurumu;
  configured: boolean;
  message: string;
  config: UnicontaConfigResponse;
}

export interface UnicontaInvoicesResponse {
  source: string;
  generatedAt: string;
  invoices: Fatura[];
}

export interface FaturaKalem {
  id: string;
  beskrivelse: string;
  antal: number;
  enhedspris: number;
  rabat: number;
  moms: number;
  liniepris: number;
}

export interface Fatura {
  id: string;
  fakturanummer: string;
  ordrenummer?: string;
  type: FaturaTipi;
  fakturadato: string;
  konto: string;
  mailSendt?: string;
  eFakturaSendt?: string;
  kunde: {
    id: string;
    navn: string;
    email?: string;
    telefon?: string;
    adresse?: string;
    postnr?: string;
    cvr?: string;
  };
  kalemler: FaturaKalem[];
  subtotal: number;
  momsTotal: number;
  total: number;
  valuta: 'DKK' | 'EUR' | 'USD';
  note?: string;
  wooOrderId?: string;
  unicontaRef?: string;
}

export interface UseUnicontaMakeStateResult {
  kimlik: UnicontaKimlik;
  setKimlik: Dispatch<SetStateAction<UnicontaKimlik>>;
  ayarlarAcik: boolean;
  setAyarlarAcik: Dispatch<SetStateAction<boolean>>;
  secilenFatura: Fatura | null;
  setSecilenFatura: Dispatch<SetStateAction<Fatura | null>>;
  aramaQ: string;
  setAramaQ: Dispatch<SetStateAction<string>>;
  tipFiltre: FaturaTipi | 'Tümü';
  setTipFiltre: Dispatch<SetStateAction<FaturaTipi | 'Tümü'>>;
  mailFiltre: MailFiltre;
  setMailFiltre: Dispatch<SetStateAction<MailFiltre>>;
  eFaturaFiltre: MailFiltre;
  setEFaturaFiltre: Dispatch<SetStateAction<MailFiltre>>;
  tarihFiltre: TarihFiltre;
  setTarihFiltre: Dispatch<SetStateAction<TarihFiltre>>;
  sortKey: SortKey;
  sortDir: SortDir;
  filtrePanelAcik: boolean;
  setFiltrePanelAcik: Dispatch<SetStateAction<boolean>>;
  faturalar: Fatura[];
  filtrelenmis: Fatura[];
  baglantiDurumu: BaglantiDurumu;
  yukleniyor: boolean;
  sonYenileme: Date | null;
  stats: {
    toplam: number;
    toplamKredit: number;
    mailGonderildi: number;
    eFakturaGonderildi: number;
  };
  activeFilters: number;
  baglan: () => void;
  yenile: () => void;
  sort: (key: SortKey) => void;
}
import type { Dispatch, SetStateAction } from 'react';
