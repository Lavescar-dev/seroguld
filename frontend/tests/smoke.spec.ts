import { expect, test } from '@playwright/test';

import { login } from './helpers/login';

test('auth, AFG, depolama, log and GDPR routes smoke cleanly', async ({ page }) => {
  const subjectName = `Smoke Request ${Date.now()}`;

  // Public GDPR yüzeyi İngilizce yazılır ama i18n katmanı operator default
  // locale'ine ('tr') çevirir — beklentiler çevrilmiş metinlerdir.
  await page.goto('/#/gdpr/request');
  await expect(page.getByRole('heading', { name: /Veri Talep Merkezi/i })).toBeVisible();
  await page.getByLabel('Talep tipi').selectOption('access_export');
  await page.getByLabel('Ad Soyad').fill(subjectName);
  await page.getByLabel('E-posta').fill('smoke.gdpr@seroguld.test');
  await page.getByLabel('Telefon').fill('+4500000000');
  await page.getByLabel(/Kişisel veri ve gizlilik/i).check();
  await page.getByRole('button', { name: 'Talep oluştur' }).click();
  await expect(page.getByText('Talep oluşturuldu')).toBeVisible();

  await login(page);
  await expect(page.getByRole('button', { name: /^Yeni Alış(?: Başlat)?$/i }).first()).toBeVisible({ timeout: 30_000 });

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
  // gerçek talep sahibi kimliğiyle (eski "Pseudonymous subject" yer tutucusu
  // yerine) listelenir ve detay panelinde görünür.
  await expect(page.getByRole('heading', { name: 'GDPR Merkezi' }).first()).toBeVisible();
  await expect(page.getByText(subjectName).first()).toBeVisible();
});
