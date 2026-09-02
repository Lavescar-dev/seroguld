import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  acquireIdentityScan,
  getIdentityScannerCapabilities,
  identityScanFromBytes,
  pickIdentityScanFile,
  writeUiDiagnostic,
} from '@/lib/desktop';

import type { EditableCustomer } from './types';

export type IdentityFieldName = 'name' | 'identity_doc_number' | 'identity_doc_type' | 'identity_doc_country' | 'address' | 'postal_code' | 'city' | 'cpr_number';
export type IdentityFieldReview = 'validated' | 'needs_review';

export type ParsedIdentityField = {
  value: string;
  review: IdentityFieldReview;
};

export type IdentityParseResult = {
  documentType: 'passport' | 'id_card' | 'driver_license' | 'health_card' | 'unknown';
  rawLines: string[];
  fields: Partial<Record<IdentityFieldName, ParsedIdentityField>>;
};

export type IdentityOcrLanguageInfo = {
  danishAvailable: boolean;
  profileLanguage: string;
  availableLanguages: string[];
};

export type IdentityScannerCapabilities = {
  scanner: boolean;
  file: boolean;
  message?: string;
  ocr?: IdentityOcrLanguageInfo;
};

export type IdentityScanStatus = 'checking' | 'ready' | 'acquiring' | 'review' | 'applied' | 'unavailable' | 'error';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function cleanMrzField(value: string): string {
  return value.replace(/</g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeCountry(value: string): string {
  const country = value.replace(/[^A-Z]/gi, '').toUpperCase();
  return country.length === 3 ? country : '';
}

function mrzCheckDigit(value: string): number {
  const weights = [7, 3, 1];
  return value.split('').reduce((sum, character, index) => {
    const code = character === '<' ? 0 : /\d/.test(character) ? Number(character) : character.charCodeAt(0) - 55;
    return sum + Math.max(0, code) * weights[index % weights.length];
  }, 0) % 10;
}

function hasValidMrzCheck(value: string, check: string): boolean {
  return /^\d$/.test(check) && mrzCheckDigit(value) === Number(check);
}

function parsedField(value: string, review: IdentityFieldReview): ParsedIdentityField | undefined {
  const normalized = value.trim();
  return normalized ? { value: normalized, review } : undefined;
}

function parseTd3(lines: string[]): IdentityParseResult | null {
  const [first, second] = lines;
  if (!first || !second || first.length !== 44 || second.length !== 44 || !/^[PVIAC][A-Z<]/.test(first)) return null;

  const nameField = first.slice(5);
  const [surnameRaw = '', givenRaw = ''] = nameField.split('<<', 2);
  const name = [cleanMrzField(givenRaw), cleanMrzField(surnameRaw)].filter(Boolean).join(' ');
  const documentNumber = second.slice(0, 9).replace(/</g, '');
  const documentValidated = hasValidMrzCheck(second.slice(0, 9), second[9]);
  const country = normalizeCountry(first.slice(2, 5));
  const fields = definedFields([
    ['name', parsedField(name, 'needs_review')],
    ['identity_doc_number', parsedField(documentNumber, documentValidated ? 'validated' : 'needs_review')],
    ['identity_doc_type', { value: 'passport', review: 'validated' as const }],
    ['identity_doc_country', parsedField(country, 'needs_review')],
  ]);
  return { documentType: 'passport', rawLines: [first, second], fields };
}

function parseTd1(lines: string[]): IdentityParseResult | null {
  const [first, second, third] = lines;
  if (!first || !second || !third || first.length !== 30 || second.length !== 30 || third.length !== 30 || !/^[ACI][A-Z<]/.test(first)) return null;

  const documentNumber = first.slice(5, 14).replace(/</g, '');
  const documentValidated = hasValidMrzCheck(first.slice(5, 14), first[14]);
  const [surnameRaw = '', givenRaw = ''] = third.split('<<', 2);
  const name = [cleanMrzField(givenRaw), cleanMrzField(surnameRaw)].filter(Boolean).join(' ');
  const country = normalizeCountry(first.slice(2, 5));
  const fields = definedFields([
    ['name', parsedField(name, 'needs_review')],
    ['identity_doc_number', parsedField(documentNumber, documentValidated ? 'validated' : 'needs_review')],
    ['identity_doc_type', { value: 'id_card', review: 'validated' as const }],
    ['identity_doc_country', parsedField(country, 'needs_review')],
  ]);
  return { documentType: 'id_card', rawLines: [first, second, third], fields };
}

function valueAfterLabel(raw: string, label: string): string {
  const match = raw.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[.:]\\s*([^\\n]+)`, 'im'));
  return match?.[1]?.trim() || '';
}

// ---- Danca etiketli belgeler (gerçek Windows OCR çıktısına göre) -------------
//
// Windows.Media.Ocr, MRZ'yi güvenilir vermez: '<' işaretleri '«' okunur, araya
// boşluk girer, satırlar kısmen kaybolur. Buna karşılık basılı Danca alan
// etiketleri (Efternavn, Fornavn, Pasnr., CPR-nr., Postnr. og by ...) ayrı
// satırlar halinde sağlam gelir. Bu dal, etiket satırını bulup İZLEYEN uygun
// değer satırını alır; MRZ yalnız temiz geldiğinde (TD3/TD1 yolları) kazanır.
// Basılı ad kanoniktir: MRZ'nin translitere adı (Æ→AE, Ø→OE, Å→AA) basılı adla
// eşitlenmeye çalışılmaz.

const IDENTITY_NOISE_LINE = /SPECIMEN|^FOTO$|^PLACE-?$|^HOLDER$|KONGERIGET|KINGDOM OF|^PAS\b.*PASSPORT|^DANMARK\b|IDENTITETSKORT|^SUNDHEDSKORT$|^REGION\s|Kortet er ikke|GYLDIGT/i;

function definedFields(entries: Array<[IdentityFieldName, ParsedIdentityField | undefined]>): IdentityParseResult['fields'] {
  // Yalnız dolu alanlar yazılır: merge sırasında undefined anahtarların önceki
  // taramadan gelen değerleri ezmemesi için.
  const fields: IdentityParseResult['fields'] = {};
  for (const [key, value] of entries) {
    if (value) fields[key] = value;
  }
  return fields;
}

function valueAfterLabelLine(
  lines: string[],
  label: RegExp,
  labels: RegExp[],
  accept: (line: string) => boolean,
  window = 4,
): string {
  const start = lines.findIndex((line) => label.test(line));
  if (start < 0) return '';
  // Gerçek kartlarda değer etiketle AYNI satırda basılır ("1. Demir",
  // "5. 30499959") — önce etiketin satır içi kaldığı denenir; sentetik
  // fixture'lardaki ayrı-satır düzeni için ardından alttaki satırlara bakılır.
  const labelLine = lines[start];
  const labelMatch = labelLine.match(label);
  // Yalnız etiket SATIR BAŞINDA olduğunda satır içi değere bakılır ("1. Demir");
  // OCR gürültüsünde etiket kelimesi satır ortasında geçebilir ("I GIVEN NAMES
  // …") — oradan değer almak soyadı ada çeker.
  if (labelMatch && labelMatch.index === 0) {
    const rest = labelLine
      .slice(labelMatch[0].length)
      .replace(/^[\s.:·•\-]+/, '')
      .trim();
    if (rest && accept(rest)) return rest;
  }
  for (let index = start + 1; index <= start + window && index < lines.length; index += 1) {
    const line = lines[index];
    if (labels.some((candidate) => candidate.test(line))) return '';
    if (IDENTITY_NOISE_LINE.test(line)) continue;
    if (accept(line)) return line.trim();
  }
  return '';
}

// Adres penceresi: "c/o Jens Jensen" sokağın ÜSTÜNDE basılır; yalnız c/o
// satırını adres almak gerçek sokağı kaybettirir. c/o satırları toplanıp
// sokakla birleştirilir → "c/o Jens Jensen, Testgade 1".
function addressValueAfterLabelLine(lines: string[], label: RegExp, labels: RegExp[], window = 4): string {
  const start = lines.findIndex((line) => label.test(line));
  if (start < 0) return '';
  const careOf: string[] = [];
  for (let index = start + 1; index <= start + window && index < lines.length; index += 1) {
    const line = lines[index];
    if (labels.some((candidate) => candidate.test(line))) break;
    if (IDENTITY_NOISE_LINE.test(line)) continue;
    const trimmed = line.trim();
    if (CARE_OF_LINE.test(trimmed)) {
      careOf.push(trimmed);
      continue;
    }
    if (/\d/.test(line) || line.length > 4) return [...careOf, trimmed].filter(Boolean).join(', ');
  }
  return careOf.join(', ');
}

const PRINTED_NAME_PART = /^[A-ZÆØÅÄÖÜÂÊÎÔÛ][A-ZÆØÅÄÖÜÂÊÎÔÛ '’-]{1,39}$/;

// Bilinen etiket kelimeleri asla ad değeri değildir (case-tolerant kontrolde
// "Fornavn" gibi satırlar ad sanılmasın). OCR başlıkları bozabilir
// (Fornavn→PORNAVN) — "navn" sonu (Danca: isim) ek bazında dışlanır.
const IDENTITY_LABEL_WORDS = /NAVN$|^NAVN$|SURNAME|GIVEN NAMES|KOMMUNE|^REGION\b/;

function isPrintedNamePart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /DANSK|DANISH|DNK\b/.test(trimmed) || IDENTITY_LABEL_WORDS.test(trimmed.toUpperCase())) return false;
  // Gerçek kartlarda ad karışık durumda basılır ("Recai Demtr"); sentetik
  // fixture'larda tamamen büyüktür — iki biçim de kabul edilir.
  return PRINTED_NAME_PART.test(trimmed) || PRINTED_NAME_PART.test(trimmed.toUpperCase());
}

function cprFirstSix(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(0, 6) : '';
}

// Danca CPR tarih bölümü makul bir tarih kodlar (dd 01-31, mm 01-12) — OCR
// bozulmalarında uydurma CPR kalıcı yüzeye taşınmasın diye son makuliyet
// kapısı. 6+4 desenine uyan yabancı sayılar da burada elenir.
function plausibleCprSix(value: string): string {
  const digits = cprFirstSix(value);
  if (digits.length < 6) return '';
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? digits : '';
}

const CARE_OF_LINE = /^c\s*[/\\]\s*o\b/i;

// Etiketsiz CPR adayı: Danca CPR 6+4 düzenidir ve tarih bölümü makul bir
// tarih kodlar (dd 01-31, mm 01-12) — EHIC/kart no gibi 10 haneli yabancı
// sayılar (ör. "Kort nr 0512345678", "999999-9999") CPR sanılmaz. Kart-no
// işaretli satırlar ("Kortnr.", "EHIC", "sygesikr") baştan elenir.
function findBareCpr(lines: string[]): string {
  for (const line of lines) {
    if (/kort\s*\.?\s*nr|kortnr|ehic|sygesikr/i.test(line)) continue;
    const match = line.match(/\b(\d{6})[-\s]?(\d{4})\b/);
    if (!match) continue;
    const day = Number(match[1].slice(0, 2));
    const month = Number(match[1].slice(2, 4));
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return match[0];
  }
  return '';
}

function parseDanishLabeled(raw: string, lines: string[]): IdentityParseResult | null {
  const upper = raw.toUpperCase();

  // Sundhedskort kimlik belgesi DEĞİLDİR ("Kortet er ikke et identitetsbevis"):
  // belge türü/numarası doldurulmaz; ad, CPR ilk-6 ve adres alınır.
  // Yeni kartlarda başlık kelimesi dikey basılı olduğu için OCR okumayabilir;
  // KOMMUNE + CPR kombinasyonu da kartı tanır (diğer kartlarda Kommune yok).
  const bareCpr = findBareCpr(lines);
  const isSundhedskort = /SUNDHEDSKORT/.test(upper) || (/KOMMUNE/.test(upper) && Boolean(bareCpr));
  if (isSundhedskort) {
    const labels = [/^Navn$/i, /CPR[-\s.]?n/i, /^Ad?resse$/i, /r\.?\s*og\s*by/i, /^T[l1i]f|^TM\b|^Tif/i, /^L[æa]ge/i];
    const name = valueAfterLabelLine(lines, /^Navn$/i, labels, isPrintedNamePart);
    const cprLine = valueAfterLabelLine(lines, /CPR[-\s.]?n/i, labels, (line) => /\d{6}/.test(line));
    const street = addressValueAfterLabelLine(lines, /^Ad?resse$/i, labels);
    const postalLine = valueAfterLabelLine(lines, /r\.?\s*og\s*by/i, labels, (line) => /^\d{4}\s+\S/.test(line));
    const postalMatch = postalLine.match(/^(\d{4})\s+(.+)$/);
    const fields = definedFields([
      ['name', parsedField(name, 'needs_review')],
      // Kartta tam CPR basılıdır; kalıcı yüzeylere YALNIZ ilk 6 hane taşınır.
      ['cpr_number', parsedField(plausibleCprSix(cprLine), 'needs_review')],
      ['address', parsedField(street, 'needs_review')],
      ['postal_code', parsedField(postalMatch?.[1] || '', 'needs_review')],
      ['city', parsedField(postalMatch?.[2] || '', 'needs_review')],
    ]);
    if (Object.keys(fields).length) return { documentType: 'health_card', rawLines: lines, fields };
    // Etiketsiz yeni düzen: ad/sokak/posta bloğu alt alta basılır, etiket yok.
    // Posta satırı (9999 By) çıpaydır; bir üstü sokak, iki üstü addır.
    // Sokak ile ad arasına c/o satırı düşebilir — c/o satırları atlanır ve
    // adrese eklenir ("c/o Jens Jensen, Testgade 1").
    const postalIndex = lines.findIndex((line) => /^\d{4}\s+\S/.test(line.trim()));
    if (postalIndex >= 2) {
      const streetLine = lines[postalIndex - 1]?.trim() ?? '';
      const careOf: string[] = [];
      let nameCursor = postalIndex - 2;
      while (nameCursor >= 0 && CARE_OF_LINE.test(lines[nameCursor]?.trim() ?? '')) {
        careOf.unshift(lines[nameCursor].trim());
        nameCursor -= 1;
      }
      const nameLine = nameCursor >= 0 ? (lines[nameCursor]?.trim() ?? '') : '';
      const blockPostal = lines[postalIndex].trim().match(/^(\d{4})\s+(.+)$/);
      const blockAddress = /\d/.test(streetLine) ? [...careOf, streetLine].filter(Boolean).join(', ') : '';
      const blockFields = definedFields([
        ['name', isPrintedNamePart(nameLine) ? parsedField(nameLine, 'needs_review') : undefined],
        ['address', blockAddress ? parsedField(blockAddress, 'needs_review') : undefined],
        ['postal_code', parsedField(blockPostal?.[1] || '', 'needs_review')],
        ['city', parsedField(blockPostal?.[2] || '', 'needs_review')],
        ['cpr_number', parsedField(plausibleCprSix(bareCpr), 'needs_review')],
      ]);
      if (Object.keys(blockFields).length) return { documentType: 'health_card', rawLines: lines, fields: blockFields };
    }
    // Blok sezgisi de başarısızsa kartta CPR varsa yalnız CPR ile dön.
    if (bareCpr) {
      return {
        documentType: 'health_card',
        rawLines: lines,
        fields: definedFields([['cpr_number', parsedField(plausibleCprSix(bareCpr), 'needs_review')]]),
      };
    }
    return null;
  }

  // Dansk kørekort: numaralı etiketler ve değerler aynı satırda ("1. Demir");
  // tr-paketi başlığı bozabilir (MOREKORT) — [KMG] toleransı; Ø bazı
  // motorlarda OE diye translitre okunur (KOEREKORT) — E? toleransı.
  // 4d = personnummer.
  if (/[KMG][OØ0]E?REKORT/.test(upper)) {
    const labels = [/^1[.:]/, /^2[.:]/, /^3[.:]/, /^4a[.:]/i, /^4b[.:]/i, /^4c[.:]/i, /^5[.:]/, /^8[.:]/, /^9[.:]/, /^12[.:]/];
    let surname = valueAfterLabelLine(lines, /^1[.:]/, labels, isPrintedNamePart);
    let givenName = valueAfterLabelLine(lines, /^2[.:]/, labels, isPrintedNamePart);
    // tr-OCR numara öneklerini yutabilir ("1. Demir" → "Demir") ve başlığın
    // altındaki değer satırlarını etiketsiz bırakabilir (gerçek saha
    // fotoğrafı: KOREKORT / Demir / 21 / Recai / 1985-04-20 …). Etiket yolu
    // iki alanı da bulamadıysa başlık sonrasındaki ilk iki basılı isim
    // satırını sırayla soyad/ad al — sayı/gürültü satırları isPrintedNamePart
    // dışında kalır.
    if (!surname && !givenName) {
      const blockNames = lines
        .filter((line) => {
          const trimmed = line.trim();
          if (/^[KMG][OØ0]E?REKORT/i.test(trimmed) || IDENTITY_NOISE_LINE.test(trimmed)) return false;
          return isPrintedNamePart(trimmed);
        })
        .slice(0, 2);
      [surname, givenName] = [blockNames[0] ?? '', blockNames[1] ?? ''];
    }
    const documentNumber = valueAfterLabelLine(lines, /^5[.:]/, labels, (line) => /^[A-Z]{0,3}\d{6,}$/.test(line.trim()))
      || (lines.find((line) => /^\d{8,9}$/.test(line.trim()))?.trim() ?? '')
      // da-motor '-5. . 30499459' gibi önek gürültüsü bırakabilir; satır
      // içinde bağımsız 8-9 haneli sayı (tarih/CPR parçası olmayan) belge no
      // adayıdır — tarih (4+2+2) ve CPR (6+4) desenleri 8-9 bitişik hane
      // üretmediğinden yanlış pozitif oluşmaz.
      || (lines.map((line) => line.match(/(?<![\d-])\d{8,9}(?!\d)/)?.[0]).find(Boolean) ?? '');
    // Kørekort CPR'si 4d alanındadır ("4d. 010190-1234"); tarihlerden ayrışır
    // (tarihler 4+2+2 hanedir, CPR 6+4). tr-OCR '4d.' önekini '48.' olarak
    // okuyabilir (d→8) — 4[db8] toleransı; 4b'deki tarih 4+2+2 düzeni
    // yüzünden 6+4 desenine asla uymaz, yanlış pozitif oluşmaz.
    const cprRaw = raw.match(/4[db8]\s*[.:]?\s*(\d{6}[-\s]?\d{4})/i)?.[1] ?? '';
    // Eski kart düzeninde 8. alan bopælsadresse (kayıtlı adres) taşır.
    const addressLine = valueAfterLabelLine(lines, /^8[.:]/, labels, (line) => /\d/.test(line) || line.length > 4);
    const addressPostal = addressLine.match(/\b(\d{4})\s+([^,\n]+)$/);
    const name = [givenName, surname].filter(Boolean).join(' ');
    const fields = definedFields([
      ['name', parsedField(name, 'needs_review')],
      ['identity_doc_number', parsedField(documentNumber, 'needs_review')],
      ['identity_doc_type', name || documentNumber ? { value: 'driver_license', review: 'validated' as const } : undefined],
      ['identity_doc_country', parsedField(/DANMARK|\bDNK\b|\bDK\b/.test(upper) ? 'DNK' : '', 'needs_review')],
      ['cpr_number', parsedField(plausibleCprSix(cprRaw), 'needs_review')],
      ['address', parsedField(addressLine.replace(/\b\d{4}\s+.*$/, '').replace(/[,-]\s*$/, ''), 'needs_review')],
      ['postal_code', parsedField(addressPostal?.[1] || '', 'needs_review')],
      ['city', parsedField(addressPostal?.[2]?.trim() || '', 'needs_review')],
    ]);
    return Object.keys(fields).length ? { documentType: 'driver_license', rawLines: lines, fields } : null;
  }

  const isPas = /KONGERIGET|\bPAS\b|PASSPORT/.test(upper);
  const isIdKort = /IDENTITETSKORT/.test(upper);
  if (!isPas && !isIdKort) return null;

  const labels = [
    /^Type\b/i, /Kode\b|\/\s*Code/i, /ternavn|Surname/i, /Fornavn|Given names/i, /Nationalit/i,
    /dselsdato|Date of birth/i, /Udstedt|Date of issue/i, /Pasnr|Passport No/i, /Kortnr|card No/i,
    /^K[oø]n\b|\bSex\b/i, /Personnr|Personal No/i, /Udl[oø]ber|Date of expiry/i,
  ];
  const surname = valueAfterLabelLine(lines, /ternavn|Surname/i, labels, isPrintedNamePart);
  const givenName = valueAfterLabelLine(lines, /Fornavn|Given names/i, labels, isPrintedNamePart);
  const name = [givenName, surname].filter(Boolean).join(' ');
  const documentNumber = isPas
    ? valueAfterLabelLine(lines, /Pasnr|Passport No/i, labels, (line) => /^\d{7,9}$/.test(line.trim()))
    : valueAfterLabelLine(lines, /Kortnr|card No/i, labels, (line) => /^[A-Z]{0,3}\d{6,}$/.test(line.trim()))
      || (lines.find((line) => /^[A-Z]{2}\d{7}$/.test(line.trim()))?.trim() ?? '');
  // Dansk pasta 'Personnr.' alanı zaten yalnız CPR'nin ilk 6 hanesidir.
  const personnr = isPas
    ? valueAfterLabelLine(lines, /Personnr|Personal No/i, labels, (line) => /^\d{6}$/.test(line.trim()))
    : '';
  const country = valueAfterLabelLine(lines, /Kode\b|\/\s*Code/i, labels, (line) => /^[A-Z]{3}$/.test(line.trim()))
    || (lines.some((line) => /^DNK$/.test(line.trim())) ? 'DNK' : '');
  const documentType = isPas ? 'passport' as const : 'id_card' as const;
  const fields = definedFields([
    ['name', parsedField(name, 'needs_review')],
    ['identity_doc_number', parsedField(documentNumber, 'needs_review')],
    ['identity_doc_type', name || documentNumber ? { value: documentType, review: 'validated' as const } : undefined],
    ['identity_doc_country', parsedField(normalizeCountry(country), 'needs_review')],
    ['cpr_number', parsedField(plausibleCprSix(personnr), 'needs_review')],
  ]);
  return Object.keys(fields).length ? { documentType, rawLines: lines, fields } : null;
}

function parseDriverLicense(raw: string, lines: string[]): IdentityParseResult | null {
  const upper = raw.toUpperCase();
  const looksLikeLicense = /[KMG][ØO]E?REKORT|DRIVING\s+LICEN[CS]E|PERMIS\s+DE\s+CONDUIRE|F[ÜU]HRERSCHEIN/.test(upper);
  if (!looksLikeLicense) return null;

  const surname = valueAfterLabel(raw, '1');
  const givenName = valueAfterLabel(raw, '2');
  const name = [givenName, surname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const documentNumber = valueAfterLabel(raw, '5') || (raw.match(/(?:LICEN[CS]E|K[ØO]REKORT)\s*(?:NO|NR|NUMBER)?\s*[:#-]?\s*([A-Z0-9-]{5,})/i)?.[1] || '');
  const addressLine = valueAfterLabel(raw, '8');
  const postalMatch = addressLine.match(/\b(\d{4})\s+([^,\n]+)/) || raw.match(/\b(\d{4})\s+([A-ZÆØÅ][A-ZÆØÅ .'-]{2,})/i);
  const countryMatch = upper.match(/\b(DNK|DK|DENMARK|DANMARK|SWE|NOR|DEU|GER|FRA|FIN|NLD)\b/);
  const countryMap: Record<string, string> = { DK: 'DNK', DENMARK: 'DNK', DANMARK: 'DNK', GER: 'DEU' };
  const country = countryMatch ? countryMap[countryMatch[1]] || countryMatch[1] : '';
  const fields = definedFields([
    ['name', parsedField(name, 'needs_review')],
    ['identity_doc_number', parsedField(documentNumber, 'needs_review')],
    ['identity_doc_type', { value: 'driver_license', review: 'needs_review' as const }],
    ['identity_doc_country', parsedField(normalizeCountry(country), 'needs_review')],
    ['address', parsedField(addressLine.replace(/\b\d{4}\s+.*$/, '').replace(/[,-]\s*$/, ''), 'needs_review')],
    ['postal_code', parsedField(postalMatch?.[1] || '', 'needs_review')],
    ['city', parsedField(postalMatch?.[2] || '', 'needs_review')],
  ]);
  return { documentType: 'driver_license', rawLines: lines, fields };
}

export function parseIdentityScan(raw: string): IdentityParseResult {
  const lines = raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const mrzLines = lines.filter((line) => /^[A-Z0-9<]+$/.test(line) && line.length >= 30);
  const td3 = parseTd3(mrzLines.filter((line) => line.length === 44).slice(0, 2));
  if (td3) return td3;
  const td1 = parseTd1(mrzLines.filter((line) => line.length === 30).slice(0, 3));
  if (td1) return td1;
  // Onarılmış MRZ: Windows OCR '<' yerine « okur ve aralara boşluk koyar
  // (raw_ocr.json: "2010000337 D N K 8611172 M 3103142 « « «"). Artıklardan
  // arındırıp ICAO karakter kümesine oturan satırlar MRZ adayıdır; check
  // digit gate'i yanlış pozitifi engeller. Basılı etiket dalı varsa kazınır:
  // basılı ad kanoniktir, MRZ yalnız eksik alanları doldurur.
  const repaired = parseRepairedMrz(lines);
  const labeled = parseDanishLabeled(raw, lines);
  if (labeled && repaired) return mergeParsedIdentity(labeled, repaired);
  if (labeled) return labeled;
  if (repaired) return repaired;
  const license = parseDriverLicense(raw, lines);
  if (license) return license;
  return { documentType: 'unknown', rawLines: lines, fields: {} };
}

// MRZ adayı: « → <, boşluklar silinir; geri kalan her karakter ICAO kümesinde
// olmak zorunda ('SPECIMEN — TEST FIXTURE' gibi uzun başlık satırlarını ve
// "I (DNKID…" gibi kısmi MRZ parçalarını eler).
function mrzCandidate(line: string): string | null {
  const compact = line.toUpperCase().replace(/«/g, '<').replace(/\s+/g, '');
  return /^[A-Z0-9<]{30,}$/.test(compact) ? compact : null;
}

// ICAO 9303 TD3: birleşik kontrol hanesi 2. satırın 44. hanesi; 1-10, 14-20
// ve 22-43 (1 tabanlı) haneleri üzerinden hesaplanır.
function td3CompositeCheckValid(second: string): boolean {
  return hasValidMrzCheck(second.slice(0, 10) + second.slice(13, 20) + second.slice(21, 43), second[43]);
}

// ICAO 9303 TD1: 2. satırın 1-6 haneleri doğum tarihi, 7. hane kontrol hanesi.
function td1BirthCheckValid(second: string): boolean {
  return hasValidMrzCheck(second.slice(0, 6), second[6]);
}

function parseRepairedMrz(lines: string[]): IdentityParseResult | null {
  const candidates = lines
    .map((line) => {
      const candidate = mrzCandidate(line);
      // Yalnız normalizasyonun DEĞİŞTİRDİĞİ satırlar; temiz satırlar zaten
      // yukarıdaki pristine dalda değerlendirildi (davranış değişmez).
      return candidate && candidate !== line ? candidate : null;
    })
    .filter((candidate): candidate is string => Boolean(candidate));

  const td3Lines = candidates.filter((line) => line.length === 44).slice(0, 2);
  if (td3Lines.length === 2 && td3CompositeCheckValid(td3Lines[1])) {
    return parseTd3(td3Lines);
  }
  const td1Lines = candidates.filter((line) => line.length === 30).slice(0, 3);
  if (td1Lines.length === 3 && td1BirthCheckValid(td1Lines[1])) {
    return parseTd1(td1Lines);
  }
  return null;
}

// Basılı dal primary: documentType ve dolu alanlar korunur; secondary (MRZ)
// yalnız eksik alanları doldurur (ör. parlamada basılı belge no okunmazsa).
function mergeParsedIdentity(primary: IdentityParseResult, secondary: IdentityParseResult): IdentityParseResult {
  return {
    documentType: primary.documentType,
    rawLines: [...secondary.rawLines, ...primary.rawLines],
    fields: { ...secondary.fields, ...primary.fields },
  };
}

export function hasParsedIdentityFields(result: IdentityParseResult | null | undefined): boolean {
  return Boolean(result && Object.values(result.fields).some((field) => Boolean(field?.value)));
}

export function applyConfirmedIdentityResult(customer: EditableCustomer, result: IdentityParseResult): EditableCustomer {
  const next = { ...customer };
  (Object.entries(result.fields) as Array<[IdentityFieldName, ParsedIdentityField | undefined]>).forEach(([field, parsed]) => {
    if (!parsed?.value) return;
    next[field] = field === 'postal_code' ? parsed.value.replace(/\D/g, '').slice(0, 4) : parsed.value;
  });
  return next;
}

export function normalizeIdentityScannerCapabilities(value: unknown): IdentityScannerCapabilities {
  if (typeof value === 'boolean') return { scanner: value, file: value };
  const record = asRecord(value);
  const supported = record?.supported;
  const scanner = supported === false
    ? false
    : Boolean(record?.wiaAcquisition ?? record?.scanner ?? record?.scanner_available ?? record?.can_scan ?? record?.acquire);
  const file = supported === false
    ? false
    : Boolean(record?.imageFileFallback ?? record?.file ?? record?.file_picker ?? record?.file_picker_available ?? record?.can_pick_file);
  const danishAvailable = record?.ocrDanishAvailable ?? record?.ocr_danish_available;
  const languagesRaw: unknown = record?.ocrAvailableLanguages ?? record?.ocr_available_languages;
  const ocr: IdentityOcrLanguageInfo | undefined = danishAvailable === undefined
    ? undefined
    : {
        danishAvailable: Boolean(danishAvailable),
        profileLanguage: text(record?.ocrProfileLanguage ?? record?.ocr_profile_language),
        availableLanguages: Array.isArray(languagesRaw)
          ? languagesRaw.map((tag) => text(tag)).filter(Boolean)
          : [],
      };
  return { scanner, file, message: text(record?.message) || undefined, ocr };
}

export function extractIdentityScanText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const record = asRecord(value);
  if (!record) return '';
  for (const key of ['raw_text', 'rawText', 'text', 'mrz', 'ocr_text', 'ocrText', 'scan_text', 'scanText']) {
    const candidate = text(record[key]);
    if (candidate) return candidate;
  }
  for (const key of ['scan', 'result', 'data', 'document']) {
    const candidate = extractIdentityScanText(record[key]);
    if (candidate) return candidate;
  }
  return '';
}

export function extractIdentityScanPreview(value: unknown): string {
  const record = asRecord(value);
  if (!record) return '';
  const preview = text(record.previewDataUrl) || text(record.preview_data_url);
  if (preview) return preview;
  for (const key of ['scan', 'result', 'data', 'document']) {
    const candidate = extractIdentityScanPreview(record[key]);
    if (candidate) return candidate;
  }
  return '';
}

export function extractIdentityScanLanguage(value: unknown): string {
  const record = asRecord(value);
  if (!record) return '';
  const language = text(record.ocrLanguage) || text(record.ocr_language);
  if (language) return language;
  for (const key of ['scan', 'result', 'data', 'document']) {
    const candidate = extractIdentityScanLanguage(record[key]);
    if (candidate) return candidate;
  }
  return '';
}

export type IdentityScanImageInfo = {
  language: string;
  scaled?: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  maxImageDimension?: number;
};

function readNumericField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}

// Saha teshisi: hangi dil paketi seçildi, görüntü ölçeklendi mi. Kalıcı
// log YOK — yalnız hook state'i ve hata mesajı.
export function extractIdentityScanImageInfo(value: unknown): IdentityScanImageInfo {
  const record = asRecord(value);
  if (!record) return { language: '' };
  const direct: IdentityScanImageInfo = {
    language: text(record.ocrLanguage) || text(record.ocr_language),
    scaled: typeof record.imageScaled === 'boolean' ? record.imageScaled : typeof record.image_scaled === 'boolean' ? record.image_scaled : undefined,
    sourceWidth: readNumericField(record, ['imageSourceWidth', 'image_source_width']),
    sourceHeight: readNumericField(record, ['imageSourceHeight', 'image_source_height']),
    maxImageDimension: readNumericField(record, ['ocrMaxImageDimension', 'ocr_max_image_dimension']),
  };
  if (direct.language || direct.scaled !== undefined || direct.sourceWidth !== undefined) return direct;
  for (const key of ['scan', 'result', 'data', 'document']) {
    const nested = asRecord(record[key]);
    if (!nested) continue;
    const candidate = extractIdentityScanImageInfo(nested);
    if (candidate.language || candidate.scaled !== undefined || candidate.sourceWidth !== undefined) return candidate;
  }
  return { language: '' };
}

// Tanılamada ham satırlar ASLA düz metin olarak gösterilmez: rakamlar 9'a,
// harfler a'ya maskelenir; «/< ve satır uzunluğu korunur (operatör "MRZ « ile
// gelmiş, 44 karakter" gibi yapısal ipucu görür, kişisel veri görmez).
export function maskIdentityScanDiagnostic(lines: string[]): string {
  return lines
    .slice(0, 8)
    .map((line) => {
      const trimmed = line.trim();
      const masked = trimmed.slice(0, 40).replace(/[^\s«<]/g, (character) => (/\d/.test(character) ? '9' : 'a'));
      return `${masked} (${trimmed.length})`;
    })
    .join('\n');
}

// Saha teshisi (0.3.30): tarama başına atomik özet — PII yok, yalnız yüz, OCR
// dili, satır sayısı, ölçek bilgisi ve DOLU alan anahtarlarının baş
// harfleri. ui-diagnostics.jsonl'e yazılır; OCR satırlarının kendisi asla
// kalıcı yüzeye girmez (GDPR minimizasyonu, maskeli önizleme yalnız ekranda).
export type IdentityScanMeta = {
  side: 'front' | 'back';
  language: string;
  lineCount: number;
  scaled?: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  fieldKeys: string[];
};

const IDENTITY_FIELD_INITIAL: Record<string, string> = {
  name: 'N',
  cpr_number: 'C',
  identity_doc_number: 'D',
  identity_doc_type: 'T',
  identity_doc_country: 'U',
  address: 'A',
  postal_code: 'P',
  city: 'S',
};

export function buildIdentityScanDiagnosticCode(meta: IdentityScanMeta): string {
  const initials = meta.fieldKeys.map((key) => IDENTITY_FIELD_INITIAL[key] ?? 'X').join('');
  const language = (meta.language || 'none').replace(/[^A-Za-z0-9-]/g, '');
  const scaledTag = meta.scaled === undefined ? '' : meta.scaled ? '.S' : '.NS';
  return `idscan.${meta.side}.${language}.${meta.lineCount}L.${meta.fieldKeys.length}F${scaledTag}.${initials || 'none'}`;
}

// Çoklu tarama birleşimi: ÖN YÜZ kanoniktir. Arka yüz taraması (MRZ
// transliterasyonu "SOERENSEN AABERG", kategori legend gürültüsü, ikinci bir
// kartın karışması) ön yüzden gelen doğru dolumları EZMEZ — yalnız eksik
// anahtarları doldurur (basılı Pasnr. okunmadıysa MRZ belge noyu verir,
// tek-pars davranışıyla aynı sözleşme). documentType: bilinen ilk tür kazanır.
export function mergeSideScanResults(
  front: IdentityParseResult | null,
  back: IdentityParseResult | null,
): IdentityParseResult | null {
  const frontKnown = front && front.documentType !== 'unknown' ? front : null;
  const backKnown = back && back.documentType !== 'unknown' ? back : null;
  const primary = frontKnown ?? backKnown;
  if (!primary) return null;
  const secondary = primary === frontKnown ? backKnown : frontKnown;
  return {
    documentType: primary.documentType,
    rawLines: [...(front?.rawLines ?? []), ...(back?.rawLines ?? [])],
    fields: { ...secondary?.fields, ...primary.fields },
  };
}

export function useIdentityScan({
  customer: _customer,
  setCustomer,
  onApplied,
  uiVariant = 'modern',
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onApplied?: () => void;
  uiVariant?: 'classic' | 'modern';
}) {
  const [capabilities, setCapabilities] = useState<IdentityScannerCapabilities>({ scanner: false, file: false });
  const [status, setStatus] = useState<IdentityScanStatus>('checking');
  // Taramalar yüze göre tutulur: aynı yüzün yeniden taraması o yüzün sonucunu
  // günceller (bozuk tarama düzeltilebilir); ön+arka birleşimi kanoniktir.
  const [scanBySide, setScanBySide] = useState<{ front: IdentityParseResult | null; back: IdentityParseResult | null }>({ front: null, back: null });
  const [error, setError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [scanMeta, setScanMeta] = useState<IdentityScanMeta | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<'front' | 'back', string>>>({});
  const result = useMemo(() => mergeSideScanResults(scanBySide.front, scanBySide.back), [scanBySide]);
  const resultRef = useRef(result);
  resultRef.current = result;

  // Danca OCR paketi yoksa sahadan uyarı: profil dili (ör. tr) Danca'yı
  // bozarak okur (Æ→E, Ø→O, Å→Â) — isim/adres alanları hatalı olabilir.
  const ocrNotice = capabilities.ocr && capabilities.ocr.availableLanguages.length > 0 && !capabilities.ocr.danishAvailable
    ? `Danca OCR paketi bulunamadı (${capabilities.ocr.profileLanguage || 'profil dili'} kullanılıyor) — Danca karakterler hatalı okunabilir.`
    : null;

  const refreshCapabilities = useCallback(async () => {
    setStatus('checking');
    setError(null);
    try {
      const next = normalizeIdentityScannerCapabilities(await getIdentityScannerCapabilities());
      setCapabilities(next);
      setStatus(next.scanner || next.file ? 'ready' : 'unavailable');
    } catch {
      setCapabilities({ scanner: false, file: false });
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => { void refreshCapabilities(); }, [refreshCapabilities]);

  const receive = useCallback((value: unknown, side: 'front' | 'back') => {
    const raw = extractIdentityScanText(value);
    const preview = extractIdentityScanPreview(value);
    if (preview) setPreviews((current) => ({ ...current, [side]: preview }));
    const nextResult = parseIdentityScan(raw);
    // Saha teshisi (0.3.30): her tarama — başarılı dahil — maskeli satır
    // önizlemesini ve atomik özeti üretir. Başarılı taramada isim yoksa
    // panel bunu görünür kılar; özet ui-diagnostics.jsonl'e yazılır.
    const rawLines = raw ? raw.split('\n').filter((line) => line.trim()) : [];
    const imageInfo = extractIdentityScanImageInfo(value);
    const filledKeys = nextResult
      ? Object.entries(nextResult.fields).filter(([, field]) => Boolean(field?.value)).map(([key]) => key)
      : [];
    const meta: IdentityScanMeta = {
      side,
      language: imageInfo.language,
      lineCount: rawLines.length,
      scaled: imageInfo.scaled,
      sourceWidth: imageInfo.sourceWidth,
      sourceHeight: imageInfo.sourceHeight,
      fieldKeys: filledKeys,
    };
    setScanMeta(meta);
    setDiagnostic(rawLines.length ? maskIdentityScanDiagnostic(rawLines) : null);
    void writeUiDiagnostic({
      occurredAt: new Date().toISOString(),
      route: '/alis/identity-scan',
      uiVariant,
      frontendBuild: typeof __SERO_FRONTEND_BUILT_AT__ === 'string' ? __SERO_FRONTEND_BUILT_AT__ : 'dev',
      errorCode: buildIdentityScanDiagnosticCode(meta),
    });
    if (!hasParsedIdentityFields(nextResult)) {
      if (!resultRef.current) setPreviews({});
      setStatus((current) => current === 'review' ? 'review' : 'error');
      // R2-04: tek genel mesaj yerine neden sınıfı — OCR metin verdi mi,
      // vermediyse cihaz/görüntü; verdiyse belge türü tanınmadı (hangi türler
      // desteklendiği söylenir). Kısmi MRZ zaten merge ile korunuyor.
      // Saha teshisi: okunan satır sayısı + dil + ölçekleme bilgisi ve
      // maskeli ham satır önizlemesi (yalnız ekranda, kalıcı kayıt yok).
      const detailParts: string[] = [];
      if (imageInfo.language) detailParts.push(`OCR dili ${imageInfo.language}`);
      if (imageInfo.sourceWidth && imageInfo.sourceHeight) {
        detailParts.push(`görüntü ${imageInfo.sourceWidth}×${imageInfo.sourceHeight}${imageInfo.scaled === false ? ' (ölçeklenemedi)' : ''}`);
      }
      const detailSuffix = detailParts.length ? ` — ${detailParts.join(', ')}` : '';
      setError(
        !raw
          ? 'Tarayıcı/görüntü metin döndürmedi — görüntü kalitesini veya cihazı kontrol edin.'
          : `Belge türü tanınamadı (${rawLines.length} satır okundu${detailSuffix}). Desteklenen: pas, ID-kort, kørekort, sundhedskort. Bilgileri elle girebilirsiniz.`,
      );
      return;
    }
    setScanBySide((current) => ({ ...current, [side]: nextResult }));
    setStatus('review');
    setError(null);
  }, [uiVariant]);

  const acquire = useCallback(async (side: 'front' | 'back' = 'front') => {
    if (!capabilities.scanner) return;
    setStatus('acquiring');
    setError(null);
    try {
      receive(await acquireIdentityScan(side), side);
    } catch (scanError) {
      setStatus('ready');
      setError(scanError instanceof Error ? scanError.message : 'Tarayıcı başlatılamadı.');
    }
  }, [capabilities.scanner, receive]);

  const pickFile = useCallback(async (side: 'front' | 'back' = 'front') => {
    if (!capabilities.file) return;
    setStatus('acquiring');
    setError(null);
    try {
      const picked = await pickIdentityScanFile(side);
      if (picked == null) {
        setStatus('ready');
        return;
      }
      receive(picked, side);
    } catch (scanError) {
      setStatus('ready');
      setError(scanError instanceof Error ? scanError.message : 'Kimlik dosyası açılamadı.');
    }
  }, [capabilities.file, receive]);

  // R2-03 — sürükle-bırak: bırakılan görüntü doğrudan OCR akışına girer.
  const dropFile = useCallback(async (file: File, side: 'front' | 'back' = 'front') => {
    if (!capabilities.file) return;
    setStatus('acquiring');
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      let binary = '';
      const view = new Uint8Array(buffer);
      const chunk = 0x8000;
      for (let index = 0; index < view.length; index += chunk) {
        binary += String.fromCharCode(...view.subarray(index, index + chunk));
      }
      receive(await identityScanFromBytes(side, btoa(binary)), side);
    } catch (scanError) {
      setStatus('ready');
      setError(scanError instanceof Error ? scanError.message : 'Kimlik dosyası okunamadı.');
    }
  }, [capabilities.file, receive]);

  const confirm = useCallback(() => {
    if (!result) return;
    setCustomer((current) => applyConfirmedIdentityResult(current, result));
    setScanBySide({ front: null, back: null });
    setPreviews({});
    setScanMeta(null);
    setDiagnostic(null);
    setStatus('applied');
    window.setTimeout(() => onApplied?.(), 0);
  }, [onApplied, result, setCustomer]);

  const clear = useCallback(() => {
    setScanBySide({ front: null, back: null });
    setPreviews({});
    setScanMeta(null);
    setError(null);
    setDiagnostic(null);
    setStatus(capabilities.scanner || capabilities.file ? 'ready' : 'unavailable');
  }, [capabilities.file, capabilities.scanner]);

  return useMemo(() => ({
    capabilities,
    status,
    result,
    previews,
    error,
    diagnostic,
    scanMeta,
    ocrNotice,
    acquire,
    pickFile,
    dropFile,
    confirm,
    clear,
    refreshCapabilities,
  }), [acquire, capabilities, clear, confirm, diagnostic, dropFile, error, ocrNotice, pickFile, previews, refreshCapabilities, result, scanMeta, status]);
}
