// R10-4 — Alış çalışma alanında extra satır sırası (22K-2 = '22b' anahtarı).
//
// Operatör talebi: yeni eklenen extra satır (22K-2, kniv, çeyrek) grubun en
// sonuna değil, aynı karat rütbesindeki taban satırın YANINA düşer — 22K-2 her
// zaman 22K'nın hemen altında durur. Bu modül o rütbe sıralamasının tek
// kaynağıdır; modern workbench (modern/modules/alis.tsx) kullanır.

/**
 * Karat rütbesi: '22b' → 22 ('b' eki operatörün ikinci 22K alış seviyesidir),
 * '21.6' → 21.6. Sayı çözülemeyen karatlar ('—' vb.) daima en sona düşer.
 */
export function karatRank(karat: string | undefined | null): number {
  const numeric = Number(String(karat ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : Number.POSITIVE_INFINITY;
}

/**
 * Kararlı karat sıralaması: rütbesi eşit satırlarda GİRİŞ SIRASI korunur
 * (ES2019 Array.sort garantisi) — taban satır önce basılır, extra satır onun
 * hemen ardından gelir. 8K…24K taban dizisi kendi iç sırasını korur.
 */
export function sortByKaratRank<T extends { karat?: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => karatRank(a.karat) - karatRank(b.karat));
}
