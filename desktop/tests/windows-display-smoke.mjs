import { Builder, By, until } from 'selenium-webdriver';
import fs from 'node:fs';
import path from 'node:path';

const serverUrl = process.env.TAURI_DRIVER_URL || 'http://127.0.0.1:4444';
const application = process.env.DESKTOP_SMOKE_APPLICATION;
const timeoutMs = Number(process.env.DESKTOP_SMOKE_TIMEOUT_MS || 180_000);

if (!application) {
  throw new Error('DESKTOP_SMOKE_APPLICATION zorunlu.');
}

const applicationPath = path.resolve(application);
if (!fs.existsSync(applicationPath)) {
  throw new Error(`Windows smoke application bulunamadı: ${applicationPath}`);
}

const capabilities = {
  browserName: 'wry',
  pageLoadStrategy: 'none',
  'tauri:options': {
    application: applicationPath,
  },
};

let driver;

try {
  driver = await new Builder().usingServer(serverUrl).withCapabilities(capabilities).build();
  await driver.manage().setTimeouts({ pageLoad: 15_000, script: 30_000 });
  await driver.wait(
    until.elementLocated(By.css('[data-testid="customer-display-idle"]')),
    timeoutMs,
  );

  const state = await driver.executeScript(() => ({
    href: window.location.href,
    title: document.title,
    hasIdle: Boolean(document.querySelector('[data-testid="customer-display-idle"]')),
    hasDisplayError: Boolean(document.querySelector('[data-testid="customer-display-error"]')),
    bodyText: document.body?.innerText?.slice(0, 500) || '',
  }));

  if (!state.hasIdle || state.hasDisplayError) {
    throw new Error(`Windows display route smoke failed: ${JSON.stringify(state)}`);
  }

  console.log(`[windows-display-smoke] ok ${JSON.stringify(state)}`);
} finally {
  if (driver) {
    await driver.quit();
  }
}
