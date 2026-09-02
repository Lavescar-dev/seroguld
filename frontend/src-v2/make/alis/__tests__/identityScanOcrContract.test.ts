// OCR fixture sözleşmesi — backend/tests/fixtures/ocr altındaki 20 sentetik
// SPECIMEN görselin GERÇEK Windows.Media.Ocr çıktısı (raw_ocr.json, harness:
// scripts/ocr-fixture-harness.ps1) parseIdentityScan'e beslenir ve
// fixtures.json ground-truth'una karşı doğrulanır.
//
// Kayıt motoru bu geliştirme makinesinde 'tr' dil paketiyle çalıştı: Æ/Ø/Å
// harfleri E/O/Â gibi okunur. Bu yüzden ad/adres karşılaştırmaları foldDanish
// ile harf-katlanmış yapılır; rakam alanları (belge no, CPR, posta kodu)
// birebir eşitlenir. Hedef makinede (da paketi) yeniden kayıt alınırsa
// raw_ocr.json harness ile tazelenir, sözleşme aynı kalır.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EditableCustomer } from '../types';
import {
  applyConfirmedIdentityResult,
  type IdentityParseResult,
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
const rawOcr = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, 'raw_ocr.json'), 'utf-8')) as {
  results: Record<string, string[]>;
};

const DOCUMENT_TYPE_MAP = {
  pas: 'passport',
  idkort: 'id_card',
  koerekort: 'driver_license',
  sundhedskort: 'health_card',
} as const;

function ocrLines(name: string): string[] {
  const lines = rawOcr.results[name];
  if (!lines) throw new Error(`raw OCR kaydı eksik: ${name} (scripts/ocr-fixture-harness.ps1 ile üretin)`);
  return lines;
}

function parseFixture(name: string): IdentityParseResult {
  return parseIdentityScan(ocrLines(name).join('\n'));
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

describe('OCR fixture sözleşmesi — alan çıkarımı (clean + rotate)', () => {
  const reliable = groundTruth.fixtures.filter((item) => (RELIABLE as readonly string[]).includes(item.capture_condition));

  it.each(reliable.map((item) => [item.file.replace('images/', ''), item] as const))(
    '%s: alanlar doğru form alanlarına iner',
    (name, fixture) => {
      const result = parseFixture(name);
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
    // raw_ocr.json'dan gerçek hayatta görülen şekiller: '(' içeren kısmi MRZ
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
      'Demir',
      '21',
      'Recai',
      '1985-04-20,',
      '-40. 2012-05-09',
      '46. 2055-04-20',
      '5. - 30499459',
      'DANMARK / z',
      'Tyrkiej',
      '4c. Rigsp.iitkfwö•n-—-',
      '48.200485-2985',
      '9.- B.C-D-BE.CE.DE',
    ].join('\n');
    const result = parseIdentityScan(raw);
    expect(result.documentType).toBe('driver_license');
    expect(result.fields.name?.value).toBe('Recai Demir');
    expect(result.fields.identity_doc_number?.value).toBe('30499459');
    expect(result.fields.cpr_number?.value).toBe('200485');
    expect(result.fields.identity_doc_country?.value).toBe('DNK');
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
