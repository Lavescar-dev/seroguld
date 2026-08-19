import { type Dispatch, type SetStateAction, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Pencil, RefreshCcw, ScanLine } from 'lucide-react';

import { validateCpr } from '@/lib/cpr';
import type { PosWorkspaceBankInfo } from '@/types';

import { normalizePostalCode, useAddressAutocomplete } from './addressAutocomplete';
import { useCustomerMatch } from './customerMatch';
import { type IdentityFieldName, useIdentityScan } from './identityScan';
import type { EditableCustomer, PaymentMethod } from './types';

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace" } as const;
const sansStyle = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif" } as const;

export function PaymentMethodToggle({
  setPaymentMethod,
}: {
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
}) {
  return (
    <div className="inline-flex overflow-hidden border border-emerald-300 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setPaymentMethod('bank')}
        className="min-w-[148px] bg-emerald-700 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-emerald-800"
      >
        Bankoverførsel
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
    { label: 'Belge türü', key: 'identity_doc_type', type: 'text' },
    { label: 'Belge ülkesi', key: 'identity_doc_country', mono: true, type: 'text' },
    { label: 'Tlf.', key: 'phone', mono: true, type: 'text' },
    { label: 'E-mail', key: 'email', type: 'email' },
    { label: 'Adresse', key: 'address', type: 'text' },
    { label: 'Şehir / By', key: 'city', type: 'text' },
    { label: 'Postnr.', key: 'postal_code', mono: true, type: 'text' },
  ];
  const [bankOpen, setBankOpen] = useState(false);
  const address = useAddressAutocomplete({ customer, setCustomer, onApplied: onBlur });
  const hasBankData = Boolean(bankInfo.reg_number || bankInfo.account_number);
  const cellInput =
    'w-full px-2 py-1 border border-brand-200 bg-white focus:outline-none focus:border-brand-700 focus:bg-brand-50 text-brand-900 text-sm';
  const mainFields = fields.filter((field) => !field.section);
  const updateField = (field: keyof EditableCustomer, value: string) => {
    if (field === 'postal_code') value = normalizePostalCode(value);
    if (field === 'identity_doc_country') value = value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 3);
    setCustomer((current) => ({ ...current, [field]: value }));
  };

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
                  onChange={(value) => updateField(field.key, value)}
                  onBlur={onBlur}
                  className={`${cellInput} ${field.mono ? 'mono' : ''}`}
                  style={field.mono ? monoStyle : sansStyle}
                />
              ) : field.key === 'identity_doc_type' ? (
                <select
                  value={customer.identity_doc_type}
                  onChange={(event) => updateField('identity_doc_type', event.target.value)}
                  onBlur={onBlur}
                  className={cellInput}
                >
                  <option value="">Seçin</option>
                  <option value="passport">Pasaport</option>
                  <option value="id_card">Kimlik kartı</option>
                  <option value="driver_license">Ehliyet</option>
                </select>
              ) : (
                <input
                  type={field.type || 'text'}
                  value={customer[field.key]}
                  onChange={(event) => updateField(field.key, event.target.value)}
                  onBlur={onBlur}
                  className={`${cellInput} ${field.mono ? 'mono' : ''}`}
                  style={field.mono ? monoStyle : sansStyle}
                />
              )}
            </td>
          </tr>
        ))}
        {address.status !== 'idle' ? (
          <tr>
            <td colSpan={2} className="border-b border-brand-100 bg-brand-50 px-3 py-2">
              {address.status === 'loading' || address.postalLookupStatus === 'loading' ? <p className="text-[10px] font-medium text-brand-400">Adres / posta kodu aranıyor...</p> : null}
              {address.status === 'ready' ? <div className="space-y-1">{address.suggestions.map((suggestion) => <button key={suggestion.id} type="button" onClick={() => address.selectSuggestion(suggestion)} disabled={address.selectedId === suggestion.id} className="block w-full border border-brand-200 bg-white px-2 py-1 text-left text-[10px] font-semibold text-brand-700 hover:border-brand-500 disabled:opacity-60">{suggestion.title}</button>)}</div> : null}
              {address.status === 'empty' ? <p className="text-[10px] font-medium text-amber-600">Bu postnr. ve sokak için adres bulunamadı.</p> : null}
              {address.status === 'unavailable' || address.postalLookupStatus === 'unavailable' ? <p className="text-[10px] font-medium text-amber-600">Adres servisine şu an ulaşılamıyor.</p> : null}
            </td>
          </tr>
        ) : null}
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

  const validation = useMemo(() => validateCpr(value), [value]);
  const isPartial = suffix === '????' || validation.digits.length !== 10;
  const showValidation = !isPartial && Boolean(value);
  const validationTone = !showValidation
    ? null
    : validation.formatOk && validation.mod11Ok
      ? 'ok'
      : validation.formatOk
        ? 'warn'
        : 'err';

  const validationIcon =
    validationTone === 'ok' ? (
      <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-emerald-600" />
    ) : validationTone === 'warn' ? (
      <AlertCircle className="h-3 w-3 flex-shrink-0 text-amber-600" />
    ) : validationTone === 'err' ? (
      <AlertCircle className="h-3 w-3 flex-shrink-0 text-red-600" />
    ) : null;

  const validationMessage =
    validationTone === 'ok'
      ? 'CPR mod-11 doğrulandı'
      : validationTone === 'warn'
        ? validation.reason || 'Mod-11 kontrolü başarısız (uyarı)'
        : validationTone === 'err'
          ? validation.reason || 'CPR geçersiz'
          : null;

  const validationTextClass =
    validationTone === 'ok'
      ? 'text-emerald-700'
      : validationTone === 'warn'
        ? 'text-amber-700'
        : 'text-red-700';

  if (value && value.includes('-')) {
    const suffixInputCls = `${className} !w-16 text-center !px-1 ${
      suffix === '????' ? 'border-red-300 bg-red-50 text-red-600 ring-1 ring-red-400' : ''
    } ${
      validationTone === 'ok'
        ? 'border-emerald-300 bg-emerald-50 ring-1 ring-emerald-300'
        : validationTone === 'warn'
          ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-300'
          : validationTone === 'err'
            ? 'border-red-300 bg-red-50 ring-1 ring-red-300'
            : ''
    }`;
    return (
      <div className="space-y-1">
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
            className={suffixInputCls}
            style={style}
            placeholder="0000"
            maxLength={4}
          />
          {suffix === '????' ? (
            <span className="ml-1 hidden text-[10px] font-bold text-red-500 sm:inline">Eksik!</span>
          ) : null}
          {validationIcon}
        </div>
        {showValidation && validationMessage ? (
          <p className={`text-[10px] font-semibold ${validationTextClass}`}>{validationMessage}</p>
        ) : null}
      </div>
    );
  }

  const baseInputCls = `${className} ${
    validationTone === 'ok'
      ? 'border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200'
      : validationTone === 'warn'
        ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200'
        : validationTone === 'err'
          ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
          : ''
  }`;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={baseInputCls}
          style={style}
          placeholder="120385-1234"
        />
        {validationIcon}
      </div>
      {showValidation && validationMessage ? (
        <p className={`text-[10px] font-semibold ${validationTextClass}`}>{validationMessage}</p>
      ) : null}
    </div>
  );
}

function identityFieldLabel(field: IdentityFieldName) {
  return {
    name: 'Navn / Ad Soyad',
    identity_doc_number: 'Kørekort / Pas',
    identity_doc_type: 'Belge türü',
    identity_doc_country: 'Belge ülkesi',
    address: 'Adresse',
    postal_code: 'Postnr.',
    city: 'Şehir / By',
    cpr_number: 'CPR (ilk 6 hane)',
  }[field];
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
  onSelectMatchedCustomer,
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onBlur?: () => void;
  bankInfo: PosWorkspaceBankInfo;
  setBankInfo: Dispatch<SetStateAction<PosWorkspaceBankInfo>>;
  paymentMethod: PaymentMethod;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
  showPaymentSection?: boolean;
  onSelectMatchedCustomer?: (customerId: string) => void;
}) {
  const [bankOpen, setBankOpen] = useState(false);
  const identity = useIdentityScan({ customer, setCustomer, onApplied: onBlur });
  const address = useAddressAutocomplete({ customer, setCustomer, onApplied: onBlur });
  const customerMatch = useCustomerMatch(customer);

  const bankFields: Array<{ label: string; key: 'reg_number' | 'account_number'; placeholder: string }> = [
    { label: 'Reg.nr.', key: 'reg_number', placeholder: '0000' },
    { label: 'Kontonr.', key: 'account_number', placeholder: '0000000000' },
  ];
  const autoFields: Array<{ label: string; key: keyof EditableCustomer; placeholder: string; mono?: boolean }> = [
    { label: 'Navn / Ad Soyad *', key: 'name', placeholder: 'Ad Soyad' },
    { label: 'CPR nr. *', key: 'cpr_number', placeholder: '120385-????', mono: true },
    { label: 'Kørekort / Pas', key: 'identity_doc_number', placeholder: 'Belge No', mono: true },
    { label: 'Belge türü', key: 'identity_doc_type', placeholder: 'Belge türünü seçin' },
    { label: 'Belge ülkesi', key: 'identity_doc_country', placeholder: 'DNK', mono: true },
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
    if (field === 'postal_code') {
      value = normalizePostalCode(value);
    }
    if (field === 'identity_doc_country') {
      value = value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 3);
    }
    setCustomer((current) => ({ ...current, [field]: value }));
  }

  return (
    <div>
      <div className="border-b-2 border-brand-400">
        <div className="flex items-center justify-between bg-brand-900 px-4 py-2">
          <div className="flex items-center gap-2">
            <ScanLine className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
            <span className="text-xs font-black uppercase tracking-widest text-white">Kimlik tarama</span>
            <span className="hidden text-[10px] font-bold uppercase tracking-wider text-brand-500 sm:inline">— yerel tarayıcı / dosya</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void identity.refreshCapabilities()}
              className="border border-brand-600 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-300 transition hover:border-brand-400 hover:text-white"
            >
              <RefreshCcw className="mr-1 inline h-2.5 w-2.5" /> Yenile
            </button>
            <button
              type="button"
              disabled={!identity.capabilities.scanner || identity.status === 'acquiring'}
              onClick={() => void identity.acquire('front')}
              className="inline-flex items-center gap-1 border border-emerald-600 bg-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-emerald-600"
            >
              Ön yüz tara
            </button>
            <button
              type="button"
              disabled={!identity.capabilities.file || identity.status === 'acquiring'}
              onClick={() => void identity.pickFile('front')}
              className="border border-brand-600 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-300 transition hover:border-brand-400 hover:text-white"
            >
              Dosyadan oku
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-brand-700 bg-brand-800 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-brand-100">
              {identity.status === 'checking'
                ? 'Tarayıcı özellikleri denetleniyor'
                : identity.status === 'acquiring'
                  ? 'Belge okunuyor'
                  : identity.status === 'review'
                    ? 'İnceleme ve onay gerekli'
                    : identity.status === 'applied'
                      ? 'Onaylanan alanlar uygulandı'
                      : identity.status === 'unavailable'
                        ? 'Tarayıcı / dosya desteği yok'
                        : identity.error || 'CPR doğum tarihinden türetilmez'}
            </span>
          </div>
          {identity.result?.documentType === 'id_card' ? (
            <div className="flex gap-1.5">
              <button type="button" disabled={!identity.capabilities.scanner || identity.status === 'acquiring'} onClick={() => void identity.acquire('back')} className="text-[10px] text-emerald-300 underline disabled:opacity-40">Arka yüz tara</button>
              <button type="button" disabled={!identity.capabilities.file || identity.status === 'acquiring'} onClick={() => void identity.pickFile('back')} className="text-[10px] text-emerald-300 underline disabled:opacity-40">Arka yüz dosyası</button>
            </div>
          ) : null}
        </div>

        {identity.result ? (
          <div className="border-b border-emerald-300 bg-emerald-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Okunan alanları inceleyin</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {Object.entries(identity.result.fields).map(([field, parsed]) => parsed ? (
                <p key={field} className="text-xs text-emerald-900"><strong>{identityFieldLabel(field as IdentityFieldName)}:</strong> {parsed.value} <span className={parsed.review === 'validated' ? 'text-emerald-700' : 'text-amber-700'}>({parsed.review === 'validated' ? 'doğrulandı' : 'inceleyin'})</span></p>
              ) : null)}
            </div>
            {Object.keys(identity.previews).length ? <div className="mt-2 flex gap-2">{(['front', 'back'] as const).map((side) => identity.previews[side] ? <img key={side} src={identity.previews[side]} alt={`Kimlik ${side === 'front' ? 'ön' : 'arka'} yüz önizlemesi`} className="h-16 max-w-28 border border-emerald-300 object-cover" /> : null)}</div> : null}
            <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={identity.clear} className="border border-emerald-300 px-2 py-1 text-[10px] font-bold text-emerald-800">Vazgeç</button><button type="button" onClick={identity.confirm} className="border border-emerald-700 bg-emerald-700 px-2 py-1 text-[10px] font-black text-white">İnceledim, alanları uygula</button></div>
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
              const fromScanner = Boolean(identity.result?.fields[field.key as IdentityFieldName]) && identity.status === 'review';
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
                      ) : (
                        <span className="w-8 shrink-0" />
                      )}
                      {field.key === 'cpr_number' ? (
                        <CprInput
                          value={customer[field.key]}
                          onChange={(value) => {
                            updateField(field.key, value);
                          }}
                          onBlur={onBlur}
                          className={`${fromScanner ? scannedInputClass : baseInputClass} ${field.mono ? 'mono' : ''}`}
                          style={field.mono ? monoStyle : sansStyle}
                        />
                      ) : field.key === 'identity_doc_type' ? (
                        <select
                          value={customer.identity_doc_type}
                          onChange={(event) => updateField('identity_doc_type', event.target.value)}
                          onBlur={onBlur}
                          className={`${fromScanner ? scannedInputClass : baseInputClass}`}
                        >
                          <option value="">Seçin</option>
                          <option value="passport">Pasaport</option>
                          <option value="id_card">Kimlik kartı</option>
                          <option value="driver_license">Ehliyet</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder={field.placeholder}
                          value={customer[field.key]}
                          onChange={(event) => {
                            updateField(field.key, event.target.value);
                          }}
                          onBlur={onBlur}
                          className={`${fromScanner ? scannedInputClass : baseInputClass} ${field.mono ? 'mono' : ''}`}
                          style={field.mono ? monoStyle : sansStyle}
                        />
                      )}
                    </div>
                    {field.key === 'postal_code' ? (
                      <div className="ml-[2.4rem] mt-1.5">
                        {address.status === 'loading' ? (
                          <p className="text-[10px] font-medium text-brand-400">Adres aranıyor...</p>
                        ) : null}
                        {address.status === 'ready' ? (
                          <div className="space-y-1">
                            {address.suggestions.map((suggestion) => (
                              <button key={suggestion.id} type="button" onClick={() => address.selectSuggestion(suggestion)} disabled={address.selectedId === suggestion.id} className="block w-full border border-brand-200 bg-white px-1.5 py-1 text-left text-[10px] font-semibold text-brand-700 hover:border-brand-500 disabled:opacity-60">
                                {suggestion.title}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {address.status === 'empty' ? (
                          <p className="text-[10px] font-medium text-amber-600">Bu postnr. ve sokak için adres bulunamadı.</p>
                        ) : null}
                        {address.status === 'unavailable' ? (
                          <p className="text-[10px] font-medium text-amber-600">Adres servisine şu an ulaşılamıyor.</p>
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

      {customerMatch.loading || customerMatch.response || customerMatch.error ? (
        <div className={`border-b px-3 py-2 text-xs ${customerMatch.response?.status === 'conflict' || customerMatch.error ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-brand-100 bg-brand-50 text-brand-600'}`}>
          {customerMatch.loading ? 'Müşteri eşleşmesi kontrol ediliyor...' : null}
          {customerMatch.error ? 'Müşteri eşleşmesi şu an kontrol edilemedi.' : null}
          {customerMatch.response?.status === 'none' ? 'Mevcut müşteri eşleşmesi yok; yeni kayıt yalnız operatör onayıyla oluşturulur.' : null}
          {customerMatch.response?.status === 'single' ? (
            <span>
              Eşleşen müşteri: <strong>{customerMatch.response.matches[0]?.name}</strong>
              {onSelectMatchedCustomer && customerMatch.response.matches[0] ? (
                <button type="button" onClick={() => onSelectMatchedCustomer(customerMatch.response!.matches[0].id)} className="ml-2 underline">Mevcut müşteriyi seç</button>
              ) : null}
            </span>
          ) : null}
          {customerMatch.response?.status === 'conflict' ? (
            <span><strong>Çakışan kayıtlar:</strong> {customerMatch.response.matches.map((item) => item.name).join(', ')}. Kaydı seçip inceleyin.</span>
          ) : null}
        </div>
      ) : null}

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
              {bankInfo.reg_number || bankInfo.account_number ? 'Banka bağlı' : 'Banka bekleniyor'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
