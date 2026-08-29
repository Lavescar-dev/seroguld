// Roadmap madde 1 — müşteri panelinin MUTUALLY_EXCLUSIVE görünümleri.
// Tek doğruluk kaynağı: AlisPage sağ paneli bu helper üzerinden dallanır,
// böylece "kart + form + OCR üst üste" çakışması render seviyesinde imkânsızdır.
export type CustomerPanelMode = 'existing' | 'new' | null;

export type CustomerPanelView = 'attached' | 'pick-action' | 'search-existing' | 'create-new';

export function resolveCustomerPanelView(customerMode: CustomerPanelMode, hasSelectedCustomer: boolean): CustomerPanelView {
  // ATTACHED her zaman kazanır: müşteri bağlıyken mod state'i takılı kalsa bile
  // form/arama/OCR ASLA render edilmez (kart + "Müşteriyi Değiştir" yeter).
  if (hasSelectedCustomer) return 'attached';
  if (customerMode === 'existing') return 'search-existing';
  if (customerMode === 'new') return 'create-new';
  // IDLE_SELECT: arama kutusu + "Yeni Müşteri Oluştur" aksiyon kartı.
  return 'pick-action';
}
