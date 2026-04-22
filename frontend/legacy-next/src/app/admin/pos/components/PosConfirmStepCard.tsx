'use client';

import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { labelMetalType, labelPosStatus, labelPosTradeSide, labelProductType } from '@/lib/labels';
import { formatKaratFinhed, getPosDocumentKind, labelPosDocumentKind, mapPosSessionLineToAfregningsRow, toLodighed } from '@/lib/pos-mappers';
import type { PosNumberingPreview, PosSession, PosSessionLine } from '@/types';
import { DEFAULT_INTERNAL_MARGIN_PERCENT } from '../pos-config';
import type { ConfirmFormState, SaleMode } from '../pos-types';

type PosConfirmStepCardProps = {
  visible: boolean;
  session: PosSession | null;
  saleMode: SaleMode;
  canEditSession: boolean;
  busy: boolean;
  confirmForm: ConfirmFormState;
  setConfirmForm: Dispatch<SetStateAction<ConfirmFormState>>;
  confirmTargetAmount: number | null;
  formatDkk: (value: number | string | null | undefined) => string;
  requiresSaleOverrideApproval: boolean;
  hasSalePriceOverride: boolean;
  hasSaleMarginOverride: boolean;
  finalOfferValue: number | null;
  manualSalePriceValue: number | null;
  sessionMarginValue: number | null;
  saleOverrideApproved: boolean;
  setSaleOverrideApproved: (value: boolean) => void;
  posLines: PosSessionLine[];
  posLinesTotalOffer: number;
  hasMeaningfulPosLinesDifference: boolean;
  posLinesAmountDifference: number | null;
  lineTotalAdjustmentApproved: boolean;
  setLineTotalAdjustmentApproved: (value: boolean) => void;
  nextReferenceSuggestion: string;
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
  finalApprovalChecked: boolean;
  setFinalApprovalChecked: (value: boolean) => void;
  canConfirmSession: boolean;
  confirmBlockers: string[];
  onRefreshNextReferenceSuggestion: () => void;
  onConfirmSession: () => void;
  onCancelSession: () => void;
};

export function PosConfirmStepCard({
  visible,
  session,
  saleMode,
  canEditSession,
  busy,
  confirmForm,
  setConfirmForm,
  confirmTargetAmount,
  formatDkk,
  requiresSaleOverrideApproval,
  hasSalePriceOverride,
  hasSaleMarginOverride,
  finalOfferValue,
  manualSalePriceValue,
  sessionMarginValue,
  saleOverrideApproved,
  setSaleOverrideApproved,
  posLines,
  posLinesTotalOffer,
  hasMeaningfulPosLinesDifference,
  posLinesAmountDifference,
  lineTotalAdjustmentApproved,
  setLineTotalAdjustmentApproved,
  nextReferenceSuggestion,
  numberingPreview,
  customerSummary,
  finalApprovalChecked,
  setFinalApprovalChecked,
  canConfirmSession,
  confirmBlockers,
  onRefreshNextReferenceSuggestion,
  onConfirmSession,
  onCancelSession,
}: PosConfirmStepCardProps) {
  if (!visible) {
    return null;
  }

  const documentKind = getPosDocumentKind(session?.trade_side);
  const documentTitle = labelPosDocumentKind(documentKind);
  const documentNumberLabel = documentKind === 'faktura' ? 'Fatura no' : 'Afregningsnr.';
  const nowText = new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  const salePreviewText =
    posLines[0]
      ? `${labelProductType(posLines[0].product_type)} · ${labelMetalType(posLines[0].metal_type)}`
      : `${labelProductType(session?.product_type || null)} · ${labelMetalType(session?.metal_type || null)}`;

  return (
    <div className="card rounded-3xl border-[#ddccab] bg-[linear-gradient(180deg,#fffdf9_0%,#f7efdf_100%)] p-5 shadow-[0_14px_34px_rgba(92,62,24,0.08)]">
      <h3 className="text-lg font-semibold text-[#3d2b10] md:text-xl">5) Islemi Onayla</h3>
      <p className="mt-1 text-sm text-[#6d5531]">
        {session?.trade_side === 'sell_to_customer'
          ? saleMode === 'inventory'
            ? 'Onaylandığında seçilen stok ürünü satıldı olarak işaretlenir ve alıcı müşteri bu POS oturumuna bağlanır.'
            : 'Onaylandığında manuel satış kaydı oluşturulur ve ürün satıldı olarak işlenir.'
          : 'Onaylandığında sistem otomatik ürün kaydı açar ve 14 gün kilidini başlatır.'}
      </p>

      <div className="mt-4 grid gap-3 xl:grid-cols-12">
        <div className="rounded-2xl border border-[#e5d6bb] bg-white/90 px-4 py-4 xl:col-span-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#a28045]">Belge ve Oturum</p>
          <p className="mt-1 text-lg font-semibold text-[#3d2b10]">{documentTitle}</p>
          <div className="mt-3 grid gap-1 text-sm text-[#6d5531]">
            <p>POS Kodu: <strong>{session?.session_code || '-'}</strong></p>
            <p>Durum: <strong>{labelPosStatus(session?.status || 'draft')}</strong></p>
            <p>Islem: <strong>{labelPosTradeSide(session?.trade_side || 'buy_from_customer')}</strong></p>
          </div>
        </div>
        <div className="rounded-2xl border border-[#e5d6bb] bg-white/90 px-4 py-4 xl:col-span-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#a28045]">Numaralandirma Preview</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-[#7d6540]">Afregnings No</p>
              <p className="text-base font-semibold text-[#3d2b10]">{numberingPreview?.afregnings_number_next || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-[#7d6540]">Invoice No</p>
              <p className="text-base font-semibold text-[#3d2b10]">{numberingPreview?.invoice_number_next || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-[#7d6540]">Reference No</p>
              <p className="text-base font-semibold text-[#3d2b10]">{numberingPreview?.reference_number_next || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-[#7d6540]">Product No</p>
              <p className="text-base font-semibold text-[#3d2b10]">{numberingPreview?.product_number_next || '-'}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-[#d7c193] bg-[linear-gradient(135deg,#352615_0%,#21170f_100%)] px-4 py-4 text-[#f7ecd2] xl:col-span-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#d9bd81]">Onay Toplami</p>
          <p className="mt-2 text-3xl font-bold text-[#f4d99b]">{formatDkk(confirmTargetAmount)} DKK</p>
          <p className="mt-2 text-sm text-[#e6d5b0]">{posLines.length > 0 ? `${posLines.length} kalem` : 'Tek kalem'} belgeye yansiyacak.</p>
        </div>
        <div className="rounded-2xl border border-[#e5d6bb] bg-white/90 px-4 py-4 xl:col-span-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#a28045]">Musteri</p>
          <p className="mt-1 text-lg font-semibold text-[#3d2b10]">{customerSummary?.name || session?.customer_name || '-'}</p>
          <p className="mt-3 text-sm text-[#6d5531]">Kalem toplam: <strong>{formatDkk(posLinesTotalOffer)} DKK</strong></p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-[#e5d6bb] bg-white/90 p-4">
        <p className="text-sm font-semibold text-[#3d2b10]">Belge Alanlari (On Izleme)</p>
        <p className="mt-1 text-xs text-[#6d5531]">
          Alan sirasi Excel kontratina gore korunur. Bu kart belgeye hangi bilginin yazilacagini gosterir.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <p>
            H6 · {documentNumberLabel}: <strong>{documentKind === 'faktura' ? numberingPreview?.invoice_number_next || '-' : numberingPreview?.afregnings_number_next || '-'}</strong>
          </p>
          <p>
            H7 · Dato: <strong>{nowText}</strong>
          </p>
          <p>
            C16 · Navn: <strong>{customerSummary?.name || session?.customer_name || '-'}</strong>
          </p>
          <p>
            F16 · CPR nr.: <strong>{customerSummary?.cprDisplay || '-'}</strong>
          </p>
          <p>
            C17 · Adresse: <strong>{customerSummary?.address || '-'}</strong>
          </p>
          <p>
            F17 · Korekort/pas: <strong>{customerSummary?.identityDisplay || '-'}</strong>
          </p>
          <p>
            C18 · Postnr.: <strong>{customerSummary?.postalCode || '-'}</strong>
          </p>
          <p>
            F18 · Tlf.: <strong>{customerSummary?.phone || '-'}</strong>
          </p>
          <p className="md:col-span-2">
            F19 · E-mail: <strong>{customerSummary?.email || '-'}</strong>
          </p>
        </div>
      </div>

      {posLines.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[#e5d6bb] bg-white/90 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#3d2b10]">Kalem On Izleme (C20:H20 Kontrati)</p>
              <p className="mt-1 text-xs text-[#6d5531]">Onayda bu satirlar belgeye, transaction kaydina ve customer-safe snapshot toplamlarina yansir.</p>
            </div>
            <div className="rounded-full border border-[#d8c39a] bg-[#fbf4e6] px-4 py-2 text-sm font-semibold text-[#684f24]">
              Kalem Toplami: {formatDkk(posLinesTotalOffer)} DKK
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#f9f2e5]">
                  <th className="border border-[#eadcc3] px-2 py-1 text-left">#</th>
                  <th className="border border-[#eadcc3] px-2 py-1 text-left">Type</th>
                  <th className="border border-[#eadcc3] px-2 py-1 text-left">Karat / % Finhed</th>
                  <th className="border border-[#eadcc3] px-2 py-1 text-left">Lodighed</th>
                  <th className="border border-[#eadcc3] px-2 py-1 text-left">Vaegt i g</th>
                  <th className="border border-[#eadcc3] px-2 py-1 text-left">Enhedspris / g</th>
                  <th className="border border-[#eadcc3] px-2 py-1 text-left">I alt</th>
                </tr>
              </thead>
              <tbody>
                {[...posLines]
                  .sort((a, b) => a.line_no - b.line_no)
                  .map((line) => {
                    const row = mapPosSessionLineToAfregningsRow(line);
                    return (
                      <tr key={line.id}>
                        <td className="border border-[#f0e5d1] px-2 py-1 font-semibold">{row.lineNo}</td>
                        <td className="border border-[#f0e5d1] px-2 py-1">{row.type}</td>
                        <td className="border border-[#f0e5d1] px-2 py-1">{row.karatFinhed}</td>
                        <td className="border border-[#f0e5d1] px-2 py-1">{row.lodighed}</td>
                        <td className="border border-[#f0e5d1] px-2 py-1">{row.weightGramsText}</td>
                        <td className="border border-[#f0e5d1] px-2 py-1">{row.unitRateText}</td>
                        <td className="border border-[#f0e5d1] px-2 py-1 font-semibold">{row.totalText}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {session?.trade_side === 'sell_to_customer' ? (
          <>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Satış fiyatı (DKK) - boşsa nihai teklif kullanılır"
              value={confirmForm.sale_price_dkk}
              onChange={(event) =>
                setConfirmForm((state) => ({
                  ...state,
                  sale_price_dkk: event.target.value,
                }))
              }
              disabled={!canEditSession}
            />
            {saleMode === 'manual' ? (
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Maliyet (DKK, opsiyonel) - boşsa satış fiyatı baz alınır"
                value={confirmForm.manual_purchase_cost_dkk}
                onChange={(event) =>
                  setConfirmForm((state) => ({
                    ...state,
                    manual_purchase_cost_dkk: event.target.value,
                  }))
                }
                disabled={!canEditSession}
              />
            ) : null}
            {saleMode === 'manual' ? (
              <>
                <Input
                  placeholder="Referans no (opsiyonel)"
                  value={confirmForm.reference_number}
                  onChange={(event) =>
                    setConfirmForm((state) => ({
                      ...state,
                      reference_number: event.target.value,
                    }))
                  }
                  disabled={!canEditSession}
                />
                <Input
                  placeholder="Depolama konumu (opsiyonel)"
                  value={confirmForm.storage_location}
                  onChange={(event) =>
                    setConfirmForm((state) => ({
                      ...state,
                      storage_location: event.target.value,
                    }))
                  }
                  disabled={!canEditSession}
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <Input
              placeholder="Referans no"
              value={confirmForm.reference_number}
              onChange={(event) =>
                setConfirmForm((state) => ({
                  ...state,
                  reference_number: event.target.value,
                }))
              }
              disabled={!canEditSession}
            />
            <Input
              placeholder="Depolama konumu"
              value={confirmForm.storage_location}
              onChange={(event) =>
                setConfirmForm((state) => ({
                  ...state,
                  storage_location: event.target.value,
                }))
              }
              disabled={!canEditSession}
            />
          </>
        )}
        <Input
          className="md:col-span-2"
          placeholder="Notlar"
          value={confirmForm.notes}
          onChange={(event) =>
            setConfirmForm((state) => ({
              ...state,
              notes: event.target.value,
            }))
          }
          disabled={!canEditSession}
        />
        {session?.trade_side !== 'sell_to_customer' && (
          <label className="flex items-center gap-2 text-sm text-brand-700 md:col-span-2">
            <input
              type="checkbox"
              checked={confirmForm.needs_cleaning}
              onChange={(event) =>
                setConfirmForm((state) => ({
                  ...state,
                  needs_cleaning: event.target.checked,
                }))
              }
              disabled={!canEditSession}
            />
            Ürün temizleme gerektiriyor
          </label>
        )}
      </div>
      {session?.trade_side === 'sell_to_customer' && (
        <div className="mt-4 rounded-2xl border border-[#e5d6bb] bg-white/90 p-4">
          <p className="text-sm font-semibold text-[#3d2b10]">Faktura Diverse On Izleme</p>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-[#efe4cf] bg-[#fffaf1] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Tekst</p>
              <p className="mt-1 text-sm font-semibold text-[#3d2b10]">{salePreviewText}</p>
            </div>
            <div className="rounded-2xl border border-[#efe4cf] bg-[#fffaf1] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Antal</p>
              <p className="mt-1 text-sm font-semibold text-[#3d2b10]">{Math.max(1, posLines.length || 1)}</p>
            </div>
            <div className="rounded-2xl border border-[#efe4cf] bg-[#fffaf1] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">Pris</p>
              <p className="mt-1 text-sm font-semibold text-[#3d2b10]">{formatDkk(manualSalePriceValue ?? finalOfferValue)} DKK</p>
            </div>
            <div className="rounded-2xl border border-[#efe4cf] bg-[#fffaf1] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#a28045]">I alt</p>
              <p className="mt-1 text-sm font-semibold text-[#3d2b10]">{formatDkk(confirmTargetAmount)} DKK</p>
            </div>
          </div>
        </div>
      )}
      {requiresSaleOverrideApproval && session?.trade_side === 'sell_to_customer' && (
        <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Satış Override Onayı Zorunlu</p>
          <div className="grid gap-1 text-xs text-amber-900">
            {hasSalePriceOverride && (
              <p>
                Fiyat override: Hesaplanan satış fiyatı <strong>{formatDkk(finalOfferValue)} DKK</strong>, girilen satış
                fiyatı <strong>{formatDkk(manualSalePriceValue)} DKK</strong>.
              </p>
            )}
            {hasSaleMarginOverride && (
              <p>
                Marj override: Varsayılan marj <strong>%{DEFAULT_INTERNAL_MARGIN_PERCENT.toFixed(2)}</strong>, aktif marj{' '}
                <strong>%{formatDkk(sessionMarginValue)}</strong>.
              </p>
            )}
          </div>
          <label className="flex items-start gap-2 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={saleOverrideApproved}
              onChange={(event) => setSaleOverrideApproved(event.target.checked)}
              disabled={!canEditSession}
            />
            <span>
              Bu satışta fiyat/marj override ettiğimi onaylıyorum. Denetim izi için aşağıya gerekçeyi yazacağım.
            </span>
          </label>
          <Input
            className="w-full"
            placeholder="Override denetim notu (zorunlu, min 6 karakter)"
            value={confirmForm.sale_override_reason}
            onChange={(event) =>
              setConfirmForm((state) => ({
                ...state,
                sale_override_reason: event.target.value,
              }))
            }
            disabled={!canEditSession}
          />
        </div>
      )}
      {posLines.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[#e5d6bb] bg-[#fbf5e9] p-4">
          <p className="text-sm font-semibold text-[#3d2b10]">Onay Oncesi Kalem Ozeti</p>
          <p className="mt-1 text-xs text-[#6d5531]">
            Çoklu kalem kullanıldı. Onayda bu satırlar transaction ve belgeye yansır.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="bg-white">
                  <th className="border border-brand-200 px-2 py-1 text-left">Kalem</th>
                  <th className="border border-brand-200 px-2 py-1 text-left">Type</th>
                  <th className="border border-brand-200 px-2 py-1 text-left">Karat / % Finhed</th>
                  <th className="border border-brand-200 px-2 py-1 text-left">Lodighed</th>
                  <th className="border border-brand-200 px-2 py-1 text-left">Vaegt i g</th>
                  <th className="border border-brand-200 px-2 py-1 text-left">Enhedspris / g</th>
                  <th className="border border-brand-200 px-2 py-1 text-left">I alt</th>
                </tr>
              </thead>
              <tbody>
                {posLines.map((line) => (
                  <tr key={line.id}>
                    <td className="border border-brand-200 px-2 py-1">#{line.line_no}</td>
                    <td className="border border-brand-200 px-2 py-1">
                      {labelProductType(line.product_type)} · {labelMetalType(line.metal_type)}
                    </td>
                    <td className="border border-brand-200 px-2 py-1">{formatKaratFinhed(line.purity_karat, line.purity_percentage)}</td>
                    <td className="border border-brand-200 px-2 py-1">{toLodighed(line.purity_karat, line.purity_percentage)}</td>
                    <td className="border border-brand-200 px-2 py-1">{line.weight_grams} g</td>
                    <td className="border border-brand-200 px-2 py-1">{formatDkk(line.rate_dkk)} DKK/g</td>
                    <td className="border border-brand-200 px-2 py-1 font-semibold">
                      {formatDkk(line.line_offer_dkk)} DKK
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs font-semibold text-brand-900">
            Kalem Toplamı: {formatDkk(posLinesTotalOffer)} DKK
          </p>
          {hasMeaningfulPosLinesDifference && (
            <div className="mt-1 space-y-2">
              <p className="text-xs font-semibold text-amber-700">
                Uyarı: Kalem toplamı ile nihai teklif arasında {formatDkk(posLinesAmountDifference)} DKK fark var.
              </p>
              <label className="flex items-start gap-2 text-xs text-brand-800">
                <input
                  type="checkbox"
                  checked={lineTotalAdjustmentApproved}
                  onChange={(event) => setLineTotalAdjustmentApproved(event.target.checked)}
                  disabled={!canEditSession}
                />
                <span>
                  Bu farkı onaylıyorum. Onay sırasında sistem farkı son kaleme yansıtarak toplamı
                  nihai teklif ile eşitleyecek.
                </span>
              </label>
            </div>
          )}
        </div>
      )}
      {!(session?.trade_side === 'sell_to_customer' && saleMode === 'inventory') && (
        <div className="mt-4 rounded-2xl border border-[#e5d6bb] bg-white/90 p-4 text-sm text-[#5f4924]">
          <p>
            <strong>Otomatik Referans:</strong> {nextReferenceSuggestion || '-'}
          </p>
          <div className="mt-2 grid gap-1 text-xs text-brand-700 md:grid-cols-2">
            <p>
              Sonraki Ürün No: <strong>{numberingPreview?.product_number_next || '-'}</strong>
            </p>
            <p>
              Sonraki Referans No: <strong>{numberingPreview?.reference_number_next || '-'}</strong>
            </p>
            <p>
              Sonraki Afregnings No: <strong>{numberingPreview?.afregnings_number_next || '-'}</strong>
            </p>
            <p>
              Sonraki Fatura No (sıra): <strong>{numberingPreview?.invoice_number_next || '-'}</strong>
            </p>
          </div>
          <p className="mt-1 text-xs text-brand-700">
            Sistem normalde son referanstan devam eder. İsterseniz üstteki alanı manuel düzenleyebilirsiniz.
          </p>
          <div className="mt-2">
            <Button variant="ghost" onClick={onRefreshNextReferenceSuggestion} disabled={!canEditSession || busy}>
              Otomatik Referansı Uygula
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-semibold text-amber-900">Son Kontrol (Zorunlu)</p>
        <p className="mt-1 text-xs text-amber-900">
          Tutar, referans ve müşteri detayını müşteriyle birlikte son kez doğruladıktan sonra işaretleyin.
        </p>
        <label className="mt-2 flex items-start gap-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={finalApprovalChecked}
            onChange={(event) => setFinalApprovalChecked(event.target.checked)}
            disabled={!canEditSession}
          />
          <span>
            Son kontrolü yaptım ve işlemi onaylıyorum. (Toplam: {formatDkk(confirmTargetAmount)} DKK)
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onConfirmSession} disabled={!canConfirmSession || busy}>
          {session?.trade_side === 'sell_to_customer'
            ? saleMode === 'inventory'
              ? 'Satışı Onayla ve Stoktan Düş'
              : 'Manuel Satışı Onayla'
            : 'İşlemi Onayla ve Ürüne Dönüştür'}
        </Button>
        <Button variant="danger" onClick={onCancelSession} disabled={!canEditSession || busy}>
          Oturumu İptal Et
        </Button>
      </div>
      {confirmBlockers.length > 0 && canEditSession && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Onay için tamamlanması gerekenler:</p>
          <ul className="mt-1 list-disc pl-5">
            {confirmBlockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
