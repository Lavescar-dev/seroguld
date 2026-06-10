#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const DESKTOP_DIR = path.join(ROOT_DIR, 'desktop');

const BACKEND_HOST = process.env.DESKTOP_BACKEND_HOST || '127.0.0.1';
const BACKEND_BIND_HOST = process.env.DESKTOP_BACKEND_BIND_HOST || '0.0.0.0';
const BACKEND_PORT = Number(process.env.DESKTOP_BACKEND_PORT || 8100);
const FRONTEND_PORT = Number(process.env.DESKTOP_FRONTEND_PORT || 3300);
const START_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const BACKEND_HEALTH_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}/health`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SESSION_FILE_ENV = process.env.DESKTOP_SESSION_FILE || path.join('.run', 'desktop-dev-session.json');
const SESSION_FILE = path.isAbsolute(SESSION_FILE_ENV)
  ? SESSION_FILE_ENV
  : path.join(ROOT_DIR, SESSION_FILE_ENV);
const RUN_DIR = path.dirname(SESSION_FILE);
const DEFAULT_SQLITE_PATH = path.join(DATA_DIR, 'desktop.db').replace(/\\/g, '/');
const DESKTOP_DATABASE_URL =
  process.env.DESKTOP_DATABASE_URL || `sqlite+aiosqlite:///${DEFAULT_SQLITE_PATH}`;

const BACKEND_PYTHON =
  process.env.BACKEND_PYTHON || path.join(BACKEND_DIR, '.venv', 'bin', 'python');

const childProcesses = [];
let shuttingDown = false;
let shutdownNow = null;
const desktopSession = {
  mode: 'desktop-dev',
  started_at: new Date().toISOString(),
  backend_url: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
  frontend_url: FRONTEND_URL,
  session_file: SESSION_FILE,
  frontend_mode: 'vite-dev',
  tauri_mode: 'tauri-dev-url',
  backend_pid: null,
  frontend_pid: null,
  tauri_pid: null,
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function persistDesktopSession() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, `${JSON.stringify(desktopSession, null, 2)}\n`, 'utf8');
}

function clearDesktopSession() {
  fs.rmSync(SESSION_FILE, { force: true });
}

function pingUrl(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

function getHttpStatus(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode || null);
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
}

function isPortOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function waitForUrl(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingUrl(url)) {
      return;
    }
    await delay(500);
  }
  throw new Error(`Timeout: ${url} hazır olmadı.`);
}

function addExitHooks() {
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearDesktopSession();

    for (const child of childProcesses) {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    }

    setTimeout(() => {
      for (const child of childProcesses) {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }
      process.exit(code);
    }, 2500).unref();
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  return shutdown;
}

function spawnService(name, cmd, args, cwd, env = {}) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[desktop] ${name} kapandı (${reason}).`);
    if (shutdownNow) {
      shutdownNow(code || 1);
      return;
    }
    process.exit(code || 1);
  });

  childProcesses.push(child);
  if (name === 'backend') {
    desktopSession.backend_pid = child.pid ?? null;
    persistDesktopSession();
  } else if (name === 'frontend') {
    desktopSession.frontend_pid = child.pid ?? null;
    persistDesktopSession();
  } else if (name === 'tauri') {
    desktopSession.tauri_pid = child.pid ?? null;
    persistDesktopSession();
  }
  return child;
}

function runBlocking(name, cmd, args, cwd, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`[desktop] ${name} basarisiz oldu (code=${result.status ?? 'null'}).`);
  }
}

function buildTauriEnv() {
  const env = {
    TAURI_DEV_HOST: '127.0.0.1',
    SEROGULD_DESKTOP_DEV_URL: FRONTEND_URL,
  };

  const waylandSession = process.env.XDG_SESSION_TYPE === 'wayland';
  const hasX11Display = Boolean(process.env.DISPLAY);
  const backendOverridden = Boolean(process.env.GDK_BACKEND || process.env.WINIT_UNIX_BACKEND);
  const fallbackDisabled = process.env.DESKTOP_DISABLE_X11_FALLBACK === '1';

  if (waylandSession && hasX11Display && !backendOverridden && !fallbackDisabled) {
    console.log('[desktop] Wayland/WebKit sorunu için Tauri X11 fallback ile başlatılıyor...');
    env.GDK_BACKEND = 'x11';
    env.WINIT_UNIX_BACKEND = 'x11';
    env.WEBKIT_DISABLE_DMABUF_RENDERER = '1';
  }

  if (process.env.SEROGULD_DESKTOP_START_ROUTE) {
    env.SEROGULD_DESKTOP_START_ROUTE = process.env.SEROGULD_DESKTOP_START_ROUTE;
  }

  return env;
}

function toAlembicDatabaseUrl(databaseUrl) {
  if (databaseUrl.startsWith('sqlite+aiosqlite:')) {
    return databaseUrl.replace('sqlite+aiosqlite:', 'sqlite:');
  }
  if (databaseUrl.startsWith('postgresql+asyncpg:')) {
    return databaseUrl.replace('postgresql+asyncpg:', 'postgresql+psycopg:');
  }
  return databaseUrl;
}

function isLegacySqliteDatabase(databaseUrl) {
  if (!databaseUrl.startsWith('sqlite')) {
    return false;
  }

  const probe = spawnSync(
    BACKEND_PYTHON,
    [
      '-c',
      [
        'import os, sqlite3, sys',
        'url = os.environ["DESKTOP_DATABASE_URL"]',
        'path = url.split("///", 1)[1]',
        'conn = sqlite3.connect(path)',
        'cur = conn.cursor()',
        'cur.execute("SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'users\'")',
        'has_users = cur.fetchone() is not None',
        'cur.execute("SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'alembic_version\'")',
        'has_alembic = cur.fetchone() is not None',
        'has_version_row = False',
        'if has_alembic:',
        '    cur.execute("SELECT COUNT(*) FROM alembic_version")',
        '    has_version_row = int(cur.fetchone()[0] or 0) > 0',
        'conn.close()',
        'sys.stdout.write("legacy" if has_users and (not has_alembic or not has_version_row) else "ok")',
      ].join('\n'),
    ],
    {
      cwd: BACKEND_DIR,
      env: { ...process.env, DESKTOP_DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    },
  );

  return (probe.stdout || '').trim() === 'legacy';
}

async function main() {
  if (!fs.existsSync(BACKEND_PYTHON)) {
    throw new Error(
      `Backend Python bulunamadı: ${BACKEND_PYTHON}. Önce "make setup" veya "bash scripts/setup-dev.sh" çalıştırın.`,
    );
  }

  const shutdown = addExitHooks();
  shutdownNow = shutdown;
  persistDesktopSession();

  const backendUp = await pingUrl(BACKEND_HEALTH_URL);
  const backendPortBusy = await isPortOpen(BACKEND_HOST, BACKEND_PORT);
  if (backendUp) {
    console.log(`[desktop] Mevcut backend kullanılacak: ${BACKEND_HEALTH_URL}`);
  } else if (backendPortBusy) {
    const statusCode = await getHttpStatus(BACKEND_HEALTH_URL);
    throw new Error(
      `${BACKEND_HOST}:${BACKEND_PORT} portu dolu fakat backend hazır değil (health=${statusCode ?? 'yok'}). ` +
        'Portu kullanan süreci kapatın veya DESKTOP_BACKEND_PORT değiştirin.',
    );
  } else {
    console.log('[desktop] Backend başlatılıyor...');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[desktop] Local veritabanı: ${DESKTOP_DATABASE_URL}`);
    console.log('[desktop] Alembic migration uygulanıyor...');
    if (isLegacySqliteDatabase(DESKTOP_DATABASE_URL)) {
      console.log('[desktop] Legacy SQLite tespit edildi, alembic versiyonu 0007 olarak isaretleniyor...');
      runBlocking('alembic stamp', BACKEND_PYTHON, ['-m', 'alembic', 'stamp', '0007_pos_session_lines'], BACKEND_DIR, {
        PYTHONPATH: BACKEND_DIR,
        DATABASE_URL: toAlembicDatabaseUrl(DESKTOP_DATABASE_URL),
      });
    }
    runBlocking('alembic upgrade', BACKEND_PYTHON, ['-m', 'alembic', 'upgrade', 'head'], BACKEND_DIR, {
      PYTHONPATH: BACKEND_DIR,
      DATABASE_URL: toAlembicDatabaseUrl(DESKTOP_DATABASE_URL),
    });
    spawnService(
      'backend',
      BACKEND_PYTHON,
      ['-m', 'uvicorn', 'app.main:app', '--host', BACKEND_BIND_HOST, '--port', String(BACKEND_PORT), '--reload'],
      BACKEND_DIR,
      {
        PYTHONPATH: BACKEND_DIR,
        DATABASE_URL: DESKTOP_DATABASE_URL,
        CORS_ORIGINS: `http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}`,
        APP_URL: START_URL,
      },
    );
  }

  const frontendUp = await pingUrl(FRONTEND_URL);
  const frontendPortBusy = await isPortOpen('127.0.0.1', FRONTEND_PORT);
  if (frontendUp) {
    console.log(`[desktop] Mevcut frontend kullanılacak: ${FRONTEND_URL}`);
  } else if (frontendPortBusy) {
    const statusCode = await getHttpStatus(FRONTEND_URL);
    throw new Error(
      `127.0.0.1:${FRONTEND_PORT} portu dolu fakat frontend hazır değil (http=${statusCode ?? 'yok'}). ` +
        'Portu kullanan süreci kapatın veya DESKTOP_FRONTEND_PORT değiştirin.',
    );
  } else {
    console.log('[desktop] Frontend başlatılıyor...');
    spawnService('frontend', 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(FRONTEND_PORT), '--strictPort'], FRONTEND_DIR, {
      NEXT_PUBLIC_API_BASE_URL: 'auto',
      VITE_API_BASE_URL: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
      VITE_WS_BASE_URL: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
    });
  }

  await waitForUrl(BACKEND_HEALTH_URL, 90000);
  await waitForUrl(FRONTEND_URL, 120000);

  if (process.env.DESKTOP_SKIP_TAURI === '1') {
    console.log('[desktop] DESKTOP_SKIP_TAURI=1, Tauri açılmadan doğrulama tamamlandı.');
    shutdown(0);
    return;
  }

  console.log('[desktop] Tauri başlatılıyor...');
  const tauri = spawnService('tauri', 'npm', ['run', 'tauri', 'dev'], DESKTOP_DIR, buildTauriEnv());

  tauri.on('exit', (code) => {
    shutdown(code || 0);
  });
}

main().catch((error) => {
  clearDesktopSession();
  console.error(`[desktop] Başlatma hatası: ${error.message}`);
  process.exit(1);
});
