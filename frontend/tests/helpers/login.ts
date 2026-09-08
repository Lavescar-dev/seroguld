import { expect, type Page } from '@playwright/test';

/**
 * Ortak Playwright girişi — smoke ve görsel kanıt spec'leri aynı akışı paylaşır.
 * Sunucu (desktop olmayan) env'de bootstrap e-postası maskeli gelir ve alan
 * boş açılır; tam adres test tarafında yazılır.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/#/login');
  // Tarayıcıda modern login yüzeyi açılır (classic değil). Vite dev
  // sunucusunda ilk boot uzun sürebilir (özellikle CI'da).
  await expect(page.getByRole('heading', { name: /Masaüstü girişi/i })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('E-posta').fill('info@seroguld.dk');
  await page.locator('input[type="password"]').fill('Admin123!');
  await page.getByRole('button', { name: 'Giriş Yap' }).click();

  // The login mutation navigates asynchronously.  Modern shell defaults to
  // the dashboard route after sign-in; re-enter the hash route once the
  // token-backed redirect has settled so a slow Vite/backend start cannot
  // leave the assertion on the public login route.
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 30_000 });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  const discoveryDismiss = page.getByRole('button', { name: 'Şimdi değil' });
  try {
    await discoveryDismiss.click({ timeout: 2_000 });
  } catch {
    // Modern UI variant does not render the classic discovery banner.
  }
}
