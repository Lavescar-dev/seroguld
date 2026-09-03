import { useState } from 'react';
import { Camera, CheckCircle2, FileImage, FolderInput, Loader2, Radio, ScanLine, X } from 'lucide-react';

import { useIdentityScan } from '@/make/alis/identityScan';
import type { EditableCustomer } from '@/make/alis/types';
import type { CustomerDraft } from './types';

const EMPTY: EditableCustomer = {
  name: '',
  phone: '',
  email: '',
  address: '',
  postal_code: '',
  city: '',
  cpr_number: '',
  identity_doc_type: '',
  identity_doc_number: '',
  identity_doc_country: 'DK',
};

// R1-02 — müşteri formuna kimlik tarama/OCR bloğu. AFG'deki useIdentityScan
// hattını (WIA tarayıcı + dosya + sürükle-bırak, R2-03) yeniden kullanır;
// onaylanan alanlar "önerilen değer" olarak yeni-müşteri taslağına dolar,
// kayıt yine operatörün Kaydet onayıyla oluşur.
export function CustomerOcrPanel({
  onApply,
}: {
  onApply: (fields: Partial<CustomerDraft>) => void;
}) {
  const [mirror, setMirror] = useState<EditableCustomer>(EMPTY);
  const [dragActive, setDragActive] = useState(false);
  const identity = useIdentityScan({
    customer: mirror,
    setCustomer: setMirror,
    onApplied: () => {
      setMirror((applied) => {
        const fields: Partial<CustomerDraft> = {};
        if (applied.name) fields.name = applied.name;
        if (applied.phone) fields.phone = applied.phone;
        if (applied.address) fields.address = applied.address;
        if (applied.postal_code) fields.postal_code = applied.postal_code;
        if (applied.cpr_number) fields.cpr_number = applied.cpr_number;
        if (applied.identity_doc_type) fields.identity_doc_type = applied.identity_doc_type;
        if (applied.identity_doc_number) fields.identity_doc_number = applied.identity_doc_number;
        onApply(fields);
        return EMPTY;
      });
    },
  });

  const scannedFields = identity.result
    ? Object.entries(identity.result.fields).filter(([field, parsed]) => field !== 'identity_doc_country' && parsed?.value)
    : [];

  return (
    <div
      className={`mb-3 border-2 border-dashed px-4 py-3 ${dragActive ? 'border-emerald-500 bg-emerald-50' : 'border-brand-300 bg-brand-50'}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (identity.capabilities.file) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        const file = Array.from(event.dataTransfer?.files || []).find((item) => /\.(jpe?g|png|tiff?|bmp)$/i.test(item.name));
        if (file) void identity.dropFile(file, 'front');
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-emerald-700" />
          <span className="text-xs font-black uppercase tracking-widest text-brand-700">Kimlik tarama / OCR</span>
          {identity.status === 'acquiring' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" /> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!identity.capabilities.scanner || identity.status === 'acquiring'}
            onClick={() => void identity.acquire('front')}
            className="inline-flex items-center gap-1 border border-emerald-600 bg-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Camera className="h-3 w-3" /> Tarayıcıdan
          </button>
          <button
            type="button"
            disabled={!identity.capabilities.file || identity.status === 'acquiring'}
            onClick={() => void identity.pickFile('front')}
            className="inline-flex items-center gap-1 border border-brand-400 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileImage className="h-3 w-3" /> Dosyadan
          </button>
          {identity.capabilities.watch && !identity.watchStatus?.active ? (
            <button
              type="button"
              disabled={identity.status === 'acquiring'}
              onClick={() => void identity.startWatch('front')}
              title="Epson tarayıcının klasöre tara profilinin yazdığı klasörü izler (varsayılan: Pictures\SeroGuld-Scan)"
              className="inline-flex items-center gap-1 border border-sky-400 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FolderInput className="h-3 w-3" /> Klasörden
            </button>
          ) : null}
          {identity.capabilities.watch && identity.watchStatus?.active ? (
            <span
              className="inline-flex items-center gap-1 border border-sky-400 bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-800"
              title={identity.watchStatus.folder ?? undefined}
            >
              <Radio className="h-3 w-3 animate-pulse" />
              <span className="uppercase tracking-widest">Klasör izleme açık</span>
              {identity.watchStatus.folder ? (
                <span className="max-w-44 truncate font-mono normal-case tracking-normal">{identity.watchStatus.folder}</span>
              ) : null}
              <button
                type="button"
                onClick={() => void identity.stopWatch()}
                className="ml-1 underline hover:text-sky-900"
              >
                Durdur
              </button>
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-brand-500">
        Pas / ID-kort / kørekort / sundhedskort görüntüsünü sürükleyip bırakın veya seçin — alanlar önerilen değer olarak dolar, kayıt onayınızla oluşur.
      </p>
      {identity.ocrNotice ? <p className="mt-1 text-[11px] font-semibold text-amber-700">{identity.ocrNotice}</p> : null}
      {identity.error ? <p className="mt-1 text-[11px] font-semibold text-rose-700">{identity.error}</p> : null}
      {identity.error && identity.errorCode ? (
        <p className="mt-0.5 font-mono text-[10px] font-bold text-rose-500">Hata kodu: {identity.errorCode}</p>
      ) : null}
      {identity.error && identity.diagnostic ? <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-line border border-brand-200 bg-brand-50 px-2 py-1 font-mono text-[10px] text-brand-600">{identity.diagnostic}</pre> : null}
      {identity.status === 'review' && scannedFields.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-brand-200 pt-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800">Okunan:</span>
          {scannedFields.map(([field, parsed]) => (
            <span key={field} className="border border-emerald-300 bg-white px-2 py-0.5 text-[11px] text-brand-800">
              {parsed?.value}
            </span>
          ))}
          <button
            type="button"
            onClick={identity.confirm}
            className="inline-flex items-center gap-1 border border-emerald-600 bg-emerald-700 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-600"
          >
            <CheckCircle2 className="h-3 w-3" /> Forma uygula
          </button>
          <button
            type="button"
            onClick={identity.clear}
            className="inline-flex items-center gap-1 border border-brand-300 bg-white px-2 py-1 text-[10px] font-bold uppercase text-brand-600 hover:bg-brand-100"
          >
            <X className="h-3 w-3" /> Vazgeç
          </button>
        </div>
      ) : null}
    </div>
  );
}
