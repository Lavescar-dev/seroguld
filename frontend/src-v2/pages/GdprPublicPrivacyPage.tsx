import { GdprPublicPrivacyPage as Page } from '@/make/gdpr/GdprPublicPages';
import { LanguageSelector } from '@/i18n';

export function GdprPublicPrivacyPage() {
  return <><div className="fixed right-4 top-4 z-dropdown rounded border border-slate-200 bg-white p-1 shadow-sm"><LanguageSelector className="text-slate-700" /></div><Page /></>;
}
