import { Locale, messages } from './messages';

export const DEFAULT_LOCALE: Locale = 'tr';

export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  return messages[locale]?.[key] ?? messages.tr[key] ?? key;
}
