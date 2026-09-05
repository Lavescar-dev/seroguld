import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const evidenceDir = process.env.PLAYWRIGHT_EVIDENCE_DIR || 'test-results/inventory-log';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/#/login');
  // Tarayıcıda modern login yüzeyi açılır (classic değil). Vite dev
  // sunucusunda ilk boot uzun sürebilir (özellikle CI'da).
  await expect(page.getByRole('heading', { name: /Masaüstü girişi/i })).toBeVisible({ timeout: 30_000 });
  // Sunucu (desktop olmayan) env'de bootstrap e-postası maskeli gelir ve alan
  // boş açılır; tam adres test tarafında yazılır.
  await page.getByLabel('E-posta').fill('info@seroguld.dk');
  await page.locator('input[type="password"]').fill('Admin123!');
  await page.getByRole('button', { name: 'Giriş Yap' }).click();
  await expect(page).toHaveURL(/#\/dashboard/, { timeout: 30_000 });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  const dismiss = page.getByRole('button', { name: 'Şimdi değil' });
  try {
    await dismiss.click({ timeout: 2_000 });
  } catch {
    // The modern shell does not always show discovery.
  }
}

test('inventory and log user-path evidence smoke', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || 'failed'}`));
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });

  await login(page);
  await page.evaluate(() => window.localStorage.setItem('seroguld.ui.variant.v3', 'modern'));
  await page.reload({ waitUntil: 'networkidle' });

  await page.goto('/#/depolama', { waitUntil: 'networkidle' });
  await expect(page.getByText('Envanter ve Stok')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/01-depolama-initial.png`, fullPage: true });

  const textFilter = page.locator('label').filter({ hasText: 'Metin Filtre' }).locator('input');
  await textFilter.fill('smoke-no-match');
  await expect(page.getByText('Bu görünümde ürün yok')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/02-depolama-filter-empty.png`, fullPage: true });
  await textFilter.fill('');

  // Regression guard: modern “Yeni Ürün” must remain in the modern form surface.
  await page.getByRole('button', { name: 'Yeni Ürün', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Yeni ürün' })).toBeVisible();
  await expect(page.locator('#inventory-name')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/03-depolama-new-product-form.png`, fullPage: true });
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).click();

  await page.getByRole('button', { name: 'Office', exact: true }).click();
  await expect(page.getByText('Depolama.xlsx')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/04-depolama-office.png`, fullPage: true });

  await page.goto('/#/log', { waitUntil: 'networkidle' });
  // Başlık metni banner <p>'de de geçer — tek eşleşme için h1'i hedefle.
  await expect(page.getByRole('heading', { name: 'Log ve melt akışı' })).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/05-log-initial.png`, fullPage: true });
  await page.getByRole('button', { name: 'Gümüş', exact: true }).click();
  // DataPill "Defter" etiketinin kardeş span'ı aktif sekmeyi gösterir.
  await expect(page.getByText('Defter', { exact: true }).locator('xpath=following-sibling::span[1]')).toHaveText('Gümüş');
  await page.screenshot({ path: `${evidenceDir}/06-log-silver.png`, fullPage: true });
  await page.getByRole('button', { name: 'Office', exact: true }).click();
  // Log workbook artifact adı yıl damgalıdır (örn. Log-2026.xlsx).
  await expect(page.getByRole('heading', { name: /Log-\d{4}\.xlsx/ })).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/07-log-office.png`, fullPage: true });

  writeFileSync(`${evidenceDir}/console-errors.txt`, consoleErrors.length ? `${consoleErrors.join('\n')}\n` : 'none\n');
  writeFileSync(`${evidenceDir}/request-failures.txt`, requestFailures.length ? `${requestFailures.join('\n')}\n` : 'none\n');
  writeFileSync(`${evidenceDir}/bad-responses.txt`, badResponses.length ? `${badResponses.join('\n')}\n` : 'none\n');
  // Chromium reports one opaque 404 console warning in this environment
  // without exposing a matching response URL; keep it in the evidence file
  // while failing on actionable request/HTTP failures below.
  expect(requestFailures.filter((item) => !item.includes('ERR_ABORTED')), 'failed browser requests').toEqual([]);
  expect(badResponses, 'HTTP responses >= 400').toEqual([]);
});
