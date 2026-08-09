import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: /Desktop Sign In/i })).toBeVisible();
  await page.getByLabel('Şifre').fill('Admin123!');
  await page.getByRole('button', { name: 'Giriş Yap' }).click();

  const discoveryDismiss = page.getByRole('button', { name: 'Şimdi değil' });
  try {
    await discoveryDismiss.click({ timeout: 2_000 });
  } catch {
    // Modern UI variant does not render the classic discovery banner.
  }

  await expect(page.getByRole('button', { name: /^Yeni Alış(?: Başlat)?$/i }).first()).toBeVisible();
}

test('auth, AFG, depolama, log and GDPR routes smoke cleanly', async ({ page }) => {
  const subjectName = `Smoke Request ${Date.now()}`;

  await page.goto('/#/gdpr/request');
  await expect(page.getByRole('heading', { name: /Data Request Center/i })).toBeVisible();
  await page.getByLabel('Request type').selectOption('access_export');
  await page.getByLabel('Ad Soyad').fill(subjectName);
  await page.getByLabel('E-mail').fill('smoke.gdpr@seroguld.test');
  await page.getByLabel('Telefon').fill('+4500000000');
  await page.getByLabel(/Persondata ve privacy/i).check();
  await page.getByRole('button', { name: /Request oluştur/i }).click();
  await expect(page.getByText('Request created')).toBeVisible();

  await login(page);

  await page.getByRole('button', { name: /^Yeni Alış(?: Başlat)?$/i }).first().click();
  await expect(page.getByText(/Çalışma Dosyası|AFG SATIRLARI/i).first()).toBeVisible();
  await expect(page.getByText(/Afregningsnr\.|AFG SATIRLARI/i).first()).toBeVisible();

  await page.goto('/#/depolama');
  await expect(page.getByText('Depolama.xlsx').first()).toBeVisible();

  await page.goto('/#/log');
  await expect(page.getByText('Log Workbook').first()).toBeVisible();

  await page.goto('/#/gdpr');
  await expect(page.getByRole('heading', { name: /Veri Hakları ve Saklama Cockpit’i/i })).toBeVisible();
  await expect(page.getByText(subjectName).first()).toBeVisible();
});
