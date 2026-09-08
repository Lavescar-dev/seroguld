import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  acquireIdentityScan,
  getIdentityScannerCapabilities,
  identityScanFromBytes,
  onIdentityWatchScan,
  pickIdentityScanFile,
  startIdentityWatch,
  stopIdentityWatch,
  writeUiDiagnostic,
  type IdentityWatchStatus,
} from '@/lib/desktop';
import {
  fetchIdentityExtractCapabilities,
  requestIdentityExtract,
} from '@/lib/identityExtract';

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
  /** Tri-state: false = paket yok, null = bilinmiyor (probe sonucu okunamadı). */
  danishAvailable: boolean | null;
  /** false = probe çalışamadı → "doğrulanamadı" uyarısı (yalnız Windows'ta). */
  probeOk: boolean;
  profileLanguage: string;
  availableLanguages: string[];
};

export type IdentityScannerCapabilities = {
  scanner: boolean;
  file: boolean;
  /** İş 4: klasör izleme (scan-to-folder) yeteneği. */
  watch: boolean;
  platform?: string;
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
  // Gerçek kartlarda değer etiketle AYNI satırda basılır ("1. Testsoy",
  // "5. 30499959") — önce etiketin satır içi kaldığı denenir; sentetik
  // fixture'lardaki ayrı-satır düzeni için ardından alttaki satırlara bakılır.
  const labelLine = lines[start];
  const labelMatch = labelLine.match(label);
  // Yalnız etiket SATIR BAŞINDA olduğunda satır içi değere bakılır ("1. Testsoy");
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
  // Etiket ve sokak aynı satırda basılmışsa ("Adresse: Testgade 1") önce
  // satır içi değere bakılır — boş sokak pencere yanlış satırdan dolmasın.
  const labelMatch = lines[start].match(label);
  if (labelMatch && labelMatch.index === 0) {
    const rest = lines[start]
      .slice(labelMatch[0].length)
      .replace(/^[\s.:·•\-]+/, '')
      .trim();
    if (rest && (/\d/.test(rest) || rest.length > 4)) return rest;
  }
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
// ^AD$: kørekort 2. alanının başlık kelimesi ("2. Ad") — ayırıcı toleransıyla
// değer sanılıp ada yazılmasın (Danca ad = isim).
const IDENTITY_LABEL_WORDS = /NAVN$|^NAVN$|SURNAME|GIVEN NAMES|KOMMUNE|^REGION\b|SUNDHEDSKORT|^DANMARK\b|^ADRESSE\b|^POSTNR|^POSTNUMMER|^CPR\b|^TLF\b|^TELEFON\b|^L[AÆ]GE\b|^GYLDIG\b|^SYGEHUS\b|SYGESIKR|^PERSONNR\b|^F[ØO]EDT\b|^AD$|^EFTERNAVN\b|^FORNAVN\b/;

function isPrintedNamePart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /DANSK|DANISH|DNK\b/.test(trimmed) || IDENTITY_LABEL_WORDS.test(trimmed.toUpperCase())) return false;
  // Gerçek kartlarda ad karışık durumda basılır ("Testkay Denmtr"); sentetik
  // fixture'larda tamamen büyüktür — iki biçim de kabul edilir.
  return PRINTED_NAME_PART.test(trimmed) || PRINTED_NAME_PART.test(trimmed.toUpperCase());
}

// Ad satırı adayı: kenar gürültüsünü kırp (madde imi, nokta, etiket artığı),
// başlık kelimesiyle birleşen satırı ayır, "Soyad, Ad" düzenini "Ad Soyad"a
// çevir. Gerçek kartlarda OCR ad satırının kenarına im/etiket kalıntısı
// bırakabilir — çekirdek harflerle başlayıp harfle biter.
function printedNameCandidate(line: string): string {
  const stripped = line
    .trim()
    .replace(/^[^\p{L}]+/u, '')
    .replace(/[^\p{L}.]+$/u, '')
    .replace(/^sundhedskort\s+/i, '')
    .replace(/^danmark\s+/i, '')
    .replace(/^(?:efternavn|fornavn|fuldt\s+navn|navn)\s*[:\-.]?\s*/i, '')
    .trim();
  if (!stripped) return '';
  const comma = stripped.match(/^(\p{L}[\p{L} .'’-]{0,39}),\s*(\p{L}[\p{L} .'’-]{0,39})$/u);
  return comma ? `${comma[2].trim()} ${comma[1].trim()}` : stripped;
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

// Posta satırındaki şehir artığı: OCR iki fiziksel satırı birleştirdiğinde
// şehirden sonra Tlf./etiket kısaltmaları ve rakamlar eklenir
// ("Testby Tit. 36 78 45 66", 2026-09-08 gerçek kart). Şehir bilinen etiket
// kısaltmasında ya da ilk rakamda kesilir; gerçek şehirler dokunulmaz.
function sanitizeCityValue(value: string): string {
  return value
    .replace(/\s+(?:tlf|tit|tel|tf|tlv)\b.*$/i, '')
    .replace(/\s+\d.*$/, '')
    .replace(/[,;:.]+$/, '')
    .trim();
}

// OCR bilinen etiket kelimelerini bozabilir ("Adresse" → "Athesse", tr-paketi
// P3 fixture'ı) — bozuk tek-kelime etiketler ad sanılıp pencereyi yanlış
// kilitler. Uzunluk ≥6 tek-kelime adaylar bilinen etiket gövdeleriyle 2
// düzenleme mesafesinde karşılaştırılır.
const GARBLED_LABEL_STEMS = ['ADRESSE', 'POSTNR', 'POSTNUMMER', 'NAVN', 'KOMMUNE', 'PERSONNR', 'GYLDIG', 'SYGEHUS', 'CPRNR'];

function editDistanceAtMost2(a: string, b: string): boolean {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
    if (Math.min(...previous) > 2) return false;
  }
  return previous[b.length] <= 2;
}

function looksLikeGarbledLabel(line: string): boolean {
  const word = line.toUpperCase().replace(/[^A-ZÆØÅ]/g, '');
  if (word.length < 6 || word !== line.toUpperCase().trim()) return false;
  return GARBLED_LABEL_STEMS.some((stem) => editDistanceAtMost2(word, stem));
}

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
  // Başlık dikey basılırsa OCR harf-aralıklı yatay metin üretir
  // ("S U N D H E D S K O R T") — boşluklar çöertilerek eşleştirilir.
  const collapsedTitle = upper.replace(/\s+/g, '');
  // Son çare kapısı (c/o + CPR) kimlik belgesi başlıklarında AÇILMAZ: eski-tip
  // kørekort bopælsadresse + c/o taşıyabilir — guard'sız kapı onu yutardı.
  const identityDocTitle = /[KMG][OØ0]E?REKORT|DRIVING\s+LICEN[CS]E|KONGERIGET|PASSPORT|IDENTITETSKORT/.test(upper);
  const isSundhedskort = /SUNDHEDSKORT/.test(upper)
    || /SUNDHEDSKORT/.test(collapsedTitle)
    || /SYGESIKR/.test(upper)
    || (/KOMMUNE/.test(upper) && Boolean(bareCpr))
    || (!identityDocTitle && Boolean(bareCpr) && /(^|\n)\s*c\s*[/\\]\s*o\b/i.test(raw));
  if (isSundhedskort) {
    const labels = [/^\s*navn\b\s*[:.]?/i, /CPR[-\s.]?n/i, /^\s*ad?resse\b\s*[:.]?/i, /r\.?\s*og\s*by/i, /^T[l1i]f|^TM\b|^Tif/i, /^L[æa]ge/i];
    const name = valueAfterLabelLine(lines, /^\s*navn\b\s*[:.]?/i, labels, isPrintedNamePart);
    const cprLine = valueAfterLabelLine(lines, /CPR[-\s.]?n/i, labels, (line) => /\d{6}/.test(line));
    const street = addressValueAfterLabelLine(lines, /^\s*ad?resse\b\s*[:.]?/i, labels);
    const postalLine = valueAfterLabelLine(lines, /r\.?\s*og\s*by/i, labels, (line) => /^\d{4}\s+\S/.test(line));
    const postalMatch = postalLine.match(/^(\d{4})\s+(.+)$/);
    const fields = definedFields([
      ['name', parsedField(name, 'needs_review')],
      // Kartta tam CPR basılıdır; kalıcı yüzeylere YALNIZ ilk 6 hane taşınır.
      ['cpr_number', parsedField(plausibleCprSix(cprLine), 'needs_review')],
      ['address', parsedField(street, 'needs_review')],
      ['postal_code', parsedField(postalMatch?.[1] || '', 'needs_review')],
      ['city', parsedField(sanitizeCityValue(postalMatch?.[2] || ''), 'needs_review')],
    ]);
    // Etiketsiz yeni düzen: ad/sokak/posta bloğu alt alta basılır, etiket yok.
    // Posta satırı (9999 By) çıpaydır; bir üstü sokak, iki üstü addır.
    // Sokak ile ad arasına c/o satırı düşebilir — c/o satırları atlanır ve
    // adrese eklenir ("c/o Jens Jensen, Testgade 1").
    const blockFields = (() => {
      // Posta satırı çıpası: gerçek kartta læge (doktor) bloğu ÜSTTE, hasta
      // bloğu CPR'nin ALTINDADIR. CPR satırı okunduysa onun altındaki İLK
      // posta satırı hastablordur; ilk-posta sezgisi doktorun sokağını adres
      // yazıyordu (2026-09-08 gerçek kart değerlendirmesi). CPR okunmadıysa
      // eski davranış (ilk posta satırı) korunur.
      const postalIndices: number[] = [];
      lines.forEach((line, index) => {
        if (/^\d{4}\s+\S/.test(line.trim())) postalIndices.push(index);
      });
      const cprLineIndex = bareCpr ? lines.findIndex((line) => line.includes(bareCpr)) : -1;
      const postalIndex = postalIndices.find((index) => index > cprLineIndex) ?? postalIndices[0] ?? -1;
      if (postalIndex < 2) return null;
      // Sokak satırı: posta satırının hemen üstü beklenir; ama gerçek OCR
      // çıktısına tek harf/rakam döküntüsü girer ("I", "1813"). Üste doğru en
      // fazla 4 satır tara: rakam + harf taşıyan İLK satır sokaktır. c/o
      // satırları toplanır; ad satırına varıldığında sokak üsttedir, tarama
      // biter (eski tek-satır bakışta adres bu döküntülerde kayboluyordu).
      const streetCareOf: string[] = [];
      let streetLine = '';
      for (let cursor = postalIndex - 1, depth = 0; cursor >= 0 && depth < 4; cursor -= 1, depth += 1) {
        const line = lines[cursor]?.trim() ?? '';
        if (CARE_OF_LINE.test(line)) {
          streetCareOf.unshift(line);
          continue;
        }
        if (/\d/.test(line) && /\p{L}/u.test(line)) {
          streetLine = line;
          break;
        }
        if (line.length <= 2) continue;
        if (printedNameCandidate(line) && isPrintedNamePart(line)) break;
      }
      const careOf: string[] = [];
      // Ad adayı her zaman posta bloğunun iki üstünde değildir: araya CPR/
      // tarih satırı girebilir (gerçek saha kartı), ad satırının kenarında
      // madde imi/etiket kalıntısı olabilir. En fazla 3 satır pencereyle
      // yukarı tara: c/o toplanır, rakam/iman satırları atlanır, etiket
      // satırları (Navn/Adresse/Postnr…) pencereyi kapatmadan atlanır —
      // 0.3.30 saha kartında isim etiketin ÜSTÜNDE kalabiliyordu.
      let nameCandidate = '';
      for (let cursor = postalIndex - 2, depth = 0; cursor >= 0 && depth < 5; cursor -= 1, depth += 1) {
        const line = lines[cursor]?.trim() ?? '';
        if (CARE_OF_LINE.test(line)) {
          careOf.unshift(line);
          continue;
        }
        if (/\d/.test(line) || !/\p{L}/u.test(line) || IDENTITY_NOISE_LINE.test(line)) continue;
        // Tek/iki harflik OCR döküntüsü ("I", "er") pencereyi kırmasın:
        // gerçek kartta posta satırı ile ad arasına düşer (2026-09-08).
        if (line.length <= 2) continue;
        if (looksLikeGarbledLabel(line)) continue;
        const candidate = printedNameCandidate(line);
        if (candidate && isPrintedNamePart(candidate)) {
          nameCandidate = candidate;
          break;
        }
        if (IDENTITY_LABEL_WORDS.test(line.toUpperCase())) continue;
        break;
      }
      const blockPostal = lines[postalIndex].trim().match(/^(\d{4})\s+(.+)$/);
      const blockAddress = [...new Set([...careOf, ...streetCareOf, streetLine].filter(Boolean))].join(', ');
      return definedFields([
        ['name', nameCandidate ? parsedField(nameCandidate, 'needs_review') : undefined],
        ['address', blockAddress ? parsedField(blockAddress, 'needs_review') : undefined],
        ['postal_code', parsedField(blockPostal?.[1] || '', 'needs_review')],
        ['city', parsedField(sanitizeCityValue(blockPostal?.[2] || ''), 'needs_review')],
        ['cpr_number', parsedField(plausibleCprSix(bareCpr), 'needs_review')],
      ]);
    })();
    if (Object.keys(fields).length) {
      // B1 (0.3.30 saha imzası): etiketli diğer alanlar dolup yalnız isim
      // okunmazsa erken dönme YOK — blok penceresi ismi kurtarır. Merge yönü
      // labeled kazanır: blok adayı etiketli değerleri asla ezmez.
      return { documentType: 'health_card', rawLines: lines, fields: { ...blockFields, ...fields } };
    }
    if (blockFields && Object.keys(blockFields).length) return { documentType: 'health_card', rawLines: lines, fields: blockFields };
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

  // Dansk kørekort: numaralı etiketler ve değerler aynı satırda ("1. Testsoy");
  // tr-paketi başlığı bozabilir (MOREKORT) — [KMG] toleransı; Ø bazı
  // motorlarda OE diye translitre okunur (KOEREKORT) — E? toleransı.
  // 4d = personnummer.
  if (/[KMG][OØ0]E?REKORT/.test(upper)) {
    // 1/2 etiketleri ayırıcı-toleranslı: OCR "1. Testsoy"in noktasını yutarak
    // "1 Testsoy" üretebilir. (?!\d) 1981-03-14 (3. alan) ve 12. (betingelser)
    // gibi sayısal satırların etiket sanılmasını engeller.
    const surnameLabel = /^1(?!\d)\s*[.:]?\s*/;
    const givenLabel = /^2(?!\d)\s*[.:]?\s*/;
    const labels = [surnameLabel, givenLabel, /^3[.:]/, /^4a[.:]/i, /^4b[.:]/i, /^4c[.:]/i, /^5[.:]/, /^8[.:]/, /^9[.:]/, /^12[.:]/];
    let surname = valueAfterLabelLine(lines, surnameLabel, labels, isPrintedNamePart);
    let givenName = valueAfterLabelLine(lines, givenLabel, labels, isPrintedNamePart);
    // Birleşik form: OCR iki fiziksel satırı tek satıra bindirebilir
    // ("1. Testove 2. TESTSEN" — hatta arkasından 3. tarih). 1 = soyad,
    // 2 = ad kurallı; her parça isim-şeklinde olmak zorundadır (başlık
    // kelimesi Efternavn/Ad parça olarak da kabul edilmez).
    if (!surname || !givenName) {
      for (const line of lines) {
        const combined = line.match(/^\s*1(?!\d)\s*[.:]?\s*(\p{L}[\p{L} .'’-]{0,39}?)\s+2\s*[.:]?\s*(\p{L}[\p{L} .'’-]{1,39}?)(?=\s*,?\s*(?:3(?!\d)|$))/u);
        if (!combined) continue;
        const surnamePart = combined[1].trim();
        const givenPart = combined[2].trim();
        if (!isPrintedNamePart(surnamePart) || !isPrintedNamePart(givenPart)) continue;
        if (!surname) surname = surnamePart;
        if (!givenName) givenName = givenPart;
        break;
      }
    }
    // Tek-satır blok tamamlama: 1./2. önekleri tamamen yutulmuşsa ve kardeş
    // isim satırı yoksa (ya da isim-şeklinde değilse), 3. (doğum tarihi)
    // satırına komşu TEK isim-şeklinde satır kabul edilir. Slot, kart
    // düzeninden gelir: 2 = ad (tarihin hemen üstü), 1 = soyad (bir üstü).
    if (!surname || !givenName) {
      const licenseDateIndex = (() => {
        const labeled = lines.findIndex((line) => /^3(?!\d)\s*[.:]?\s*/.test(line) && /\d{4}/.test(line));
        if (labeled >= 0) return labeled;
        // Etiket öneki bozuk okunduğunda tarih deseni çıpa olur
        // ("3. 1981-03-14, Tyrkiet" → "1981-03-14," / "2012.05-09").
        return lines.findIndex((line) => /\d{4}[-.]\d{2}[-.]\d{2}/.test(line) || /\d{2}[-.]\d{2}[-.]\d{2}(?!\d)/.test(line));
      })();
      // Yukarı doğru taramada başlık/gürültü/döküntü satırları atlanır;
      // bulunan her isim adayı sıradaki slota yazılır (bilinen slota eşit
      // aday atlanır — çift-yazım yok).
      const normalizeSlot = (value: string) => value
        .toUpperCase()
        .replace(/Æ/g, 'AE')
        .replace(/Ø/g, 'OE')
        .replace(/Å/g, 'AA')
        .replace(/[^A-Z ]/g, '')
        .trim();
      const knownSlots = [surname, givenName].filter(Boolean).map(normalizeSlot);
      let slot = 2; // tarihe komşu aday 2 (ad), sonraki 1 (soyad)
      for (let cursor = licenseDateIndex - 1, depth = 0; cursor >= 0 && depth < 4 && (!surname || !givenName); cursor -= 1, depth += 1) {
        const line = lines[cursor]?.trim() ?? '';
        if (!line || /\d/.test(line) || !/\p{L}/u.test(line)) continue;
        if (/^[KMG][OØ0]E?REKORT/i.test(line) || IDENTITY_NOISE_LINE.test(line) || looksLikeGarbledLabel(line)) continue;
        const candidate = printedNameCandidate(line);
        if (!candidate || !isPrintedNamePart(candidate)) continue;
        if (knownSlots.includes(normalizeSlot(candidate))) continue;
        if (slot === 2 && !givenName) {
          givenName = candidate;
        } else if (!surname) {
          surname = candidate;
        }
        knownSlots.push(normalizeSlot(candidate));
        slot = 1;
      }
    }
    // tr-OCR numara öneklerini yutabilir ("1. Testsoy" → "Testsoy") ve başlığın
    // altındaki değer satırlarını etiketsiz bırakabilir (gerçek saha
    // fotoğrafı: KOREKORT / Testsoy / 21 / Testkay / 1981-03-14 …). Etiket yolu
    // ALANLARDAN BİRİNİ bile bulamadıysa başlık sonrasındaki basılı isim
    // satırları eksik slota tamamlanır — bilinen slota eşit aday atlanır
    // (çift-yazım yok), kalan sırayla soyad/ad alınır.
    if (!surname || !givenName) {
      const blockNames = lines
        .filter((line) => {
          const trimmed = line.trim();
          if (/^[KMG][OØ0]E?REKORT/i.test(trimmed) || IDENTITY_NOISE_LINE.test(trimmed)) return false;
          return isPrintedNamePart(trimmed);
        })
        .slice(0, 2);
      const knownSlots = [surname, givenName]
        .filter(Boolean)
        .map((value) => value.toUpperCase().replace(/Æ/g, 'AE').replace(/Ø/g, 'OE').replace(/Å/g, 'AA').replace(/[^A-Z ]/g, '').trim());
      const remaining = blockNames.filter((candidate) => !knownSlots.includes(candidate.toUpperCase().replace(/Æ/g, 'AE').replace(/Ø/g, 'OE').replace(/Å/g, 'AA').replace(/[^A-Z ]/g, '').trim()));
      if (!surname) surname = remaining.shift() ?? '';
      if (!givenName) givenName = remaining.shift() ?? '';
    }
    const documentNumber = valueAfterLabelLine(lines, /^5[.:]/, labels, (line) => /^[A-Z]{0,3}\d{6,}$/.test(line.trim()))
      || (lines.find((line) => /^\d{8,9}$/.test(line.trim()))?.trim() ?? '')
      // da-motor '-5. . 20984713' gibi önek gürültüsü bırakabilir; satır
      // içinde bağımsız 8-9 haneli sayı (tarih/CPR parçası olmayan) belge no
      // adayıdır — tarih (4+2+2) ve CPR (6+4) desenleri 8-9 bitişik hane
      // üretmediğinden yanlış pozitif oluşmaz.
      || (lines.map((line) => line.match(/(?<![\d-])\d{8,9}(?!\d)/)?.[0]).find(Boolean) ?? '');
    // Kørekort CPR'si 4d alanındadır ("4d. 010190-1234"); tarihlerden ayrışır
    // (tarihler 4+2+2 hanedir, CPR 6+4). tr-OCR '4d.' önekini '48.' olarak
    // okuyabilir (d→8) — 4[db8] toleransı; 4b'deki tarih 4+2+2 düzeni
    // yüzünden 6+4 desenine asla uymaz, yanlış pozitif oluşmaz. Gerçek OCR
    // ayraç bozukluğu ("010190- 1234") [-\s]{0,2} ile tolere edilir; etiket
    // öneki tamamen bozuk okunduğunda ("åd. 010190- 1234", 2026-09-08 gerçek
    // kart) gövdedeki bağımsız 6+4 düzeni yedektir — 8-9 bitişik belge no ve
    // 4+2+2 tarihler bu deseni üretemez, plausibility kapısı uydurmayı eler.
    const cprRaw = raw.match(/4[db8]\s*[.:]?\s*(\d{6}[-\s]{0,2}\d{4})/i)?.[1]
      ?? raw.match(/(?<![\d-])(\d{6}[-\s]{0,2}\d{4})(?!\d)/i)?.[1]
      ?? '';
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
  // (raw_ocr_tr.json: "2010000337 D N K 8611172 M 3103142 « « «"). Artıklardan
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
// R1-B: VLM birleşiminde de aynı sözleşme — primary=VLM, secondary=yerel
// regex zinciri (fallback asla silinmez, eksik alanı o doldurur).
export function mergeParsedIdentity(primary: IdentityParseResult, secondary: IdentityParseResult): IdentityParseResult {
  return {
    documentType: primary.documentType,
    rawLines: [...secondary.rawLines, ...primary.rawLines],
    fields: { ...secondary.fields, ...primary.fields },
  };
}

export function hasParsedIdentityFields(result: IdentityParseResult | null | undefined): boolean {
  return Boolean(result && Object.values(result.fields).some((field) => Boolean(field?.value)));
}

// ---- R1-B: VLM çıkarım yanıtını yerel parse sözleşmesine eşleme -------------
//
// Backend /alis/identity/extract yanıtındaki alanlar (app/schemas/identity.py)
// IdentityParseResult'a çevrilir. Kritik kural: CPR burada KIRPILMAZ — backend
// barkod+doğrulamadan geçmiş tam 10 haneyi verir; 6'ya kırpmak R1-C'nin
// amacını bozar. plausibleCprSix kırpması yalnız yerel regex dalında kalır.
// birth_date/expiry_date EditableCustomer alanı olmadığından düşürülür.

function identityDocumentTypeFromExtract(
  documentType: string | null,
  fields: Partial<Record<IdentityFieldName, ParsedIdentityField>>,
): IdentityParseResult['documentType'] {
  switch (documentType) {
    case 'sundhedskort':
      return 'health_card';
    case 'passport':
    case 'driver_license':
    case 'id_card':
      return documentType;
    case 'residence_permit':
      // Oturum izni kimlik kartı ailesindedir (canonical seçim için tür
      // bilinmelidir); belge türü DEĞERİ yazılmaz — aşağıda yalnız üç bilinen
      // enum yazılır.
      return 'id_card';
    default:
      // other/null: tür söylenmemişse dolu alanlardan sınıfla — belge no varsa
      // kimlik kartı, yoksa ad/CPR bloğu sundhedskort düzenidir. Bu yalnız
      // yüzey birleşiminde canonical seçim içindir.
      return fields.identity_doc_number?.value ? 'id_card' : 'health_card';
  }
}

export function identityParseResultFromExtract(payload: {
  document_type: string | null;
  fields: Record<string, { value: string; review?: string }>;
}): IdentityParseResult {
  const extractFields = payload.fields ?? {};
  const readField = (key: string): ParsedIdentityField | undefined => {
    const entry = extractFields[key];
    const value = typeof entry?.value === 'string' ? entry.value.trim() : '';
    if (!value) return undefined;
    return { value, review: entry.review === 'validated' ? 'validated' : 'needs_review' };
  };
  const fields = definedFields([
    ['name', readField('full_name')],
    // Tam 10 hane korunur (barkod/doğrulama kaynaklı; kırpma YOK).
    ['cpr_number', readField('cpr_number')],
    ['address', readField('address')],
    ['postal_code', parsedField((readField('postal_code')?.value ?? '').replace(/\D/g, '').slice(0, 4), 'needs_review')],
    ['city', readField('city')],
    ['identity_doc_number', readField('doc_number')],
    // Sundhedskort kimlik belgesi değildir — yerel daldaki kural aynen korunur.
    ['identity_doc_type', ['passport', 'driver_license', 'id_card'].includes(payload.document_type ?? '')
      ? { value: payload.document_type as string, review: 'validated' as const }
      : undefined],
    ['identity_doc_country', parsedField(normalizeCountry(readField('country')?.value ?? ''), 'needs_review')],
  ]);
  return {
    documentType: identityDocumentTypeFromExtract(payload.document_type, fields),
    rawLines: [],
    fields,
  };
}

// OCR'ın sahiplendiği alanlar iki gruptur: belge kimliği ve kişi+adres. Yeni
// belge bir gruptan EN AZ BİR alan dolduruyorsa o grup, birleştirmeden önce
// sıfırlanır — aksi halde yeniden taramada eski belgenin okunamayan alanları
// kalıntı olarak kalıyordu ("üst üste biniyor", 0.3.36 saha bildirimi).
// Sundhedskort kimlik belgesi değildir ve kimlik grubuna hiç yazmaz; bu yüzden
// pas → sundhedskort akışı (kimlik belgesi + adres belgesi) bozulmaz.
const IDENTITY_DOCUMENT_FIELDS: IdentityFieldName[] = ['identity_doc_number', 'identity_doc_type', 'identity_doc_country'];
const IDENTITY_PERSON_FIELDS: IdentityFieldName[] = ['name', 'cpr_number', 'address', 'postal_code', 'city'];

export function applyConfirmedIdentityResult(customer: EditableCustomer, result: IdentityParseResult): EditableCustomer {
  const next = { ...customer };
  const filledFields = new Set(
    (Object.entries(result.fields) as Array<[IdentityFieldName, ParsedIdentityField | undefined]>)
      .filter(([, parsed]) => Boolean(parsed?.value))
      .map(([field]) => field),
  );
  for (const group of [IDENTITY_DOCUMENT_FIELDS, IDENTITY_PERSON_FIELDS]) {
    if (!group.some((field) => filledFields.has(field))) continue;
    group.forEach((field) => {
      next[field] = '';
    });
  }
  (Object.entries(result.fields) as Array<[IdentityFieldName, ParsedIdentityField | undefined]>).forEach(([field, parsed]) => {
    if (!parsed?.value) return;
    next[field] = field === 'postal_code' ? parsed.value.replace(/\D/g, '').slice(0, 4) : parsed.value;
  });
  return next;
}

export function normalizeIdentityScannerCapabilities(value: unknown): IdentityScannerCapabilities {
  if (typeof value === 'boolean') return { scanner: value, file: value, watch: value, platform: '' };
  const record = asRecord(value);
  const supported = record?.supported;
  const scanner = supported === false
    ? false
    : Boolean(record?.wiaAcquisition ?? record?.scanner ?? record?.scanner_available ?? record?.can_scan ?? record?.acquire);
  const file = supported === false
    ? false
    : Boolean(record?.imageFileFallback ?? record?.file ?? record?.file_picker ?? record?.file_picker_available ?? record?.can_pick_file);
  const watch = supported === false
    ? false
    : Boolean(record?.watchFolder ?? record?.watch_folder);
  // Rust Option<bool> → null: `??` null'u snake_case yedeğine düşürür; önce
  // anahtar varlığına bakılır (null = bilinmiyor, tri-state korunur).
  const rawDanish = record && 'ocrDanishAvailable' in record ? record.ocrDanishAvailable : record?.ocr_danish_available;
  const rawProbeOk = record && 'ocrProbeOk' in record ? record.ocrProbeOk : record?.ocr_probe_ok;
  const danishAvailable = typeof rawDanish === 'boolean' ? rawDanish : rawDanish === undefined ? undefined : null;
  // Eski payload'larda probe alanı yoktur: danishAvailable biliniyorsa probe
  // çalışmış sayılır (geriye dönük uyum).
  const probeOk = rawProbeOk === undefined || rawProbeOk === null ? danishAvailable !== undefined && danishAvailable !== null : Boolean(rawProbeOk);
  const languagesRaw: unknown = record?.ocrAvailableLanguages ?? record?.ocr_available_languages;
  const ocr: IdentityOcrLanguageInfo | undefined = danishAvailable === undefined && rawProbeOk === undefined
    ? undefined
    : {
        danishAvailable: danishAvailable ?? null,
        probeOk,
        profileLanguage: text(record?.ocrProfileLanguage ?? record?.ocr_profile_language),
        availableLanguages: Array.isArray(languagesRaw)
          ? languagesRaw.map((tag) => text(tag)).filter(Boolean)
          : [],
      };
  return {
    scanner,
    file,
    watch,
    platform: text(record?.platform),
    message: text(record?.message) || undefined,
    ocr,
  };
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

// Düşük çözünürlük eşiği: saha taraması 419×288 geldiğinde OCR 9 çöp satır
// okuyup hiçbir alan tutmadı — kök neden DPI (WIA varsayılanı ~125). Parse
// başarısızsa ve görüntü bu eşiğin altındaysa genel "belge türü tanınamadı"
// metni yerine DPI/çekim yönlendirmesi verilir.
const IDENTITY_LOW_RES_MIN_WIDTH = 600;
const IDENTITY_LOW_RES_MIN_HEIGHT = 400;

export function isLowResolutionIdentityImage(width?: number, height?: number): boolean {
  return (width !== undefined && width < IDENTITY_LOW_RES_MIN_WIDTH) || (height !== undefined && height < IDENTITY_LOW_RES_MIN_HEIGHT);
}

// Yönlendirme metni: paneller identity.error'ı aynen gösterir; null = düşük
// çözünürlük değil (ya da boyut bilinmiyor).
export function describeLowResIdentityScan(width?: number, height?: number): string | null {
  if (!isLowResolutionIdentityImage(width, height)) return null;
  const dimensions = width !== undefined && height !== undefined ? ` (${width}×${height})` : '';
  return `Görüntü çok düşük çözünürlüklü${dimensions}. Tarayıcıyı 300 DPI'ya alin veya kart fotoğrafini yakinden cekin.`;
}

// Düşük çözünürlük hata imzası — buildIdentityScanDiagnosticCode ile aynı
// idscan.* ailesinden ve aynı ascii-atom kısıtında (Rust validate_ui_diagnostic
// safe_atom: alfanumerik + -_.:+, en fazla 64 karakter).
export function buildIdentityScanLowResCode(width?: number, height?: number): string {
  return width !== undefined && height !== undefined ? `idscan.lowres.${width}x${height}` : 'idscan.lowres';
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

// İş 4 — tarayıcı hata kodlarının UI ayrımı (pure). Köprü hatası ya da hata
// payload'ı şeklinde gelen nesneyi {code, message} olarak açıklar:
// SCAN_CANCELLED sessizdir (kullanıcı iptali hata değildir) → null.
// Bilinen teşhis kodlarına saha metni (cihaz açık/ağda mı, WIA sürücüsü,
// Epson profili JPEG+tek sayfa) bağlanır; diğerleri Rust mesajını korur.
export type DescribedScannerError = { code: string; message: string };

export function describeScannerError(error: unknown): DescribedScannerError | null {
  const record = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : null;
  const code = typeof record?.code === 'string' && record.code ? record.code : 'INTERNAL_ERROR';
  if (code === 'SCAN_CANCELLED') return null;
  const hints: Record<string, string> = {
    SCANNER_UNAVAILABLE:
      'Tarayıcı bulunamadı. Cihazın açık ve aynı ağda olduğundan, Windows’ta WIA tarayıcı sürücüsünün kurulu olduğundan emin olun (Epson ET-3850 kurulumu için kimlik tarayıcı runbook’una bakın). Cihaz WIA üzerinden cevap vermiyorsa tarayıcının “klasöre tara” profilini kullanıp “Klasörden” izlemesini başlatın.',
    INVALID_IMAGE:
      'Görüntü okunamadı. Epson tarayıcı profilinde çıktı biçimi JPEG, tek sayfa ve yaklaşık 300 dpi olacak şekilde ayarlayın; PDF ve çok sayfalı taramalar desteklenmez.',
    WATCH_FOLDER_UNAVAILABLE:
      'İzlenecek klasör açılamadı — klasör yolunun geçerli ve erişilebilir olduğundan emin olun.',
    WATCH_ALREADY_ACTIVE: 'Klasör izleme zaten açık — önce durdurun.',
  };
  const fallback = typeof record?.message === 'string' && record.message.trim() ? record.message : 'Tarama başarısız oldu.';
  return { code, message: hints[code] ?? fallback };
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
  const [capabilities, setCapabilities] = useState<IdentityScannerCapabilities>({ scanner: false, file: false, watch: false });
  const [status, setStatus] = useState<IdentityScanStatus>('checking');
  // Taramalar yüze göre tutulur: aynı yüzün yeniden taraması o yüzün sonucunu
  // günceller (bozuk tarama düzeltilebilir); ön+arka birleşimi kanoniktir.
  const [scanBySide, setScanBySide] = useState<{ front: IdentityParseResult | null; back: IdentityParseResult | null }>({ front: null, back: null });
  const [error, setError] = useState<string | null>(null);
  // İş 4: hata kodu UI'da ayrışır — mesajın yanında teşhis kodu da gösterilir
  // (exit 3 = cihaz yok ≠ iptal karışmasın).
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [scanMeta, setScanMeta] = useState<IdentityScanMeta | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<'front' | 'back', string>>>({});
  // Klasör izleme durumu (rozet); null = hiç sorgulanmadı / destek yok.
  const [watchStatus, setWatchStatus] = useState<IdentityWatchStatus | null>(null);
  // R1-B: VLM katmanı (backend flag'i) — kapalıysa akış yalnız yerel OCR
  // zinciriyle çalışır, davranış bugüne kadar aynıdır. Hata durumunda regex
  // sonucu ekranda kalır ve operatör GÖRÜNÜR uyarılır (sessiz kalite kaybı yok).
  const [vlmNotice, setVlmNotice] = useState<string | null>(null);
  const vlmEnabledRef = useRef(false);
  // Uçuşta VLM yanıtının eski taramaya yazılmasını kesen sıra: her receive,
  // confirm ve clear bir sonrakini geçersiz kılar.
  const vlmSeqRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    void fetchIdentityExtractCapabilities()
      .then((extractCaps) => {
        if (!disposed) vlmEnabledRef.current = extractCaps.extract_enabled;
      })
      .catch(() => {
        // Yetenek sorgusu başarısız = VLM yok sayılır; yerel zincir çalışır.
        // Sessiz geçilir çünkü VLM opsiyonel bir üst katmandır.
      });
    return () => {
      disposed = true;
    };
  }, []);
  const result = useMemo(() => mergeSideScanResults(scanBySide.front, scanBySide.back), [scanBySide]);
  const resultRef = useRef(result);
  resultRef.current = result;
  // Yüz-başına son sonuç: yeniden taramada karşı yüzün eskime denetimi için.
  const scanBySideRef = useRef(scanBySide);
  scanBySideRef.current = scanBySide;

  // Danca OCR paketi uyarısı — iki yol:
  // 1) probe çalıştı ve paket yok: kurulum mesajı (profil dili Danca'yı
  //    bozarak okur: Æ→E, Ø→O, Å→Â — isim/adres alanları hatalı olabilir).
  // 2) probe çalışamadı (tri-state bilinmiyor): eski çift kilit uyarıyı
  //    bastırıyordu; artık saha "doğrulanamadı" mesajı + log yolu görür.
  //    Yalnız Windows'ta: diğer platformlarda OCR hattı ilgisizdir.
  const ocrInfo = capabilities.ocr;
  const ocrNotice = !ocrInfo
    ? null
    : ocrInfo.probeOk && ocrInfo.danishAvailable === false
      ? `Danca OCR paketi bulunamadı (${ocrInfo.profileLanguage || 'profil dili'} kullanılıyor) — Danca karakterler hatalı okunabilir.`
      : !ocrInfo.probeOk && capabilities.platform === 'windows'
        ? 'Danca OCR paketi doğrulanamadı — tarama hatalı çıkabilir; %APPDATA%\\dk.seroguld.crm\\logs\\ui-diagnostics.jsonl kodunu iletin.'
        : null;

  // Ortak hata bildirimi: describeScannerError iptali sessizce yutar (null),
  // diğerlerini teşhis kodu + saha metniyle state'e yazar. true = hata gösterildi.
  const reportScanError = useCallback((scanError: unknown) => {
    const described = describeScannerError(scanError);
    if (!described) return false;
    setError(described.message);
    setErrorCode(described.code);
    return true;
  }, []);

  const refreshCapabilities = useCallback(async () => {
    setStatus('checking');
    setError(null);
    try {
      const next = normalizeIdentityScannerCapabilities(await getIdentityScannerCapabilities());
      setCapabilities(next);
      setStatus(next.scanner || next.file ? 'ready' : 'unavailable');
    } catch {
      setCapabilities({ scanner: false, file: false, watch: false });
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
      // Düşük çözünürlük kendi sınıfıdır: kök neden DPI (WIA varsayılanı
      // ~125) — genel "tanınamadı" metni yerine DPI/çekim yönlendirmesi.
      const lowResMessage = describeLowResIdentityScan(imageInfo.sourceWidth, imageInfo.sourceHeight);
      const detailParts: string[] = [];
      if (imageInfo.language) detailParts.push(`OCR dili ${imageInfo.language}`);
      if (imageInfo.sourceWidth && imageInfo.sourceHeight) {
        detailParts.push(`görüntü ${imageInfo.sourceWidth}×${imageInfo.sourceHeight}${imageInfo.scaled === false ? ' (ölçeklenemedi)' : ''}`);
      }
      const detailSuffix = detailParts.length ? ` — ${detailParts.join(', ')}` : '';
      setError(
        lowResMessage
          || (!raw
            ? 'Tarayıcı/görüntü metin döndürmedi — görüntü kalitesini veya cihazı kontrol edin.'
            : `Belge türü tanınamadı (${rawLines.length} satır okundu${detailSuffix}). Desteklenen: pas, ID-kort, kørekort, sundhedskort. Bilgileri elle girebilirsiniz.`),
      );
      // Başarısız taramada önceki taramanın hata kodu taşınmasın; düşük
      // çözünürlükte imza kodu gösterilir (destek talebinde kopyalanır).
      setErrorCode(lowResMessage ? buildIdentityScanLowResCode(imageInfo.sourceWidth, imageInfo.sourceHeight) : null);
      return;
    }
    // Yeniden tarama hijyeni: aynı yüze FARKLI TÜRDE bir belge düştüyse karşı
    // yüzün sonucu eski belgeye aittir — birleşim iki belgeyi karıştırırdı.
    // id_card ön+arka bilinçli akışı aynı türde kaldığı için bozulmaz.
    const otherSide: 'front' | 'back' = side === 'front' ? 'back' : 'front';
    const otherResult = scanBySideRef.current[otherSide];
    const oppositeStale = nextResult.documentType !== 'unknown'
      && otherResult !== null
      && otherResult.documentType !== 'unknown'
      && otherResult.documentType !== nextResult.documentType;
    setScanBySide((current) => {
      const next: { front: IdentityParseResult | null; back: IdentityParseResult | null } = { ...current, [side]: nextResult };
      if (oppositeStale) next[otherSide] = null;
      return next;
    });
    if (oppositeStale) {
      setPreviews((current) => {
        const next = { ...current };
        delete next[otherSide];
        return next;
      });
    }
    setStatus('review');
    setError(null);
    // R1-B motor seçimi: yerel regex sonucu zaten ekranda; VLM flag'i açık ve
    // görüntü önizlemesi varsa arka planda çıkarım isteği atılır. Yanıt
    // gelince VLM birincil, regex eksik-doldurucu birleşir (mergeParsedIdentity);
    // hata yerel sonucu ASLA ezmez — sadece görünür uyarı üretir.
    if (vlmEnabledRef.current && preview) {
      const seq = (vlmSeqRef.current += 1);
      void requestIdentityExtract(preview, side)
        .then((payload) => {
          if (seq !== vlmSeqRef.current) return;
          const vlmResult = identityParseResultFromExtract(payload);
          const merged = hasParsedIdentityFields(vlmResult) ? mergeParsedIdentity(vlmResult, nextResult) : nextResult;
          setScanBySide((current) => ({ ...current, [side]: merged }));
          setVlmNotice(null);
        })
        .catch(() => {
          if (seq !== vlmSeqRef.current) return;
          setVlmNotice('VLM doğrulaması yanıt vermedi — yerel OCR sonucu gösteriliyor, alanları kontrol edin.');
        });
    }
  }, [uiVariant]);

  const acquire = useCallback(async (side: 'front' | 'back' = 'front') => {
    if (!capabilities.scanner) return;
    setStatus('acquiring');
    setError(null);
    setErrorCode(null);
    try {
      receive(await acquireIdentityScan(side), side);
    } catch (scanError) {
      setStatus('ready');
      // İptal (SCAN_CANCELLED) sessiz: describeScannerError null döner, mesaj kalmaz.
      reportScanError(scanError);
    }
  }, [capabilities.scanner, receive, reportScanError]);

  const pickFile = useCallback(async (side: 'front' | 'back' = 'front') => {
    if (!capabilities.file) return;
    setStatus('acquiring');
    setError(null);
    setErrorCode(null);
    try {
      const picked = await pickIdentityScanFile(side);
      if (picked == null) {
        setStatus('ready');
        return;
      }
      receive(picked, side);
    } catch (scanError) {
      setStatus('ready');
      reportScanError(scanError);
    }
  }, [capabilities.file, receive, reportScanError]);

  // R2-03 — sürükle-bırak: bırakılan görüntü doğrudan OCR akışına girer.
  const dropFile = useCallback(async (file: File, side: 'front' | 'back' = 'front') => {
    if (!capabilities.file) return;
    setStatus('acquiring');
    setError(null);
    setErrorCode(null);
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
      reportScanError(scanError);
    }
  }, [capabilities.file, receive, reportScanError]);

  // İş 4 — klasör izleme: Epson "klasöre tara" profilinin yazdığı klasörü
  // izler; düşen görüntü mevcut receive() hattına girer (yeni parse YOK).
  const startWatch = useCallback(async (side: 'front' | 'back' = 'front', folder?: string) => {
    if (!capabilities.watch) return;
    setError(null);
    setErrorCode(null);
    try {
      setWatchStatus(await startIdentityWatch(side, folder));
    } catch (watchError) {
      reportScanError(watchError);
    }
  }, [capabilities.watch, reportScanError]);

  const stopWatch = useCallback(async () => {
    try {
      setWatchStatus(await stopIdentityWatch());
    } catch {
      // Durdurma hatası parazit etmesin; bir sonraki durum sorgusu düzeltir.
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: () => void = () => undefined;
    // Promise zinciri içinde çağır: masaüstü köprüsü yoksa (kısmen mock'lanmış
    // test ortamları) hata zincire düşer ve sessizce yutulur.
    void Promise.resolve()
      .then(() =>
        onIdentityWatchScan(
          (result) => receive(result, result.side === 'back' ? 'back' : 'front'),
          (errorPayload) => { reportScanError(errorPayload); },
        ),
      )
      .then((unsubscribeFn) => {
        if (disposed) unsubscribeFn();
        else unsubscribe = unsubscribeFn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [receive, reportScanError]);

  const confirm = useCallback(() => {
    if (!result) return;
    // Uçuştaki VLM yanıtı artık eskidir — onaylanan sonuç yazıldı.
    vlmSeqRef.current += 1;
    setCustomer((current) => applyConfirmedIdentityResult(current, result));
    setScanBySide({ front: null, back: null });
    setPreviews({});
    setScanMeta(null);
    setDiagnostic(null);
    setStatus('applied');
    window.setTimeout(() => onApplied?.(), 0);
  }, [onApplied, result, setCustomer]);

  const clear = useCallback(() => {
    vlmSeqRef.current += 1; // uçuştaki VLM yanıtı temizlenen taramaya yazmasın
    setScanBySide({ front: null, back: null });
    setPreviews({});
    setScanMeta(null);
    setError(null);
    setErrorCode(null);
    setVlmNotice(null);
    setDiagnostic(null);
    setStatus(capabilities.scanner || capabilities.file ? 'ready' : 'unavailable');
    // Klasör izleme oturumu bilinçli olarak durmaz: temizleme yalnız tarama
    // sonuçlarını sıfırlar, izleme ayrı yaşam döngüsündedir.
  }, [capabilities.file, capabilities.scanner]);

  return useMemo(() => ({
    capabilities,
    status,
    result,
    previews,
    error,
    errorCode,
    diagnostic,
    scanMeta,
    ocrNotice,
    vlmNotice,
    watchStatus,
    acquire,
    pickFile,
    dropFile,
    startWatch,
    stopWatch,
    confirm,
    clear,
    refreshCapabilities,
  }), [acquire, capabilities, clear, confirm, diagnostic, dropFile, error, errorCode, ocrNotice, pickFile, previews, refreshCapabilities, result, scanMeta, startWatch, status, stopWatch, vlmNotice, watchStatus]);
}
