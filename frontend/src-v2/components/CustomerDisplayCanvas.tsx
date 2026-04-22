import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { formatNumber } from '@/lib/format';
import type { PosDisplaySnapshot } from '@/types';

type CustomerDisplayIdleViewProps = {
  embedded?: boolean;
  now?: Date;
};

type CustomerDisplayLiveViewProps = {
  snapshot: PosDisplaySnapshot;
  connection: 'connecting' | 'live' | 'offline';
  embedded?: boolean;
};

const DISPLAY_SCENE_WIDTH = 1920;
const DISPLAY_SCENE_HEIGHT = 1080;

function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function timeLabel(value?: Date) {
  if (!value) return '—';
  return value.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function decimalLabel(value?: string | number | null, suffix = '') {
  const formatted = formatNumber(value, suffix);
  return formatted === '-' ? '—' : formatted;
}

function displayTypeLabel(snapshot: PosDisplaySnapshot, line: PosDisplaySnapshot['lines'][number]) {
  if (line.type_label) return line.type_label;
  if (line.product_type) return line.product_type;
  if (line.metal_type === 'silver') return 'Sølv (Gümüş)';
  if (line.metal_type === 'gold' || line.metal_type === 'yellow_gold' || line.metal_type === 'white_gold') {
    return 'Guld (Altın)';
  }
  if (snapshot.trade_side === 'buy_from_customer') return 'Takı';
  return 'Ürün';
}

function purityLabel(line: PosDisplaySnapshot['lines'][number]) {
  if (line.lodighed) return line.lodighed;
  if (line.purity_percentage) return decimalLabel(line.purity_percentage, '%');
  return '—';
}

function computeTotalWeight(snapshot: PosDisplaySnapshot) {
  if (snapshot.total_weight_grams) return snapshot.total_weight_grams;
  const total = snapshot.lines.reduce((sum, line) => sum + (Number(line.weight_grams) || 0), 0);
  return String(total);
}

function parseDecimalValue(value?: string | number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasWorksheetGram(value?: string | number | null) {
  return parseDecimalValue(value) > 0;
}

function useDisplaySceneScale() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: DISPLAY_SCENE_WIDTH, height: DISPLAY_SCENE_HEIGHT });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: Math.max(rect.width, 1),
        height: Math.max(rect.height, 1),
      });
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return {
    containerRef,
    scaleX: size.width / DISPLAY_SCENE_WIDTH,
    scaleY: size.height / DISPLAY_SCENE_HEIGHT,
  };
}

function Field({
  label,
  value,
  wrap = false,
}: {
  label: string;
  value: string;
  wrap?: boolean;
}) {
  return (
    <div className="flex min-h-[6.2rem] flex-col justify-center bg-white px-5 py-4">
      <span className="mb-2 text-[0.72rem] font-black uppercase tracking-[0.2em] text-brand-500">{label}</span>
      <div className="min-w-0">
        <span
          className={`block text-[1.52rem] font-black text-brand-900 ${
            wrap ? 'break-words leading-[1.15]' : 'truncate leading-tight'
          }`}
        >
          {value || '—'}
        </span>
      </div>
    </div>
  );
}

function DisplaySceneViewport({
  children,
  embedded = false,
  backgroundClassName = 'bg-white',
}: {
  children: ReactNode;
  embedded?: boolean;
  backgroundClassName?: string;
}) {
  const { containerRef, scaleX, scaleY } = useDisplaySceneScale();

  return (
    <div className={embedded ? 'relative aspect-video w-full overflow-hidden' : 'relative h-screen w-screen overflow-hidden'}>
      <div ref={containerRef} className={`relative h-full w-full overflow-hidden ${backgroundClassName}`}>
        <div
          className="origin-top-left"
          style={{
            width: `${DISPLAY_SCENE_WIDTH}px`,
            height: `${DISPLAY_SCENE_HEIGHT}px`,
            transform: `scale(${scaleX}, ${scaleY})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function CustomerDisplayIdleView({ embedded = false, now = new Date() }: CustomerDisplayIdleViewProps) {
  const scene = (
    <div className="flex h-[1080px] w-[1920px] flex-col bg-[#16100b] px-10 py-8" style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div className="flex h-full w-full flex-col items-center justify-center border-2 border-brand-600 bg-brand-900">
        <div className="min-w-[560px] border-2 border-brand-600 bg-brand-800 px-16 py-12 text-center">
          <div className="mb-8 border-b-2 border-brand-600 pb-8">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-brand-400">Kuyumcu Sistemi</p>
            <h1 className="text-5xl font-black tracking-tight text-brand-50">SeruGold</h1>
          </div>

          <div className="mb-8 space-y-1">
            <p className="text-sm text-brand-300">Müşteri Gösterge Ekranı</p>
            <p className="text-xs text-brand-500">Customer Display Terminal</p>
          </div>

          <div className="mb-8 inline-block border border-brand-600 bg-brand-900 px-8 py-4">
            <p className="mono text-4xl font-black tabular-nums text-brand-100">{timeLabel(now)}</p>
          </div>

          <div className="border border-brand-600 bg-brand-900/50 px-6 py-3">
            <p className="text-sm font-medium tracking-wide text-brand-400">İşlem bekleniyor / Awaiting transaction</p>
          </div>
        </div>
        <div className="mt-6 space-x-6 text-center text-xs text-brand-600">
          <span>Şeffaf İşlem</span>
          <span>•</span>
          <span>Güncel Piyasa Değeri</span>
          <span>•</span>
          <span>Anında Hesaplama</span>
        </div>
      </div>
    </div>
  );

  return (
    <DisplaySceneViewport embedded={embedded} backgroundClassName="bg-[#16100b]">
      {scene}
    </DisplaySceneViewport>
  );
}

export function CustomerDisplayLiveView({
  snapshot,
  connection,
  embedded = false,
}: CustomerDisplayLiveViewProps) {
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const activeLines = useMemo(
    () => (snapshot.lines || []).filter((line) => line.type_label || line.product_type || line.weight_grams || line.line_offer_dkk),
    [snapshot.lines],
  );
  const goldRows = snapshot.gold_rows || [];
  const silverRows = snapshot.silver_rows || [];
  const hasWorksheet = goldRows.length > 0 || silverRows.length > 0;
  const activeWorksheetCount = useMemo(
    () => [...goldRows, ...silverRows].filter((row) => hasWorksheetGram(row.gram)).length,
    [goldRows, silverRows],
  );
  const goldWorksheetWeight = useMemo(
    () => goldRows.reduce((sum, row) => sum + parseDecimalValue(row.gram), 0),
    [goldRows],
  );
  const silverWorksheetWeight = useMemo(
    () => silverRows.reduce((sum, row) => sum + parseDecimalValue(row.gram), 0),
    [silverRows],
  );
  const worksheetTotalAmount = useMemo(
    () => [...goldRows, ...silverRows].reduce((sum, row) => sum + parseDecimalValue(row.line_total_dkk), 0),
    [goldRows, silverRows],
  );
  const totalWeight = useMemo(
    () => (hasWorksheet ? String(goldWorksheetWeight + silverWorksheetWeight) : computeTotalWeight(snapshot)),
    [goldWorksheetWeight, hasWorksheet, silverWorksheetWeight, snapshot],
  );
  const totalAmount = useMemo(() => {
    if (hasWorksheet) {
      return snapshot.lines_total_dkk || worksheetTotalAmount.toFixed(2);
    }
    return snapshot.lines_total_dkk || snapshot.final_offer_dkk || '0';
  }, [hasWorksheet, snapshot.final_offer_dkk, snapshot.lines_total_dkk, worksheetTotalAmount]);
  const goldReferenceRate =
    activeLines.find((line) => line.metal_type?.includes('gold'))?.unit_price_dkk ||
    activeLines.find((line) => line.metal_type?.includes('gold'))?.rate_dkk ||
    goldRows.find((row) => hasWorksheetGram(row.gram))?.rate_dkk ||
    snapshot.rate_dkk ||
    null;
  const silverReferenceRate =
    activeLines.find((line) => line.metal_type === 'silver')?.unit_price_dkk ||
    activeLines.find((line) => line.metal_type === 'silver')?.rate_dkk ||
    silverRows.find((row) => hasWorksheetGram(row.gram))?.rate_dkk ||
    silverRows[0]?.rate_dkk ||
    null;
  const customerFields = useMemo(
    () =>
      [
        { label: 'Telefon / Tlf.', value: snapshot.customer_phone, wrap: false },
        { label: 'E-mail', value: snapshot.customer_email, wrap: true },
        { label: 'CPR Numarası', value: snapshot.customer_cpr, wrap: false },
        {
          label: 'Kørekort / Pas',
          value: snapshot.customer_identity_doc_number,
          wrap: false,
        },
        { label: 'Adres', value: snapshot.customer_address, wrap: true },
        { label: 'Postnr.', value: snapshot.customer_postal_code, wrap: false },
        { label: 'Şehir / By', value: snapshot.customer_city, wrap: false },
        { label: 'Tarih', value: dateLabel(snapshot.updated_at), wrap: false },
      ].filter((field) => field.value && field.value !== '—'),
    [
      snapshot.customer_address,
      snapshot.customer_cpr,
      snapshot.customer_city,
      snapshot.customer_email,
      snapshot.customer_identity_doc_number,
      snapshot.customer_phone,
      snapshot.customer_postal_code,
      snapshot.updated_at,
    ],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const scene = (
    <div
      className="flex h-[1080px] w-[1920px] flex-col overflow-hidden bg-white"
      style={{ fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}
    >
      <div className="border-b-4 border-brand-600 bg-brand-900">
        <div className="flex items-stretch">
          <div className="flex shrink-0 items-center space-x-4 border-r-2 border-brand-700 px-6 py-3">
            <div className="text-left">
              <p className="text-xs font-bold uppercase tracking-widest text-brand-400">Kuyumcu Sistemi</p>
              <h1 className="text-2xl font-black tracking-tight text-brand-50">SeruGold</h1>
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex shrink-0 flex-col items-center justify-center border-l-2 border-brand-700 px-5 py-2.5">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500">Afregningsnr.</p>
            <p className="mono text-3xl font-black tabular-nums text-brand-50">
              {snapshot.document_number || snapshot.session_code}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-center justify-center border-l-2 border-brand-700 px-5 py-2.5">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500">Dato</p>
            <p className="text-xl font-bold tabular-nums text-brand-100">{dateLabel(snapshot.updated_at)}</p>
          </div>

          <div className="flex shrink-0 flex-col items-center justify-center border-l-2 border-brand-700 bg-brand-800 px-5 py-2.5">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500">Saat</p>
            <p className="text-2xl font-black tabular-nums text-brand-50">{timeLabel(currentTime)}</p>
          </div>
        </div>
      </div>

      <div className="border-b-2 border-brand-200 bg-brand-50 px-5 py-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-6">
            <div className="flex items-center gap-2 border-r border-brand-200 pr-4">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-500">Altın 24K:</span>
              <span className="text-sm font-black tabular-nums text-brand-800">
                {goldReferenceRate ? `${decimalLabel(goldReferenceRate)} DKK/g` : '—'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-500">Gümüş:</span>
              <span className="text-sm font-black tabular-nums text-brand-800">
                {silverReferenceRate ? `${decimalLabel(silverReferenceRate)} DKK/g` : '—'}
              </span>
            </div>
          </div>
          <span
            className={`text-[11px] font-black uppercase tracking-wider ${
              connection === 'offline'
                ? 'text-rose-500'
                : connection === 'connecting'
                  ? 'text-amber-600'
                  : 'text-brand-400'
            }`}
          >
            {connection === 'offline' ? 'Bağlantı bekleniyor' : connection === 'connecting' ? 'Bağlanıyor' : 'Referans piyasa değerleri'}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[25rem] shrink-0 flex-col border-r-4 border-brand-200 bg-white">
          <div className="border-b-2 border-brand-600 bg-brand-800 px-5 py-4">
            <p className="text-xs font-black uppercase tracking-widest text-brand-300">Müşteri Bilgileri</p>
            <p className="text-xs text-brand-500">Kundeoplysninger</p>
          </div>

          <div className="border-b-2 border-brand-200 bg-brand-50 px-5 py-6">
            <p className="mb-2 text-[0.72rem] font-black uppercase tracking-[0.2em] text-brand-500">Navn / Ad Soyad</p>
            <p className="text-[2.45rem] font-black leading-[1.02] text-brand-900">{snapshot.customer_name || '—'}</p>
          </div>

          <div className="flex flex-1 flex-col bg-brand-200">
            {customerFields.map((field) => (
              <Field key={field.label} label={field.label} value={field.value || '—'} wrap={field.wrap} />
            ))}
          </div>

          <div className="border-t-2 border-brand-300 bg-brand-100 px-4 py-2.5">
            <p className="text-center text-[11px] font-semibold text-brand-700">Lütfen bilgilerinizi kontrol edin</p>
            <p className="mt-0.5 text-center text-[11px] text-brand-500">Kontroller venligst dine oplysninger</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col bg-white">
          <div className="border-b-2 border-brand-600 bg-brand-800 px-4 py-2.5">
            <p className="text-xs font-black uppercase tracking-widest text-brand-300">Ürün Detayları & Fiyatlandırma</p>
            <p className="text-xs text-brand-500">Produktdetaljer og prisfastsættelse</p>
          </div>

          <div className="flex-1 overflow-hidden">
            {hasWorksheet ? (
              <>
                <div className="flex items-center justify-between border-b border-brand-600 bg-brand-800 px-4 py-1.5">
                  <p className="text-xs font-black uppercase tracking-widest text-brand-300">Ürün Detayları — Guld & Sølv</p>
                </div>
                <table className="w-full border-collapse text-[0.96rem]">
                  <thead>
                    <tr className="border-b-2 border-brand-400">
                      <th className="border border-brand-300 bg-brand-100 px-3 py-2.5 text-left text-[0.82rem] font-black uppercase tracking-wider text-brand-600">Açıklama</th>
                      <th className="w-24 border border-brand-300 bg-brand-100 px-3 py-2.5 text-center text-[0.82rem] font-black uppercase tracking-wider text-brand-600">Karat</th>
                      <th className="w-24 border border-brand-300 bg-brand-100 px-3 py-2.5 text-center text-[0.82rem] font-black uppercase tracking-wider text-brand-600">Lødighed</th>
                      <th className="w-32 border border-amber-300 bg-amber-100 px-3 py-2.5 text-center text-[0.82rem] font-black uppercase tracking-wider text-amber-800">Vægt i g</th>
                      <th className="w-40 border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-right text-[0.82rem] font-black uppercase tracking-wider text-emerald-700">Enhedspris/g</th>
                      <th className="w-44 border border-emerald-300 bg-emerald-100 px-3 py-2.5 text-right text-[0.82rem] font-black uppercase tracking-wider text-emerald-800">I alt (DKK)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goldRows.map((row, index) => {
                      const hasGram = hasWorksheetGram(row.gram);
                      return (
                        <tr
                          key={row.row_key}
                          className={`h-[3.45rem] border-b transition-colors ${hasGram ? 'border-amber-200 border-l-4 border-l-amber-400' : 'border-brand-100 border-l-4 border-l-transparent opacity-70'}`}
                          style={{ background: hasGram ? '#fffbeb' : '#ffffff' }}
                        >
                          <td className="border border-brand-300 px-3 py-2.5">
                            <span className="text-[1rem] font-semibold text-brand-800">Guld</span>
                            <span className="ml-2 bg-amber-100 px-2 py-0.5 text-[0.86rem] font-bold text-amber-700">{row.label}</span>
                          </td>
                          <td className="mono border border-brand-300 px-3 py-2.5 text-center text-[0.95rem] font-bold text-amber-700">{decimalLabel(row.karat)}</td>
                          <td className="mono border border-brand-300 px-3 py-2.5 text-center text-[0.95rem] text-amber-600">{row.lodighed || '—'}</td>
                          <td className={`mono border px-3 py-2.5 text-center text-[0.95rem] font-bold ${hasGram ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-brand-300 text-brand-400'}`}>
                            {hasGram ? decimalLabel(row.gram) : '—'}
                          </td>
                          <td className="mono border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-right text-[0.95rem]">
                            <span className={hasGram ? 'font-semibold text-emerald-700' : 'text-brand-300'}>
                              {hasGram ? Number(row.unit_price_dkk).toFixed(2) : '—'}
                            </span>
                          </td>
                          <td className={`mono border px-3 py-2.5 text-right text-[0.95rem] ${hasGram ? 'border-amber-300 bg-amber-100 font-black text-amber-900' : 'border-brand-300 bg-brand-50 text-brand-300'}`}>
                            {hasGram ? Number(row.line_total_dkk).toFixed(2) : '—'}
                          </td>
                        </tr>
                      );
                    })}

                    <tr>
                      <td colSpan={9} className="border-y-2 border-slate-400 bg-slate-600 px-4 py-1.5">
                        <div className="flex items-center gap-3">
                          <span className="text-[0.82rem] font-black uppercase tracking-widest text-white">Sølv — Gümüş</span>
                          <span className="h-3 w-px bg-slate-400" />
                          <span className="mono text-[0.82rem] text-slate-300">999 · 925 · 830 · 800</span>
                        </div>
                      </td>
                    </tr>

                    {silverRows.map((row, index) => {
                      const hasGram = hasWorksheetGram(row.gram);
                      return (
                        <tr
                          key={row.row_key}
                          className={`h-[3.45rem] border-b transition-colors ${hasGram ? 'border-slate-200 border-l-4 border-l-slate-400' : 'border-brand-100 border-l-4 border-l-transparent opacity-70'}`}
                          style={{ background: hasGram ? '#f8fafc' : '#ffffff' }}
                        >
                          <td className="border border-brand-300 px-3 py-2.5">
                            <span className="text-[1rem] font-semibold text-brand-800">{row.label}</span>
                            <span className="mono ml-2 bg-slate-100 px-2 py-0.5 text-[0.86rem] text-slate-500">{row.lodighed}‰</span>
                          </td>
                          <td className="mono border border-brand-300 px-3 py-2.5 text-center text-[0.95rem] text-brand-300">—</td>
                          <td className="mono border border-brand-300 px-3 py-2.5 text-center text-[0.95rem] font-semibold text-slate-500">{row.lodighed || '—'}</td>
                          <td className={`mono border px-3 py-2.5 text-center text-[0.95rem] font-bold ${hasGram ? 'border-slate-300 bg-slate-50 text-slate-900' : 'border-brand-300 text-brand-400'}`}>
                            {hasGram ? decimalLabel(row.gram) : '—'}
                          </td>
                          <td className="mono border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-right text-[0.95rem]">
                            <span className={hasGram ? 'font-semibold text-emerald-700' : 'text-brand-300'}>
                              {hasGram ? Number(row.unit_price_dkk).toFixed(2) : '—'}
                            </span>
                          </td>
                          <td className={`mono border px-3 py-2.5 text-right text-[0.95rem] ${hasGram ? 'border-slate-300 bg-slate-100 font-black text-slate-800' : 'border-brand-300 bg-brand-50 text-brand-300'}`}>
                            {hasGram ? Number(row.line_total_dkk).toFixed(2) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : activeLines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center space-y-2">
                <p className="text-lg font-semibold text-brand-400">Ürün bekleniyor...</p>
                <p className="text-sm text-brand-300">Afventer produkter</p>
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-brand-400 bg-brand-100">
                    <th className="w-10 border border-brand-300 px-3 py-2 text-left text-xs font-black uppercase tracking-wider text-brand-700">#</th>
                    <th className="border border-brand-300 px-3 py-2 text-left text-xs font-black uppercase tracking-wider text-brand-700">Ürün Tipi</th>
                    <th className="w-24 border border-brand-300 px-3 py-2 text-center text-xs font-black uppercase tracking-wider text-brand-700">Saflık</th>
                    <th className="w-24 border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-700">Karat</th>
                    <th className="w-24 border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-700">Gram</th>
                    <th className="w-24 border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-700">Oran %</th>
                    <th className="w-32 border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-700">Birim Fiyat</th>
                    <th className="w-36 border border-brand-300 px-3 py-2 text-right text-xs font-black uppercase tracking-wider text-brand-700">Tutar (DKK)</th>
                  </tr>
                </thead>
                <tbody>
                  {activeLines.map((line, index) => (
                    <tr key={`${line.line_no}-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-brand-50'}>
                      <td className="border border-brand-200 px-3 py-3 text-center">
                        <span className="text-xs font-bold text-brand-500">{line.line_no || index + 1}</span>
                      </td>
                      <td className="border border-brand-200 px-3 py-3">
                        <p className="font-bold text-brand-900">{displayTypeLabel(snapshot, line)}</p>
                      </td>
                      <td className="border border-brand-200 px-3 py-3 text-center">
                        <span className="font-semibold text-brand-700">{purityLabel(line)}</span>
                      </td>
                      <td className="mono border border-brand-200 px-3 py-3 text-right text-base font-bold text-brand-900">
                        {line.purity_karat || '—'}
                      </td>
                      <td className="mono border border-brand-200 px-3 py-3 text-right text-base font-bold text-brand-900">
                        {decimalLabel(line.weight_grams, ' g')}
                      </td>
                      <td className="mono border border-brand-200 px-3 py-3 text-right font-semibold text-brand-700">—</td>
                      <td className="mono border border-brand-200 px-3 py-3 text-right font-semibold text-brand-700">
                        {decimalLabel(line.unit_price_dkk || line.rate_dkk)}
                      </td>
                      <td className="mono border border-brand-200 bg-brand-50 px-3 py-3 text-right text-base font-black text-brand-900">
                        {decimalLabel(line.line_offer_dkk)}
                      </td>
                    </tr>
                  ))}

                    {Array.from({ length: Math.max(0, 6 - activeLines.length) }).map((_, index) => (
                      <tr key={`empty-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-brand-50'}>
                      {Array.from({ length: 6 }).map((__, cellIndex) => (
                        <td key={cellIndex} className="h-11 border border-brand-100 px-3 py-3" />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="border-t-4 border-brand-400">
            <div className="flex items-center justify-between border-b-2 border-brand-300 bg-brand-100 px-6 py-2.5">
              <span className="text-sm font-bold uppercase tracking-[0.2em] text-brand-600">
                {(hasWorksheet ? activeWorksheetCount : activeLines.length)} kalem ürün
              </span>
              <div className="flex items-center gap-4">
                {hasWorksheet && goldWorksheetWeight > 0 ? (
                  <span className="inline-flex items-center gap-2 border border-amber-300 bg-amber-100 px-3 py-1.25">
                    <span className="text-sm font-black uppercase text-amber-700">Guld</span>
                    <span className="mono text-base font-black text-amber-900">{decimalLabel(goldWorksheetWeight, ' g')}</span>
                  </span>
                ) : null}
                {hasWorksheet && silverWorksheetWeight > 0 ? (
                  <span className="inline-flex items-center gap-2 border border-slate-300 bg-slate-100 px-3 py-1.25">
                    <span className="text-sm font-black uppercase text-slate-600">Sølv</span>
                    <span className="mono text-base font-black text-slate-800">{decimalLabel(silverWorksheetWeight, ' g')}</span>
                  </span>
                ) : null}
                <span className="text-base font-bold uppercase tracking-wider text-brand-700">Toplam Gram:</span>
                <span className="mono text-lg font-black text-brand-900">{decimalLabel(totalWeight, ' g')}</span>
              </div>
            </div>

            <div className="flex items-center justify-between bg-emerald-800 px-7 py-3.5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">Genel Toplam</p>
                <p className="text-sm text-emerald-100/70">I alt / Grand Total</p>
              </div>
              <div className="flex items-baseline space-x-3">
                <span className="mono text-4xl font-black tabular-nums text-white">{decimalLabel(totalAmount)}</span>
                <span className="text-lg font-bold text-emerald-100">DKK</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return <DisplaySceneViewport embedded={embedded}>{scene}</DisplaySceneViewport>;
}
