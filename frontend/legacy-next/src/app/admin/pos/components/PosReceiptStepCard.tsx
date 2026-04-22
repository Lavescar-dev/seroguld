'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { formatKaratFinhed, toLodighed } from '@/lib/pos-mappers';
import { labelMetalType, labelProductType } from '@/lib/labels';
import type { PosSession, PosTransaction } from '@/types';

type PosReceiptStepCardProps = {
  visible: boolean;
  session: PosSession | null;
  busy: boolean;
  receiptApiUrl: string;
  confirmedProductIds: string[];
  confirmedProductNumbers: string[];
  loadingPosTransaction: boolean;
  posTransaction: PosTransaction | null;
  onOpenReceiptHtml: (copyType: 'customer' | 'admin') => void;
  onDownloadReceiptPdf: (copyType: 'customer' | 'admin') => void;
};

export function PosReceiptStepCard({
  visible,
  session,
  busy,
  receiptApiUrl,
  confirmedProductIds,
  confirmedProductNumbers,
  loadingPosTransaction,
  posTransaction,
  onOpenReceiptHtml,
  onDownloadReceiptPdf,
}: PosReceiptStepCardProps) {
  if (!visible || !session) {
    return null;
  }

  return (
    <div className="card rounded-3xl border-[#ddccab] bg-[linear-gradient(180deg,#fffdf9_0%,#f7efdf_100%)] p-5 shadow-[0_14px_34px_rgba(92,62,24,0.08)]">
      <h3 className="text-lg font-semibold text-[#3d2b10] md:text-xl">6) Fatura / Makbuz ve Ciktilar</h3>
      <p className="mt-1 text-sm text-[#6d5531]">
        Onaylanan işlem için müşteri ve yönetim kopyalarını HTML önizleme veya PDF olarak alabilirsiniz.
      </p>
      <div className="mt-4 grid gap-3 xl:grid-cols-12">
        <div className="rounded-2xl border border-[#d7c193] bg-[linear-gradient(135deg,#352615_0%,#21170f_100%)] px-4 py-4 text-[#f7ecd2] xl:col-span-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#d9bd81]">Onay Durumu</p>
          <p className="mt-2 text-2xl font-semibold text-[#f4d99b]">Belge Hazir</p>
          <p className="mt-2 text-sm text-[#e6d5b0]">Oturum: {session.session_code}</p>
        </div>
        <div className="rounded-2xl border border-[#e5d6bb] bg-white/90 px-4 py-4 xl:col-span-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#a28045]">Musteri Kopyasi</p>
          <p className="mt-1 text-sm font-semibold text-[#3d2b10]">Hassas veri gizli</p>
          <p className="mt-1 text-sm text-[#6d5531]">CPR, kimlik numarasi, internal margin ve admin notlari belgeye yazdirilmaz.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => onOpenReceiptHtml('customer')} disabled={busy}>
              HTML Önizleme
            </Button>
            <Button onClick={() => onDownloadReceiptPdf('customer')} disabled={busy}>
              PDF İndir
            </Button>
          </div>
        </div>
        <div className="rounded-2xl border border-[#e5d6bb] bg-white/90 px-4 py-4 xl:col-span-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#a28045]">Yonetim Kopyasi</p>
          <p className="mt-1 text-sm font-semibold text-[#3d2b10]">Tam operasyon detayi</p>
          <p className="mt-1 text-sm text-[#6d5531]">Tam belge, transaction satirlari, satin alma/satis izlemesi ve operasyonel alanlar gorunur.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => onOpenReceiptHtml('admin')} disabled={busy}>
              HTML Önizleme
            </Button>
            <Button onClick={() => onDownloadReceiptPdf('admin')} disabled={busy}>
              PDF İndir
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-brand-600">
        Teknik URL: <code>{receiptApiUrl}</code>
      </p>

      {confirmedProductIds.length > 0 && (
        <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-brand-900">Onayda Olusan Urunler</p>
          <p className="mt-1 text-xs text-brand-700">
            Bu POS oturumunda oluşturulan/işlenen ürünler:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {confirmedProductIds.map((productId, index) => (
              <Link
                key={productId}
                href={`/admin/products/${productId}`}
                target="_blank"
                className="inline-flex items-center rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-xs text-brand-800 hover:bg-brand-100"
              >
                Ürün #{confirmedProductNumbers[index] || `#${index + 1}`}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-brand-200 bg-white/90 p-4">
        <p className="text-sm font-semibold text-brand-900">Islem Ozeti (Transaction)</p>
        {loadingPosTransaction ? (
          <p className="mt-2 text-sm text-brand-700">İşlem özeti yükleniyor...</p>
        ) : !posTransaction ? (
          <p className="mt-2 text-sm text-brand-700">Bu oturum için işlem özeti bulunamadı.</p>
        ) : (
          <div className="mt-2 space-y-3">
            <div className="grid gap-1 text-xs text-brand-700 md:grid-cols-3">
              <p>
                İşlem ID: <strong>{posTransaction.id.slice(0, 8)}...</strong>
              </p>
              <p>
                Belge Sırası: <strong>{posTransaction.pos_document_sequence_no ?? '-'}</strong>
              </p>
              <p>
                Döviz: <strong>{posTransaction.currency_code}</strong>
              </p>
              <p>
                Brüt: <strong>{posTransaction.gross_amount_dkk}</strong>
              </p>
              <p>
                Net: <strong>{posTransaction.net_amount_dkk}</strong>
              </p>
              <p>
                KDV: <strong>{posTransaction.vat_amount_dkk}</strong>
              </p>
              <p>
                Kalem Sayisi: <strong>{posTransaction.lines.length}</strong>
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-brand-50">
                    <th className="border border-brand-200 px-2 py-1 text-left">#</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Ürün</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Type</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Karat / % Finhed</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Lødighed</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Vægt i g</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Enhedspris / g</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">Avance</th>
                    <th className="border border-brand-200 px-2 py-1 text-left">I alt</th>
                  </tr>
                </thead>
                <tbody>
                  {posTransaction.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="border border-brand-200 px-2 py-1">{line.line_no}</td>
                      <td className="border border-brand-200 px-2 py-1">
                        #{line.product_number || '-'} / Ref: {line.reference_number || '-'}
                      </td>
                      <td className="border border-brand-200 px-2 py-1">
                        {labelProductType((line.product_type as Parameters<typeof labelProductType>[0]) || null)} ·{' '}
                        {labelMetalType((line.metal_type as Parameters<typeof labelMetalType>[0]) || null)}
                      </td>
                      <td className="border border-brand-200 px-2 py-1">
                        {formatKaratFinhed(line.purity_karat, line.purity_percentage)}
                      </td>
                      <td className="border border-brand-200 px-2 py-1">{toLodighed(line.purity_karat, line.purity_percentage)}</td>
                      <td className="border border-brand-200 px-2 py-1">{line.weight_grams || '-'} g</td>
                      <td className="border border-brand-200 px-2 py-1">{line.rate_dkk || '-'} DKK/g</td>
                      <td className="border border-brand-200 px-2 py-1">{line.margin_percent}%</td>
                      <td className="border border-brand-200 px-2 py-1 font-semibold">{line.line_total_dkk} DKK</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
