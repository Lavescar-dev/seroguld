import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  identityEngineFromExtract,
  identityParseResultFromExtract,
  mergeParsedIdentity,
  parseIdentityScan,
  type IdentityParseResult,
} from '../identityScan';

describe('identityParseResultFromExtract', () => {
  it('VLM alanlarını yerel sözleşmeye eşler ve CPR tam 10 hane olarak korur', () => {
    const result = identityParseResultFromExtract({
      document_type: 'sundhedskort',
      fields: {
        full_name: { value: 'Test Person', review: 'validated' },
        cpr_number: { value: '0101011119', review: 'validated' },
        address: { value: 'Testgade 1', review: 'needs_review' },
        postal_code: { value: '1620', review: 'validated' },
        city: { value: 'Testby', review: 'validated' },
        birth_date: { value: '1901-01-01', review: 'validated' },
      },
    });
    // Kırpma YOK: R1-C doğrultusunda tam 10 hane taşınır.
    expect(result.fields.cpr_number).toEqual({ value: '0101011119', review: 'validated' });
    expect(result.fields.name?.value).toBe('Test Person');
    expect(result.fields.address?.value).toBe('Testgade 1');
    expect(result.fields.postal_code?.value).toBe('1620');
    expect(result.fields.city?.value).toBe('Testby');
    // EditableCustomer alanı olmayan tarihler düşürülür.
    expect(Object.keys(result.fields)).not.toContain('birth_date');
    // Sundhedskort kimlik belgesi değildir: tür değeri yazılmaz.
    expect(result.fields.identity_doc_type).toBeUndefined();
    expect(result.documentType).toBe('health_card');
  });

  it('bilinen üç belge türünde identity_doc_type yazılır; residence_permit değeri yazmaz', () => {
    const passport = identityParseResultFromExtract({
      document_type: 'passport',
      fields: { doc_number: { value: 'L898902C3', review: 'validated' } },
    });
    expect(passport.documentType).toBe('passport');
    expect(passport.fields.identity_doc_type).toEqual({ value: 'passport', review: 'validated' });
    expect(passport.fields.identity_doc_number?.value).toBe('L898902C3');

    const permit = identityParseResultFromExtract({
      document_type: 'residence_permit',
      fields: { doc_number: { value: 'AB123456', review: 'needs_review' } },
    });
    // Canonical seçim için kimlik kartı ailesi; ama tür DEĞERİ yazılmaz.
    expect(permit.documentType).toBe('id_card');
    expect(permit.fields.identity_doc_type).toBeUndefined();
  });

  it('tür bilinmiyorsa dolu alanlardan sınıflar; review coercion needs_review taraflı', () => {
    const unknownWithDoc = identityParseResultFromExtract({
      document_type: null,
      fields: { doc_number: { value: 'X1', review: 'garbage' } },
    });
    expect(unknownWithDoc.documentType).toBe('id_card');

    const unknownPerson = identityParseResultFromExtract({
      document_type: 'other',
      fields: { full_name: { value: 'Test', review: 'validated' } },
    });
    expect(unknownPerson.documentType).toBe('health_card');

    // Bilinmeyen review değeri ihtiyatlı tarafta kalır.
    expect(unknownWithDoc.fields.identity_doc_number?.review).toBe('needs_review');

    // M (0.3.39): yalnız CPR varsa (barkod-only yanıt) tür BELİRSİZDİR —
    // 'health_card' sanmak Windows OCR'in doğru bulduğu türü ezerdi.
    const barcodeOnly = identityParseResultFromExtract({
      document_type: null,
      fields: {},
      barcode: { cpr: '0101011234', verified: true },
    });
    expect(barcodeOnly.documentType).toBe('unknown');
    expect(barcodeOnly.fields.cpr_number?.value).toBe('0101011234');

    const empty = identityParseResultFromExtract({ document_type: null, fields: {} });
    expect(empty.documentType).toBe('unknown');
    expect(Object.keys(empty.fields)).toHaveLength(0);
  });

  it('ülkeyi 3 harfe normalize eder, posta kodunu 4 haneye indirir', () => {
    const result = identityParseResultFromExtract({
      document_type: 'driver_license',
      fields: {
        country: { value: 'DNK', review: 'needs_review' },
        postal_code: { value: '16ab20', review: 'validated' },
      },
    });
    expect(result.fields.identity_doc_country?.value).toBe('DNK');
    expect(result.fields.postal_code?.value).toBe('1620');
    // 3 harfe inemeyen ülke değeri YAZILMAZ (boş alan eklemez).
    const bad = identityParseResultFromExtract({
      document_type: 'driver_license',
      fields: { country: { value: 'Danmark', review: 'needs_review' } },
    });
    expect(bad.fields.identity_doc_country).toBeUndefined();
  });

  it('WP5: fields.cpr yoksa barkod CPR doldurulur — tam 10 hane, doğrulama rozetiyle', () => {
    const fromBarcode = identityParseResultFromExtract({
      document_type: 'driver_license',
      fields: {},
      barcode: { cpr: '0101011234', verified: true },
    });
    expect(fromBarcode.fields.cpr_number).toEqual({ value: '0101011234', review: 'validated' });

    // Doğrulanamayan barkod needs_review ile taşınır (yorum operatördedir).
    const unverified = identityParseResultFromExtract({
      document_type: null,
      fields: {},
      barcode: { cpr: '0101011234', verified: false },
    });
    expect(unverified.fields.cpr_number).toEqual({ value: '0101011234', review: 'needs_review' });

    // Kısmi/bozuk barkod taşınmaz (barkod hep 10 hanelidir; uydurma yok).
    const partial = identityParseResultFromExtract({
      document_type: null,
      fields: {},
      barcode: { cpr: '010101', verified: false },
    });
    expect(partial.fields.cpr_number).toBeUndefined();

    // ROI değeri varsa barkod ezemez: ROI alanı birincildir.
    const roiWins = identityParseResultFromExtract({
      document_type: null,
      fields: { cpr_number: { value: '0202034567', review: 'needs_review' } },
      barcode: { cpr: '0101011234', verified: true },
    });
    expect(roiWins.fields.cpr_number?.value).toBe('0202034567');
  });
});

describe('identityEngineFromExtract (WP5 — motor etiketi türetme)', () => {
  it('source VLM izi taşıyorsa vlm kazanır (birleşimde VLM birincildir)', () => {
    expect(identityEngineFromExtract({ source: 'merged+vlm' }, 'backend-local')).toBe('vlm');
  });

  it('engine bloğu ya da local izi backend-local döndürür', () => {
    expect(identityEngineFromExtract({ engine: { name: 'rapidocr' } }, 'windows-ocr')).toBe('backend-local');
    expect(identityEngineFromExtract({ source: 'local+barcode' }, 'windows-ocr')).toBe('backend-local');
  });

  it('iz yoksa beklenti (fallback) aynen döner', () => {
    expect(identityEngineFromExtract({}, 'windows-ocr')).toBe('windows-ocr');
    expect(identityEngineFromExtract({ source: 'vlm-only-tier' }, 'vlm')).toBe('vlm');
    // L (0.3.39): engine nesnesi her yanıtta VARDIR (schema default'u
    // name:"none") — "none" katman koşmuş sayılmaz, barkod-only yanıt
    // yerel motor sanılmaz.
    expect(identityEngineFromExtract({ engine: { name: 'none' }, source: 'barcode' }, 'windows-ocr')).toBe('windows-ocr');
  });
});

describe('mergeParsedIdentity (VLM birincil, regex doldurucu)', () => {
  const regexResult: IdentityParseResult = {
    documentType: 'health_card',
    rawLines: ['SUNDHEDSKORT', 'Test Person'],
    fields: {
      name: { value: 'Test Person', review: 'needs_review' },
      cpr_number: { value: '010101', review: 'needs_review' },
      address: { value: 'Testgade 1', review: 'needs_review' },
    },
  };

  it('VLM dolu alanları regex değerinin ÜZERİNE yazar (tam CPR kazanır)', () => {
    const vlm: IdentityParseResult = {
      documentType: 'health_card',
      rawLines: [],
      fields: { cpr_number: { value: '0101011119', review: 'validated' } },
    };
    const merged = mergeParsedIdentity(vlm, regexResult);
    expect(merged.fields.cpr_number).toEqual({ value: '0101011119', review: 'validated' });
    // Regex yalnız VLM'in bulamadığı anahtarları doldurur.
    expect(merged.fields.name?.value).toBe('Test Person');
    expect(merged.fields.address?.value).toBe('Testgade 1');
  });

  it('VLM hiçbir alan bulamazsa regex sonucu aynen kalır', () => {
    const vlm: IdentityParseResult = { documentType: 'health_card', rawLines: [], fields: {} };
    const merged = mergeParsedIdentity(vlm, regexResult);
    expect(merged.fields).toEqual(regexResult.fields);
  });
});

describe('regex zinciri VLM olmadan aynen çalışır (fallback asla silinmez)', () => {
  it('TD3 MRZ yolu bozulmadı', () => {
    const parsed = parseIdentityScan(
      ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'].join('\n'),
    );
    expect(parsed.documentType).toBe('passport');
    expect(parsed.fields.identity_doc_number?.value).toBe('L898902C3');
  });
});

describe('fetchIdentityExtractCapabilities modül önbelleği', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('tek GET atar; hata önbelleklenmez', async () => {
    const apiRequest = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ extract_enabled: false, model: null, barcode_available: true });
    vi.doMock('@/lib/api', () => ({ apiRequest }));
    const { fetchIdentityExtractCapabilities } = await import('@/lib/identityExtract');

    // İlk çağrı başarısız: önbelleğe TAKILMAZ, sonraki çağrı yeniden dener.
    await expect(fetchIdentityExtractCapabilities()).rejects.toThrow('boom');
    await expect(fetchIdentityExtractCapabilities()).resolves.toEqual({ extract_enabled: false, model: null, barcode_available: true });
    // Başarılı yanıt önbelleklenir: üçüncü çağrı ağa çıkmaz.
    await expect(fetchIdentityExtractCapabilities()).resolves.toEqual({ extract_enabled: false, model: null, barcode_available: true });
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
