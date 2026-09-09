// OCR fixture sözleşmesi — backend/tests/fixtures/ocr altındaki 20 sentetik
// SPECIMEN görselin GERÇEK Windows.Media.Ocr çıktıları (raw_ocr_da.json +
// raw_ocr_tr.json, harness: scripts/ocr-fixture-harness.ps1)
// parseIdentityScan'e beslenir ve fixtures.json ground-truth'una karşı
// doğrulanır.
//
// İki kayıt: 'da' = üretim motoru (da-DK WinRT, CI runner kaydı) — ana
// sözleşme bundadır; 'tr' = geliştirme makinesi kaydı (Æ/Ø/Å harfleri
// E/O/Â gibi okunur) — regresyon gövdesi ve motor-farklılığı dayanıklılık
// sözleşmesi bundadır. Karşılaştırmalar foldDanish ile harf-katlanmış
// yapılır; rakam alanları (belge no, CPR, posta kodu) birebir eşitlenir.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EditableCustomer } from '../types';
import {
  applyConfirmedIdentityResult,
  buildIdentityScanLowResCode,
  describeLowResIdentityScan,
  type IdentityParseResult,
  mergeSideScanResults,
  parseIdentityScan,
} from '../identityScan';

const FIXTURE_ROOT = resolve(__dirname, '../../../../../backend/tests/fixtures/ocr');

type GroundTruth = {
  fixtures: Array<{
    file: string;
    document_type: 'pas' | 'idkort' | 'koerekort' | 'sundhedskort';
    person_id: string;
    capture_condition: 'clean' | 'rotate' | 'blur_noise' | 'lowlight' | 'glare';
    carries_address: boolean;
    expected_fields: Record<string, unknown> & {
      full_name?: string;
      cpr_first6?: string;
      document_number?: string;
      street?: string;
      postal_code?: string;
      city?: string;
      mrz_lines?: string[];
    };
  }>;
};

const groundTruth = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, 'fixtures.json'), 'utf-8')) as GroundTruth;

// Görüntüsüz satır-deseni fixture'ları: gerçek OCR kayıtlarının SENTETİK
// modelleri (0.3.36 saha bildirimleri). Görselleri ve raw_ocr kaydı YOKTUR —
// satır listesi doğrudan parseIdentityScan'e beslenir.
type LinePatternFixture = {
  id: string;
  pattern: string;
  lines: string[];
  image_source?: { width?: number; height?: number };
  expected: {
    document_type: 'pas' | 'idkort' | 'koerekort' | 'sundhedskort' | 'unknown';
    full_name?: string;
    cpr_first6?: string;
    document_number?: string;
    filled_field_count?: number;
    low_res_guidance?: { message_contains: string[]; error_code: string };
  };
};

const linePatternFixtures = (groundTruth as unknown as { line_pattern_fixtures?: LinePatternFixture[] }).line_pattern_fixtures ?? [];

type RawOcrRecord = { results: Record<string, string[]> };

// tr kaydı: 2026-09-01, geliştirme makinesi (tr dil paketi) — regresyon
// gövdesi bu kaydın gerçek satır şekillerine sabitlenmiştir; korunur.
const rawOcrTr = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, 'raw_ocr_tr.json'), 'utf-8')) as RawOcrRecord;
// da kaydı: 2026-09-08, GitHub windows-latest CI runner'ı (run 34173433109)
// — ÜRETİM motoru (da-DK WinRT) ile kaydedildi; kaydı üreten akış:
// .github/workflows/windows-ocr-fixture.yml (runner'da da-DK capability
// kurulumu kanıtlandı). Da-DK paketiyle tazeleme artık hp/müşteri makinesi
// beklemeden CI'dan alınabilir.
const rawOcrDa = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, 'raw_ocr_da.json'), 'utf-8')) as RawOcrRecord;

const DOCUMENT_TYPE_MAP = {
  pas: 'passport',
  idkort: 'id_card',
  koerekort: 'driver_license',
  sundhedskort: 'health_card',
} as const;

function ocrLinesFrom(record: RawOcrRecord, file: string, name: string): string[] {
  const lines = record.results[name];
  if (!lines) throw new Error(`raw OCR kaydı eksik: ${name} (${file}; scripts/ocr-fixture-harness.ps1 ile üretin)`);
  return lines;
}

// Regression pinleri tr kaydının satır şekillerine bağlı — tr kaydını okur.
function ocrLines(name: string): string[] {
  return ocrLinesFrom(rawOcrTr, 'raw_ocr_tr.json', name);
}

function parseFixture(name: string): IdentityParseResult {
  return parseIdentityScan(ocrLines(name).join('\n'));
}

function parseFixtureDa(name: string): IdentityParseResult {
  return parseIdentityScan(ocrLinesFrom(rawOcrDa, 'raw_ocr_da.json', name).join('\n'));
}

// Kayıt motorunun bilinen harf katlamaları (tr paketi): Æ→E, Ø→O, Å/Â→A.
function foldDanish(value: string): string {
  return value
    .toUpperCase()
    .replace(/Æ/g, 'E')
    .replace(/Ø/g, 'O')
    .replace(/[ÅÂ]/g, 'A')
    .replace(/[^A-Z0-9 '-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMPTY_CUSTOMER: EditableCustomer = {
  name: '', email: '', phone: '', address: '', postal_code: '', city: '',
  cpr_number: '', identity_doc_type: '', identity_doc_number: '', identity_doc_country: '',
};

const RELIABLE = ['clean', 'rotate'] as const;

// clean+rotate için ortak alan sözleşmesi; hem tr hem da kaydı aynı
// ground-truth'a karşı koşar.
function expectReliableContract(
  parse: (name: string) => IdentityParseResult,
  fixture: GroundTruth['fixtures'][number],
): void {
  const result = parse(fixture.file.replace('images/', ''));
  const expected = fixture.expected_fields;
  expect(result.documentType).toBe(DOCUMENT_TYPE_MAP[fixture.document_type]);

  // Ad basılı satırlardan gelir; harf-katlanmış birebir eşleşme.
  expect(foldDanish(result.fields.name?.value ?? '')).toBe(foldDanish(expected.full_name ?? ''));

  if (fixture.document_type === 'sundhedskort') {
    // Sundhedskort kimlik belgesi değildir: belge no/türü doldurulmaz.
    expect(result.fields.identity_doc_number).toBeUndefined();
    expect(result.fields.identity_doc_type).toBeUndefined();
    expect(result.fields.address?.value ?? '').not.toBe('');
    expect(result.fields.postal_code?.value).toBe(expected.postal_code);
    expect(foldDanish(result.fields.city?.value ?? '')).toBe(foldDanish(expected.city ?? ''));
    expect(result.fields.cpr_number?.value).toBe(expected.cpr_first6);
  } else {
    // Rakam alanları birebir: OCR kayıtlarında rakamlar güvenilir.
    expect(result.fields.identity_doc_number?.value).toBe(expected.document_number);
  }
  if (fixture.document_type === 'pas') {
    // Dansk pasta Personnr. alanı zaten yalnız ilk 6 hanedir.
    expect(result.fields.cpr_number?.value).toBe(expected.cpr_first6);
    expect(result.fields.identity_doc_country?.value).toBe('DNK');
  }
}

describe('OCR fixture sözleşmesi — alan çıkarımı (clean + rotate)', () => {
  const reliable = groundTruth.fixtures.filter((item) => (RELIABLE as readonly string[]).includes(item.capture_condition));

  it.each(reliable.map((item) => [item.file.replace('images/', ''), item] as const))(
    '%s: alanlar doğru form alanlarına iner',
    (_name, fixture) => {
      expectReliableContract(parseFixture, fixture);
    },
  );
});

describe('OCR fixture sözleşmesi — uydurma yok', () => {
  const withoutAddress = groundTruth.fixtures.filter((item) => !item.carries_address);

  it.each(withoutAddress.map((item) => [item.file.replace('images/', ''), item] as const))(
    '%s: basılı olmayan adres alanları asla doldurulmaz',
    (name) => {
      const result = parseFixture(name);
      // Pas, idkort ve dansk kørekort adres TAŞIMAZ; parser tahmin edemez.
      expect(result.fields.address).toBeUndefined();
      expect(result.fields.postal_code).toBeUndefined();
      expect(result.fields.city).toBeUndefined();
    },
  );
});

describe('OCR fixture sözleşmesi — CPR minimizasyonu', () => {
  const sundhedskort = groundTruth.fixtures.filter((item) => item.document_type === 'sundhedskort');

  it.each(sundhedskort.map((item) => [item.file.replace('images/', ''), item] as const))(
    '%s: kartta tam CPR basılı olsa da yalnız ilk 6 hane taşınır',
    (name, fixture) => {
      const raw = ocrLines(name).join('\n');
      const result = parseFixture(name);
      const parsed = result.fields.cpr_number?.value ?? '';
      if (fixture.capture_condition === 'clean' || fixture.capture_condition === 'rotate') {
        expect(parsed).toBe(fixture.expected_fields.cpr_first6);
      }
      if (parsed) {
        // Hiçbir koşulda 6 haneden fazlası çıkmaz; son 4 hane düşürülür.
        expect(parsed).toMatch(/^\d{6}$/);
        // Ham OCR tam CPR'yi içeriyor olabilir — parse sonucu içermemeli.
        const fullCpr = raw.match(/(\d{6})[-–]\s?(\d{4})/);
        if (fullCpr) {
          expect(parsed).not.toContain(fullCpr[2]);
          expect(parsed.length).toBeLessThan((fullCpr[1] + fullCpr[2]).length);
        }
        // Uygulanan müşteri kaydında da yalnız ilk 6 hane bulunur.
        const customer = applyConfirmedIdentityResult(EMPTY_CUSTOMER, result);
        expect(customer.cpr_number).toBe(parsed);
      }
    },
  );
});

describe('OCR fixture sözleşmesi — MRZ translitere ad zorla eşitlenmez', () => {
  it('pas: basılı ad kanoniktir, MRZ transliterasyonu adı ezmez', () => {
    // P2: basılı 'SØRENSEN-ÅBERG', MRZ 'SOERENSEN<AABERG'.
    const result = parseFixture('pas_02_rotate.png');
    const name = result.fields.name?.value ?? '';
    expect(name).not.toContain('SOERENSEN');
    expect(name).not.toContain('AABERG');
    expect(foldDanish(name)).toBe(foldDanish('METTE KIRSTINE SØRENSEN-ÅBERG'));
    // Basılı alanlardan gelen ad her zaman operatör incelemesine düşer.
    expect(result.fields.name?.review).toBe('needs_review');
  });

  it('pas: bozuk MRZ satırları TD3 yolunu yanlışlıkla tetiklemez', () => {
    // Gerçek OCR MRZ'yi boşluklu/«'lı verir; TD3 44-karakter sözleşmesi
    // tutmaz ve parser basılı-etiket dalına düşer. (Onarım dalı ayrı test
    // edilir: aşağıdaki 'MRZ normalizasyonu' bloğu.)
    const result = parseFixture('pas_01_clean.png');
    expect(result.documentType).toBe('passport');
    expect(result.fields.name?.value).not.toContain('PROEVE');
    const expected = groundTruth.fixtures.find((item) => item.file.endsWith('pas_01_clean.png'));
    expect(expected).toBeDefined();
    expect(result.fields.identity_doc_number?.value).toBe(expected?.expected_fields.document_number);
  });
});

// Kanonik ICAO 9303 TD3 örneği (check digit'leri geçerli) — « ve boşluklu
// gerçek OCR biçimine çevrilerek onarım dalının girdisi yapılır.
const ICAO_TD3_PRISTINE = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];

describe('OCR fixture sözleşmesi — MRZ normalizasyonu (« ve boşluk onarımı)', () => {
  it('« + boşluklu gerçek OCR TD3 çifti onarılıp parse edilir', () => {
    // Pristine dal bu satırları reddeder (« [A-Z0-9<] dışında); onarım dalı
    // normalize eder ve ICAO check digit doğrulamasıyla kabul eder.
    const raw = ICAO_TD3_PRISTINE.map((line, index) => (index === 0 ? line.replace(/</g, '«') : line.replace(/</g, ' « ').replace('L8989', 'l8989'))).join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('passport');
    expect(result.fields.name?.value).toBe('ANNA MARIA ERIKSSON');
    expect(result.fields.identity_doc_number?.value).toBe('L898902C3');
  });

  it('check digit bozuk onarılmış satır reddedilir (uydurma yok)', () => {
    // Bileşik kontrol hanesini geçersiz kılan tek harf değişimi: onarım dalı
    // kabul etmez, etiket dalı da yok → unknown.
    const broken = ICAO_TD3_PRISTINE.map((line, index) => {
      const mangled = index === 0 ? line.replace(/</g, '«') : line.replace(/</g, ' « ').replace('L898902C3', 'M898902C3');
      return mangled;
    }).join('\n');
    const result = parseIdentityScan(broken);
    expect(result.documentType).toBe('unknown');
    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it('whitelist dışı satırlar (« ile bile) MRZ sanılmaz', () => {
    // raw_ocr_tr.json'dan gerçek hayatta görülen şekiller: '(' içeren kısmi MRZ
    // ve uzun SPECIMEN başlığı — normalizasyon sonrası bile reddedilmeli.
    const raw = ['I (DNKID1000066«««««««««', 'SPECIMEN — TEST FIXTURE — IKKE ET GYLDIGT DOKUMENT «««'].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('unknown');
    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it('onarılmış MRZ + zayıf etiket çıktısı: basılı ad kazanır, MRZ eksik belge noyu doldurur', () => {
    const repairedLines = [
      ICAO_TD3_PRISTINE[0].replace(/</g, '«'),
      ICAO_TD3_PRISTINE[1].replace(/</g, ' « '),
    ];
    const raw = [
      'KONGERIGET DANMARK',
      'Efternavn',
      'YILMAZ',
      'Pasnr.',
      ...repairedLines,
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('passport');
    // Basılı ad kanoniktir; MRZ transliterasyonu (ERIKSSON) adı ezmez.
    expect(result.fields.name?.value).toBe('YILMAZ');
    // Parlamada basılı Pasnr. değeri okunamadı — MRZ'den doldurulur.
    expect(result.fields.identity_doc_number?.value).toBe('L898902C3');
  });
});

describe('OCR fixture sözleşmesi — gerçek kart düzenleri (aynı-satır + etiketsiz)', () => {
  it('kørekort: değer etiketle aynı satırda (gerçek kart düzeni)', () => {
    const raw = [
      'KØREKORT DANMARK',
      '1. Hansen',
      '2. Lars',
      '3. 1990-01-01, Danmark',
      '4a. 2010-01-01 4c. Rigspolitichefen',
      '4b. 2050-01-01 4d. 010190-1234',
      '5. 30998877',
      '9. B·C·D',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name?.value).toBe('Lars Hansen');
    expect(result.fields.identity_doc_number?.value).toBe('30998877');
    // Kørekort 4d = personnummer; kalıcı yüzeye yalnız ilk 6 hane taşınır.
    expect(result.fields.cpr_number?.value).toBe('010190');
    expect(result.fields.identity_doc_country?.value).toBe('DNK');
  });

  it('kørekort: tr-motor bozukluğunda (MOREKORT, etiketsiz numara) yine tanınır', () => {
    // Gerçek OCR: başlık "MOREKORT" okundu, 1./2. satırları kayboldu,
    // kørekort numarası etiketsiz tek başına düştü.
    const raw = ['MOREKORT DANMARK', '4d.010190-1234', '-5.', '30998877'].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.identity_doc_number?.value).toBe('30998877');
    expect(result.fields.cpr_number?.value).toBe('010190');
    expect(result.fields.identity_doc_country?.value).toBe('DNK');
    expect(result.fields.name).toBeUndefined();
  });

  it('kørekort: tr-OCR numara öneklerini yuttuğunda başlık bloğundan ad okunur (gerçek saha fotoğrafı)', () => {
    // Gerçek Windows OCR (tr paketi, 2026-09-02 saha fotoğrafı): "1." / "2."
    // önekleri tamamen kayboldu; isim satırları etiketsiz kaldı. Başlık
    // sonrasındaki ilk iki basılı isim satırı soyad/ad alınır; sayı ve
    // gürültü satırları (21, tarih) alınmaz. 4d öneki "48." bozuk okunmuş —
    // 4[db8] toleransı CPR'yi kurtarır.
    const raw = [
      'KOREKORT',
      'Testsoy',
      '21',
      'Testkay',
      '1981-03-14,',
      '-40. 2012-05-09',
      '46. 2055-04-20',
      '5. - 20984713',
      'DANMARK / z',
      'Tyrkiej',
      '4c. Rigsp.iitkfwö•n-—-',
      '48.010102-2468',
      '9.- B.C-D-BE.CE.DE',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name?.value).toBe('Testkay Testsoy');
    expect(result.fields.identity_doc_number?.value).toBe('20984713');
    expect(result.fields.cpr_number?.value).toBe('010102');
    expect(result.fields.identity_doc_country?.value).toBe('DNK');
  });

  it('kørekort: da-motor satırlarında belge no önek gürültüsüyle tek satırda düşer (gerçek saha fotoğrafı)', () => {
    // Aynı fotoğrafın da-DK motoru kaydı (2026-09-02, raw_ocr_da.json):
    // KØREKORT başlığı ve 4d. öneki doğru okunur (rakamlar artık güvenilir);
    // ama 5. etiketi '-5. . ' önekiyle bozuk düşer — etiket yolu kaçar,
    // satır-içi 8-9 hane taraması belge noyu kurtarır.
    const raw = [
      'KØREKORT',
      'Testsoy',
      '21',
      'Testkay',
      '2012.05-09',
      'Ab. 2055-04-20',
      '-5. . 20984713',
      'DANMARK /',
      'Tyrkiet',
      '4c. Rigs p.titiciwf•n•—-',
      '4d.010102-2468',
      '9., B.C.D.BE.CE.DE',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name?.value).toBe('Testkay Testsoy');
    expect(result.fields.identity_doc_number?.value).toBe('20984713');
    expect(result.fields.cpr_number?.value).toBe('010102');
    expect(result.fields.identity_doc_country?.value).toBe('DNK');
  });

  it('kørekort: başlık Ø→OE translitresiyle (KOEREKORT) okunduğunda yine tanınır', () => {
    // Bazı motorlar Ø'yi OE diye translitre eder; iki tetikleyici de E?
    // toleransıyla kapsanır — yoksa belge unknown düşer, tüm alanlar kaybolur.
    const raw = [
      'KOEREKORT',
      '1. Hansen',
      '2. Lars',
      '3. 1990-01-01, Danmark',
      '4a. 2010-01-01 4c. Rigspolitichefen',
      '4b. 2050-01-01 4d. 010190-1234',
      '5. 30998877',
      '9. B·C·D',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name?.value).toBe('Lars Hansen');
    expect(result.fields.identity_doc_number?.value).toBe('30998877');
    expect(result.fields.cpr_number?.value).toBe('010190');
    expect(result.fields.identity_doc_country?.value).toBe('DNK');
  });

  it('sundhedskort: c/o satırı sokağı yutmaz — etiketli düzende adres birleşir', () => {
    // Gerçek kart: "Adresse" etiketi altında önce c/o satırı, sonra sokak.
    const raw = [
      'Aarhus Kommune',
      'Navn',
      'Mette Hansen',
      'Adresse',
      'c/o Jens Jensen',
      'Testgade 1',
      'Postnr. og by',
      '8000 Aarhus C',
      'CPR-nr',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Mette Hansen');
    expect(result.fields.address?.value).toBe('c/o Jens Jensen, Testgade 1');
    expect(result.fields.postal_code?.value).toBe('8000');
    expect(result.fields.city?.value).toBe('Aarhus C');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('sundhedskort: c/o satırı sokak ile ad arasındaki blok düzende de kaybolmaz', () => {
    const raw = [
      'Aarhus Kommune',
      '010190-1234',
      'Mette Hansen',
      'c/o Jens Jensen',
      'Testgade 1',
      '8000 Aarhus C',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Mette Hansen');
    expect(result.fields.address?.value).toBe('c/o Jens Jensen, Testgade 1');
    expect(result.fields.postal_code?.value).toBe('8000');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('sundhedskort: EHIC/kart no 10 haneli sayı CPR sanılmaz', () => {
    // "Kort nr" işaretli 10 hane CPR değil; kart CPR'siz okunduğunda
    // cpr_number uydurulmaz (yanlış dolum yok).
    const raw = [
      'Aarhus Kommune',
      'Kort nr. 0512345678',
      'Mette Hansen',
      'Testgade 1',
      '8000 Aarhus C',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.fields.cpr_number).toBeUndefined();
  });

  it('sundhedskort: makul olmayan CPR (999999-9999) taşınmaz', () => {
    // CPR tarih bölümü (ddmm) makul olmalı — OCR bozuk okumasında uydurma
    // CPR kalıcı yüzeye yazılmaz.
    const raw = [
      'Aarhus Kommune',
      '999999-9999',
      'Mette Hansen',
      'Testgade 1',
      '8000 Aarhus C',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.fields.cpr_number).toBeUndefined();
  });

  it('çoklu tarama: arka yüz MRZ adı basılı adı EZMEZ, eksik belge noyu doldurur', () => {
    // Ön yüz basılı etiketlerden okundu; arka yüz TD3 MRZ'si transliterasyon
    // adı üretir — birleşimde basılı ad kanonik kalır (çoklu-tarama merge'i
    // tek-pars sözleşmesiyle aynıdır), MRZ yalnız eksik anahtarı doldurur.
    const front = parseIdentityScan([
      'KONGERIGET DANMARK',
      'Efternavn',
      'YILMAZ',
      'Fornavn',
      'AHMET',
      'Pasnr.',
    ].join('\n'));
    const back = parseIdentityScan(ICAO_TD3_PRISTINE.map((line, index) => (index === 0 ? line.replace(/</g, '«') : line.replace(/</g, ' « ')).replace('l8989', 'L8989')).join('\n'));
    expect(front.documentType).toBe('passport');
    expect(front.fields.name?.value).toBe('AHMET YILMAZ');
    const merged = mergeSideScanResults(front, back);
    expect(merged?.documentType).toBe('passport');
    expect(merged?.fields.name?.value).toBe('AHMET YILMAZ');
    expect(merged?.fields.identity_doc_number?.value).toBe('L898902C3');
  });

  it('sundhedskort: etiketsiz yeni düzen — başlık okunmasa da blok sezgisiyle okunur', () => {
    // Gerçek kart: Navn/Adresse etiketi yok; ad/sokak/posta alt alta.
    const raw = [
      'Hvidovre Kommune',
      'Tlf. 00 00 00 00',
      '010190-1234',
      'Test Person',
      'Testgade 1',
      '9999 Testby',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
    expect(result.fields.address?.value).toBe('Testgade 1');
    expect(result.fields.postal_code?.value).toBe('9999');
    expect(result.fields.city?.value).toBe('Testby');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('sundhedskort: ad ile c/o arasına giren CPR satırı ismi düşürmez (0.3.30 saha kartı)', () => {
    // 0.3.30 saha bildirimi: da motoru 9 satır okudu, ad ile c/o+sokak
    // satırı arasına CPR düştü — tek-satır bakış ismi kaçırmıştı.
    const raw = [
      'Hvidovre Kommune',
      'Sundhedskort',
      'Test Person',
      '010190-1234',
      'c/o Testgade 1',
      '9999 Testby',
      'Sygehus Hovedstaden',
      'Gyldigt til 2027-01-01',
      'Læge Test Jensen',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
    expect(result.fields.address?.value).toBe('c/o Testgade 1');
    expect(result.fields.postal_code?.value).toBe('9999');
    expect(result.fields.city?.value).toBe('Testby');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('sundhedskort: ad satırının kenarındaki madde imi kırpılır', () => {
    const raw = [
      'Hvidovre Kommune',
      '• Test Person',
      'c/o Testgade 1',
      '9999 Testby',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
  });

  it('sundhedskort: "Soyad, Ad" virgüllü düzen doğrudan ada çevrilir', () => {
    const raw = [
      'Hvidovre Kommune',
      'Person, Test',
      'c/o Testgade 1',
      '9999 Testby',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
  });

  it('sundhedskort: ad satırı okunmazsa başlık kelimesi isim olarak sızmaz', () => {
    const raw = [
      'Hvidovre Kommune',
      'Sundhedskort',
      'c/o Testgade 1',
      '9999 Testby',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBeUndefined();
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('sundhedskort: başlıkla birleşen ad satırı ayıklanır', () => {
    const raw = [
      'Hvidovre Kommune',
      'Sundhedskort Test Person',
      'c/o Testgade 1',
      '9999 Testby',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
  });

  it('kombine kart fotoğrafı: sundhedskort bloğu kazanır, alanlar doldurulur', () => {
    // Tek fotoğrafta üstte kørekort altta sundhedskort (gerçek kullanım).
    const raw = [
      'MOREKORT DANMARK',
      '4d.010190-1234',
      'Test Person',
      'Testgade 1',
      '9999 Testby',
      'Hvidovre Kommune',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });
});

describe('OCR parser regresyonları — 0.3.35 (etiket esnetme, erken dönüş, kapı genişletme)', () => {
  it('B2: iki noktalı etiketler (Navn: / CPR-nr:) okunur', () => {
    // Gerçek OCR etiket satırlarına iki nokta bırakır; /^Navn$/ çapası bu
    // satırları etiket sanmaz → isim boş kalır, alanlar eksik döner.
    const raw = [
      'Hvidovre Kommune',
      'Navn: Mette Hansen',
      'CPR-nr: 010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Mette Hansen');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('B1: Navn etiketi okunmaz + diğer alanlar dolu → blok ismi kurtarır (0.3.30 saha imzası)', () => {
    const raw = [
      'Hvidovre Kommune',
      'Sundhedskort',
      'Mette Hansen',
      'Adresse',
      'Testgade 1',
      'Postnr. og by',
      '8000 Aarhus C',
      'CPR-nr',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Mette Hansen');
    expect(result.fields.address?.value).toBe('Testgade 1');
    expect(result.fields.postal_code?.value).toBe('8000');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('B1+B3: Adresse etiket satırı ASLA isim olarak sızmaz', () => {
    const raw = [
      'Hvidovre Kommune',
      'Sundhedskort',
      'Adresse',
      'Testgade 1',
      '8000 Aarhus C',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name).toBeUndefined();
    expect(result.fields.address?.value).toBe('Testgade 1');
  });

  it('B1: merge yönü — blok ismi eklenir, etiketli adres/posta kazanır', () => {
    const raw = [
      'Hvidovre Kommune',
      'Sundhedskort',
      'Mette Hansen',
      'Adresse',
      'Labelgade 1',
      'Postnr. og by',
      '8000 Aarhus C',
      'CPR-nr',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.fields.name?.value).toBe('Mette Hansen');
    expect(result.fields.address?.value).toBe('Labelgade 1');
    expect(result.fields.postal_code?.value).toBe('8000');
    expect(result.fields.city?.value).toBe('Aarhus C');
  });

  it('B4: harf-aralıklı başlık (S U N D H E D S K O R T) kartı tanır', () => {
    // Başlık dikey basıldığında OCR harf-aralıklı yatay metin üretir;
    // KOMMUNE da okunmamışsa kart unknown düşer → 0 alan + sert hata.
    const raw = [
      'S U N D H E D S K O R T',
      'Test Person',
      'c/o Testgade 1',
      '9999 Testby',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
    expect(result.fields.address?.value).toBe('c/o Testgade 1');
    expect(result.fields.postal_code?.value).toBe('9999');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('B4: sygesikring başlığı kartı tanır', () => {
    const raw = [
      'Sygesikringskort',
      'Test Person',
      'Testgade 1',
      '9999 Testby',
      '010190-1234',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
    expect(result.fields.address?.value).toBe('Testgade 1');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('B4 guard: KØREKORT başlığı + bopælsadresse + 4d CPR → driver_license KALIR', () => {
    // Kapı genişledikten sonra bile eski-tip kørekort (adres taşır) health_card
    // yutulmamalı — sundhedskort bloğu başlıktan ÖNCE guard ile ayrılır.
    // WP6: DK kørekortunda adres BASILI DEĞİLDİR — 8. alan araması kaldırıldı,
    // kategori/commune satırlarından adres-posta-şehir uydurulmaz.
    const raw = [
      'KØREKORT',
      '1. Hansen',
      '2. Lars',
      '3. 1990-01-01',
      '4b. 2050-01-01 4d. 010190-1234',
      '5. 30998877',
      '8. Testgade 1, 8000 Aarhus C',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name?.value).toBe('Lars Hansen');
    expect(result.fields.identity_doc_number?.value).toBe('30998877');
    expect(result.fields.address).toBeUndefined();
    expect(result.fields.postal_code).toBeUndefined();
    expect(result.fields.city).toBeUndefined();
    // WP6: ad + belge no birlikte okunduğunda tür 'validated' olur.
    expect(result.fields.identity_doc_type).toEqual({ value: 'driver_license', review: 'validated' });
  });

  it('WP6: kørekortta ad okunamadığında belge türü incelemeye kalır', () => {
    const raw = [
      'KØREKORT',
      '3. 1990-01-01',
      '4d. 010190-1234',
      '5. 30998877',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name).toBeUndefined();
    expect(result.fields.identity_doc_type).toEqual({ value: 'driver_license', review: 'needs_review' });
  });

  it('WP6: ülke yalnız beyaz listedeki ISO-3 kodu olarak yazılır; OCR gürültüsü ülke alanını kirletmez', () => {
    // Danmark → DNK; 'Tyrkiej' gibi bozuk ülke satırı beyaz liste dışıdır.
    const raw = [
      'KØREKORT DANMARK',
      '1. Hansen',
      '2. Lars',
      '3. 1990-01-01, Tyrkiej',
      '4d. 010190-1234',
      '5. 30998877',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.fields.identity_doc_country?.value).toBe('DNK');

    const foreign = parseIdentityScan([
      'KØREKORT',
      '3. 1990-01-01',
      '5. 30998877',
    ].join('\n'));
    // Başlıkta ülke yoksa alan hiç yazılmaz (boş değer taşımaz).
    expect(foreign.fields.identity_doc_country).toBeUndefined();
  });

  it('B4 negatif: c/o + CPR son-çare kapısı kørekort başlığıyla AÇILMAZ', () => {
    const raw = [
      'KØREKORT',
      'c/o Jens Jensen',
      'Testgade 1',
      '8000 Aarhus C',
      '4d. 010190-1234',
      '5. 30998877',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.identity_doc_number?.value).toBe('30998877');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('B5: kørekort yalnız 2. (ad) alanı eksik → blok tamamlar, çift-yazım yok', () => {
    const raw = [
      'KØREKORT',
      '1. Hansen',
      '2.',
      '3. 1990-01-01, Danmark',
      '4a. 2010-01-01 4c. Rigspolitichefen',
      '4b. 2050-01-01 4d. 010190-1234',
      '5. 30998877',
      'Lars',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name?.value).toBe('Lars Hansen');
  });

  it('B5: kørekort yalnız 1. (soyad) alanı eksik → blok tamamlar', () => {
    const raw = [
      'KØREKORT',
      '2. Lars',
      '3. 1990-01-01, Danmark',
      '4a. 2010-01-01',
      '4b. 2050-01-01 4d. 010190-1234',
      '5. 30998877',
      'Hansen',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name?.value).toBe('Lars Hansen');
  });
});

describe('OCR fixture sözleşmesi — düşük kalite davranışı', () => {
  const degraded = groundTruth.fixtures.filter((item) => !(RELIABLE as readonly string[]).includes(item.capture_condition));

  it.each(degraded.map((item) => [item.file.replace('images/', ''), item] as const))(
    '%s: çıkarılan her alan manuel incelemeye açılır, yanlış alan doldurulmaz',
    (name, fixture) => {
      const result = parseFixture(name);
      for (const [field, parsed] of Object.entries(result.fields)) {
        if (!parsed) continue;
        if (field === 'identity_doc_type') continue; // tür tespiti yapısal olarak güçlü
        // Düşük kalitede kabul kriteri doğruluk değil: alan ya boş kalır ya
        // da needs_review ile operatör düzeltmesine sunulur.
        expect(parsed.review).toBe('needs_review');
      }
      if (!fixture.carries_address) {
        expect(result.fields.address).toBeUndefined();
      }
    },
  );
});

describe('OCR fixture sözleşmesi — pas + sundhedskort eşleştirme (P1–P5)', () => {
  const people = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;

  it.each(people.map((person) => [person] as const))(
    '%s: iki belge aynı kişiye birleşir; CPR ilk-6 anahtarı tutarlıdır',
    (person) => {
      const pasFixture = groundTruth.fixtures.find((item) => item.person_id === person && item.document_type === 'pas')!;
      const sundFixture = groundTruth.fixtures.find((item) => item.person_id === person && item.document_type === 'sundhedskort')!;
      const pasResult = parseFixture(pasFixture.file.replace('images/', ''));
      const sundResult = parseFixture(sundFixture.file.replace('images/', ''));

      const pasCpr = pasResult.fields.cpr_number?.value;
      const sundCpr = sundResult.fields.cpr_number?.value;
      // Dedup anahtarı: iki belge de CPR ilk-6 verdiyse birebir aynı olmalı.
      if (pasCpr && sundCpr) expect(pasCpr).toBe(sundCpr);
      expect(pasCpr || sundCpr).toBe(pasFixture.expected_fields.cpr_first6);

      // Gerçek akış: önce kimlik belgesi, sonra adres belgesi uygulanır.
      const afterPas = applyConfirmedIdentityResult(EMPTY_CUSTOMER, pasResult);
      const merged = applyConfirmedIdentityResult(afterPas, sundResult);
      // Sundhedskort, pastan gelen belge no/türünü EZMEZ (kimlik belgesi değil).
      expect(merged.identity_doc_number).toBe(afterPas.identity_doc_number);
      expect(merged.identity_doc_type).toBe('passport');
      // Adres yalnız sundhedskorttan gelir.
      if (sundResult.fields.postal_code) {
        expect(merged.postal_code).toBe(sundFixture.expected_fields.postal_code);
        expect(foldDanish(merged.city)).toBe(foldDanish(sundFixture.expected_fields.city ?? ''));
      }
      // İki belgenin adları aynı kişiyi göstermeli (harf-katlanmış karşılaştırma).
      const pasName = pasResult.fields.name?.value ?? '';
      const sundName = sundResult.fields.name?.value ?? '';
      if (pasName && sundName) {
        const folded = foldDanish(sundName);
        for (const part of foldDanish(pasName).split(' ')) {
          expect(folded).toContain(part);
        }
      }
    },
  );
});

describe('OCR parser sağlamlaştırma — gerçek saha kartı değerlendirmesi (2026-09-08)', () => {
  // Aşağıdaki düzenler, müşterinin gerçek sundhedskort+kørekort fotoğrafının
  // VDS-üzeri OCR denemesinde gözlemlenen satır desenlerinin SENTETİK
  // modelleridir (Test Person / Testgade 47 / 2650 Testby — gerçek veri yok).

  it('S1: læge (doktor) bloğu hasta bloğunu gölgelemez — CPR altındaki posta satırı kazanır', () => {
    // Gerçek kart düzeni: üstte læge adresi, ortada CPR, altta hasta adı/
    // sokak/posta. İlk-posta sezgisi doktorun sokağını adres olarak yazıyordu.
    const raw = [
      'Region Hovedstaden',
      'Hvidovre Kommune',
      'Læge Testklinikken',
      'Lægevej 101',
      '2650 Testby',
      '010190-1234',
      'Test Person',
      'Testgade 47',
      '2650 Testby',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
    expect(result.fields.address?.value).toBe('Testgade 47');
    expect(result.fields.postal_code?.value).toBe('2650');
    expect(result.fields.city?.value).toBe('Testby');
    expect(result.fields.cpr_number?.value).toBe('010190');
  });

  it('S2: posta satırı ile ad arasına giren tek harf/rakam döküntüsü pencereyi kırmez', () => {
    // Gerçek OCR: "I", "er", "1813" gibi kullanılamaz satırlar ad ile posta
    // arasına düşer — mevcut pencere ilk tıkanmada kırılır, ad/sokak düşer.
    const raw = [
      'Hvidovre Kommune',
      '010190-1234',
      'Test Person',
      'er',
      'Testgade 47',
      'I',
      '1813',
      'I',
      '2650 Testby',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.name?.value).toBe('Test Person');
    expect(result.fields.address?.value).toBe('Testgade 47');
    expect(result.fields.postal_code?.value).toBe('2650');
  });

  it('S3: posta satırına taşan etiket artığı şehiri kirletmez', () => {
    // OCR iki fiziksel satırı birleştirdiğinde şehirden sonra Tlf./etiket
    // artığı ve rakamlar eklenir ("Testby Tit. 36 78 45 66").
    const raw = [
      'Hvidovre Kommune',
      '010190-1234',
      'Test Person',
      'Testgade 47',
      '2650 Testby Tit. 36 78 45 66',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('health_card');
    expect(result.fields.city?.value).toBe('Testby');
    expect(result.fields.postal_code?.value).toBe('2650');
  });

  it('L1: kørekort 4d etiketi bozuk okunduğunda CPR gövdedeki 6+4 düzeninden kurtarılır', () => {
    // Gerçek OCR: "4b. 2055-04-20 ad. 010190- 1234" — etiket öneki ve
    // tire+boşluk ayraçlı CPR. Tarih (4+2+2) ve 8-9 bitişik belge no bu
    // deseni üretemez; plausibility kapısı uydurma CPR'yi eler.
    const raw = [
      'KØREKORT DANMARK',
      '1. Testsen',
      '2. Test',
      '3. 1981-03-14, Tyrkiet',
      '4b. 2055-04-20 ad. 010190- 1234',
      '5. 20984713',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.cpr_number?.value).toBe('010190');
    expect(result.fields.identity_doc_number?.value).toBe('20984713');
  });
});

describe('OCR fixture sözleşmesi — da motoru (üretim motoru, CI runner kaydı)', () => {
  // da kaydı 2026-09-08'de GitHub windows-latest runner'ında ÜRETİM motoruyla
  // (da-DK WinRT) alındı — tr kaydının aksine Æ/Ø/Å gerçek harfleriyle gelir.
  const reliable = groundTruth.fixtures.filter((item) => (RELIABLE as readonly string[]).includes(item.capture_condition));

  it.each(reliable.map((item) => [item.file.replace('images/', ''), item] as const))(
    'da %s: alanlar doğru form alanlarına iner',
    (_name, fixture) => {
      expectReliableContract(parseFixtureDa, fixture);
    },
  );

  it.each(
    groundTruth.fixtures.filter((item) => !item.carries_address).map((item) => [item.file.replace('images/', '')] as const),
  )('da %s: basılı olmayan adres alanları asla doldurulmaz', (name) => {
    const result = parseFixtureDa(name);
    expect(result.fields.address).toBeUndefined();
    expect(result.fields.postal_code).toBeUndefined();
    expect(result.fields.city).toBeUndefined();
  });

  it.each(
    groundTruth.fixtures.filter((item) => item.document_type === 'sundhedskort').map((item) => [item.file.replace('images/', '')] as const),
  )('da %s: kartta tam CPR basılı olsa da yalnız ilk 6 hane taşınır', (name) => {
    const raw = ocrLinesFrom(rawOcrDa, 'raw_ocr_da.json', name).join('\n');
    const result = parseFixtureDa(name);
    const parsed = result.fields.cpr_number?.value ?? '';
    if (parsed) {
      expect(parsed).toMatch(/^\d{6}$/);
      const fullCpr = raw.match(/(\d{6})[-–]\s?(\d{4})/);
      if (fullCpr) {
        expect(parsed).not.toContain(fullCpr[2]);
        expect(parsed.length).toBeLessThan((fullCpr[1] + fullCpr[2]).length);
      }
      const customer = applyConfirmedIdentityResult(EMPTY_CUSTOMER, result);
      expect(customer.cpr_number).toBe(parsed);
    }
  });

  it('da kaydında Danca karakterler gerçek formlarıyla gelir (mojibake yok)', () => {
    // BOM'suz .ps1'in cp1252 okunması yalnız kaynak literal'leri bozar;
    // OCR satırları runtime WinRT'den gelir. Bu test bozulma geri gelirse
    // (ör. harness yeniden Türkçe literal yazarsa) erken düşer.
    const lines = ocrLinesFrom(rawOcrDa, 'raw_ocr_da.json', 'sundhedskort_01_clean.png');
    expect(lines.some((line) => /[ÆØÅæøå]/.test(line))).toBe(true);
    for (const line of lines) {
      expect(line.includes('Ã')).toBe(false);
      expect(line.includes('Ä')).toBe(false);
    }
  });
});

describe('OCR satır-deseni fixture\'ları — 0.3.36 saha modelleri (sentetik)', () => {
  it.each(linePatternFixtures.map((item) => [item.id, item] as const))(
    '%s: satır deseni sözleşmeye bağlanır',
    (_id, fixture) => {
      const result = parseIdentityScan(fixture.lines.join('\n'));
      const expectedType = fixture.expected.document_type === 'unknown'
        ? 'unknown'
        : DOCUMENT_TYPE_MAP[fixture.expected.document_type];
      expect(result.documentType).toBe(expectedType);

      const filled = Object.values(result.fields).filter((field) => Boolean(field?.value));
      if (fixture.expected.filled_field_count !== undefined) {
        expect(filled).toHaveLength(fixture.expected.filled_field_count);
      }
      // Ad: beklenen satır birebir; beklenen yoksa asla uydurulmaz.
      expect(result.fields.name?.value ?? '').toBe(fixture.expected.full_name ?? '');
      if (fixture.expected.document_number !== undefined) {
        expect(result.fields.identity_doc_number?.value).toBe(fixture.expected.document_number);
      }
      if (fixture.expected.cpr_first6 !== undefined) {
        expect(result.fields.cpr_number?.value).toBe(fixture.expected.cpr_first6);
      }

      // Düşük çözünürlük yönlendirmesi: parse boş + küçük görüntü → DPI/çekim
      // metni ve imza kodu (genel "tanınamadı" mesajı değil).
      const guidance = fixture.expected.low_res_guidance;
      if (guidance) {
        const width = fixture.image_source?.width;
        const height = fixture.image_source?.height;
        const message = describeLowResIdentityScan(width, height);
        expect(message).not.toBeNull();
        for (const fragment of guidance.message_contains) {
          expect(message).toContain(fragment);
        }
        expect(buildIdentityScanLowResCode(width, height)).toBe(guidance.error_code);
        // Yönlendirme PII/ham satır taşımaz.
        expect(message).not.toContain(fixture.lines[0]);
      }
    },
  );
});
