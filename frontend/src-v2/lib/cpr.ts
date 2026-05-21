const MULTIPLIERS = [4, 3, 2, 7, 6, 5, 4, 3, 2, 1] as const;

export type CprValidation = {
  digits: string;
  formatOk: boolean;
  mod11Ok: boolean;
  birthdate: Date | null;
  reason: string | null;
};

export function normalizeCpr(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

function decodeBirthdate(digits10: string): Date | null {
  if (digits10.length !== 10) return null;
  const dd = Number(digits10.slice(0, 2));
  const mm = Number(digits10.slice(2, 4));
  const yy = Number(digits10.slice(4, 6));
  const seventh = Number(digits10[6]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yy)) return null;
  let century: number;
  if (seventh < 4) {
    century = 1900;
  } else if (seventh === 4 || seventh === 9) {
    century = yy <= 36 ? 2000 : 1900;
  } else {
    century = yy <= 57 ? 2000 : 1800;
  }
  const year = century + yy;
  const candidate = new Date(year, mm - 1, dd);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== mm - 1 ||
    candidate.getDate() !== dd
  ) {
    return null;
  }
  return candidate;
}

export function validateCpr(value: string | null | undefined): CprValidation {
  const digits = normalizeCpr(value);
  if (!digits) {
    return { digits, formatOk: false, mod11Ok: false, birthdate: null, reason: 'CPR boş' };
  }
  if (digits.length !== 10) {
    return {
      digits,
      formatOk: false,
      mod11Ok: false,
      birthdate: null,
      reason: 'CPR 10 haneli olmalı (DDMMYY + 4 hane)',
    };
  }
  const birthdate = decodeBirthdate(digits);
  if (birthdate === null) {
    return {
      digits,
      formatOk: false,
      mod11Ok: false,
      birthdate: null,
      reason: 'CPR doğum tarihi geçersiz',
    };
  }
  const sum = digits
    .split('')
    .reduce((acc, char, idx) => acc + Number(char) * MULTIPLIERS[idx], 0);
  const mod11Ok = sum % 11 === 0;
  return {
    digits,
    formatOk: true,
    mod11Ok,
    birthdate,
    reason: mod11Ok ? null : 'Mod-11 kontrolü başarısız (2007 sonrası bazı CPR\'lar için normal)',
  };
}
