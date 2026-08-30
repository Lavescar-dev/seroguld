import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, Search, X } from 'lucide-react';

import { apiRequest } from '@/lib/api';
import type { CustomerOut, PosSavedPurchaseListItem } from '@/types';

// R2-17 — tarihsel (içe aktarılmış) belgeyi doğru müşteriye ELLE bağlama.
// Otomatik eşleşme (CPR → e-posta → ad+telefon) duplike/yanlış müşteriye
// düştüğünde müşteri kartı 0 gösteriyordu; operatör buradan düzeltir.
export function RelinkCustomerModal({
  document: targetDocument,
  onClose,
}: {
  document: PosSavedPurchaseListItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchQuery = useQuery({
    queryKey: ['customers', 'relink-search', term],
    enabled: term.trim().length >= 2,
    queryFn: () => apiRequest<CustomerOut[]>(`/api/customers/search?q=${encodeURIComponent(term.trim())}`),
  });

  async function link(customerId: string) {
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/v2/alis/documents/${targetDocument.sequence_no}/link-customer`, {
        method: 'POST',
        body: JSON.stringify({ customer_id: customerId }),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pos', 'alis'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer'] }),
      ]);
      onClose();
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'Bağlama tamamlanamadı.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-slate-950/45 px-4" role="dialog" aria-modal="true" aria-label="Belgeyi müşteriye bağla">
      <div className="w-full max-w-md border border-brand-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-brand-200 bg-brand-50 px-4 py-3">
          <p className="text-xs font-black uppercase tracking-widest text-brand-700">
            AFG {targetDocument.document_number || targetDocument.sequence_no} → müşteriye bağla
          </p>
          <button type="button" onClick={onClose} aria-label="Kapat" className="text-brand-500 hover:text-brand-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p className="text-xs text-brand-600">
            Belgedeki müşteri: <strong>{targetDocument.customer_name || '—'}</strong>. Doğru müşteriyi arayıp seçin;
            belge ve toplamları o müşterinin kartına taşınır.
          </p>
          <div className="flex items-center gap-2 border border-brand-300 px-2 py-1.5">
            <Search className="h-4 w-4 text-brand-400" />
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Ad, telefon veya CPR ile ara…"
              className="w-full text-sm outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-64 divide-y divide-brand-100 overflow-y-auto border border-brand-200">
            {term.trim().length < 2 ? (
              <p className="px-3 py-4 text-xs text-brand-400">Aramak için en az 2 karakter yazın.</p>
            ) : searchQuery.isLoading ? (
              <p className="flex items-center gap-2 px-3 py-4 text-xs text-brand-500"><Loader2 className="h-3 w-3 animate-spin" /> Aranıyor…</p>
            ) : (searchQuery.data || []).length === 0 ? (
              <p className="px-3 py-4 text-xs text-brand-400">Eşleşen müşteri yok.</p>
            ) : (
              (searchQuery.data || []).map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  disabled={pending}
                  onClick={() => void link(customer.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50 disabled:opacity-50"
                >
                  <span>
                    <span className="font-semibold text-brand-900">{customer.name}</span>
                    <span className="ml-2 text-xs text-brand-500">{customer.phone || customer.email || ''}</span>
                  </span>
                  <Link2 className="h-4 w-4 text-emerald-600" />
                </button>
              ))
            )}
          </div>
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
