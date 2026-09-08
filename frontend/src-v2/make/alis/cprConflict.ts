// R1-CPR: doğum-bölümü yumuşak dup akışı.
//
// Backend aynı doğum tarihi bölümüne (ilk 6 hane) sahip başka müşteri
// bulduğunda 409 döner; gövde makine-okunurdur:
//   { code: 'cpr_birth_conflict', message: string,
//     matches: [{ id, name, cpr_number_masked }] }
// Operatöre eşleşmeler gösterilir; onaylarsa istek TEK KEZ
// confirm_cpr_conflict=true ile tekrarlanır. Tam-CPR çakışması bu gövdeyi
// taşımadığı için onayla geçilemez (gerçek dup).

import { ApiError } from '@/lib/api';

export type CprBirthConflictMatch = {
  id: string;
  name: string;
  cpr_number_masked: string;
};

export type CprBirthConflict = {
  code: 'cpr_birth_conflict';
  message: string;
  matches: CprBirthConflictMatch[];
};

export function parseCprBirthConflict(error: unknown): CprBirthConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const detail = error.detail as Record<string, unknown> | string | undefined;
  if (!detail || typeof detail === 'string') return null;
  if (detail.code !== 'cpr_birth_conflict') return null;
  const rawMatches = Array.isArray(detail.matches) ? detail.matches : [];
  const matches = rawMatches.flatMap((item): CprBirthConflictMatch[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    if (!id || !name) return [];
    return [{
      id,
      name,
      cpr_number_masked: typeof record.cpr_number_masked === 'string' ? record.cpr_number_masked : '',
    }];
  });
  return {
    code: 'cpr_birth_conflict',
    message: typeof detail.message === 'string' && detail.message.trim()
      ? detail.message
      : 'Aynı doğum tarihi bölümüne sahip başka bir müşteri kaydı var.',
    matches,
  };
}

// window.confirm yerine enjekte edilebilir onay: testler stub'lar, masaüstü
// kabuğu ileride kendi diyaloğunu bağlayabilir.
export type ConfirmDialog = (message: string) => Promise<boolean> | boolean;

const defaultConfirm: ConfirmDialog = (message) => window.confirm(message);

export async function confirmCprBirthConflict(
  conflict: CprBirthConflict,
  confirmDialog: ConfirmDialog = defaultConfirm,
): Promise<boolean> {
  const lines = conflict.matches.slice(0, 5).map(
    (match) => `• ${match.name}${match.cpr_number_masked ? ` (CPR: ${match.cpr_number_masked})` : ''}`,
  );
  const dialogMessage = [
    conflict.message,
    lines.length ? `\n${lines.join('\n')}` : '',
    '\n\nYine de kaydetmek istiyor musunuz?',
  ].join('');
  return Boolean(await confirmDialog(dialogMessage));
}

// Kalıcı yüzeylerin tek satırlık entegrasyonu: ilk gönderim onaysız gider;
// yumuşak 409 dönerse operatöre sorulur, onayla TEK KEZ
// confirm_cpr_conflict=true ile tekrarlanır. Başka hatalar aynen fırlatılır.
export async function sendWithCprConflictConfirm<T>(
  send: (confirmCprConflict: boolean) => Promise<T>,
  confirmDialog: ConfirmDialog = defaultConfirm,
): Promise<T> {
  try {
    return await send(false);
  } catch (error) {
    const conflict = parseCprBirthConflict(error);
    if (!conflict) throw error;
    const confirmed = await confirmCprBirthConflict(conflict, confirmDialog);
    if (!confirmed) throw error;
    return await send(true);
  }
}
