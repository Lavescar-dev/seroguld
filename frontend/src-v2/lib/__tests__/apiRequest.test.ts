import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRequest, formatDetailList } from '../api';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 422,
    statusText: 'Unprocessable Entity',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatDetailList', () => {
  it('pydantic detail listesini Turkce madde metnine cevirir', () => {
    const detail = [
      { loc: ['body', 'postal_code'], msg: 'Field required', type: 'missing' },
      { loc: ['body', 'cpr_number'], msg: 'Value error, invalid CPR', type: 'value_error' },
    ];
    expect(formatDetailList(detail)).toBe('postnr zorunlu alan; CPR geçersiz değer');
  });

  it('bilinmeyen type icin ham msg kullanir ve alan adini sozlukten etiketler', () => {
    const detail = [{ loc: ['body', 'reg_number'], msg: 'uzunluk en az 4', type: 'string_pattern_mismatch' }];
    expect(formatDetailList(detail)).toBe('reg. nr uzunluk en az 4');
  });

  it('dizi disi girisler icin null doner', () => {
    expect(formatDetailList('hata')).toBeNull();
    expect(formatDetailList({ message: 'hata' })).toBeNull();
    expect(formatDetailList([])).toBeNull();
  });

  it('uzun listeyi uc maddeye kirpar ve kalan sayisini belirtir', () => {
    const detail = [1, 2, 3, 4, 5].map((i) => ({
      loc: ['body', `field_${i}`],
      msg: 'Field required',
      type: 'missing',
    }));
    expect(formatDetailList(detail)).toBe('field_1 zorunlu alan; field_2 zorunlu alan; field_3 zorunlu alan (+2 madde)');
  });
});

describe('apiRequest 422 tasimasi', () => {
  it('detail listesi okunur Turkce mesaja cevrilir (ham 422 gorunmez)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        detail: [
          { loc: ['body', 'postal_code'], msg: 'Field required', type: 'missing' },
          { loc: ['body', 'bank_info', 'reg_number'], msg: 'Field required', type: 'missing' },
        ],
        request_id: 'req-42',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await apiRequest('/api/v2/customers', { method: 'POST', auth: false }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe('postnr zorunlu alan; reg. nr zorunlu alan (Kod: req-42)');
  });

  it('detail string ve {message} nesnesi mevcut davranisi korur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ detail: 'Toplam teklif tutarı geçersiz.' })),
    );
    await expect(apiRequest('/api/v2/pos', { method: 'POST', auth: false })).rejects.toThrow(
      'Toplam teklif tutarı geçersiz.',
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(jsonResponse({ detail: { message: 'Oturum kilitli.' } })),
    );
    await expect(apiRequest('/api/v2/pos', { method: 'POST', auth: false })).rejects.toThrow('Oturum kilitli.');
  });

  it('bos govdeli 422 ham status metni yerine yedek mesaj verir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 422, statusText: 'Unprocessable Entity' })),
    );
    const error = await apiRequest('/api/v2/pos', { method: 'POST', auth: false }).catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('Gönderilen veriler doğrulanamadı (422).');
  });

  it('bos govdeli 500 ham status metninde kalir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500, statusText: 'Internal Server Error' })),
    );
    const error = await apiRequest('/api/v2/pos', { method: 'POST', auth: false }).catch((e: unknown) => e);
    expect((error as ApiError).message).toBe('500 Internal Server Error');
  });
});
