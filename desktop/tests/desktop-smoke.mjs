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

const capabilities = {
  'tauri:options': {
    application: path.resolve(application),
  },
};

let driver;

try {
  driver = await new Builder().usingServer(serverUrl).withCapabilities(capabilities).build();
  await waitForSessionFile(sessionFile);
  await driver.get(baseUrl);

  const summary = await driver.wait(
    until.elementLocated(By.css('[data-testid="desktop-smoke-summary"]')),
    timeoutMs,
  );
  await driver.wait(async () => {
    const text = await summary.getText();
    return text.trim().length > 0;
  }, timeoutMs);

  await driver.wait(
    until.elementLocated(By.css('[data-testid="desktop-smoke-shell-ok"]')),
    timeoutMs,
  );
} finally {
  if (driver) {
    await driver.quit();
  }
}
