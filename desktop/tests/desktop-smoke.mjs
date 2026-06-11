import { Builder, By, until } from 'selenium-webdriver';
import fs from 'node:fs';
import path from 'node:path';

const serverUrl = process.env.TAURI_DRIVER_URL || 'http://127.0.0.1:4444';
const application = process.env.DESKTOP_SMOKE_APPLICATION;
const baseUrl = process.env.DESKTOP_SMOKE_BASE_URL || 'http://127.0.0.1:3300/#/desktop-smoke';
const sessionFile = process.env.DESKTOP_SESSION_FILE || '';
const timeoutMs = Number(process.env.DESKTOP_SMOKE_TIMEOUT_MS || 180_000);

if (!application) {
  throw new Error('DESKTOP_SMOKE_APPLICATION zorunlu.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSessionFile(targetPath) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (targetPath && fs.existsSync(targetPath)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`Desktop session dosyası oluşmadı: ${targetPath}`);
}

async function readSmokeState(driver) {
  return driver.executeScript(() => {
    const summary = document.querySelector('[data-testid="desktop-smoke-summary"]')?.textContent?.trim() || '';
    const steps = Array.from(document.querySelectorAll('[data-testid^="desktop-step-"]')).map((node) => {
      const badge = node.querySelector('span')?.textContent?.trim() || '';
      const labels = Array.from(node.querySelectorAll('p')).map((item) => item.textContent?.trim() || '');
      return {
        key: node.getAttribute('data-testid') || '',
        label: labels[0] || '',
        detail: labels[1] || '',
        state: badge,
      };
    });
    return { summary, steps };
  });
}

function displayIdleUrl() {
  return baseUrl.includes('#')
    ? `${baseUrl.split('#', 1)[0]}#/display/idle`
    : `${baseUrl.replace(/\/$/, '')}/#/display/idle`;
}

async function verifyDisplayIdleRoute(driver) {
  await driver.get(displayIdleUrl());
  await driver.wait(
    until.elementLocated(By.css('[data-testid="customer-display-idle"]')),
    timeoutMs,
  );
}

const capabilities = {
  browserName: 'wry',
  pageLoadStrategy: 'none',
  'tauri:options': {
    application: path.resolve(application),
  },
};

let driver;

try {
  driver = await new Builder().usingServer(serverUrl).withCapabilities(capabilities).build();
  await driver.manage().setTimeouts({ pageLoad: 15_000, script: 30_000 });
  await waitForSessionFile(sessionFile);

  const summary = await driver.wait(
    until.elementLocated(By.css('[data-testid="desktop-smoke-summary"]')),
    timeoutMs,
  );
  await driver.wait(async () => {
    const text = await summary.getText();
    return text.trim().length > 0;
  }, timeoutMs);

  try {
    await driver.wait(
      until.elementLocated(By.css('[data-testid="desktop-smoke-shell-ok"]')),
      timeoutMs,
    );
    await verifyDisplayIdleRoute(driver);
  } catch (error) {
    const state = await readSmokeState(driver);
    throw new Error(`Desktop smoke tamamlanmadı: ${JSON.stringify(state)}`, { cause: error });
  }
} finally {
  if (driver) {
    await driver.quit();
  }
}
