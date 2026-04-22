'use client';

import { useState } from 'react';

import { getPosDocumentKind, labelPosDocumentKind } from '@/lib/pos-mappers';
import type { PosNumberingPreview, PosTradeSide } from '@/types';

type PosDocumentFieldsCardProps = {
  tradeSide?: PosTradeSide | null;
  sessionCode?: string | null;
  lineCount: number;
  numberingPreview: PosNumberingPreview | null;
  customerSummary?: {
    name?: string | null;
    cprDisplay?: string | null;
    address?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    email?: string | null;
    identityDisplay?: string | null;
  } | null;
};

type DocumentSheetTab = 'document' | 'variables' | 'display';

function fieldValue(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '-';
}

export function PosDocumentFieldsCard({
  tradeSide,
  sessionCode,
  lineCount,
  numberingPreview,
  customerSummary,
}: PosDocumentFieldsCardProps) {
  const documentKind = getPosDocumentKind(tradeSide);
  const documentTitle = labelPosDocumentKind(documentKind);
  const documentNumberLabel = documentKind === 'faktura' ? 'Fatura no' : 'Afregningsnr.';
  const [activeTab, setActiveTab] = useState<DocumentSheetTab>('document');

  const tabClass = (tab: DocumentSheetTab) =>
    activeTab === tab
      ? 'border-[#cda86a] bg-[#fff7ea] text-[#3d2b10] shadow-[0_-1px_0_rgba(255,255,255,0.9)]'
      : 'border-transparent bg-[#efe5d1] text-[#7d6540] hover:bg-[#f4ead7]';

  return (
    <section className="mt-4 rounded-3xl border border-[#ddccab] bg-[linear-gradient(180deg,#fffdfa_0%,#f8f0e1_100%)] p-4 shadow-[0_14px_34px_rgba(92,62,24,0.08)] md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b6b38]">Belge ve Musteri Alanlari</p>
          <h3 className="mt-1 text-lg font-semibold text-[#3d2b10] md:text-xl">{documentTitle} Kontrati</h3>
          <p className="mt-1 text-sm text-[#6d5531]">
            Excel kolon sirasina hizali alan on izlemesi. Bu bilgiler belgeye ve customer-safe snapshot akisine temel olur.
          </p>
        </div>

        <div className="grid gap-2 text-xs text-[#6d5531] sm:grid-cols-2">
          <div className="rounded-2xl border border-[#e8d8bb] bg-white/80 px-4 py-3">
            <p className="uppercase tracking-[0.14em] text-[#9e7c43]">Belge Tipi</p>
            <p className="mt-1 text-sm font-semibold text-[#3d2b10]">{documentTitle}</p>
            <p className="mt-1 text-xs text-[#7c6642]">Taslak referansi: {fieldValue(sessionCode)}</p>
          </div>
          <div className="rounded-2xl border border-[#e8d8bb] bg-white/80 px-4 py-3">
            <p className="uppercase tracking-[0.14em] text-[#9e7c43]">Kalem ve Akis</p>
            <p className="mt-1 text-sm font-semibold text-[#3d2b10]">{lineCount} kalem hazir</p>
            <p className="mt-1 text-xs text-[#7c6642]">Satirlar customer display ekranina canli yansir.</p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-end gap-2 border-b border-[#d9c6a2] px-1">
          <button type="button" onClick={() => setActiveTab('document')} className={`rounded-t-2xl border px-4 py-2 text-sm font-semibold transition ${tabClass('document')}`}>
            Afregningsbilag
          </button>
          <button type="button" onClick={() => setActiveTab('variables')} className={`rounded-t-2xl border px-4 py-2 text-sm font-semibold transition ${tabClass('variables')}`}>
            Variable vaerdier
          </button>
          <button type="button" onClick={() => setActiveTab('display')} className={`rounded-t-2xl border px-4 py-2 text-sm font-semibold transition ${tabClass('display')}`}>
            Display guvenligi
          </button>
        </div>

        <div className="rounded-[1.65rem] rounded-tl-none border border-[#d9c6a2] bg-white/90 p-4 shadow-[0_12px_28px_rgba(92,62,24,0.06)] md:p-5">
          {activeTab === 'document' && (
            <div className="grid gap-4 xl:grid-cols-[0.95fr,1.45fr]">
              <div className="rounded-2xl border border-[#e8d8bb] bg-[#fffaf1] p-4">
                <p className="text-sm font-semibold text-[#3d2b10]">Belge Header ve Akis</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Belge Tipi</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{documentTitle}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Taslak Referansi</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(sessionCode)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Kalem ve Akis</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{lineCount} kalem hazir</p>
                    <p className="mt-1 text-xs text-[#7c6642]">Satirlar customer display ekranina canli yansir.</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Sheet Mantigi</p>
                    <p className="mt-1 text-sm font-semibold text-[#3d2b10]">Excel sheet duzeni</p>
                    <p className="mt-1 text-xs text-[#7c6642]">Bu sekme Afregningsbilag sayfasinin alan sirasini temsil eder.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e8d8bb] bg-[#fffaf1] p-4">
                <p className="text-sm font-semibold text-[#3d2b10]">Belge Alan Sirasi</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">H6 · {documentNumberLabel}</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(numberingPreview?.afregnings_number_next)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">H7 · Dato</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">
                      {new Intl.DateTimeFormat('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date())}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">C16 · Navn</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(customerSummary?.name)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">F16 · CPR nr.</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(customerSummary?.cprDisplay)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">C17 · Adresse</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(customerSummary?.address)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">F17 · Korekort/pas</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(customerSummary?.identityDisplay)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">C18 · Postnr.</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(customerSummary?.postalCode)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">F18 · Tlf.</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(customerSummary?.phone)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3 md:col-span-2">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">F19 · E-mail</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(customerSummary?.email)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'variables' && (
            <div className="grid gap-4 xl:grid-cols-[1.05fr,1.2fr]">
              <div className="rounded-2xl border border-[#e8d8bb] bg-[#fffaf1] p-4">
                <p className="text-sm font-semibold text-[#3d2b10]">Numaralandirma On Izleme</p>
                <p className="mt-1 text-xs text-[#7c6642]">Variable vaerdier sayfasindaki siradaki numara ve baz alanlarin web uyarlamasi.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Afregnings No</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(numberingPreview?.afregnings_number_next)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Invoice No</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(numberingPreview?.invoice_number_next)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Reference No</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(numberingPreview?.reference_number_next)}</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Product No</p>
                    <p className="mt-1 text-base font-semibold text-[#3d2b10]">{fieldValue(numberingPreview?.product_number_next)}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e8d8bb] bg-[#fffaf1] p-4">
                <p className="text-sm font-semibold text-[#3d2b10]">Sheet Mantigi</p>
                <div className="mt-3 grid gap-3">
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-sm font-semibold text-[#3d2b10]">A4:E8 referansi</p>
                    <p className="mt-1 text-sm text-[#5f4924]">Urun tipi, saflik, dagspris ve avance helper katmaninda reusable mapper mantigiyla ele aliniyor.</p>
                  </div>
                  <div className="rounded-2xl border border-[#efe4cf] bg-white px-4 py-3">
                    <p className="text-sm font-semibold text-[#3d2b10]">Belge preview alanlari</p>
                    <p className="mt-1 text-sm text-[#5f4924]">Next afregnings, invoice, reference ve product no alanlari wizard icinde gorunur tutuluyor.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'display' && (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-[#e8d8bb] bg-[#fffaf1] p-4">
                <p className="text-sm font-semibold text-[#3d2b10]">Customer-safe ekranda gorunecekler</p>
                <div className="mt-3 grid gap-2 rounded-2xl border border-[#efe4cf] bg-white p-4 text-sm text-[#5f4924]">
                  <p>Musteri adi</p>
                  <p>Islem tipi ve belge durumu</p>
                  <p>Toplam teklif, kalem adedi, gram ve has altin ozeti</p>
                  <p>Satirlar ve satir notlari</p>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e8d8bb] bg-[#fffaf1] p-4">
                <p className="text-sm font-semibold text-[#3d2b10]">Sadece admin ekraninda kalacaklar</p>
                <div className="mt-3 grid gap-2 rounded-2xl border border-[#efe4cf] bg-white p-4 text-sm text-[#5f4924]">
                  <p>CPR ve kimlik numarasi</p>
                  <p>Internal margin ve avance</p>
                  <p>Depolama, storage, audit ve operasyon notlari</p>
                  <p>Manual review ve shop-ic operasyon alanlari</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
