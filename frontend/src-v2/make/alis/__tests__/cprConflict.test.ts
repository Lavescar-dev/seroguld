import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

import { parseCprBirthConflict, sendWithCprConflictConfirm } from '../cprConflict';

function softConflictError(): ApiError {
  return new ApiError(
    409,
    'Aynı doğum tarihi bölümüne sahip başka bir müşteri kaydı var.',
    undefined,
    '/api/v2/musteriler',
    {
      code: 'cpr_birth_conflict',
      message: 'Aynı doğum tarihi bölümüne sahip başka bir müşteri kaydı var.',
      matches: [
        { id: 'u-1', name: 'First customer', cpr_number_masked: '??????' },
        { id: 'u-2', name: 'Second customer', cpr_number_masked: '**1234' },
      ],
    },
  );
}

describe('parseCprBirthConflict', () => {
  it('parses the structured 409 body', () => {
    const conflict = parseCprBirthConflict(softConflictError());
    expect(conflict).not.toBeNull();
    expect(conflict?.code).toBe('cpr_birth_conflict');
    expect(conflict?.matches).toHaveLength(2);
    expect(conflict?.matches[0]).toEqual({ id: 'u-1', name: 'First customer', cpr_number_masked: '??????' });
  });

  it('returns null for plain 409 (hard conflict)', () => {
    const error = new ApiError(409, 'Bu CPR ile kayıtlı bir müşteri zaten var.');
    expect(parseCprBirthConflict(error)).toBeNull();
  });

  it('returns null for other statuses and non-ApiError values', () => {
    expect(parseCprBirthConflict(new ApiError(422, 'CPR 6 (yalnız doğum tarihi) veya 10 haneli olmalı.'))).toBeNull();
    expect(parseCprBirthConflict(new Error('bağlantı hatası'))).toBeNull();
  });
});

describe('sendWithCprConflictConfirm', () => {
  it('retries exactly once with confirm flag after operator approval', async () => {
    const confirmDialog = vi.fn().mockResolvedValue(true);
    const calls: boolean[] = [];
    const result = await sendWithCprConflictConfirm(
      async (confirm) => {
        calls.push(confirm);
        if (!confirm) throw softConflictError();
        return 'created';
      },
      confirmDialog,
    );
    expect(result).toBe('created');
    expect(calls).toEqual([false, true]);
    expect(confirmDialog).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original error when the operator declines', async () => {
    const confirmDialog = vi.fn().mockResolvedValue(false);
    const send = vi.fn(async () => {
      throw softConflictError();
    });
    await expect(sendWithCprConflictConfirm(send, confirmDialog)).rejects.toThrow('doğum tarihi bölümüne');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('passes through unrelated errors without dialog', async () => {
    const confirmDialog = vi.fn();
    const send = vi.fn(async () => {
      throw new ApiError(422, 'CPR 6 (yalnız doğum tarihi) veya 10 haneli olmalı.');
    });
    await expect(sendWithCprConflictConfirm(send, confirmDialog)).rejects.toThrow('10 haneli');
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it('passes through immediate success without dialog', async () => {
    const confirmDialog = vi.fn();
    const send = vi.fn(async () => 'ok');
    await expect(sendWithCprConflictConfirm(send, confirmDialog)).resolves.toBe('ok');
    expect(confirmDialog).not.toHaveBeenCalled();
  });
});
