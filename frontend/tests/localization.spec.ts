import { expect, test } from '@playwright/test';

const loginButtons = { tr: 'Giriş Yap', en: 'Sign in', da: 'Log ind' } as const;

for (const locale of ['tr', 'en', 'da'] as const) {
  test('login surface follows ' + locale + ' locale without restart', async ({ page }) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      'seroguld.locale.operator.v1',
      locale,
    ]);
    await page.goto('/#/login');
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('button', { name: loginButtons[locale] })).toBeVisible();
  });
}

// i18n `lng: 'tr'` ile başlar; public GDPR yüzeyi için ayrı bir locale init
// yoktur (X1 'da' fallback yalnızca eksik anahtar durumundadır), dolayısıyla
// public yüzey de operator default locale'iyle ('tr') render olur.
test('public GDPR surface follows the default operator locale', async ({ page }) => {
  await page.goto('/#/gdpr/privacy');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
});
