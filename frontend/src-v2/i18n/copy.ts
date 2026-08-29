import { LEGACY_COPY, type LegacyCopyLocale } from './legacyCopy.generated';

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

const OVERRIDES: Record<LegacyCopyLocale, Record<string, string>> = {
  tr: {
    Operations: 'Operasyon', Overview: 'Genel Bakış', 'Purchase / AFG': 'Alış / AFG', Customers: 'Müşteriler', Inventory: 'Depolama', Settings: 'Ayarlar',
    'Documents and integrations': 'Belge ve entegrasyonlar', 'Compliance and system': 'Uyum ve sistem', Kundedatabase: 'Müşteri veritabanı',
    'AFG workspace': 'AFG çalışma alanı', 'Lager / ürün': 'Depo / ürün', 'Lager / Ürün': 'Depo / ürün', 'Privacy merkezi': 'Gizlilik merkezi',
    'Export ve sağlık': 'Dışa aktarma ve sağlık', 'Web operasyonları': 'Web işlemleri', 'İkinci pencere': 'İkinci ekran',
    'Platform ve görünüm': 'Platform ve görünüm', English: 'English', Dansk: 'Dansk', Türkçe: 'Türkçe', 'AFG → melt': 'AFG → eritme',
  },
  en: {
    'Genel Bakış': 'Overview', 'Operasyon Merkezi': 'Operations Center', 'Yeni alış çalışma alanı': 'New purchase workspace',
    'Alış çalışma alanı': 'Purchase workspace', 'Alış / POS / AFG': 'Purchase / POS / AFG',
    'Bugünün kontrolü tek çalışma alanında': "Today's operations in one workspace",
    'Bugünün kayıtları, bekleyen işler ve entegrasyon sağlığı tek operasyon bağlamında.': "Today's records, pending tasks, and integration health in one operational view.",
    'Müşteri, metal satırları, teklif, AFG ve teslim zinciri aynı gerçek workspace üzerinde.': 'Customer, metal lines, offer, AFG, and delivery are managed in one workspace.',
    'AFG alışını, müşteri bağlamını ve belge geçmişini tek operasyon yüzeyinde yönetin.': 'Manage the AFG purchase, customer context, and document history in one workspace.',
    'Yeni AFG alışını başlatın': 'Start a new AFG purchase', 'Operasyon başlangıcı': 'Start operation', 'Tarihsel AFG içe aktar': 'Import historical AFG',
    'Yeni alış': 'New purchase', Geçmiş: 'History', Yüzey: 'Interface', Sistem: 'System', Taslak: 'Draft', Müşteri: 'Customer',
    'Açık taslak': 'Open draft', 'Taslağa devam': 'Continue draft', Kundedatabase: 'Customer database', 'Lager / ürün': 'Inventory / product',
    'AFG → melt': 'AFG → melting', 'Privacy merkezi': 'Privacy center', 'Export ve sağlık': 'Exports and health',
    'İkinci pencere': 'Second display', 'Platform ve görünüm': 'Platform and appearance', English: 'English', Dansk: 'Dansk', Türkçe: 'Türkçe',
    'Müşteri notları': 'Customer notes', 'Notlar yükleniyor…': 'Loading notes…', 'Not geçmişi': 'Note history', 'Notu düzenle': 'Edit note', 'Notu sil': 'Delete note',
    'Hesap özeti': 'Account summary', 'Müşteri dosyası yükleniyor…': 'Loading customer file…', 'Risk uyarıları ·': 'Risk alerts ·', 'Tarihsel içe aktarma': 'Historical import',
    'Eski sistem taşıma merkezi': 'Legacy migration center', 'Veri taşıma merkezi': 'Data migration center', 'Eski Excel sistemini taşı': 'Migrate the old Excel system',
    'Dosyaları seç': 'Choose files', 'Yeni taşıma çalışması': 'New migration run', 'Ayar kategorileri': 'Settings categories', 'Ayar kategorisi seç': 'Choose a settings category',
    'Entegrasyon seçimi': 'Integration selection', 'Ayar yedeği': 'Settings backup', 'Gizli değerler korunur': 'Secrets are protected',
    'Güvenli çalışma alanı': 'Secure workspace', 'Korunaklı operasyon oturumu': 'Protected operations session', 'Tek operasyon hesabı': 'One operations account',
    'Güvenli giriş': 'Secure sign-in', 'Oturum aç': 'Sign in', 'Müşteri listesi': 'Customer list', 'Müşteriyi aç': 'Open customer',
    'Firma bilgileri': 'Company information', 'Tanı bilgilerini aç': 'Open diagnostics', 'Tanı kaydı oluşturuldu.': 'Diagnostic record created.',
    'Alt kategori': 'Subcategory', 'Toplam gram': 'Total grams', 'Woo durumu': 'Woo status', 'Uzunluk': 'Length', 'Shop Fark': 'Shop difference',
    'Güvenli bağlantı': 'Secure connection', 'AI Risk Skoru': 'AI risk score', 'OPMC Risk Skoru': 'OPMC risk score', 'Beyaz Liste Eylemi': 'Whitelist action',
    'Eski sistemi taşı': 'Migrate legacy system', 'Veri Yonetimi': 'Data management', 'Kullanici Adi': 'Username', 'Sifre': 'Password',
    'Bağlantı başarılı — Uniconta&apos;ya erişildi': 'Connection successful — Uniconta is reachable', 'URL Slug': 'URL slug', 'Hesap no.': 'Account no.', 'EUR / DKK kuru': 'EUR / DKK rate',
    'Önce Danca SEO paketini üretin, düzenleyip onaylayın. Ardından statik fiyatla WooCommerce&apos;e yayınlayın.': 'First generate, edit and approve the Danish SEO package, then publish to WooCommerce with a static price.',
  },
  da: {
    'Genel Bakış': 'Oversigt', 'Operasyon Merkezi': 'Driftscenter', 'Yeni alış çalışma alanı': 'Nyt indkøbsområde',
    'Alış çalışma alanı': 'Indkøbsområde', 'Alış / POS / AFG': 'Indkøb / POS / AFG', 'Bugünün kontrolü tek çalışma alanında': 'Dagens drift samlet ét sted',
    'Bugünün kayıtları, bekleyen işler ve entegrasyon sağlığı tek operasyon bağlamında.': 'Dagens registreringer, ventende opgaver og integrationsstatus samlet i ét driftsbillede.',
    'Müşteri, metal satırları, teklif, AFG ve teslim zinciri aynı gerçek workspace üzerinde.': 'Kunde, metallinjer, tilbud, AFG og levering håndteres i samme arbejdsområde.',
    'AFG alışını, müşteri bağlamını ve belge geçmişini tek operasyon yüzeyinde yönetin.': 'Administrer AFG-indkøb, kundeoplysninger og bilagshistorik i samme arbejdsområde.',
    'Yeni AFG alışını başlatın': 'Start et nyt AFG-indkøb', 'Operasyon başlangıcı': 'Start handling', 'Tarihsel AFG içe aktar': 'Importér historiske AFG-bilag',
    'Yeni alış': 'Nyt indkøb', Geçmiş: 'Historik', Yüzey: 'Grænseflade', Sistem: 'System', Taslak: 'Kladde', Müşteri: 'Kunde',
    'Açık taslak': 'Åben kladde', 'Taslağa devam': 'Fortsæt kladde', Kundedatabase: 'Kundedatabase', 'Lager / ürün': 'Lager / produkt',
    'AFG → melt': 'AFG → smeltning', 'Privacy merkezi': 'Privatlivscenter', 'Export ve sağlık': 'Eksport og systemstatus',
    'İkinci pencere': 'Anden skærm', 'Platform ve görünüm': 'Platform og udseende', English: 'English', Dansk: 'Dansk', Türkçe: 'Türkçe',
    'Müşteri notları': 'Kundenoter', 'Notlar yükleniyor…': 'Indlæser noter…', 'Not geçmişi': 'Notehistorik', 'Notu düzenle': 'Rediger note', 'Notu sil': 'Slet note',
    'Hesap özeti': 'Kontooversigt', 'Müşteri dosyası yükleniyor…': 'Indlæser kundesag…', 'Risk uyarıları ·': 'Risikovarsler ·', 'Tarihsel içe aktarma': 'Historisk import',
    'Eski sistem taşıma merkezi': 'Center for migrering af gammelt system', 'Veri taşıma merkezi': 'Datamigreringscenter', 'Eski Excel sistemini taşı': 'Migrér det gamle Excel-system',
    'Dosyaları seç': 'Vælg filer', 'Yeni taşıma çalışması': 'Ny migrering', 'Ayar kategorileri': 'Indstillingskategorier', 'Ayar kategorisi seç': 'Vælg en indstillingskategori',
    'Entegrasyon seçimi': 'Integrationsvalg', 'Ayar yedeği': 'Indstillingsbackup', 'Gizli değerler korunur': 'Hemmeligheder er beskyttet',
    'Güvenli çalışma alanı': 'Sikkert arbejdsområde', 'Korunaklı operasyon oturumu': 'Beskyttet driftssession', 'Tek operasyon hesabı': 'Én driftskonto',
    'Güvenli giriş': 'Sikkert login', 'Oturum aç': 'Log ind', 'Müşteri listesi': 'Kundeliste', 'Müşteriyi aç': 'Åbn kunde',
    'Firma bilgileri': 'Firmaoplysninger', 'Tanı bilgilerini aç': 'Åbn diagnosticering', 'Tanı kaydı oluşturuldu.': 'Diagnoseregistrering oprettet.',
    'Alt kategori': 'Underkategori', 'Toplam gram': 'Gram i alt', 'Woo durumu': 'Woo-status', 'Uzunluk': 'Længde', 'Shop Fark': 'Shopforskel',
    'AI Risk Skoru': 'AI-risikoscore', 'OPMC Risk Skoru': 'OPMC-risikoscore', 'Beyaz Liste Eylemi': 'Whitelist-handling',
    'Eski sistemi taşı': 'Migrér gammelt system', 'Veri Yonetimi': 'Datastyring', 'Kullanici Adi': 'Brugernavn', 'Sifre': 'Adgangskode',
    'Bağlantı başarılı — Uniconta&apos;ya erişildi': 'Forbindelse oprettet — Uniconta er tilgængelig', 'URL Slug': 'URL-slug', 'Hesap no.': 'Kontonr.', 'EUR / DKK kuru': 'EUR / DKK-kurs',
    'Önce Danca SEO paketini üretin, düzenleyip onaylayın. Ardından statik fiyatla WooCommerce&apos;e yayınlayın.': 'Generér, redigér og godkend den danske SEO-pakke først, og udgiv derefter til WooCommerce med en statisk pris.',
    // X1 dil sızıntısı sweep (Tur 2): Danca arayüzde Türkçe kalan metinler.
    // OVERRIDES generated katalogdan ÖNCE geldiği için buradaki girdiler
    // katalogdaki bozuk (Türkçe kalmış) da değerlerini de ezer.
    'Excel görünümü': 'Excel-visning',
    'Kimlik fotoğrafı / tarama (OCR)': 'ID-foto / scanning (OCR)',
    'Kimlik fotoğrafını yükleyin veya tarayıcıdan okutun — alanlar otomatik dolar.': 'Upload ID-billedet, eller scan det på scanneren — felterne udfyldes automatisk.',
    'Tarama iptal edildi.': 'Scanningen blev annulleret.',
    'Bu müşteri için henüz manuel not yok.': 'Der er endnu ingen manuelle noter for denne kunde.',
    'Manuel müşteri notu ekle…': 'Tilføj manuel kundenote…',
    'Not ekle': 'Tilføj note',
    'Kaydediliyor': 'Gemmer…',
    'Küçült': 'Minimér',
    'Müşteriden alış': 'Køb fra kunde',
    'Müşteriye satış': 'Salg til kunde',
    'Bıçak hesabı': 'Knivkonto',
    'Son işlem': 'Seneste transaktion',
    'Toplam ağırlık': 'Samlet vægt',
    'Yapım aşamasında': 'Under udvikling',
    "Tüm alanlar DKK/g. Yeni alışlar bu profili başlangıç snapshot'ı olarak kullanır.": 'Alle felter er i DKK/g. Nye indkøb bruger denne profil som start-snapshot.',
    'Yayın uyarısı': 'Udgivelsesadvarsel',
    // 0.3.23 — R1-21 / R1-10 / R1-16 / R1-17 / R1-18 yeni yüzey dizeleri
    'Nyhed-rozet (yeni ürün · 30 gün)': 'Nyhed-badge (nyt produkt · 30 dage)',
    'Önizleme': 'Forhåndsvisning',
    'Önizleme alınamadı.': 'Forhåndsvisning kunne ikke hentes.',
    'Yayın önizlemesi — sitede böyle görünecek': 'Udgivelsesforhåndsvisning — sådan ser det ud på sitet',
    'Kısa açıklama': 'Kort beskrivelse',
    'Uzun açıklama': 'Lang beskrivelse',
    'kategori yok': 'ingen kategori',
    'Düzenle': 'Redigér',
    'Düzenlemeyi kapat': 'Luk redigering',
    'Ürün adı': 'Produktnavn',
    'Kısa açıklama (HTML)': 'Kort beskrivelse (HTML)',
    'Açıklama (HTML)': 'Beskrivelse (HTML)',
    'Siteye kaydet': 'Gem til sitet',
    'Kaydediliyor…': 'Gemmer…',
    'Vazgeç': 'Annullér',
    'Katalog içeriği sitede güncellendi': 'Katalogindhold opdateret på sitet',
    'İçerik güncellenemedi': 'Indholdet kunne ikke opdateres',
    'Son çekim:': 'Seneste hentning:',
    'henüz çekilmedi': 'ikke hentet endnu',
    'Oto · canlı kur': 'Auto · live kurs',
    'WP "Priser" sayfası — tek karat/gümüş kaynağı': 'WP "Priser"-siden — eneste kilde til karat/sølv',
    // R1-17/R1-18 Ayarlar market bloğu — <strong> böldüğü için düğüm-düğüm girdiler
    'Otomatik oran alanları': 'Automatiske kursfelter',
    'Yalnız bu üç alan istenirse canlı kaynaktan (Stooq) otomatik çekilebilir; her biri': 'Kun disse tre felter kan hentes automatisk fra en live kilde (Stooq); hvert felt er',
    'bağımsızdır': 'uafhængigt',
    '(hepsi bir arada olmak zorunda değil). Altın ve gümüş karat oranları': '(de behøver ikke følges ad). Guld- og sølvkaratkurser hentes',
    'WP "Priser" sayfasından': 'fra WP "Priser"-siden',
    'çekilir veya üst çubuktaki oran editöründen elle girilir.': 'eller indtastes manuelt i kurseditoren i topbjælken.',
    'Manuelde bırakılan alan, oran editöründeki değerinde kalır.': 'Felter der står på manuel beholder værdien fra kurseditoren.',
    'Karat ve gümüş oranları seroguld.dk "Priser" sayfasından çekilir (üst çubuk → Au/Ag →': 'Karat- og sølvkurser hentes fra seroguld.dk "Priser"-siden (topbjælke → Au/Ag →',
    "WP'den çek": 'Hent fra WP',
    '). Elle ezilen değerler bir sonraki çekime kadar korunur.': '). Manuelt overskrevne værdier bevares indtil næste hentning.',
    'SEO başlığı': 'SEO-titel',
    'Meta açıklama': 'Metabeskrivelse',
    'Kapat ✕': 'Luk ✕',
    'Ürün Detayları': 'Produktdetaljer',
    'Müşteri seç': 'Vælg kunde',
    'Müşteri seçilmedi': 'Ingen kunde valgt',
    'Müşteri seçimi bekleniyor': 'Afventer kundevalg',
    'Kniv / Çeyrek altın': 'Kniv / Møntguld',
    'Çeyrek altın': 'Møntguld',
    'Satır ekle': 'Tilføj linje',
    'Sil': 'Slet',
    'Aktar': 'Overfør',
  },
};

const FRAGMENTS: Record<LegacyCopyLocale, Array<[string, string]>> = {
  tr: [['Toplam:', 'Toplam:'], ['Son güncelleme:', 'Son güncelleme:'], ['İlk:', 'İlk:'], ['Son:', 'Son:']],
  en: [['Toplam:', 'Total:'], ['Son güncelleme:', 'Last updated:'], ['İlk:', 'First:'], ['Son:', 'Last:'], [' kayıt', ' records']],
  da: [['Toplam:', 'I alt:'], ['Son güncelleme:', 'Senest opdateret:'], ['İlk:', 'Første:'], ['Son:', 'Seneste:'], [' kayıt', ' poster'], ['Sayfa ', 'Side ']],
};

const sourceByVariant = new Map<string, string>();
for (const source of Object.keys(LEGACY_COPY.tr)) sourceByVariant.set(normalize(source), source);
for (const source of Object.keys(LEGACY_COPY.tr)) {
  for (const locale of ['tr', 'en', 'da'] as const) {
    const localized = LEGACY_COPY[locale][source] ?? LEGACY_COPY.tr[source] ?? source;
    const variant = normalize(localized);
    if (variant && !sourceByVariant.has(variant)) sourceByVariant.set(variant, source);
  }
}

const cache = new Map<string, string>();
export function translateVisibleCopy(raw: string, locale: LegacyCopyLocale): string {
  const cacheKey = `${locale}\u0000${raw}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const compact = normalize(raw);
  if (!compact) return raw;
  const source = sourceByVariant.get(compact);
  const exact = OVERRIDES[locale][compact]
    || (source ? OVERRIDES[locale][source] || LEGACY_COPY[locale][source] || LEGACY_COPY.tr[source] || source : undefined);
  let result = exact ? raw.replace(compact, exact) : raw;
  if (!exact) for (const [from, to] of FRAGMENTS[locale]) result = result.replaceAll(from, to);
  cache.set(cacheKey, result);
  return result;
}
