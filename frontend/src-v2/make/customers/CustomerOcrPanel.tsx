import { useEffect, useState } from 'react';
import { Camera, CheckCircle2, FileImage, FolderInput, Loader2, Radio, RefreshCw, ScanLine, X } from 'lucide-react';

import { getIdentityWatchStatus, stopIdentityWatch, type IdentityWatchStatus } from '@/lib/desktop';
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
  identity_doc_country: 'DNK',
};

// R1-02 — müşteri formuna kimlik tarama/OCR bloğu. AFG'deki useIdentityScan
// hattını (WIA tarayıcı + dosya + sürükle-bırak, R2-03) yeniden kullanır;
// onaylanan alanlar "önerilen değer" olarak taslağa dolar, kayıt yine
// operatörün Kaydet onayıyla oluşur.
//
// M2: panel artık hedef-bilinçli (yeni kayıt / düzenleme) ve mount'ta
// Rust'taki kalıcı klasör-izleme durumunu sorgular — panel kapalıyken izleme
// yaşamaya devam ettiği için WATCH_ALREADY_ACTIVE ile Durdur yolu olmadan
// kilitlenmek mümkündü.
export function CustomerOcrPanel({
  onApply,
  targetLabel,
}: {
  onApply: (fields: Partial<CustomerDraft>) => void;
  /** M2: taramanın uygulanacağı hedef (yeni kayıt / düzenleme) — opsiyonel rozet. */
  targetLabel?: string;
}) {
  const [mirror, setMirror] = useState<EditableCustomer>(EMPTY);
  const [dragActive, setDragActive] = useState(false);
  // M2: panel kapalıyken başlatılmış izlemenin kalıntı durumu — hook'un
  // watchStatus'u null'dan yalnız start/stop ile set edildiği için burada
  // ayrıca sorgulanır.
  const [restoredWatch, setRestoredWatch] = useState<IdentityWatchStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getIdentityWatchStatus().then((status) => {
      if (!cancelled && status?.active) setRestoredWatch(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        // M2: şehir artık taslağa taşınıyor (backend create/update city destekler).
        if (applied.city) fields.city = applied.city;
        if (applied.cpr_number) fields.cpr_number = applied.cpr_number;
        if (applied.identity_doc_type) fields.identity_doc_type = applied.identity_doc_type;
        if (applied.identity_doc_number) fields.identity_doc_number = applied.identity_doc_number;
        onApply(fields);
        return EMPTY;
      });
    },
  });

  // M2: izleme rozeti hook durumundan YA DA kalıcı durum sorgusundan gelir.
  const activeWatch: IdentityWatchStatus | null =
    identity.watchStatus?.active ? identity.watchStatus : restoredWatch?.active ? restoredWatch : null;

  const handleStopWatch = async () => {
    try {
      if (identity.watchStatus?.active) {
        await identity.stopWatch();
      } else {
        await stopIdentityWatch();
      }
      setRestoredWatch(null);
    } catch {
      // Durdur başarısız — rozet yerinde kalır, kullanıcı tekrar deneyebilir.
    }
  };

  const scannedFields = identity.result
    ? Object.entries(identity.result.fields).filter(([field, parsed]) => field !== 'identity_doc_country' && parsed?.value)
    : [];
  // M2: hiçbir tarama yolu yoksa "Yenile" göster — cihaz sonradan bağlanınca
  // yetenekler yeniden sorgulanabilsin (AFG'deki refreshCapabilities ile aynı uç).
  const noCapabilities = !identity.capabilities.scanner && !identity.capabilities.file && !identity.capabilities.watch;

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
          {targetLabel ? (
            <span className="border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
              Hedef: {targetLabel}
            </span>
          ) : null}
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
          {identity.capabilities.watch && !activeWatch ? (
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
          {activeWatch ? (
            <span
              className="inline-flex items-center gap-1 border border-sky-400 bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-800"
              title={activeWatch.folder ?? undefined}
            >
              <Radio className="h-3 w-3 animate-pulse" />
              <span className="uppercase tracking-widest">Klasör izleme açık</span>
              {activeWatch.folder ? (
                <span className="max-w-44 truncate font-mono normal-case tracking-normal">{activeWatch.folder}</span>
              ) : null}
              <button
                type="button"
                onClick={() => void handleStopWatch()}
                className="ml-1 underline hover:text-sky-900"
              >
                Durdur
              </button>
            </span>
          ) : null}
          {noCapabilities ? (
            <button
              type="button"
              onClick={() => void identity.refreshCapabilities()}
              title="Tarayıcı sonra bağlandıysa cihaz yeteneklerini yeniden sorgular"
              className="inline-flex items-center gap-1 border border-brand-300 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-600 transition hover:bg-brand-100"
            >
              <RefreshCw className="h-3 w-3" /> Yenile
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-brand-500">
        Pas / ID-kort / kørekort / sundhedskort görüntüsünü sürükleyip bırakın veya seçin — alanlar önerilen değer olarak dolar, kayıt onayınızla oluşur.
      </p>
      {identity.ocrNotice ? <p className="mt-1 text-[11px] font-semibold text-amber-700">{identity.ocrNotice}</p> : null}
      {identity.error ? <p className="mt-1 text-[11px] font-semibold text-rose-700">{identity.error}</p> : null}
      {identity.error && identity.errorCode ? (
        <p className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold text-rose-500">
          Hata kodu: {identity.errorCode}
          {/* M2: izleme zaten açıkken kullanıcıyı kilitlemeyen Durdur yolu. */}
          {identity.errorCode === 'WATCH_ALREADY_ACTIVE' ? (
            <button
              type="button"
              onClick={() => void handleStopWatch()}
              className="border border-sky-400 bg-white px-2 py-0.5 font-sans text-[10px] font-black uppercase tracking-widest text-sky-700 transition hover:bg-sky-100"
            >
              İzlemeyi durdur
            </button>
          ) : null}
        </p>
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
      {identity.status === 'review' && identity.scanMeta ? (
        <div className="mt-1 border-t border-brand-200 pt-1">
          {/* AFG'deki tarama özetiyle aynı sözleşme: PII içermeyen teşhis satırı. */}
          <p className="text-[10px] font-semibold text-brand-500">
            OCR teşhisi: {identity.scanMeta.language || 'dil bilinmiyor'} · {identity.scanMeta.lineCount} satır
            {identity.scanMeta.scaled === undefined ? '' : identity.scanMeta.scaled ? ' · ölçeklendi' : ' · ölçeklenmedi'}
            {identity.scanMeta.fieldKeys.includes('name') ? '' : ' · İSİM OKUNAMADI'}
          </p>
          {identity.diagnostic ? (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-[10px] font-semibold text-brand-500">Maskeli ham satırlar (kişisel veri içermez)</summary>
              <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-line border border-brand-200 bg-brand-50 px-2 py-1 font-mono text-[10px] text-brand-600">{identity.diagnostic}</pre>
            </details>
          ) : null}
          {Object.keys(identity.previews).length ? (
            <div className="mt-1 flex gap-2">
              {(['front', 'back'] as const).map((side) =>
                identity.previews[side] ? (
                  <img
                    key={side}
                    src={identity.previews[side]}
                    alt={`Kimlik ${side === 'front' ? 'ön' : 'arka'} yüz önizlemesi`}
                    className="h-16 max-w-28 border border-brand-200 object-cover"
                  />
                ) : null,
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
