// Roadmap madde 1 — müşteri panelinin MUTUALLY_EXCLUSIVE görünümleri.
// Tek doğruluk kaynağı: AlisPage sağ paneli bu helper üzerinden dallanır,
// böylece "kart + form + OCR üst üste" çakışması render seviyesinde imkânsızdır.
export type CustomerPanelMode = 'existing' | 'new' | null;

export type CustomerPanelView = 'attached' | 'pick-action' | 'search-existing' | 'create-new';

export function resolveCustomerPanelView(
  customerMode: CustomerPanelMode,
  hasSelectedCustomer: boolean,
  replacingCustomer = false,
): CustomerPanelView {
  // ATTACHED kazanır: müşteri bağlıyken mod state'i takılı kalsa bile form/arama
  // ASLA render edilmez (kart + "Başka müşteri seç" yeter). Tek istisna: operatör
  // "Başka müşteri seç" ile aramayı bilinçli olarak yeniden açtığında.
  if (hasSelectedCustomer && !replacingCustomer) return 'attached';
  if (customerMode === 'existing') return 'search-existing';
  if (customerMode === 'new') return 'create-new';
  // IDLE_SELECT: arama kutusu + "Yeni Müşteri Oluştur" aksiyon kartı.
  return 'pick-action';
}
