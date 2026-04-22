'use client';

import { useRouter } from 'next/navigation';

import { GDPRCountdown } from '@/components/GDPRCountdown';
import { Button } from '@/components/ui/button';
import { labelMetalType, labelProductStatus, labelProductType } from '@/lib/labels';
import { getManualReviewReasons, isCoinSourceProduct, isManualReviewRequired } from '@/lib/productFlags';
import { Product, ProductStatus } from '@/types';

type Props = {
  items: Product[];
  onStatusChange: (id: string, status: ProductStatus) => Promise<void>;
  returnTo?: string;
};

function getPrimaryPhoto(item: Product): { url: string; count: number } | null {
  const photos = Array.isArray(item.photos) ? item.photos : [];
  const valid = photos.filter((photo) => typeof photo?.url === 'string' && photo.url.trim().length > 0);
  if (!valid.length) {
    return null;
  }
  const primary = valid.find((photo) => photo.is_primary) ?? valid[0];
  return { url: primary.url, count: valid.length };
}

export function ProductTable({ items, onStatusChange, returnTo }: Props) {
  const router = useRouter();

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-brand-50 text-brand-700">
            <tr>
              <th className="px-4 py-3 text-left">No</th>
              <th className="px-4 py-3 text-left">Foto</th>
              <th className="px-4 py-3 text-left">Tip</th>
              <th className="px-4 py-3 text-left">Metal</th>
              <th className="px-4 py-3 text-left">Ağırlık</th>
              <th className="px-4 py-3 text-left">Durum</th>
              <th className="px-4 py-3 text-left">14 Gün Kilit</th>
              <th className="px-4 py-3 text-left">Değer (DKK)</th>
              <th className="px-4 py-3 text-left">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const preview = getPrimaryPhoto(item);
              const manualReview = isManualReviewRequired(item);
              const manualReasons = getManualReviewReasons(item);
              const displayType = isCoinSourceProduct(item)
                ? `${labelProductType(item.product_type)} (Coin)`
                : labelProductType(item.product_type);
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-t border-brand-100 transition-colors hover:bg-brand-50/70"
                  onClick={() => {
                    const target = returnTo
                      ? `/admin/products/${item.id}?return_to=${encodeURIComponent(returnTo)}`
                      : `/admin/products/${item.id}`;
                    router.push(target);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      const target = returnTo
                        ? `/admin/products/${item.id}?return_to=${encodeURIComponent(returnTo)}`
                        : `/admin/products/${item.id}`;
                      router.push(target);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Ürün ${item.product_number} detayına git`}
                >
                  <td className="px-4 py-3 font-semibold text-brand-900">
                    <p>{item.product_number}</p>
                    <p className="text-xs font-normal text-brand-600">{preview ? `${preview.count} foto` : 'Foto yok'}</p>
                    {manualReview && (
                      <p className="mt-1 inline-flex rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        Manuel İnceleme
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {preview ? (
                      <img
                        src={preview.url}
                        alt={`Ürün ${item.product_number} fotoğrafı`}
                        className="h-12 w-12 rounded-lg border border-brand-200 object-cover shadow-sm"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-brand-300 bg-brand-50 text-xs text-brand-600">
                        Yok
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p>{displayType}</p>
                    {manualReasons.length > 0 && (
                      <p className="mt-1 text-[11px] text-amber-700">{manualReasons.join(', ')}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">{labelMetalType(item.metal_type)}</td>
                  <td className="px-4 py-3">{item.weight_grams} g</td>
                  <td className="px-4 py-3">{labelProductStatus(item.status)}</td>
                  <td className="px-4 py-3">
                    <GDPRCountdown releaseDate={item.gdpr_release_date} isLocked={item.is_gdpr_locked} />
                  </td>
                  <td className="px-4 py-3">{item.purchase_price_dkk}</td>
                  <td
                    className="px-4 py-3"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => onStatusChange(item.id, 'for_sale')}
                        disabled={item.is_gdpr_locked || item.status === 'sold' || item.status === 'melted'}
                      >
                        Satışa Çıkar
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => onStatusChange(item.id, 'melted')}
                        disabled={item.is_gdpr_locked || item.status === 'sold' || item.status === 'melted'}
                      >
                        Erit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => onStatusChange(item.id, 'undecided')}
                        disabled={item.status === 'sold' || item.status === 'melted'}
                      >
                        Kararsız
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!items.length && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-brand-600">
                  Ürün bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
