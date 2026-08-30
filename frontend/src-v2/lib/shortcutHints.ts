// Alış modülü klavye kısayolları — tek kaynak. make/root/Root.tsx üst bar'ındaki
// "KB" rozetinin title'ı buradan okur; Modern shell'de ayrı bir ipucu yüzeyi yok.
// Handler'lar useAlisMakeState içinde window-level bağlanır (her iki varyantta çalışır).
export const ALIS_SHORTCUT_HINT = 'Ctrl+N: Yeni Alış | Ctrl+S: Kaydet';
