import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import i18n from 'i18next';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { ensureCustomerDisplayWindow, getDesktopMonitorSetup } from '@/lib/desktop';
import { LocaleRuntimeContext } from './react/context';

export const SUPPORTED_LOCALES = ['tr', 'en', 'da'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const OPERATOR_LOCALE_KEY = 'seroguld.locale.operator.v1';
const DISPLAY_LOCALE_KEY = 'seroguld.locale.display.v1';

const resources = {
  tr: {
    translation: {
      language: { operator: 'Uygulama dili', customerDisplay: 'Müşteri ekranı dili', tr: 'Türkçe', en: 'English', da: 'Dansk' },
      common: { language: 'Dil', settings: 'Ayarlar', save: 'Kaydet', cancel: 'Vazgeç', loading: 'Yükleniyor', retry: 'Tekrar dene', unavailable: 'Kullanılamıyor', requestCode: 'İstek kodu' },
      navigation: { operations: 'Operasyon', documents: 'Belge ve Entegrasyon', compliance: 'Uyum ve Sistem', dashboard: 'Genel Bakış', purchase: 'Alış / AFG', customers: 'Müşteriler', inventory: 'Depolama', log: 'Log / AFG Defteri', settings: 'Ayarlar' },
      display: { document: 'AFREGNING · BELGE', number: 'NUMARA', date: 'TARİH', time: 'SAAT', customerInfo: 'MÜŞTERİ BİLGİLERİ', waitingCustomer: 'Müşteri seçimi bekleniyor', purchasePreparing: 'Alış hazırlanıyor', customerViewReady: 'Müşteri ekranı hazır', prices: 'Güncel altın ve gümüş fiyatları', waitingTransaction: 'İşlem bekleniyor', gold: 'Altın', silver: 'Gümüş', name: 'AD SOYAD', phone: 'TELEFON', email: 'E-POSTA', address: 'ADRES', identity: 'KİMLİK / PASAPORT' },
      error: { backendUnavailable: 'Yerel backend bağlantısı kurulamadı.', sessionExpired: 'Oturum süresi doldu.', unknown: 'Beklenmeyen bir hata oluştu.' },
      errors: { http: { bad_request: 'İstek geçersiz.', unauthorized: 'Kimlik doğrulama gerekli.', forbidden: 'Bu işlem için yetkiniz yok.', not_found: 'İstenen kayıt bulunamadı.', conflict: 'İşlem mevcut durumla çakışıyor.', validation: 'Girilen bilgiler doğrulanamadı.', rate_limited: 'Çok fazla istek gönderildi. Lütfen tekrar deneyin.', dependency: 'Bağlı servise şu anda ulaşılamıyor.', error: 'İşlem tamamlanamadı.' } },
      labels: { trade: { sell: 'Müşteriye satış', buy: 'Müşteriden alış' } },
      settings: { languageDescription: 'Operatör arayüzü ve müşteri ekranı için ayrı dil tercihleri bu cihazda saklanır.' },
      login: { workspace: 'Güvenli çalışma alanı', intro: 'Alış, stok, müşteri ve entegrasyon işlemlerine tek güvenilir oturumdan devam edin.', protected: 'Korunaklı operasyon oturumu', protectedDescription: 'ERP ayarları ve entegrasyon bağlantıları yalnız yetkili oturumdan yönetilir.', account: 'Tek operasyon hesabı', accountDescription: 'Giriş sonrasında aynı çalışma alanından günlük operasyonunuza dönersiniz.', secureLogin: 'Güvenli giriş', signIn: 'Oturum aç', signInTitle: 'Operasyon paneline giriş', signInDescription: 'Sero Guld çalışma alanına devam etmek için şifrenizi girin.', user: 'Hesap', password: 'Şifre', showPassword: 'Şifreyi göster', hidePassword: 'Şifreyi gizle', submitting: 'Giriş yapılıyor…', submit: 'Giriş Yap', secureNotice: 'Yetkili kullanıcı hesabı ile güvenli bağlantı kurulur.' },
      gdpr: { public: {
        shell: { subtitle: 'Sero Guld CRM gizlilik yüzeyleri. WordPress gizlilik ve çerez bağlantıları bu markalı sayfalara köprülenir.', links: 'Genel bağlantılar', privacyPolicy: 'Gizlilik Politikası', cookies: 'Çerezler', requestCenter: 'Talep Merkezi' },
        privacy: { eyebrow: 'Gizlilik', title: 'Kişisel Veri Politikası', dataController: 'Veri Sorumlusu', intro: 'Sero Guld CRM, müşteri talebi, işlem güvenliği, finansal kayıt zorunlulukları ve mağaza operasyonları için gerekli kişisel verileri işler. Danimarka hukukuna uygun olarak finansal ledger ve pos belgeleri hukuki zorunluluk süresince korunur; müşteri ana veri ve kimlik alanları gerekli süre sonunda pseudonymize edilir.', whatWeKeep: 'Hangi verileri tutuyoruz', keepMasterData: 'Müşteri ana verisi ve kimlik alanları; gerekli süre sonunda pseudonymize edilene kadar.', keepPosDocuments: 'POS belgeleri, alış makbuzları ve ledger kayıtları muhasebe ve uyum için.', keepRequestHistory: 'GDPR denetim izi için operasyonel talep geçmişi.', yourRights: 'Haklarınız', rightAccess: 'İşlenen kişisel verilerinize erişim talep edin.', rightRectification: 'Yasal olarak uygun olduğunda düzeltme veya kısıtlama talep edin.', rightPseudonymization: 'Yasal saklama süresi sonrasında pseudonymization talep edin.', processorsTitle: 'İşleyiciler ve barındırma', processorsBody: 'CRM, WordPress public sayfaları, WooCommerce ve office runtime\'lar iş akışına bağlı olarak sınırlı kişisel veri alt kümelerini işleyebilir. Yetkili talep işleme ve saklama politikası Sero Guld CRM\'dedir.' },
        cookies: { eyebrow: 'Çerezler', title: 'Çerez Bilgisi', intro: 'Public web yüzeyleri gerekli oturum, güvenlik ve isteğe bağlı analytics/marketing kategorilerine ayrılır. WordPress ve WooCommerce kaynaklı çerez davranışı bu sayfadan referans alınır.', required: 'Zorunlu', optional: 'İsteğe bağlı' },
        request: { eyebrow: 'Talep', title: 'Veri Talep Merkezi', intro: 'Erişim, export, restriction, rectification veya pseudonymize talebinizi buradan iletebilirsiniz. V1 akışında execution insan doğrulaması sonrası başlar; tracking token ile talep durumunu takip edebilirsiniz.', requestType: 'Talep tipi', name: 'Ad Soyad', email: 'E-posta', phone: 'Telefon', message: 'Açıklama', acceptedPrivacy: 'Kişisel veri ve gizlilik işleme metnini kabul ediyorum.', submit: 'Talep oluştur', submitting: 'Gönderiliyor', created: 'Talep oluşturuldu', reference: 'Referans', due: 'Termin', openTracking: 'Takip sayfasını aç', error: 'Talep oluşturulamadı.' },
        tracking: { eyebrow: 'Takip', title: 'Talep Durumu', noToken: 'Takip token bulunamadı.', loading: 'Talep durumu yükleniyor…', error: 'Durum okunamadı.', status: 'Durum', submitted: 'Gönderim', due: 'Termin', completed: 'Tamamlandı' },
      } },
    },
  },
  en: {
    translation: {
      language: { operator: 'Application language', customerDisplay: 'Customer display language', tr: 'Türkçe', en: 'English', da: 'Dansk' },
      common: { language: 'Language', settings: 'Settings', save: 'Save', cancel: 'Cancel', loading: 'Loading', retry: 'Try again', unavailable: 'Unavailable', requestCode: 'Request ID' },
      navigation: { operations: 'Operations', documents: 'Documents and integrations', compliance: 'Compliance and system', dashboard: 'Overview', purchase: 'Purchase / AFG', customers: 'Customers', inventory: 'Inventory', log: 'Log / AFG Ledger', settings: 'Settings' },
      display: { document: 'SETTLEMENT · DOCUMENT', number: 'NUMBER', date: 'DATE', time: 'TIME', customerInfo: 'CUSTOMER INFORMATION', waitingCustomer: 'Waiting for customer selection', purchasePreparing: 'Preparing purchase', customerViewReady: 'Customer display ready', prices: 'Current gold and silver prices', waitingTransaction: 'Waiting for transaction', gold: 'Gold', silver: 'Silver', name: 'FULL NAME', phone: 'PHONE', email: 'EMAIL', address: 'ADDRESS', identity: 'ID / PASSPORT' },
      error: { backendUnavailable: 'The local backend connection could not be established.', sessionExpired: 'Your session has expired.', unknown: 'An unexpected error occurred.' },
      errors: { http: { bad_request: 'The request is invalid.', unauthorized: 'Authentication is required.', forbidden: 'You do not have permission for this action.', not_found: 'The requested record was not found.', conflict: 'The action conflicts with the current state.', validation: 'The submitted information could not be validated.', rate_limited: 'Too many requests were sent. Please try again.', dependency: 'The connected service is currently unavailable.', error: 'The action could not be completed.' } },
      labels: { trade: { sell: 'Sale to customer', buy: 'Purchase from customer' } },
      settings: { languageDescription: 'Separate language preferences for the operator interface and customer display are stored on this device.' },
      login: { workspace: 'Secure workspace', intro: 'Continue purchase, inventory, customer, and integration work from one trusted session.', protected: 'Protected operations session', protectedDescription: 'ERP settings and integration connections are managed only from an authorized session.', account: 'One operations account', accountDescription: 'After signing in, you return to the same workspace for daily operations.', secureLogin: 'Secure sign in', signIn: 'Sign in', signInTitle: 'Sign in to the operations panel', signInDescription: 'Enter your password to continue to the Sero Guld workspace.', user: 'Account', password: 'Password', showPassword: 'Show password', hidePassword: 'Hide password', submitting: 'Signing in…', submit: 'Sign in', secureNotice: 'A secure connection is established with an authorized user account.' },
      gdpr: { public: {
        shell: { subtitle: 'Sero Guld CRM public privacy surfaces. WordPress privacy and cookie links bridge into these branded pages.', links: 'Public links', privacyPolicy: 'Privacy Policy', cookies: 'Cookies', requestCenter: 'Request Center' },
        privacy: { eyebrow: 'Privacy', title: 'Personal Data Policy', dataController: 'Data Controller', intro: 'Sero Guld CRM processes the personal data needed for customer requests, transaction security, financial record-keeping and store operations. In accordance with Danish law, the financial ledger and POS documents are kept for the statutory retention period; customer master data and identity fields are pseudonymized after that period.', whatWeKeep: 'What we keep', keepMasterData: 'Customer master data and identity fields until pseudonymization after the required period.', keepPosDocuments: 'POS documents, purchase receipts and ledger entries for accounting and compliance.', keepRequestHistory: 'Operational request history for the GDPR audit trail.', yourRights: 'Your rights', rightAccess: 'Request access to your processed personal data.', rightRectification: 'Request rectification or restriction where legally appropriate.', rightPseudonymization: 'Request pseudonymization after the legal retention window.', processorsTitle: 'Processors and hosting', processorsBody: 'CRM, WordPress public pages, WooCommerce and office runtimes may process limited subsets of personal data depending on the workflow. The authoritative request handling and retention policy lives in Sero Guld CRM.' },
        cookies: { eyebrow: 'Cookies', title: 'Cookie Information', intro: 'Public web surfaces are split into required session, security and optional analytics/marketing categories. Cookie behaviour from WordPress and WooCommerce is referenced from this page.', required: 'Required', optional: 'Optional' },
        request: { eyebrow: 'Request', title: 'Data Request Center', intro: 'Submit access, export, restriction, rectification or pseudonymization requests here. In the V1 flow execution starts after human verification; you can follow the request status with a tracking token.', requestType: 'Request type', name: 'Full name', email: 'E-mail', phone: 'Phone', message: 'Description', acceptedPrivacy: 'I accept the personal data and privacy processing notice.', submit: 'Create request', submitting: 'Submitting', created: 'Request created', reference: 'Reference', due: 'Due', openTracking: 'Open tracking page', error: 'Could not create the request.' },
        tracking: { eyebrow: 'Tracking', title: 'Request Status', noToken: 'No tracking token found.', loading: 'Loading request status…', error: 'Could not read the status.', status: 'Status', submitted: 'Submitted', due: 'Due', completed: 'Completed' },
      } },
    },
  },
  da: {
    translation: {
      language: { operator: 'Programspråg', customerDisplay: 'Sprog på kundeskærm', tr: 'Türkçe', en: 'English', da: 'Dansk' },
      common: { language: 'Sprog', settings: 'Indstillinger', save: 'Gem', cancel: 'Annuller', loading: 'Indlæser', retry: 'Prøv igen', unavailable: 'Ikke tilgængelig', requestCode: 'Anmodnings-id' },
      navigation: { operations: 'Drift', documents: 'Bilag og integrationer', compliance: 'Overholdelse og system', dashboard: 'Oversigt', purchase: 'Indkøb / AFG', customers: 'Kunder', inventory: 'Lager', log: 'Log / AFG-bog', settings: 'Indstillinger' },
      display: { document: 'AFREGNING · BILAG', number: 'NUMMER', date: 'DATO', time: 'TID', customerInfo: 'KUNDEOPLYSNINGER', waitingCustomer: 'Afventer kundevalg', purchasePreparing: 'Indkøb klargøres', customerViewReady: 'Kundevisning er klar', prices: 'Aktuelle guld- og sølvpriser', waitingTransaction: 'Afventer transaktion', gold: 'Guld', silver: 'Sølv', name: 'NAVN', phone: 'TELEFON', email: 'E-MAIL', address: 'ADRESSE', identity: 'KØREKORT / PAS' },
      error: { backendUnavailable: 'Forbindelsen til den lokale backend kunne ikke oprettes.', sessionExpired: 'Din session er udløbet.', unknown: 'Der opstod en uventet fejl.' },
      errors: { http: { bad_request: 'Anmodningen er ugyldig.', unauthorized: 'Godkendelse er påkrævet.', forbidden: 'Du har ikke tilladelse til denne handling.', not_found: 'Den ønskede post blev ikke fundet.', conflict: 'Handlingen er i konflikt med den aktuelle status.', validation: 'De indtastede oplysninger kunne ikke valideres.', rate_limited: 'Der blev sendt for mange anmodninger. Prøv igen.', dependency: 'Der kan ikke oprettes forbindelse til den tilknyttede tjeneste.', error: 'Handlingen kunne ikke gennemføres.' } },
      labels: { trade: { sell: 'Salg til kunde', buy: 'Køb fra kunde' } },
      settings: { languageDescription: 'Separate sprogindstillinger for operatørfladen og kundeskærmen gemmes på denne enhed.' },
      login: { workspace: 'Sikker arbejdsflade', intro: 'Fortsæt med indkøb, lager, kunder og integrationer fra én sikker session.', protected: 'Beskyttet driftssession', protectedDescription: 'ERP-indstillinger og integrationsforbindelser administreres kun fra en autoriseret session.', account: 'Én driftskonto', accountDescription: 'Efter login vender du tilbage til den samme arbejdsflade til den daglige drift.', secureLogin: 'Sikker login', signIn: 'Log ind', signInTitle: 'Log ind på driftspanelet', signInDescription: 'Indtast din adgangskode for at fortsætte til Sero Guld-arbejdsfladen.', user: 'Konto', password: 'Adgangskode', showPassword: 'Vis adgangskode', hidePassword: 'Skjul adgangskode', submitting: 'Logger ind…', submit: 'Log ind', secureNotice: 'Der oprettes en sikker forbindelse med en autoriseret brugerkonto.' },
      gdpr: { public: {
        shell: { subtitle: 'Sero Guld CRM offentlige privatlivsflader. WordPress-links til privatliv og cookies brobygges til disse sideflader.', links: 'Offentlige links', privacyPolicy: 'Privatlivspolitik', cookies: 'Cookies', requestCenter: 'Anmodningscenter' },
        privacy: { eyebrow: 'Privatliv', title: 'Persondatapolitik', dataController: 'Dataansvarlig', intro: 'Sero Guld CRM behandler de persondata, der er nødvendige for kundeanmodninger, transaktionssikkerhed, økonomisk registrering og butiksdrift. I overensstemmelse med dansk lov opbevares finansposteringer og POS-bilag i den lovbestemte periode; kundestamdata og identitetsfelter pseudonymiseres herefter.', whatWeKeep: 'Hvilke data vi opbevarer', keepMasterData: 'Kundestamdata og identitetsfelter indtil pseudonymisering efter den krævede periode.', keepPosDocuments: 'POS-dokumenter, købskvitteringer og finansposter til bogføring og compliance.', keepRequestHistory: 'Operationel anmodningshistorik til GDPR-sporing.', yourRights: 'Dine rettigheder', rightAccess: 'Anmod om adgang til dine behandlede persondata.', rightRectification: 'Anmod om berigtigelse eller begrænsning, hvor det er lovligt passende.', rightPseudonymization: 'Anmod om pseudonymisering efter den lovlige opbevaringsperiode.', processorsTitle: 'DataProcessorer og hosting', processorsBody: 'CRM, WordPress-offentlige sider, WooCommerce og office-runtime kan behandle begrænsede mængder persondata afhængigt af workflowet. Den autoritative anmodnings- og opbevaringspolitik findes i Sero Guld CRM.' },
        cookies: { eyebrow: 'Cookies', title: 'Cookieinformation', intro: 'Offentlige webflader opdeles i krævede sessions-, sikkerheds- og valgfrie analytics-/marketingkategorier. Cookieadfærd fra WordPress og WooCommerce refereres fra denne side.', required: 'Påkrævet', optional: 'Valgfri' },
        request: { eyebrow: 'Anmodning', title: 'Dataanmodningscenter', intro: 'Indsend anmodninger om indsigt, eksport, begrænsning, berigtigelse eller pseudonymisering her. I V1-flowet starter udførelsen efter menneskelig verifikation; du kan følge status med et sporings-token.', requestType: 'Anmodningstype', name: 'Fulde navn', email: 'E-mail', phone: 'Telefon', message: 'Beskrivelse', acceptedPrivacy: 'Jeg accepterer noten om behandling af persondata og privatliv.', submit: 'Opret anmodning', submitting: 'Sender', created: 'Anmodning oprettet', reference: 'Reference', due: 'Frist', openTracking: 'Åbn statusside', error: 'Anmodningen kunne ikke oprettes.' },
        tracking: { eyebrow: 'Sporing', title: 'Anmodningsstatus', noToken: 'Ingen sporings-token fundet.', loading: 'Indlæser anmodningsstatus…', error: 'Status kunne ikke læses.', status: 'Status', submitted: 'Indsendt', due: 'Frist', completed: 'Fuldført' },
      } },
    },
  },
} as const;

void i18n.init({
  resources,
  lng: 'tr',
  // X1: eksik anahtar Danca arayüzde TÜRKÇE'ye düşmesin — mağaza/müşteri dili
  // Danca olduğu için fallback 'da'. (Operatör 'tr' seçtiğinde tr zaten tam.)
  fallbackLng: 'da',
  interpolation: { escapeValue: false },
  returnNull: false,
});

type AppLocaleContextValue = {
  operatorLocale: Locale;
  displayLocale: Locale;
  activeLocale: Locale;
  setOperatorLocale: (locale: Locale) => void;
  setDisplayLocale: (locale: Locale) => void;
};

const AppLocaleContext = createContext<AppLocaleContextValue | null>(null);

export function isLocale(value: string | null | undefined): value is Locale {
  return Boolean(value && SUPPORTED_LOCALES.includes(value as Locale));
}

function readStoredLocale(key: string, fallback: Locale): Locale {
  try {
    const value = window.localStorage.getItem(key);
    return isLocale(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function displayRouteLocale(): Locale | null {
  const [route, query = ''] = window.location.hash.slice(1).split('?');
  if (!route.startsWith('/display/')) return null;
  const candidate = new URLSearchParams(query).get('lang');
  return isLocale(candidate) ? candidate : null;
}

function isDisplayRoute(): boolean {
  return window.location.hash.slice(1).split('?')[0].startsWith('/display/');
}

export function withDisplayLocale(route: string, locale: Locale): string {
  const [path, rawQuery = ''] = route.split('?');
  const query = new URLSearchParams(rawQuery);
  query.set('lang', locale);
  return `${path}?${query.toString()}`;
}

export function AppLocaleProvider({ children }: { children: ReactNode }) {
  const [operatorLocale, setOperatorLocaleState] = useState<Locale>(() => readStoredLocale(OPERATOR_LOCALE_KEY, 'tr'));
  const [displayLocale, setDisplayLocaleState] = useState<Locale>(() => readStoredLocale(DISPLAY_LOCALE_KEY, 'da'));
  const [routeLocale, setRouteLocale] = useState<Locale | null>(() => displayRouteLocale());
  const activeLocale = isDisplayRoute() ? routeLocale || displayLocale : operatorLocale;

  useEffect(() => {
    const syncRouteLocale = () => setRouteLocale(displayRouteLocale());
    const syncStoredLocale = (event: StorageEvent) => {
      if (event.key === OPERATOR_LOCALE_KEY && isLocale(event.newValue)) {
        setOperatorLocaleState(event.newValue);
      }
      if (event.key === DISPLAY_LOCALE_KEY && isLocale(event.newValue)) {
        setDisplayLocaleState(event.newValue);
        if (isDisplayRoute()) setRouteLocale(event.newValue);
      }
    };
    window.addEventListener('hashchange', syncRouteLocale);
    window.addEventListener('popstate', syncRouteLocale);
    window.addEventListener('storage', syncStoredLocale);
    return () => {
      window.removeEventListener('hashchange', syncRouteLocale);
      window.removeEventListener('popstate', syncRouteLocale);
      window.removeEventListener('storage', syncStoredLocale);
    };
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(activeLocale);
    document.documentElement.lang = activeLocale;
  }, [activeLocale]);

  const value = useMemo<AppLocaleContextValue>(() => ({
    operatorLocale,
    displayLocale,
    activeLocale,
    setOperatorLocale: (locale) => {
      setOperatorLocaleState(locale);
      window.localStorage.setItem(OPERATOR_LOCALE_KEY, locale);
    },
    setDisplayLocale: (locale) => {
      setDisplayLocaleState(locale);
      window.localStorage.setItem(DISPLAY_LOCALE_KEY, locale);
    },
  }), [activeLocale, displayLocale, operatorLocale]);

  return (
    <I18nextProvider i18n={i18n}>
      <AppLocaleContext.Provider value={value}>
        <LocaleRuntimeContext.Provider value={activeLocale}>{children}</LocaleRuntimeContext.Provider>
      </AppLocaleContext.Provider>
    </I18nextProvider>
  );
}

export function useAppLocale() {
  const context = useContext(AppLocaleContext);
  if (!context) throw new Error('useAppLocale must be used inside AppLocaleProvider');
  return context;
}

export function useAppTranslation() {
  return useTranslation();
}

export function LanguageSelector({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const { operatorLocale, setOperatorLocale } = useAppLocale();
  return (
    <label className={`inline-flex items-center gap-1 ${className}`}>
      <span className="sr-only">{t('language.operator')}</span>
      <select aria-label={t('language.operator')} value={operatorLocale} onChange={(event) => setOperatorLocale(event.target.value as Locale)} className="min-h-8 rounded border border-current/20 bg-transparent px-2 text-xs font-semibold outline-none">
        {SUPPORTED_LOCALES.map((locale) => <option key={locale} value={locale}>{t(`language.${locale}`)}</option>)}
      </select>
    </label>
  );
}

export function LanguagePreferencePanel({ variant }: { variant: 'classic' | 'modern' }) {
  const { t } = useTranslation();
  const { operatorLocale, displayLocale, setOperatorLocale, setDisplayLocale } = useAppLocale();
  const modern = variant === 'modern';
  const shell = modern ? 'rounded-sg-md border border-sg-border bg-sg-surface-soft p-4' : 'border border-brand-300 bg-brand-50 p-4';
  const input = modern ? 'mt-1 w-full rounded-sg-sm border border-sg-border bg-sg-surface px-3 py-2 text-sm text-sg-text' : 'mt-1 w-full border border-brand-300 bg-white px-3 py-2 text-sm text-brand-900';
  const text = modern ? 'text-sg-text' : 'text-brand-900';
  const muted = modern ? 'text-sg-text-soft' : 'text-brand-500';
  const changeDisplayLocale = async (locale: Locale) => {
    setDisplayLocale(locale);
    const state = await getDesktopMonitorSetup();
    if (!state?.window_open) return;
    const route = withDisplayLocale(state.active_route || '/display/idle?ui=classic', locale);
    await ensureCustomerDisplayWindow(route);
  };
  return (
    <section className={shell} aria-label={t('common.language')}>
      <h3 className={`text-sm font-semibold ${text}`}>{t('common.language')}</h3>
      <p className={`mt-1 text-xs ${muted}`}>{t('settings.languageDescription')}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className={`text-sm font-medium ${text}`}>{t('language.operator')}<select className={input} value={operatorLocale} onChange={(event) => setOperatorLocale(event.target.value as Locale)}>{SUPPORTED_LOCALES.map((locale) => <option key={locale} value={locale}>{t(`language.${locale}`)}</option>)}</select></label>
        <label className={`text-sm font-medium ${text}`}>{t('language.customerDisplay')}<select className={input} value={displayLocale} onChange={(event) => void changeDisplayLocale(event.target.value as Locale)}>{SUPPORTED_LOCALES.map((locale) => <option key={locale} value={locale}>{t(`language.${locale}`)}</option>)}</select></label>
      </div>
    </section>
  );
}

export function getActiveLocale(): Locale {
  return isLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'tr';
}

export function translate(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

export { i18n };
