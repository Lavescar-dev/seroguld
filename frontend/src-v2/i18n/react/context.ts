import { createContext } from 'react';

export type RuntimeLocale = 'tr' | 'en' | 'da';
export const LocaleRuntimeContext = createContext<RuntimeLocale>('tr');
export const LocalizationSkipContext = createContext(false);
