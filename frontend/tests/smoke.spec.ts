import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/#/login');
  // Tarayıcıda modern login yüzeyi açılır (classic değil). Vite dev
  // sunucusunda ilk boot uzun sürebilir (özellikle CI'da).
  await expect(page.getByRole('heading', { name: /Masaüstü girişi/i })).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="password"]').fill('Admin123!');
  await page.getByRole('button', { name: 'Giriş Yap' }).click();

  // The login mutation navigates asynchronously.  Modern shell defaults to
  // the dashboard route after sign-in; re-enter the hash route once the
  // token-backed redirect has settled so a slow Vite/backend start cannot
  // leave the smoke assertion on the public login route.
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 30_000 });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  const discoveryDismiss = page.getByRole('button', { name: 'Şimdi değil' });
  try {
    await discoveryDismiss.click({ timeout: 2_000 });
  } catch {
    // Modern UI variant does not render the classic discovery banner.
  }

  await expect(page.getByRole('button', { name: /^Yeni Alış(?: Başlat)?$/i }).first()).toBeVisible({ timeout: 30_000 });
}

test('auth, AFG, depolama, log and GDPR routes smoke cleanly', async ({ page }) => {
  const subjectName = `Smoke Request ${Date.now()}`;

  // Public GDPR yüzeyi İngilizce yazılır ama i18n katmanı operator default
  // locale'ine ('tr') çevirir — beklentiler çevrilmiş metinlerdir.
  await page.goto('/#/gdpr/request');
  await expect(page.getByRole('heading', { name: /Veri Talep Merkezi/i })).toBeVisible();
  await page.getByLabel('Talep türü').selectOption('access_export');
  await page.getByLabel('Ad Soyad').fill(subjectName);
  await page.getByLabel('E-mail').fill('smoke.gdpr@seroguld.test');
  await page.getByLabel('Telefon').fill('+4500000000');
  await page.getByLabel(/Persondata ve privacy/i).check();
  await page.getByRole('button', { name: /Request oluştur/i }).click();
  await expect(page.getByText('İstek oluşturuldu')).toBeVisible();

  await login(page);

  await page.getByRole('button', { name: /^Yeni Alış(?: Başlat)?$/i }).first().click();
  // Modern AFG yüzeyi: sabit başlık + operasyon paneli açıklaması.
  await expect(page.getByRole('heading', { name: 'Yeni alış çalışma alanı' })).toBeVisible();
  await expect(page.getByText('müşteri bağlamını ve belge geçmişini')).toBeVisible();

  await page.goto('/#/depolama');
  await expect(page.getByText('Envanter ve Stok').first()).toBeVisible();

  await page.goto('/#/log');
  await expect(page.getByText('Log ve melt akışı').first()).toBeVisible();

  await page.goto('/#/gdpr');
  // Modern GDPR yüzeyi: talep kuyruğunda public formdan gelen smoke talebi
  // "Pseudonymous subject" kimliğiyle listelenir.
  await expect(page.getByRole('heading', { name: 'GDPR Merkezi' }).first()).toBeVisible();
  await expect(page.getByText('Pseudonymous subject').first()).toBeVisible();
});
