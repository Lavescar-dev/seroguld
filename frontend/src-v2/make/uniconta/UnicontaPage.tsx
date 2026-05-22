import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Info,
  Loader2,
  Mail,
  ReceiptText,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Settings,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { PdfViewerModal } from '@/components/PdfViewerModal';
import { fetchAuthedPdfBlob } from '@/lib/api';
import { useUnicontaMakeState } from './useUnicontaMakeState';
import type {
  BaglantiDurumu,
  Fatura,
  FaturaTipi,
  SortKey,
  UnicontaKimlik,
  UseUnicontaMakeStateResult,
} from './types';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

const TIP_STYLE: Record<FaturaTipi, { bg: string; text: string; border: string }> = {
  Salgsfaktura: { bg: 'bg-brand-100', text: 'text-brand-700', border: 'border-brand-300' },
  Kreditnota: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  Forudbetaling: { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
  Rentefaktura: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
};

function fmtMoney(value: number, valuta = 'DKK') {
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : '';
  if (valuta === 'EUR') return `${prefix}€${abs.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (valuta === 'USD') return `${prefix}$${abs.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${prefix}${abs.toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DKK`;
}

function fmtDate(value: string) {
  return new Date(value).toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => undefined);
}

function BaglantiPanel({
  kimlik,
  onChange,
  onKapat,
  onBaglan,
  baglantiDurumu,
}: {
  kimlik: UnicontaKimlik;
  onChange: (kimlik: UnicontaKimlik) => void;
  onKapat: () => void;
  onBaglan: () => void;
  baglantiDurumu: BaglantiDurumu;
}) {
  const [lokal, setLokal] = useState<UnicontaKimlik>(kimlik);
  const [sifreGoster, setSifreGoster] = useState(false);
  const [kopyalandi, setKopyalandi] = useState(false);

  const exampleCode = `// Uniconta API Proxy (Sunucu tarafı)
const res = await fetch("https://www.uniconta.com/api/query", {
  method: "POST",
  headers: {
    "Authorization": \`Basic \${Buffer.from(\`\${USERNAME}:\${PASSWORD}\`).toString("base64")}\`,
    "CompanyId": COMPANY_ID,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    Table: "InvoicePostingLine",
    Fields: ["AccountNumber","AccountName","Date","MailSent","EInvoiceSent","InvoiceNumber","AmountCur"],
  }),
});`;

  const copyExample = () => {
    copyText(exampleCode);
    setKopyalandi(true);
    window.setTimeout(() => setKopyalandi(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" style={sansStyle}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onKapat} />
      <div className="relative flex h-full w-[560px] max-w-[96vw] flex-col overflow-hidden border-l-4 border-blue-500 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b-2 border-slate-700 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-blue-400" />
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Uniconta</p>
              <p className="font-black text-white">API Bağlantı Ayarları</p>
            </div>
          </div>
          <button onClick={onKapat} className="border border-slate-700 p-1.5 transition-colors hover:bg-slate-700">
            <X className="h-4 w-4 text-slate-300" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-auto p-5">
          <div className="flex items-start gap-3 border border-amber-400 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div>
              <p className="mb-0.5 text-xs font-black text-amber-800">Güvenlik Uyarısı</p>
              <p className="text-xs text-amber-700">
                API kimlik bilgileri bu arayüzde şifresiz saklanmaz — yalnızca oturum belleğinde tutulur.
                Prodüksiyon ortamında mutlaka bir backend proxy veya Supabase Edge Function kullanın.
                Kimlik bilgileri tarayıcı konsoluna loglanmaz.
              </p>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-black uppercase tracking-wider text-slate-600">Ortam</label>
            <div className="grid grid-cols-2 gap-2">
              {(['production', 'sandbox'] as const).map((env) => (
                <button
                  key={env}
                  onClick={() => setLokal((current) => ({ ...current, env }))}
                  className={`border-2 px-3 py-2.5 text-xs font-bold transition-all ${
                    lokal.env === env
                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'
                  }`}
                >
                  {env === 'production' ? 'Production' : 'Sandbox / Test'}
                </button>
              ))}
            </div>
          </div>

          {[
            { label: 'Company ID', key: 'companyId', placeholder: '123456', style: monoStyle },
            { label: 'Kullanıcı Adı', key: 'username', placeholder: 'uniconta@sirket.dk', style: sansStyle },
          ].map((field) => (
            <div key={field.key}>
              <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">{field.label} *</label>
              <input
                value={lokal[field.key as keyof UnicontaKimlik] as string}
                onChange={(event) => setLokal((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={field.placeholder}
                className="w-full border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                style={field.style}
              />
            </div>
          ))}

          <div>
            <label className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-600">Şifre *</label>
            <div className="relative">
              <input
                type={sifreGoster ? 'text' : 'password'}
                value={lokal.password}
                onChange={(event) => setLokal((current) => ({ ...current, password: event.target.value }))}
                placeholder="••••••••••"
                className="w-full border border-slate-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none"
                style={sansStyle}
              />
              <button
                onClick={() => setSifreGoster((current) => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-700"
              >
                {sifreGoster ? 'GİZLE' : 'GÖSTER'}
              </button>
            </div>
          </div>

          {/* U10 — Email/eFatura gönderim toggle'ları */}
          <div className="space-y-2 border border-slate-300 bg-slate-50 px-4 py-3">
            <p className="text-xs font-black uppercase tracking-widest text-slate-700">
              Otomatik Gönderim (Finalize sonrası)
            </p>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(lokal.sendEmailOnFinalize)}
                onChange={(event) =>
                  setLokal((current) => ({ ...current, sendEmailOnFinalize: event.target.checked }))
                }
                className="h-4 w-4"
              />
              <Mail className="h-3.5 w-3.5 text-slate-500" />
              <span>
                <strong>E-posta otomatik gönder</strong> — Müşteriye Uniconta fatura PDF'i e-posta ile yollar.
              </span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(lokal.sendXmlOnFinalize)}
                onChange={(event) =>
                  setLokal((current) => ({ ...current, sendXmlOnFinalize: event.target.checked }))
                }
                className="h-4 w-4"
              />
              <Send className="h-3.5 w-3.5 text-slate-500" />
              <span>
                <strong>OIOUBL e-fatura (XML) gönder</strong> — Danimarka standardı e-fatura.
              </span>
            </label>
          </div>

          {baglantiDurumu !== 'bagli_degil' ? (
            <div
              className={`flex items-center gap-3 border px-4 py-3 ${
                baglantiDurumu === 'bagli'
                  ? 'border-emerald-400 bg-emerald-50'
                  : baglantiDurumu === 'hata'
                    ? 'border-red-400 bg-red-50'
                    : 'border-blue-300 bg-blue-50'
              }`}
            >
              {baglantiDurumu === 'bagli' ? (
                <>
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-black text-emerald-800">Bağlantı başarılı — Uniconta&apos;ya erişildi</span>
                </>
              ) : null}
              {baglantiDurumu === 'hata' ? (
                <>
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="text-sm font-black text-red-800">Bağlantı hatası — kimlik bilgilerini kontrol edin</span>
                </>
              ) : null}
              {baglantiDurumu === 'yukleniyor' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  <span className="text-sm font-black text-blue-800">Bağlanılıyor...</span>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-hidden border border-slate-300">
            <div className="flex items-center justify-between bg-slate-800 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Info className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-xs font-black uppercase tracking-widest text-slate-300">Backend Proxy Örneği</span>
              </div>
              <button onClick={copyExample} className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white">
                {kopyalandi ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    Kopyalandı
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Kopyala
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-48 overflow-auto bg-slate-900 p-4 text-xs text-slate-300" style={monoStyle}>
              {exampleCode}
            </pre>
          </div>

          <div className="flex items-center gap-2 text-xs text-blue-600">
            <ExternalLink className="h-3.5 w-3.5" />
            <a href="https://www.uniconta.com/developers/" target="_blank" rel="noreferrer" className="font-bold underline hover:no-underline">
              Uniconta Geliştirici Portalı — API Referansı
            </a>
          </div>
        </div>

        <div className="flex gap-3 border-t-2 border-slate-200 bg-slate-50 px-5 py-4">
          <button onClick={onKapat} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100">
            İptal
          </button>
          <button
            onClick={() => {
              onChange(lokal);
              onBaglan();
            }}
            disabled={!lokal.companyId || !lokal.username || !lokal.password}
            className="flex flex-1 items-center justify-center gap-2 border border-blue-900 bg-blue-700 px-4 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Wifi className="h-4 w-4" />
            Bağlan ve Faturaları Çek
          </button>
        </div>
      </div>
    </div>
  );
}

function FaturaDetay({
  fatura,
  onKapat,
  onPdfRequest,
  pdfLoading,
}: {
  fatura: Fatura;
  onKapat: () => void;
  onPdfRequest: (fatura: Fatura) => void;
  pdfLoading: boolean;
}) {
  const ts = TIP_STYLE[fatura.type];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" style={sansStyle}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onKapat} />
      <div className="relative flex h-full w-[640px] max-w-[96vw] flex-col overflow-hidden border-l-4 border-brand-500 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b-2 border-brand-700 bg-brand-900 px-5 py-4">
          <div className="flex items-center gap-3">
            <ReceiptText className="h-5 w-5 text-amber-400" />
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-brand-400">Uniconta Fatura</p>
              <p className="font-black text-white" style={monoStyle}>
                #{fatura.fakturanummer}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPdfRequest(fatura)}
              disabled={pdfLoading}
              className="flex items-center gap-1.5 border border-brand-600 bg-brand-700 px-3 py-1.5 text-xs font-bold text-brand-200 transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pdfLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              PDF
            </button>
            <button onClick={onKapat} className="border border-brand-700 p-1.5 hover:bg-brand-700">
              <X className="h-4 w-4 text-brand-300" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="border border-brand-200 bg-brand-50 px-3 py-2.5">
              <p className="text-xs font-black uppercase tracking-wider text-brand-500">Kredit</p>
              <p className="mt-0.5 font-black text-brand-900" style={monoStyle}>
                {fmtMoney(fatura.total, fatura.valuta)}
              </p>
            </div>
            <div className={`border px-3 py-2.5 ${ts.border} ${ts.bg}`}>
              <p className={`text-xs font-black uppercase tracking-wider ${ts.text}`}>Fatura Türü</p>
              <p className={`mt-0.5 text-sm font-black ${ts.text}`}>{fatura.type}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">Konto</p>
              <p className="mt-0.5 text-sm font-black text-brand-900" style={monoStyle}>
                {fatura.konto}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="border border-brand-200 bg-brand-50 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-wider text-brand-500">Kunde</p>
              <p className="mt-1 text-base font-black text-brand-900">{fatura.kunde.navn}</p>
              <div className="mt-3 space-y-1 text-xs text-brand-600">
                {fatura.kunde.email ? <p>E-mail: {fatura.kunde.email}</p> : null}
                {fatura.kunde.telefon ? <p>Tlf.: {fatura.kunde.telefon}</p> : null}
                {fatura.kunde.adresse ? <p>Adres: {fatura.kunde.adresse}</p> : null}
                {fatura.kunde.postnr ? <p>Postnr: {fatura.kunde.postnr}</p> : null}
                {fatura.kunde.cvr ? <p>CVR: {fatura.kunde.cvr}</p> : null}
              </div>
            </div>
            <div className="border border-brand-200 bg-brand-50 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-wider text-brand-500">Meta</p>
              <div className="mt-3 space-y-1 text-xs text-brand-700" style={monoStyle}>
                <p>Dato: {fmtDate(fatura.fakturadato)}</p>
                <p>Faktura No: #{fatura.fakturanummer}</p>
                {fatura.ordrenummer ? <p>Ordre No: {fatura.ordrenummer}</p> : null}
                {fatura.unicontaRef ? <p>Uniconta Ref: {fatura.unicontaRef}</p> : null}
                {fatura.wooOrderId ? <p>Woo Ref: {fatura.wooOrderId}</p> : null}
              </div>
            </div>
          </div>

          <div className="overflow-hidden border border-brand-200">
            <div className="grid grid-cols-12 bg-brand-100 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-brand-600">
              <div className="col-span-5">Açıklama</div>
              <div className="col-span-1 text-right">Adet</div>
              <div className="col-span-2 text-right">Birim</div>
              <div className="col-span-1 text-right">Rabat</div>
              <div className="col-span-1 text-right">Moms</div>
              <div className="col-span-2 text-right">Toplam</div>
            </div>
            {fatura.kalemler.map((kalem, index) => (
              <div key={kalem.id} className={`grid grid-cols-12 border-t border-brand-100 px-3 py-2 text-sm ${index % 2 === 1 ? 'bg-brand-50/50' : 'bg-white'}`}>
                <div className="col-span-5 text-brand-800">{kalem.beskrivelse}</div>
                <div className="col-span-1 text-right text-brand-700" style={monoStyle}>
                  {kalem.antal}
                </div>
                <div className="col-span-2 text-right text-brand-700" style={monoStyle}>
                  {fmtMoney(kalem.enhedspris, fatura.valuta)}
                </div>
                <div className="col-span-1 text-right text-brand-500" style={monoStyle}>
                  {kalem.rabat > 0 ? `${kalem.rabat}%` : '—'}
                </div>
                <div className="col-span-1 text-right text-brand-500" style={monoStyle}>
                  {kalem.moms > 0 ? `${kalem.moms}%` : '—'}
                </div>
                <div className="col-span-2 text-right font-black text-brand-900" style={monoStyle}>
                  {fmtMoney(kalem.liniepris, fatura.valuta)}
                </div>
              </div>
            ))}
            <div className="border-t-2 border-brand-300 bg-brand-50">
              <div className="flex justify-between border-b border-brand-200 px-3 py-1.5">
                <span className="text-xs font-bold text-brand-500">Subtotal</span>
                <span className="text-xs font-black text-brand-800" style={monoStyle}>
                  {fmtMoney(fatura.subtotal, fatura.valuta)}
                </span>
              </div>
              {fatura.momsTotal > 0 ? (
                <div className="flex justify-between border-b border-brand-200 px-3 py-1.5">
                  <span className="text-xs font-bold text-brand-500">Moms (KDV)</span>
                  <span className="text-xs font-black text-brand-800" style={monoStyle}>
                    {fmtMoney(fatura.momsTotal, fatura.valuta)}
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-sm font-black uppercase tracking-wider text-brand-700">Kredit</span>
                <span className="text-sm font-black text-brand-900" style={monoStyle}>
                  {fmtMoney(fatura.total, fatura.valuta)}
                </span>
              </div>
            </div>
          </div>

          {fatura.note ? (
            <div className="border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="mb-1 text-xs font-black uppercase tracking-wider text-amber-700">Not</p>
              <p className="text-sm text-amber-800">{fatura.note}</p>
            </div>
          ) : null}

          {/* U12 — Invoice timeline (basit, mevcut alanlardan inşa) */}
          <div className="border border-brand-200 bg-white">
            <div className="border-b border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-xs font-black uppercase tracking-widest text-brand-700">Fatura Zaman Çizelgesi</p>
            </div>
            <ul className="divide-y divide-brand-100">
              <li className="flex items-center gap-3 px-3 py-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span className="flex-1 text-brand-800">Fatura oluşturuldu</span>
                <span className="text-brand-500" style={monoStyle}>
                  {new Date(fatura.fakturadato).toLocaleDateString('da-DK')}
                </span>
              </li>
              {fatura.mailSendt ? (
                <li className="flex items-center gap-3 px-3 py-2 text-xs">
                  <Mail className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="flex-1 text-brand-800">E-posta gönderildi</span>
                  <span className="text-brand-500" style={monoStyle}>
                    {fatura.mailSendt}
                  </span>
                </li>
              ) : (
                <li className="flex items-center gap-3 px-3 py-2 text-xs">
                  <Mail className="h-3.5 w-3.5 text-brand-300" />
                  <span className="flex-1 text-brand-400">E-posta gönderilmedi</span>
                </li>
              )}
              {fatura.eFakturaSendt ? (
                <li className="flex items-center gap-3 px-3 py-2 text-xs">
                  <Send className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="flex-1 text-brand-800">E-fatura (OIOUBL XML) gönderildi</span>
                  <span className="text-brand-500" style={monoStyle}>
                    {fatura.eFakturaSendt}
                  </span>
                </li>
              ) : (
                <li className="flex items-center gap-3 px-3 py-2 text-xs">
                  <Send className="h-3.5 w-3.5 text-brand-300" />
                  <span className="flex-1 text-brand-400">E-fatura gönderilmedi</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function UnicontaPageView({
  kimlik,
  setKimlik,
  ayarlarAcik,
  setAyarlarAcik,
  secilenFatura,
  setSecilenFatura,
  aramaQ,
  setAramaQ,
  tipFiltre,
  setTipFiltre,
  mailFiltre,
  setMailFiltre,
  eFaturaFiltre,
  setEFaturaFiltre,
  tarihFiltre,
  setTarihFiltre,
  sortKey,
  sortDir,
  filtrePanelAcik,
  setFiltrePanelAcik,
  faturalar,
  filtrelenmis,
  baglantiDurumu,
  yukleniyor,
  sonYenileme,
  stats,
  activeFilters,
  baglan,
  yenile,
  sort,
  syncSummary,
  syncSummaryLoading,
  failedSyncs,
  failedSyncsLoading,
  pendingSyncCount,
  onRetryAll,
  retryingAll,
  lastBulkRetryResult,
  health,
  onRetryFailed,
  retryingSingleSeq,
}: UseUnicontaMakeStateResult) {
  const [failedPanelOpen, setFailedPanelOpen] = useState(false);
  const [lastPdfFatura, setLastPdfFatura] = useState<Fatura | null>(null);
  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? <ChevronUp className="ml-0.5 inline h-3 w-3" /> : <ChevronDown className="ml-0.5 inline h-3 w-3" />) : null;

  const thCls = 'cursor-pointer whitespace-nowrap px-3 py-2 text-left text-xs font-black uppercase tracking-wider text-brand-500 transition-colors hover:bg-brand-200 hover:text-brand-900 select-none';

  const [pdfState, setPdfState] = useState<{ url: string | null; filename: string; loading: boolean; error: string | null }>(
    { url: null, filename: '', loading: false, error: null },
  );

  const handlePdfRequest = async (fatura: Fatura) => {
    setLastPdfFatura(fatura);
    setPdfState((current) => ({ ...current, loading: true, error: null }));
    try {
      const params = new URLSearchParams({
        invoiceNumber: String(fatura.fakturanummer),
        account: fatura.konto,
        date: fatura.fakturadato,
      });
      const { url } = await fetchAuthedPdfBlob(`/api/v2/uniconta/invoice-pdf?${params.toString()}`);
      setPdfState({ url, filename: `uniconta-${fatura.fakturanummer}.pdf`, loading: false, error: null });
    } catch (exc) {
      const raw = exc instanceof Error ? exc.message : 'PDF yüklenemedi.';
      // U5 — Friendly error parse (basit Türkçe eşleştirme)
      let message = raw;
      if (raw.includes('401') || raw.toLowerCase().includes('auth')) message = 'Uniconta oturumu süresi dolmuş. Bağlanıp tekrar deneyin.';
      else if (raw.includes('404')) message = 'Bu fatura için PDF Uniconta\'da bulunamadı.';
      else if (raw.toLowerCase().includes('timeout')) message = 'Uniconta yanıt vermedi. Tekrar deneyin.';
      else if (raw.toLowerCase().includes('network')) message = 'Ağ bağlantınızı kontrol edin.';
      else if (raw.toLowerCase().includes('5')) message = 'Uniconta sunucu hatası — geçici olabilir.';
      setPdfState({ url: null, filename: '', loading: false, error: message });
    }
  };

  const handlePdfRetry = () => {
    if (lastPdfFatura) void handlePdfRequest(lastPdfFatura);
  };

  const handlePdfClose = () => {
    setPdfState((current) => {
      if (current.url) URL.revokeObjectURL(current.url);
      return { url: null, filename: '', loading: false, error: null };
    });
  };

  useEffect(() => {
    return () => {
      if (pdfState.url) URL.revokeObjectURL(pdfState.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-full flex-col bg-white" style={sansStyle}>
      <div className="flex flex-col gap-3 border-b-2 border-brand-300 bg-brand-50 px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Building2 className="h-5 w-5 text-brand-600" />
          <div>
            <h2 className="text-lg font-black uppercase tracking-wider text-brand-900">Uniconta Faturalar</h2>
            <p className="text-xs text-brand-500">ERP entegrasyonu — fatura ve gönderim takibi</p>
          </div>

          <div
            className={`ml-auto flex items-center gap-2 border px-3 py-1.5 text-xs font-bold ${
              baglantiDurumu === 'bagli'
                ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                : baglantiDurumu === 'hata'
                  ? 'border-red-400 bg-red-50 text-red-700'
                  : baglantiDurumu === 'yukleniyor'
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-brand-300 bg-brand-100 text-brand-500'
            }`}
          >
            {baglantiDurumu === 'bagli' ? <Wifi className="h-3.5 w-3.5" /> : null}
            {baglantiDurumu === 'bagli_degil' ? <WifiOff className="h-3.5 w-3.5" /> : null}
            {baglantiDurumu === 'hata' ? <AlertCircle className="h-3.5 w-3.5" /> : null}
            {baglantiDurumu === 'yukleniyor' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {baglantiDurumu === 'bagli' ? 'Uniconta Bağlı' : baglantiDurumu === 'bagli_degil' ? 'Demo Modu' : baglantiDurumu === 'hata' ? 'Bağlantı Hatası' : 'Bağlanıyor'}
          </div>

          <div className="flex items-center gap-2">
            {sonYenileme ? (
              <span className="text-xs text-brand-400" style={monoStyle}>
                Son: {sonYenileme.toLocaleTimeString('tr-TR', { hour12: false })}
              </span>
            ) : null}
            <button
              onClick={yenile}
              disabled={yukleniyor || baglantiDurumu !== 'bagli'}
              className="flex items-center gap-1.5 border border-brand-300 bg-white px-3 py-2 text-xs font-bold text-brand-600 hover:bg-brand-100 disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${yukleniyor ? 'animate-spin' : ''}`} />
              Yenile
            </button>
            <button
              onClick={() => setAyarlarAcik(true)}
              className="flex items-center gap-1.5 border border-brand-900 bg-brand-800 px-3 py-2 text-xs font-bold text-white hover:bg-brand-900"
            >
              <Settings className="h-3.5 w-3.5" />
              API Ayarları
            </button>
          </div>
        </div>
      </div>

      {baglantiDurumu === 'bagli_degil' ? (
        <div className="flex flex-col items-stretch gap-4 border-b border-amber-300 bg-amber-50 px-6 py-6">
          <div className="flex items-center gap-3">
            <Info className="h-5 w-5 flex-shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-black uppercase tracking-widest text-amber-800">Uniconta Yapılandırılmamış</p>
              <p className="mt-1 text-xs text-amber-700">
                Aşağıdaki demo veriler örnek; canlı fatura akışını başlatmak için API ayarlarınızı girin.
              </p>
            </div>
            <button
              onClick={() => setAyarlarAcik(true)}
              className="flex-shrink-0 inline-flex items-center gap-2 border border-amber-700 bg-amber-700 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-amber-800"
            >
              <Settings className="h-3.5 w-3.5" /> API Ayarlarını Aç
            </button>
          </div>
          <ol className="grid gap-2 text-xs text-amber-800 sm:grid-cols-3">
            <li className="border border-amber-300 bg-white px-3 py-2">1. Company ID + kullanıcı + şifreyi girin.</li>
            <li className="border border-amber-300 bg-white px-3 py-2">2. "Test ve Kaydet" ile canlı bağlantıyı doğrulayın.</li>
            <li className="border border-amber-300 bg-white px-3 py-2">3. Alış finalize edildiğinde otomatik DebtorInvoice çıkacak.</li>
          </ol>
        </div>
      ) : null}

      {/* U7 + U8 + U9 + U11 + U6 — Sync summary + pending list + bulk retry + health */}
      {baglantiDurumu !== 'bagli_degil' && syncSummary ? (
        <div className="border-b border-brand-200 bg-white">
          <div className="flex flex-wrap items-center gap-4 px-6 py-3">
            <Activity className="h-4 w-4 text-emerald-700" />
            <span className="text-xs font-black uppercase tracking-widest text-brand-700">
              Son 24 Saat Sync
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-2 py-1 font-black uppercase tracking-widest text-emerald-800">
                <CheckCircle2 className="h-3 w-3" />
                {syncSummary.synced} sync
              </span>
              {syncSummary.failed > 0 ? (
                <span className="inline-flex items-center gap-1 border border-rose-300 bg-rose-50 px-2 py-1 font-black uppercase tracking-widest text-rose-800">
                  <AlertTriangle className="h-3 w-3" />
                  {syncSummary.failed} hata
                </span>
              ) : null}
              {syncSummary.skipped > 0 ? (
                <span className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-1 font-black uppercase tracking-widest text-amber-800">
                  {syncSummary.skipped} atlandı
                </span>
              ) : null}
              {pendingSyncCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setFailedPanelOpen((open) => !open)}
                  className="inline-flex items-center gap-1 border border-amber-500 bg-amber-100 px-2 py-1 font-black uppercase tracking-widest text-amber-900 hover:bg-amber-200"
                  title="Sync bekleyen AFG'leri göster"
                >
                  <AlertCircle className="h-3 w-3" />
                  {pendingSyncCount} bekliyor
                  {failedPanelOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              ) : null}
            </div>

            {syncSummary.last_synced_at ? (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-brand-500" style={monoStyle}>
                <Clock className="h-3 w-3" />
                Son: {new Date(syncSummary.last_synced_at).toLocaleString('tr-TR', { hour12: false })}
              </span>
            ) : null}

            {health && health.has_token && health.minutes_to_expiry != null ? (
              <span
                className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                  health.minutes_to_expiry > 10
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-amber-300 bg-amber-50 text-amber-800'
                }`}
              >
                Token {health.minutes_to_expiry}dk
              </span>
            ) : null}

            {pendingSyncCount > 0 ? (
              <button
                type="button"
                onClick={onRetryAll}
                disabled={retryingAll}
                className="inline-flex items-center gap-1.5 border border-amber-700 bg-amber-600 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60"
              >
                {retryingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                Tümünü Tekrar Dene
              </button>
            ) : null}
          </div>

          {failedPanelOpen && pendingSyncCount > 0 ? (
            <div className="border-t border-brand-200 bg-rose-50/30 px-6 py-3">
              {failedSyncsLoading ? (
                <div className="text-xs text-brand-500">Yükleniyor...</div>
              ) : failedSyncs.length === 0 ? (
                <div className="text-xs text-brand-400">Bekleyen sync yok.</div>
              ) : (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-brand-200">
                      <th className="px-2 py-1.5 text-left font-black uppercase tracking-wider text-brand-600">AFG</th>
                      <th className="px-2 py-1.5 text-left font-black uppercase tracking-wider text-brand-600">Tarih</th>
                      <th className="px-2 py-1.5 text-left font-black uppercase tracking-wider text-brand-600">Müşteri</th>
                      <th className="px-2 py-1.5 text-right font-black uppercase tracking-wider text-brand-600">Tutar</th>
                      <th className="px-2 py-1.5 text-left font-black uppercase tracking-wider text-brand-600">Durum</th>
                      <th className="px-2 py-1.5 text-left font-black uppercase tracking-wider text-brand-600">Hata</th>
                      <th className="px-2 py-1.5 text-center font-black uppercase tracking-wider text-brand-600">Aksiyon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedSyncs.slice(0, 25).map((row) => (
                      <tr key={row.sequence_no} className="border-b border-brand-100">
                        <td className="px-2 py-1.5 text-brand-900" style={monoStyle}>
                          {row.document_number || `#${row.sequence_no}`}
                        </td>
                        <td className="px-2 py-1.5 text-brand-600" style={monoStyle}>
                          {row.issued_at ? new Date(row.issued_at).toLocaleDateString('da-DK') : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-brand-700">{row.customer_name || '—'}</td>
                        <td className="px-2 py-1.5 text-right text-brand-800" style={monoStyle}>
                          {row.gross_amount_dkk ? Number(row.gross_amount_dkk).toFixed(0) : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`inline-flex border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                              row.uniconta_sync_status === 'failed'
                                ? 'border-rose-300 bg-rose-100 text-rose-800'
                                : 'border-amber-300 bg-amber-100 text-amber-800'
                            }`}
                          >
                            {row.uniconta_sync_status || '—'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 max-w-xs truncate text-rose-700" title={row.uniconta_sync_error || ''}>
                          {row.uniconta_sync_error || '—'}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => onRetryFailed(row.sequence_no)}
                            disabled={retryingSingleSeq === row.sequence_no}
                            className="inline-flex items-center gap-1 border border-amber-400 bg-white px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-800 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-60"
                          >
                            {retryingSingleSeq === row.sequence_no ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCw className="h-3 w-3" />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {lastBulkRetryResult ? (
                <div className="mt-2 border border-brand-200 bg-white px-3 py-2 text-[11px] text-brand-600">
                  Son toplu retry: <strong>{lastBulkRetryResult.succeeded}</strong> başarılı / <strong>{lastBulkRetryResult.failed}</strong> başarısız (toplam {lastBulkRetryResult.attempted})
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 overflow-x-auto border-b border-brand-200 bg-white px-6 py-3">
        {[
          { label: 'Toplam Fatura', value: String(stats.toplam), icon: <FileText className="h-4 w-4 text-brand-500" />, color: 'text-brand-900' },
          { label: 'Toplam Kredit', value: fmtMoney(stats.toplamKredit), icon: <ReceiptText className="h-4 w-4 text-brand-500" />, color: 'text-brand-900' },
        ].map((item) => (
          <div key={item.label} className="flex flex-shrink-0 items-center gap-2 border-r border-brand-200 pr-4 last:border-r-0 last:pr-0">
            {item.icon}
            <div>
              <p className="whitespace-nowrap text-xs uppercase tracking-wider text-brand-400">{item.label}</p>
              <p className={`whitespace-nowrap text-sm font-black ${item.color}`} style={monoStyle}>
                {item.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2.5">
        <div className="flex min-w-48 flex-1 items-center gap-2 border border-brand-300 bg-white px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-brand-400" />
          <input
            value={aramaQ}
            onChange={(event) => setAramaQ(event.target.value)}
            placeholder="Faktura no, kontonavn, konto no..."
            className="flex-1 bg-transparent text-sm text-brand-800 placeholder-brand-400 focus:outline-none"
          />
          {aramaQ ? (
            <button onClick={() => setAramaQ('')}>
              <X className="h-3 w-3 text-brand-400" />
            </button>
          ) : null}
        </div>

        <button
          onClick={() => setFiltrePanelAcik((current) => !current)}
          className={`flex items-center gap-1.5 border px-3 py-1.5 text-xs font-bold transition-colors ${
            filtrePanelAcik || activeFilters > 0
              ? 'border-amber-700 bg-amber-600 text-white'
              : 'border-brand-300 bg-white text-brand-600 hover:bg-brand-100'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          Filtrele
          {activeFilters > 0 ? (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-xs font-black text-amber-700">{activeFilters}</span>
          ) : null}
        </button>

        <span className="text-xs text-brand-400" style={monoStyle}>
          {filtrelenmis.length} / {faturalar.length} fatura
        </span>
      </div>

      {filtrePanelAcik ? (
        <div className="flex flex-wrap items-center gap-4 border-b border-brand-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-500">Tür:</span>
            {(['Tümü', 'Salgsfaktura', 'Kreditnota', 'Forudbetaling', 'Rentefaktura'] as Array<FaturaTipi | 'Tümü'>).map((type) => (
              <button
                key={type}
                onClick={() => setTipFiltre(type)}
                className={`border px-2 py-0.5 text-xs font-bold ${
                  tipFiltre === type
                    ? 'border-brand-900 bg-brand-800 text-white'
                    : 'border-brand-300 bg-white text-brand-600 hover:border-brand-600'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-brand-500" />
            <span className="text-xs font-black uppercase tracking-wider text-brand-500">Mail:</span>
            {[
              ['tümü', 'Tümü'],
              ['gonderildi', 'Gönderildi'],
              ['gonderilmedi', 'Gönderilmedi'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMailFiltre(value as UseUnicontaMakeStateResult['mailFiltre'])}
                className={`border px-2 py-0.5 text-xs font-bold ${
                  mailFiltre === value
                    ? 'border-brand-900 bg-brand-800 text-white'
                    : 'border-brand-300 bg-white text-brand-600 hover:border-brand-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Send className="h-3.5 w-3.5 text-brand-500" />
            <span className="text-xs font-black uppercase tracking-wider text-brand-500">E-faktura:</span>
            {[
              ['tümü', 'Tümü'],
              ['gonderildi', 'Gönderildi'],
              ['gonderilmedi', 'Gönderilmedi'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setEFaturaFiltre(value as UseUnicontaMakeStateResult['eFaturaFiltre'])}
                className={`border px-2 py-0.5 text-xs font-bold ${
                  eFaturaFiltre === value
                    ? 'border-brand-900 bg-brand-800 text-white'
                    : 'border-brand-300 bg-white text-brand-600 hover:border-brand-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-brand-500" />
            {[
              ['tümü', 'Tümü'],
              ['bu_ay', 'Bu Ay'],
              ['son_3ay', 'Son 3 Ay'],
              ['bu_yil', 'Bu Yıl'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTarihFiltre(value as UseUnicontaMakeStateResult['tarihFiltre'])}
                className={`border px-2 py-0.5 text-xs font-bold ${
                  tarihFiltre === value
                    ? 'border-brand-900 bg-brand-800 text-white'
                    : 'border-brand-300 bg-white text-brand-600 hover:border-brand-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse" style={{ minWidth: '860px' }}>
          <thead>
            <tr className="sticky top-0 z-10 border-b-2 border-brand-300 bg-brand-100">
              <th className={thCls} onClick={() => sort('konto')}>Konto {sortIcon('konto')}</th>
              <th className={thCls} onClick={() => sort('kunde')}>Kontonavn {sortIcon('kunde')}</th>
              <th className={thCls} onClick={() => sort('fakturadato')}>Dato {sortIcon('fakturadato')}</th>
              <th className={thCls} onClick={() => sort('fakturanummer')}>Faktura No {sortIcon('fakturanummer')}</th>
              <th className={`${thCls} text-right`} onClick={() => sort('total')}>Kredit {sortIcon('total')}</th>
            </tr>
          </thead>
          <tbody>
            {filtrelenmis.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-sm text-brand-400">
                  {faturalar.length === 0 ? "Uniconta'ya bağlanarak faturalara erişin." : 'Filtrelerle eşleşen fatura bulunamadı.'}
                </td>
              </tr>
            ) : (
              filtrelenmis.map((fatura) => (
                <tr
                  key={fatura.id}
                  className="cursor-pointer border-b border-brand-100 transition-colors hover:bg-brand-50"
                  onClick={() => setSecilenFatura(fatura)}
                >
                  <td className="px-3 py-2.5">
                    <span className="text-sm font-black text-brand-900" style={monoStyle}>
                      {fatura.konto}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="max-w-[200px] truncate text-sm font-bold text-brand-800">{fatura.kunde.navn}</p>
                    {fatura.kunde.cvr ? (
                      <p className="text-xs text-brand-400" style={monoStyle}>
                        CVR {fatura.kunde.cvr}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-brand-700" style={monoStyle}>
                    {fmtDate(fatura.fakturadato)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-sm font-black text-brand-900" style={monoStyle}>
                      #{fatura.fakturanummer}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`text-sm font-black ${fatura.total < 0 ? 'text-purple-700' : 'text-brand-900'}`} style={monoStyle}>
                      {fmtMoney(fatura.total, fatura.valuta)}
                    </span>
                    {fatura.valuta !== 'DKK' ? <span className="block text-xs text-brand-400">{fatura.valuta}</span> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {filtrelenmis.length > 0 ? (
            <tfoot>
              <tr className="sticky bottom-0 border-t-2 border-brand-300 bg-brand-100">
                <td colSpan={6} className="px-3 py-2">
                  <span className="text-xs font-black uppercase tracking-wider text-brand-600">{filtrelenmis.length} Fatura</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="text-sm font-black text-brand-900" style={monoStyle}>
                    {fmtMoney(filtrelenmis.reduce((sum, item) => sum + item.total, 0))}
                  </span>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {ayarlarAcik ? (
        <BaglantiPanel
          kimlik={kimlik}
          onChange={setKimlik}
          onKapat={() => setAyarlarAcik(false)}
          onBaglan={baglan}
          baglantiDurumu={baglantiDurumu}
        />
      ) : null}
      {secilenFatura ? (
        <FaturaDetay
          fatura={secilenFatura}
          onKapat={() => setSecilenFatura(null)}
          onPdfRequest={handlePdfRequest}
          pdfLoading={pdfState.loading}
        />
      ) : null}
      <PdfViewerModal
        open={Boolean(pdfState.url)}
        pdfUrl={pdfState.url}
        filename={pdfState.filename}
        title="Uniconta Fatura PDF"
        onClose={handlePdfClose}
      />
      {pdfState.error ? (
        <div className="fixed bottom-4 right-4 z-[60] max-w-md border border-rose-300 bg-rose-50 px-4 py-3 text-xs text-rose-700 shadow-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-bold uppercase tracking-wider">PDF Hatası</p>
              <p className="mt-1">{pdfState.error}</p>
              <div className="mt-2 flex items-center gap-2">
                {lastPdfFatura ? (
                  <button
                    type="button"
                    onClick={handlePdfRetry}
                    className="inline-flex items-center gap-1 border border-rose-400 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-rose-700 hover:bg-rose-100"
                  >
                    <RotateCw className="h-3 w-3" />
                    Tekrar Dene
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPdfState((current) => ({ ...current, error: null }))}
                  className="inline-flex items-center gap-1 border border-brand-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-brand-700 hover:bg-brand-50"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MakeUnicontaPage() {
  const state = useUnicontaMakeState();
  return <UnicontaPageView {...state} />;
}
