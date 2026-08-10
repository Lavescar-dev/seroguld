import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  acquireIdentityScan,
  getIdentityScannerCapabilities,
  pickIdentityScanFile,
} from '@/lib/desktop';

import type { EditableCustomer } from './types';

export type IdentityFieldName = 'name' | 'identity_doc_number' | 'identity_doc_type' | 'identity_doc_country' | 'address' | 'postal_code' | 'city';
export type IdentityFieldReview = 'validated' | 'needs_review';

export type ParsedIdentityField = {
  value: string;
  review: IdentityFieldReview;
};

export type IdentityParseResult = {
  documentType: 'passport' | 'id_card' | 'driver_license' | 'unknown';
  rawLines: string[];
  fields: Partial<Record<IdentityFieldName, ParsedIdentityField>>;
};

export type IdentityScannerCapabilities = {
  scanner: boolean;
  file: boolean;
  message?: string;
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
  const fields: IdentityParseResult['fields'] = {
    name: parsedField(name, 'needs_review'),
    identity_doc_number: parsedField(documentNumber, documentValidated ? 'validated' : 'needs_review'),
    identity_doc_type: { value: 'passport', review: 'validated' },
    identity_doc_country: parsedField(country, 'needs_review'),
  };
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
  const fields: IdentityParseResult['fields'] = {
    name: parsedField(name, 'needs_review'),
    identity_doc_number: parsedField(documentNumber, documentValidated ? 'validated' : 'needs_review'),
    identity_doc_type: { value: 'id_card', review: 'validated' },
    identity_doc_country: parsedField(country, 'needs_review'),
  };
  return { documentType: 'id_card', rawLines: [first, second, third], fields };
}

function valueAfterLabel(raw: string, label: string): string {
  const match = raw.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[.:]\\s*([^\\n]+)`, 'im'));
  return match?.[1]?.trim() || '';
}

function parseDriverLicense(raw: string, lines: string[]): IdentityParseResult | null {
  const upper = raw.toUpperCase();
  const looksLikeLicense = /K[ØO]REKORT|DRIVING\s+LICEN[CS]E|PERMIS\s+DE\s+CONDUIRE|F[ÜU]HRERSCHEIN/.test(upper);
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
  const fields: IdentityParseResult['fields'] = {
    name: parsedField(name, 'needs_review'),
    identity_doc_number: parsedField(documentNumber, 'needs_review'),
    identity_doc_type: { value: 'driver_license', review: 'needs_review' },
    identity_doc_country: parsedField(normalizeCountry(country), 'needs_review'),
    address: parsedField(addressLine.replace(/\b\d{4}\s+.*$/, '').replace(/[,-]\s*$/, ''), 'needs_review'),
    postal_code: parsedField(postalMatch?.[1] || '', 'needs_review'),
    city: parsedField(postalMatch?.[2] || '', 'needs_review'),
  };
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
  const license = parseDriverLicense(raw, lines);
  if (license) return license;
  return { documentType: 'unknown', rawLines: lines, fields: {} };
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
  return { scanner, file, message: text(record?.message) || undefined };
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

function mergeIdentityResults(previous: IdentityParseResult | null, next: IdentityParseResult): IdentityParseResult {
  if (!previous || next.documentType === 'unknown') return next.documentType === 'unknown' && previous ? previous : next;
  return {
    documentType: previous.documentType === 'unknown' ? next.documentType : previous.documentType,
    rawLines: [...previous.rawLines, ...next.rawLines],
    fields: { ...previous.fields, ...next.fields },
  };
}

export function useIdentityScan({
  customer,
  setCustomer,
  onApplied,
}: {
  customer: EditableCustomer;
  setCustomer: Dispatch<SetStateAction<EditableCustomer>>;
  onApplied?: () => void;
}) {
  const [capabilities, setCapabilities] = useState<IdentityScannerCapabilities>({ scanner: false, file: false });
  const [status, setStatus] = useState<IdentityScanStatus>('checking');
  const [result, setResult] = useState<IdentityParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Partial<Record<'front' | 'back', string>>>({});
  const resultRef = useRef(result);
  resultRef.current = result;

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
    if (!hasParsedIdentityFields(nextResult)) {
      if (!resultRef.current) setPreviews({});
      setStatus((current) => current === 'review' ? 'review' : 'error');
      setError(raw ? 'Belge tanınamadı; kimlik bilgilerini elle girin.' : 'Tarayıcı metin sonucu döndürmedi.');
      return;
    }
    setResult((current) => mergeIdentityResults(current, nextResult));
    setStatus('review');
    setError(null);
  }, []);

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

  const confirm = useCallback(() => {
    if (!result) return;
    setCustomer((current) => applyConfirmedIdentityResult(current, result));
    setResult(null);
    setPreviews({});
    setStatus('applied');
    window.setTimeout(() => onApplied?.(), 0);
  }, [onApplied, result, setCustomer]);

  const clear = useCallback(() => {
    setResult(null);
    setPreviews({});
    setError(null);
    setStatus(capabilities.scanner || capabilities.file ? 'ready' : 'unavailable');
  }, [capabilities.file, capabilities.scanner]);

  return useMemo(() => ({
    capabilities,
    status,
    result,
    previews,
    error,
    acquire,
    pickFile,
    confirm,
    clear,
    refreshCapabilities,
  }), [acquire, capabilities, clear, confirm, error, pickFile, previews, refreshCapabilities, result, status]);
}
