import { expect, type Page, test } from '@playwright/test';

import { login } from './helpers/login';

/**
 * R1-36 v2 — Woo foto sürükle-sırala E2E.
 *
 * HTML5 DnD Playwright'un click/hover akışıyla tetiklenmez; gerçek DragEvent'ler
 * paylaşılan bir DataTransfer ile dispatchEvent üzerinden gönderilir. Ürün +
 * fotoğraflar UI yerine API'den tohumlanır (UI seed'i kırılgan); kart sırası
 * ve Birincil rozeti yenilemeden sonra da korunmalı (PUT kalıcılığı).
 */

const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Smoke betiği backend'i AYRI portta açar ve uygulamaya mutlak
// VITE_API_BASE_URL verir; vite dev'de /api proxy'si YOKTUR — sayfa
// origin'ine göreli fetch 404 alır (CI 0.3.38 dersi). URL ortamdan
// geçersiz kılınabilir, varsayılanı frontend-smoke.sh ile aynıdır.
const BACKEND_URL = process.env.SERO_E2E_BACKEND_URL || 'http://127.0.0.1:38100';

async function seedProductWithPhotos(page: Page, displayName: string): Promise<void> {
  // evaluate gövdesi tarayıcıda çalışır: modül sabitleri argument olarak geçilmeli.
  await page.evaluate(async ({ backendUrl, displayName, pngBase64 }) => {
    const token = sessionStorage.getItem('seroguld.desktop.access_token');
    if (!token) throw new Error('oturum tokenı bulunamadı');
    const auth = { Authorization: `Bearer ${token}` };

    const created = await fetch(`${backendUrl}/api/v2/depolama/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        display_name: displayName,
        product_type: 'jewelry',
        metal_type: 'yellow_gold',
        weight_grams: 10,
        purchase_price_dkk: 1000,
      }),
    });
    if (!created.ok) throw new Error(`ürün oluşturulamadı: ${created.status}`);
    const product = (await created.json()) as { id: string };

    const bin = atob(pngBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const form = new FormData();
    for (const name of ['e2e-reorder-a.png', 'e2e-reorder-b.png', 'e2e-reorder-c.png']) {
      form.append('files', new Blob([bytes], { type: 'image/png' }), name);
    }
    const uploaded = await fetch(`${backendUrl}/api/v2/woocommerce/products/${product.id}/photos`, {
      method: 'POST',
      headers: auth,
      body: form,
    });
    if (!uploaded.ok) throw new Error(`fotoğraflar yüklenemedi: ${uploaded.status}`);
  }, { backendUrl: BACKEND_URL, displayName, pngBase64: PNG_1PX_BASE64 });
}

async function dragPhotoCard(page: Page, fromIndex: number, toIndex: number): Promise<void> {
  await page.evaluate(([fromIndex, toIndex]) => {
    const cards = document.querySelectorAll<HTMLElement>('[data-testid^="woo-photo-card-"]');
    const source = cards[fromIndex];
    const target = cards[toIndex];
    if (!source || !target) throw new Error(`kart bulunamadı: ${fromIndex} -> ${toIndex}`);
    // Paylaşılan DataTransfer: dragstart'ta yazılan veri drop'ta okunur.
    const dataTransfer = new DataTransfer();
    for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
      const eventInit: DragEventInit = { bubbles: true, cancelable: true, dataTransfer };
      if (type === 'dragstart') source.dispatchEvent(new DragEvent(type, eventInit));
      else target.dispatchEvent(new DragEvent(type, eventInit));
    }
  }, [fromIndex, toIndex]);
}

async function openPhotoCards(page: Page, displayName: string): Promise<void> {
  await page.goto('/#/woocommerce');
  // Modern Woo sayfası Woo kataloğu yüzeyiyle açılır; tohumlanan depolama
  // ürünü "CRM ürünleri" yerel yüzeyinde listelenir. Liste sayfalıdır
  // (25/sayfa) — isimle arayıp satırı seçmek şart.
  await page.getByRole('button', { name: 'CRM ürünleri' }).click();
  const search = page.getByLabel('Woo ürünlerinde ara');
  await expect(search).toBeVisible();
  await search.fill(displayName);
  // Arama ~300ms debounce'ludur; debounce + fetch oturmadan satır seçilirse
  // filtre biz Fotoğraf sekmesindeyken uygulanıp çalışma alanını sıfırlar
  // (sekme Genel'e döner). Araç çubuğu sayacı filtre sonrası "1 ürün" olur.
  await expect(page.getByText('1 ürün', { exact: true })).toBeVisible();
  await page.getByText(displayName).first().click();
  await page.getByRole('button', { name: 'Fotoğraf' }).click();
  await expect(page.getByTestId('woo-photo-dropzone')).toBeVisible();
  await expect(page.getByTestId('woo-photo-card-0')).toBeVisible();
}

test('woo foto sürükle-sırala: Birincil rozeti taşınır ve yenilemede korunur', async ({ page }) => {
  test.setTimeout(120_000);
  const displayName = `E2E foto siralama ${Date.now()}`;

  await login(page);
  await seedProductWithPhotos(page, displayName);
  await openPhotoCards(page, displayName);

  // Tohum sırası a, b, c — ilk kart primary.
  await expect(page.getByTestId('woo-photo-card-0')).toContainText('e2e-reorder-a.png');
  await expect(page.getByTestId('woo-photo-card-0')).toContainText('Birincil');

  // HTML5 DnD: click ile çalışmaz — gerçek DragEvent + DataTransfer şart.
  await dragPhotoCard(page, 0, 2);

  // Mutasyon PUT + invalidate sonrası refetch: kart 0 artık b, Birincil rozetli.
  await expect(page.getByTestId('woo-photo-card-0')).toContainText('e2e-reorder-b.png', { timeout: 15_000 });
  await expect(page.getByTestId('woo-photo-card-0')).toContainText('Birincil');
  await expect(page.getByTestId('woo-photo-card-2')).toContainText('e2e-reorder-a.png');
  await expect(page.getByTestId('woo-photo-card-2')).not.toContainText('Birincil');

  // Kalıcılık: yenileme sonrası sıra aynen korunmalı.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openPhotoCards(page, displayName);
  await expect(page.getByTestId('woo-photo-card-0')).toContainText('e2e-reorder-b.png');
  await expect(page.getByTestId('woo-photo-card-0')).toContainText('Birincil');
  await expect(page.getByTestId('woo-photo-card-2')).toContainText('e2e-reorder-a.png');
});
