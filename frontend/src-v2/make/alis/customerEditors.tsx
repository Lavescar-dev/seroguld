import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Pencil, RefreshCcw, ScanLine, Zap } from 'lucide-react';

import { apiRequest } from '@/lib/api';
import type { PosPostalLookup, PosWorkspaceBankInfo } from '@/types';

import type { EditableCustomer, PaymentMethod } from './types';

type ScanStatus = 'idle' | 'ready' | 'done' | 'error';
type PostalLookupStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'unavailable';

type MRZResult = {
  fullName?: string;
  docNumber?: string;
  cprHint?: string;
  adresse?: string;
  postnr?: string;
  docType?: string;
  rawLines?: string[];
};

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

function cleanMrzField(value: string): string {
  return value.replace(/</g, ' ').trim().replace(/\s+/g, ' ');
}

function parseMrzLines(raw: string): MRZResult {
  const lines = raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 20 && /^[A-Z0-9<]+$/.test(line));

  if (lines.length === 0) {
    return { rawLines: [] };
  }

  if (lines.length >= 2 && lines[0].length >= 44 && lines[1].length >= 44) {
    const first = lines[0];
    const second = lines[1];
    const nameField = first.substring(5, 44);
    const separator = nameField.indexOf('<<');
    const surname = separator >= 0 ? cleanMrzField(nameField.substring(0, separator)) : cleanMrzField(nameField);
    const given = separator >= 0 ? cleanMrzField(nameField.substring(separator + 2)) : '';
    const docNumber = second.substring(0, 9).replace(/</g, '');
    const dob = second.substring(13, 19);
    const cprHint =
      dob.length === 6 ? `${dob.substring(4, 6)}${dob.substring(2, 4)}${dob.substring(0, 2)}-????` : '';
    return {
      fullName: `${given} ${surname}`.trim(),
      docNumber,
      cprHint,
      docType: 'MRZ / Pasaport',
      rawLines: lines,
    };
  }

  if (lines.length >= 3) {
    const normalized = lines.join('');
    const docMatch = normalized.match(/[A-Z]{0,3}\d{6,12}/);
    const cprMatch = normalized.match(/(\d{2})(\d{2})(\d{2})(\d{4})?/);
    return {
      docNumber: docMatch?.[0] || undefined,
      cprHint: cprMatch ? `${cprMatch[1]}${cprMatch[2]}${cprMatch[3]}-${cprMatch[4] || '????'}` : undefined,
      docType: 'Kimlik / Ehliyet',
      rawLines: lines,
    };
  }

  return { rawLines: lines };
}

export function PaymentMethodToggle({
  paymentMethod,
  setPaymentMethod,
}: {
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
}) {
  return (
    <div className="inline-flex overflow-hidden border border-brand-300 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setPaymentMethod('bank')}
        className={`min-w-[128px] px-3 py-1.5 text-xs font-black uppercase tracking-widest transition ${
          paymentMethod === 'bank' ? 'bg-brand-900 text-white' : 'text-brand-600 hover:bg-brand-50'
        }`}
      >
        Bankoverførsel
      </button>
      <button
        type="button"
        onClick={() => setPaymentMethod('cash')}
        className={`min-w-[108px] border-l border-brand-300 px-3 py-1.5 text-xs font-black uppercase tracking-widest transition ${
          paymentMethod === 'cash' ? 'bg-brand-900 text-white' : 'text-brand-600 hover:bg-brand-50'
        }`}
      >
        Kontant
      </button>
    </div>
  );
}

export function CustomerInfoTable({
  customer,
  setCustomer,
  onBlur,
  bankInfo,
  setBankInfo,
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onBlur?: () => void;
  bankInfo: PosWorkspaceBankInfo;
  setBankInfo: Dispatch<SetStateAction<PosWorkspaceBankInfo>>;
}) {
  const fields: Array<{ label: string; key: keyof EditableCustomer; mono?: boolean; type?: string; section?: 'bank' }> = [
    { label: 'Navn / Ad Soyad', key: 'name', type: 'text' },
    { label: 'CPR nr.', key: 'cpr_number', mono: true, type: 'text' },
    { label: 'Kørekort / Pas', key: 'identity_doc_number', mono: true, type: 'text' },
    { label: 'Tlf.', key: 'phone', mono: true, type: 'text' },
    { label: 'E-mail', key: 'email', type: 'email' },
    { label: 'Adresse', key: 'address', type: 'text' },
    { label: 'Şehir / By', key: 'city', type: 'text' },
    { label: 'Postnr.', key: 'postal_code', mono: true, type: 'text' },
  ];
  const [bankOpen, setBankOpen] = useState(false);
  const hasBankData = Boolean(bankInfo.reg_number || bankInfo.account_number);
  const cellInput =
    'w-full px-2 py-1 border border-brand-200 bg-white focus:outline-none focus:border-brand-700 focus:bg-brand-50 text-brand-900 text-sm';
  const mainFields = fields.filter((field) => !field.section);

  return (
    <table className="w-full border-collapse">
      <tbody>
        {mainFields.map((field) => (
          <tr key={field.key} className="border-b border-brand-100">
            <td className="w-36 border-r border-brand-200 bg-brand-50 px-3 py-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-600">{field.label}</span>
            </td>
            <td className="px-2 py-1.5">
              {field.key === 'cpr_number' ? (
                <CprInput
                  value={customer[field.key]}
                  onChange={(value) => setCustomer((current) => ({ ...current, [field.key]: value }))}
                  onBlur={onBlur}
                  className={`${cellInput} ${field.mono ? 'mono' : ''}`}
                  style={field.mono ? monoStyle : sansStyle}
                />
              ) : (
                <input
                  type={field.type || 'text'}
                  value={customer[field.key]}
                  onChange={(event) => setCustomer((current) => ({ ...current, [field.key]: event.target.value }))}
                  onBlur={onBlur}
                  className={`${cellInput} ${field.mono ? 'mono' : ''}`}
                  style={field.mono ? monoStyle : sansStyle}
                />
              )}
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={2} className="border-t border-emerald-200">
            <button
              type="button"
              onClick={() => setBankOpen((current) => !current)}
              className="flex w-full items-center justify-between bg-emerald-50 px-3 py-1.5 transition-colors hover:bg-emerald-100"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Overførsel — Banka Bilgileri</span>
                {hasBankData && !bankOpen ? (
                  <span className="mono bg-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">
                    {bankInfo.reg_number && bankInfo.account_number
                      ? `${bankInfo.reg_number} · ${bankInfo.account_number}`
                      : bankInfo.reg_number || bankInfo.account_number}
                  </span>
                ) : null}
              </div>
              <ChevronDown className={`h-3 w-3 text-emerald-600 transition-transform duration-200 ${bankOpen ? 'rotate-180' : ''}`} />
            </button>
          </td>
        </tr>
        {bankOpen ? (
          <>
            <tr className="border-b border-emerald-100">
              <td className="w-36 border-r border-emerald-200 bg-emerald-50 px-3 py-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Reg.nr.</span>
              </td>
              <td className="bg-white px-2 py-1.5">
                <input
                  type="text"
                  value={bankInfo.reg_number || ''}
                  onChange={(event) => setBankInfo((current) => ({ ...current, reg_number: event.target.value }))}
                  className="mono w-full border border-brand-200 bg-white px-2 py-1 text-sm text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50"
                  style={monoStyle}
                  autoFocus
                />
              </td>
            </tr>
            <tr className="border-b border-emerald-100">
              <td className="w-36 border-r border-emerald-200 bg-emerald-50 px-3 py-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">Kontonr.</span>
              </td>
              <td className="bg-white px-2 py-1.5">
                <input
                  type="text"
                  value={bankInfo.account_number || ''}
                  onChange={(event) => setBankInfo((current) => ({ ...current, account_number: event.target.value }))}
                  className="mono w-full border border-brand-200 bg-white px-2 py-1 text-sm text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50"
                  style={monoStyle}
                />
              </td>
            </tr>
          </>
        ) : null}
      </tbody>
    </table>
  );
}

function CprInput({
  value,
  onChange,
  onBlur,
  className,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  className: string;
  style?: typeof monoStyle | typeof sansStyle;
}) {
  const parts = (value || '').split('-');
  const prefix = parts[0] || '';
  const suffix = parts.length > 1 ? parts.slice(1).join('-') : '';

  if (value && value.includes('-')) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={prefix}
          onChange={(event) => {
            let next = event.target.value.replace(/\D/g, '');
            if (next.length > 6) next = next.slice(0, 6);
            onChange(next + (suffix || next.length === 6 ? `-${suffix}` : ''));
          }}
          onBlur={onBlur}
          className={`${className} !w-20 text-center !px-1`}
          style={style}
          placeholder="DDMMYY"
        />
        <span className="font-bold text-brand-500">-</span>
        <input
          value={suffix}
          onChange={(event) => onChange(`${prefix}-${event.target.value.slice(0, 4)}`)}
          onFocus={(event) => {
            if (event.target.value === '????') onChange(`${prefix}-`);
          }}
          onBlur={onBlur}
          className={`${className} !w-16 text-center !px-1 ${
            suffix === '????' ? 'border-red-300 bg-red-50 text-red-600 ring-1 ring-red-400' : ''
          }`}
          style={style}
          placeholder="0000"
          maxLength={4}
        />
        {suffix === '????' ? <span className="ml-1 hidden text-[10px] font-bold text-red-500 sm:inline">Eksik!</span> : null}
      </div>
    );
  }

  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      className={className}
      style={style}
      placeholder="120385-1234"
    />
  );
}

export function CustomerEditorTable({
  customer,
  setCustomer,
  onBlur,
  bankInfo,
  setBankInfo,
  paymentMethod,
  setPaymentMethod,
  showPaymentSection = true,
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onBlur?: () => void;
  bankInfo: PosWorkspaceBankInfo;
  setBankInfo: Dispatch<SetStateAction<PosWorkspaceBankInfo>>;
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
  showPaymentSection?: boolean;
}) {
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanBuffer, setScanBuffer] = useState('');
  const [scanResult, setScanResult] = useState<MRZResult | null>(null);
  const [scanSources, setScanSources] = useState<Set<keyof EditableCustomer>>(new Set());
  const [showRaw, setShowRaw] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [postalLookupStatus, setPostalLookupStatus] = useState<PostalLookupStatus>('idle');
  const [postalLookup, setPostalLookup] = useState<PosPostalLookup | null>(null);
  const timerRef = useRef<number | null>(null);
  const scanRef = useRef<HTMLTextAreaElement | null>(null);
  const postalLookupAutoCityRef = useRef('');
  const postalLookupRequestRef = useRef(0);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const normalizedPostalCode = customer.postal_code.replace(/\D/g, '').slice(0, 4);
    if (normalizedPostalCode.length !== 4) {
      setPostalLookup(null);
      setPostalLookupStatus('idle');
      return;
    }

    const requestId = ++postalLookupRequestRef.current;
    setPostalLookupStatus('loading');
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await apiRequest<PosPostalLookup>(`/api/v2/alis/postal-lookup/${normalizedPostalCode}`);
          if (postalLookupRequestRef.current !== requestId) return;
          setPostalLookup(result);
          if (!result.available) {
            setPostalLookupStatus('unavailable');
            return;
          }
          if (!result.found || !result.postal_district) {
            setPostalLookupStatus('not_found');
            return;
          }
          setPostalLookupStatus('ready');
          setCustomer((current) => {
            const nextCity = (result.postal_district || '').trim();
            const currentCity = String(current.city || '').trim();
            const previousAutoCity = postalLookupAutoCityRef.current.trim();
            if (!nextCity || (currentCity && currentCity !== previousAutoCity)) {
              return current;
            }
            postalLookupAutoCityRef.current = nextCity;
            return current.city === nextCity ? current : { ...current, city: nextCity };
          });
          window.setTimeout(() => onBlur?.(), 0);
        } catch {
          if (postalLookupRequestRef.current !== requestId) return;
          setPostalLookup(null);
          setPostalLookupStatus('unavailable');
        }
      })();
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [customer.postal_code, onBlur, setCustomer]);

  const bankFields: Array<{ label: string; key: 'reg_number' | 'account_number'; placeholder: string }> = [
    { label: 'Reg.nr.', key: 'reg_number', placeholder: '0000' },
    { label: 'Kontonr.', key: 'account_number', placeholder: '0000000000' },
  ];
  const autoFields: Array<{ label: string; key: keyof EditableCustomer; placeholder: string; mono?: boolean }> = [
    { label: 'Navn / Ad Soyad *', key: 'name', placeholder: 'Ad Soyad' },
    { label: 'CPR nr. *', key: 'cpr_number', placeholder: '120385-????', mono: true },
    { label: 'Kørekort / Pas', key: 'identity_doc_number', placeholder: 'Belge No', mono: true },
    { label: 'Adresse', key: 'address', placeholder: 'Sokak, No.' },
    { label: 'Şehir / By', key: 'city', placeholder: 'Şehir' },
    { label: 'Postnr.', key: 'postal_code', placeholder: '0000', mono: true },
  ];
  const manualFields: Array<{ label: string; key: keyof EditableCustomer; placeholder: string; mono?: boolean }> = [
    { label: 'Tlf.', key: 'phone', placeholder: '+45 00 00 00 00', mono: true },
    { label: 'E-mail', key: 'email', placeholder: 'ornek@mail.dk' },
  ];

  const baseInputClass =
    'w-full border border-brand-300 bg-white px-2 py-1.5 text-sm text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50';
  const scannedInputClass =
    'w-full border border-emerald-400 bg-emerald-50 px-2 py-1.5 text-sm text-brand-900 outline-none focus:border-emerald-700 focus:bg-white';

  function updateField(field: keyof EditableCustomer, value: string) {
    if (field === 'city' && value.trim() !== postalLookupAutoCityRef.current.trim()) {
      postalLookupAutoCityRef.current = '';
    }
    setCustomer((current) => ({ ...current, [field]: value }));
  }

  function applyScanResult(result: MRZResult) {
    const sources = new Set<keyof EditableCustomer>();
    if (result.fullName) {
      updateField('name', result.fullName);
      sources.add('name');
    }
    if (result.cprHint) {
      updateField('cpr_number', result.cprHint);
      sources.add('cpr_number');
    }
    if (result.docNumber) {
      updateField('identity_doc_number', result.docNumber);
      sources.add('identity_doc_number');
    }
    if (result.adresse) {
      updateField('address', result.adresse);
      sources.add('address');
    }
    if (result.postnr) {
      updateField('postal_code', result.postnr);
      sources.add('postal_code');
    }
    setScanSources(sources);
    setScanResult(result);
    setScanStatus(sources.size > 0 ? 'done' : 'error');
    window.setTimeout(() => onBlur?.(), 0);
  }

  function triggerParse(value: string) {
    setScanBuffer(value);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (value.trim().length > 10) {
        applyScanResult(parseMrzLines(value));
      }
    }, 150);
  }

  function loadDemo() {
    const result: MRZResult = {
      fullName: 'Lars Christian Nielsen',
      docNumber: 'DK-123456789',
      cprHint: '120385-????',
      docType: 'Kimlik / Ehliyet (Demo)',
      rawLines: [
        'IDDNK1234567890<<<<<<<<<<<<<<<',
        '8503126M3012315DNK<<<<<<<<<<<4',
        'NIELSEN<<LARS<CHRISTIAN<<<<<<<',
      ],
    };
    setScanBuffer(result.rawLines?.join('\n') || '');
    applyScanResult(result);
  }

  function resetScanner() {
    setScanStatus('idle');
    setScanBuffer('');
    setScanResult(null);
    setScanSources(new Set());
    setPostalLookup(null);
    setPostalLookupStatus('idle');
    postalLookupAutoCityRef.current = '';
    setShowRaw(false);
    (['name', 'cpr_number', 'identity_doc_number', 'address', 'city', 'postal_code'] as Array<keyof EditableCustomer>).forEach((field) => {
      updateField(field, '');
    });
    window.setTimeout(() => onBlur?.(), 0);
  }

  function activateScanner() {
    setScanStatus('ready');
    setScanBuffer('');
    setScanResult(null);
    setShowRaw(false);
    window.setTimeout(() => scanRef.current?.focus(), 60);
  }

  const statusStyles: Record<ScanStatus, { bar: string; dot: string; text: string }> = {
    idle: { bar: 'bg-brand-100 border-brand-200', dot: 'bg-brand-400', text: 'text-brand-500' },
    ready: { bar: 'bg-emerald-100 border-emerald-300', dot: 'bg-emerald-500 animate-pulse', text: 'text-emerald-800' },
    done: { bar: 'bg-emerald-800 border-emerald-700', dot: 'bg-emerald-300', text: 'text-white' },
    error: { bar: 'bg-red-100 border-red-300', dot: 'bg-red-500', text: 'text-red-800' },
  };
  const statusText: Record<ScanStatus, string> = {
    idle: 'Hazır — Tarayıcı bekleniyor',
    ready: '● Aktif — Kimliği tarayıcıya yerleştirin',
    done: `✓ Tarama başarılı — ${scanResult?.docType || 'Belge'}`,
    error: '✕ Okunamadı — MRZ / barkod tanımsız',
  };
  const statusStyle = statusStyles[scanStatus];

  return (
    <div>
      <div className="border-b-2 border-brand-400">
        <div className="flex items-center justify-between bg-brand-900 px-4 py-2">
          <div className="flex items-center gap-2">
            <ScanLine className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
            <span className="text-xs font-black uppercase tracking-widest text-white">IDScanner 365</span>
            <span className="hidden text-[10px] font-bold uppercase tracking-wider text-brand-500 sm:inline">— Otomatik Kimlik Okuyucu</span>
          </div>
          <div className="flex items-center gap-1.5">
            {scanStatus !== 'idle' ? (
              <button
                type="button"
                onClick={resetScanner}
                title="Sıfırla"
                className="inline-flex items-center gap-1 border border-brand-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-brand-400 transition-colors hover:border-brand-400 hover:text-white"
              >
                <RefreshCcw className="h-2.5 w-2.5" />
                Sıfırla
              </button>
            ) : null}
            <button
              type="button"
              onClick={loadDemo}
              className="border border-brand-600 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-300 transition hover:border-brand-400 hover:text-white"
            >
              Demo
            </button>
            <button
              type="button"
              onClick={activateScanner}
              className="inline-flex items-center gap-1 border border-emerald-600 bg-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-emerald-600"
            >
              <Zap className="h-2.5 w-2.5" />
              Tara
            </button>
          </div>
        </div>

        <div className={`flex items-center justify-between border-b px-3 py-1.5 ${statusStyle.bar}`}>
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
            <span className={`text-[10px] font-black uppercase tracking-widest ${statusStyle.text}`}>{statusText[scanStatus]}</span>
          </div>
          {scanStatus === 'done' && scanResult?.rawLines?.length ? (
            <button
              type="button"
              onClick={() => setShowRaw((current) => !current)}
              className="text-[10px] text-emerald-300 underline transition-colors hover:text-white"
            >
              {showRaw ? 'Ham veriyi gizle' : 'Ham veriyi gör'}
            </button>
          ) : null}
          {scanStatus === 'error' ? <AlertCircle className="h-3 w-3 text-red-500" /> : null}
        </div>

        {showRaw && scanResult?.rawLines?.length ? (
          <div className="border-b border-brand-700 bg-brand-900 px-4 py-2">
            <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-brand-500">MRZ / Barkod Çıktısı</p>
            <pre className="mono whitespace-pre-wrap text-[10px] leading-relaxed text-emerald-300">{scanResult.rawLines.join('\n')}</pre>
          </div>
        ) : null}

        {scanStatus === 'ready' ? (
          <div className="border-b border-emerald-300 bg-emerald-50 px-4 py-3">
            <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
              ↓ Aşağıya tıklayın ve kimliği tarayıcıya yerleştirin
            </p>
            <textarea
              ref={scanRef}
              value={scanBuffer}
              onChange={(event) => triggerParse(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && scanBuffer.trim().length > 10) {
                  event.preventDefault();
                  applyScanResult(parseMrzLines(scanBuffer));
                }
              }}
              rows={3}
              className="mono w-full resize-none border-2 border-emerald-500 bg-white px-3 py-2 text-xs text-emerald-900 outline-none ring-2 ring-emerald-200 focus:border-emerald-700 focus:ring-emerald-400"
              placeholder="Tarayıcı çıktısı buraya gelecek..."
              spellCheck={false}
            />
          </div>
        ) : null}
      </div>

      <div className="border-b border-brand-200">
        <div className="flex items-center gap-2 bg-brand-800 px-3 py-1.5">
          <ScanLine className="h-3 w-3 text-emerald-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-brand-300">ID'den Okunan</span>
          <span className="text-[10px] text-brand-500">— otomatik doldurulur</span>
        </div>
        <table className="w-full border-collapse">
          <tbody>
            {autoFields.map((field) => {
              const fromScanner = scanSources.has(field.key);
              return (
                <tr key={field.key} className="border-b border-brand-100">
                  <td className="w-36 border-r border-brand-200 bg-brand-50 px-3 py-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-brand-600">{field.label}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {fromScanner ? (
                        <span className="inline-flex items-center gap-0.5 border border-emerald-400 bg-emerald-100 px-1 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-800">
                          <CheckCircle2 className="h-2 w-2" />
                          ID
                        </span>
                      ) : field.key === 'city' && postalLookupStatus === 'ready' && customer.city.trim() === postalLookupAutoCityRef.current.trim() ? (
                        <span className="inline-flex items-center gap-0.5 border border-sky-300 bg-sky-50 px-1 py-0.5 text-[9px] font-black uppercase tracking-wide text-sky-700">
                          POSTNR
                        </span>
                      ) : (
                        <span className="w-8 shrink-0" />
                      )}
                      {field.key === 'cpr_number' ? (
                        <CprInput
                          value={customer[field.key]}
                          onChange={(value) => {
                            updateField(field.key, value);
                            if (fromScanner && value && !value.includes('????')) {
                              setScanSources((current) => {
                                const next = new Set(current);
                                next.delete(field.key);
                                return next;
                              });
                            }
                          }}
                          onBlur={onBlur}
                          className={`${fromScanner ? scannedInputClass : baseInputClass} ${field.mono ? 'mono' : ''}`}
                          style={field.mono ? monoStyle : sansStyle}
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder={field.placeholder}
                          value={customer[field.key]}
                          onChange={(event) => {
                            updateField(field.key, event.target.value);
                            if (fromScanner) {
                              setScanSources((current) => {
                                const next = new Set(current);
                                next.delete(field.key);
                                return next;
                              });
                            }
                          }}
                          onBlur={onBlur}
                          className={`${fromScanner ? scannedInputClass : baseInputClass} ${field.mono ? 'mono' : ''}`}
                          style={field.mono ? monoStyle : sansStyle}
                        />
                      )}
                    </div>
                    {field.key === 'postal_code' ? (
                      <div className="ml-[2.4rem] mt-1.5">
                        {postalLookupStatus === 'loading' ? (
                          <p className="text-[10px] font-medium text-brand-400">Posta kodu çözülüyor...</p>
                        ) : null}
                        {postalLookupStatus === 'ready' && postalLookup ? (
                          <div className="flex flex-wrap gap-1.5">
                            {postalLookup.region_name ? (
                              <span className="inline-flex items-center border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-600">
                                İl: {postalLookup.region_name}
                              </span>
                            ) : null}
                            {postalLookup.municipality_name ? (
                              <span className="inline-flex items-center border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-600">
                                İlçe / Kommune: {postalLookup.municipality_name}
                              </span>
                            ) : null}
                            {postalLookup.postal_district ? (
                              <span className="inline-flex items-center border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                                Mahalle / Bölge: {postalLookup.postal_district}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {postalLookupStatus === 'not_found' ? (
                          <p className="text-[10px] font-medium text-amber-600">Bu postnr. için otomatik bölge bilgisi bulunamadı.</p>
                        ) : null}
                        {postalLookupStatus === 'unavailable' ? (
                          <p className="text-[10px] font-medium text-amber-600">Posta kodu servisine şu an ulaşılamıyor.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-b border-brand-200">
        <div className="flex items-center gap-2 bg-brand-100 px-3 py-1.5">
          <Pencil className="h-3 w-3 text-brand-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-brand-600">Manuel Giriş</span>
          <span className="text-[10px] text-brand-400">— elle doldurulur</span>
        </div>
        <table className="w-full border-collapse">
          <tbody>
            {manualFields.map((field) => (
              <tr key={field.key} className="border-b border-brand-100">
                <td className="w-36 border-r border-brand-200 bg-brand-50 px-3 py-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-brand-600">{field.label}</span>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-0.5 border border-brand-300 bg-brand-100 px-1 py-0.5 text-[9px] font-black uppercase tracking-wide text-brand-500">
                      <Pencil className="h-2 w-2" />
                      EL
                    </span>
                    <input
                      type="text"
                      placeholder={field.placeholder}
                      value={customer[field.key]}
                      onChange={(event) => updateField(field.key, event.target.value)}
                      onBlur={onBlur}
                      className={`${baseInputClass} ${field.mono ? 'mono' : ''}`}
                      style={field.mono ? monoStyle : sansStyle}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <td colSpan={2} className="border-t border-emerald-200">
              <button
                type="button"
                onClick={() => setBankOpen((current) => !current)}
                className="flex w-full items-center justify-between bg-emerald-50 px-3 py-1.5 transition-colors hover:bg-emerald-100"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Overførsel — Banka Bilgileri</span>
                  {bankInfo.reg_number || bankInfo.account_number ? (
                    !bankOpen ? (
                      <span className="mono bg-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">
                        {bankInfo.reg_number && bankInfo.account_number
                          ? `${bankInfo.reg_number} · ${bankInfo.account_number}`
                          : bankInfo.reg_number || bankInfo.account_number}
                      </span>
                    ) : null
                  ) : null}
                </div>
                <ChevronDown className={`h-3 w-3 text-emerald-600 transition-transform duration-200 ${bankOpen ? 'rotate-180' : ''}`} />
              </button>
            </td>
          </tr>
          {bankOpen
            ? bankFields.map((field) => (
                <tr key={field.key} className="border-b border-emerald-100">
                  <td className="w-36 border-r border-emerald-200 bg-emerald-50 px-3 py-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">{field.label}</span>
                  </td>
                  <td className="bg-white px-2 py-1.5">
                    <input
                      type="text"
                      value={bankInfo[field.key] || ''}
                      onChange={(event) => setBankInfo((current) => ({ ...current, [field.key]: event.target.value }))}
                      className="mono w-full border border-brand-200 bg-white px-2 py-1 text-sm text-brand-900 outline-none focus:border-brand-700 focus:bg-brand-50"
                      style={monoStyle}
                      autoFocus={field.key === 'reg_number'}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      {showPaymentSection ? (
        <div className="border-t border-emerald-200">
          <div className="flex items-center justify-between bg-emerald-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Ödeme</span>
              <PaymentMethodToggle paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
              {paymentMethod === 'cash' ? 'Nakit seçili' : bankInfo.reg_number || bankInfo.account_number ? 'Banka bağlı' : 'Banka bekleniyor'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
