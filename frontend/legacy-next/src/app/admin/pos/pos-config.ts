import {
  IdentityDocType,
  MetalType,
  ProductType,
} from '@/types';
import {
  ConfirmFormState,
  NewCustomerState,
  PurityPreset,
  QuoteFormState,
  WizardStepMeta,
} from './pos-types';

export const productTypeOptions: Array<{ value: ProductType; label: string }> = [
  { value: 'bracelet', label: 'Bilezik' },
  { value: 'ring', label: 'Yüzük' },
  { value: 'necklace', label: 'Kolye' },
  { value: 'earring', label: 'Küpe' },
  { value: 'chain', label: 'Zincir' },
  { value: 'bar', label: 'Bar' },
  { value: 'jewelry', label: 'Takı' },
];

export const metalTypeOptions: Array<{ value: MetalType; label: string }> = [
  { value: 'yellow_gold', label: 'Sarı Altın' },
  { value: 'white_gold', label: 'Beyaz Altın' },
  { value: 'silver', label: 'Gümüş' },
  { value: 'platinum', label: 'Platin' },
  { value: 'palladium', label: 'Palladium' },
];

export const identityDocOptions: Array<{ value: IdentityDocType; label: string }> = [
  { value: 'passport', label: 'Pasaport' },
  { value: 'id_card', label: 'Kimlik Kartı' },
  { value: 'driver_license', label: 'Ehliyet' },
];

export const goldPurityPresets: PurityPreset[] = [
  { value: '8K', purity: '33.3', aliases: ['8k', '8', '333', '33.3'] },
  { value: '9K', purity: '37.5', aliases: ['9k', '9', '375', '37.5'] },
  { value: '10K', purity: '41.7', aliases: ['10k', '10', '417', '41.7'] },
  { value: '14K', purity: '58.5', aliases: ['14k', '14', '585', '58.5'] },
  { value: '18K', purity: '75.0', aliases: ['18k', '18', '750', '75', '75.0'] },
  { value: '21K', purity: '87.5', aliases: ['21k', '21', '875', '87.5'] },
  { value: '22K', purity: '91.6', aliases: ['22k', '22', '916', '91.6'] },
  { value: '24K', purity: '99.9', aliases: ['24k', '24', '999', '99.9'] },
];

export const silverPurityPresets: PurityPreset[] = [
  { value: '800', purity: '80.0', aliases: ['800', '80', '80.0'] },
  { value: '830', purity: '83.0', aliases: ['830', '83', '83.0'] },
  { value: '900', purity: '90.0', aliases: ['900', '90', '90.0'] },
  { value: '925', purity: '92.5', aliases: ['925', '92.5'] },
  { value: '999', purity: '99.9', aliases: ['999', '99.9'] },
];

export const platinumPalladiumPresets: PurityPreset[] = [
  { value: '850', purity: '85.0', aliases: ['850', '85', '85.0'] },
  { value: '900', purity: '90.0', aliases: ['900', '90', '90.0'] },
  { value: '950', purity: '95.0', aliases: ['950', '95', '95.0'] },
  { value: '999', purity: '99.9', aliases: ['999', '99.9'] },
];

export const DEFAULT_INTERNAL_MARGIN_PERCENT = 8;

export const initialQuote: QuoteFormState = {
  product_type: '',
  metal_type: '',
  weight_grams: '',
  purity_karat: '18K',
  purity_percentage: '75',
  margin_percent_internal: '8',
};

export const initialCustomer: NewCustomerState = {
  name: '',
  phone: '',
  email: '',
  address: '',
  postal_code: '',
  cpr_number: '',
  identity_doc_type: '',
  identity_doc_number: '',
  identity_doc_country: 'DK',
};

export const initialConfirm: ConfirmFormState = {
  reference_number: '',
  storage_location: '',
  notes: '',
  needs_cleaning: false,
  sale_override_reason: '',
  sale_price_dkk: '',
  manual_purchase_cost_dkk: '',
};

export const wizardSteps: WizardStepMeta[] = [
  { id: 0, title: 'İşlem', hint: 'Alış / Satış ve satış modu' },
  { id: 1, title: 'Müşteri', hint: 'Müşteriyi seç ve POS başlat' },
  { id: 2, title: 'Kalemler', hint: 'Ürün detaylarını doldur' },
  { id: 3, title: 'Kur', hint: 'Canlı/manuel kur ile fiyat oluştur' },
  { id: 4, title: 'Onay', hint: 'İşlemi kesinleştir' },
  { id: 5, title: 'Belge', hint: 'Fatura/makbuz çıktısı al' },
];
