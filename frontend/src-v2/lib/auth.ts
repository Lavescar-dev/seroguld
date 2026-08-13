import type { AppUser } from '@/types';
import { isTauriRuntime } from '@/lib/desktop';

const ACCESS_TOKEN_KEY = 'seroguld.desktop.access_token';
const REFRESH_TOKEN_KEY = 'seroguld.desktop.refresh_token';
const USER_KEY = 'seroguld.desktop.user';
const REMEMBERED_KEY = 'seroguld.desktop.remembered';
const NATIVE_LAUNCH_MARKER = 'seroguld.desktop.native-launch.v2';

// Tokens from versions that persisted the login in localStorage must not be
// allowed to bypass the login screen after the desktop migration.  The
// `seroguld.desktop.*` names were used by the first Vite desktop build, while
// `sg_*` belongs to the retired classic Next build. Keep this list narrow so
// unrelated local application settings survive the migration.
const LEGACY_AUTH_KEYS = [
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
  'sg_access_token',
  'sg_refresh_token',
  'sg_user',
] as const;

function getBrowserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window[kind];
  } catch {
    return null;
  }
}

function clearLegacyAuthStorage(): void {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return;
  for (const key of LEGACY_AUTH_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be present but locked (for example in an opaque WebView).
      // Auth callers still fall back to the session-only path below.
    }
  }
}

// Run once when the auth module is first loaded.  This is intentionally not a
// broad localStorage wipe: remembered passwords are handled by the desktop
// credential manager, while app preferences remain local.
clearLegacyAuthStorage();

// A fresh native WebView process starts without the session marker. Clear any
// stale token from an older desktop process, while a normal page refresh keeps
// the current sessionStorage session intact.
if (isTauriRuntime()) {
  const session = getBrowserStorage('sessionStorage');
  if (session?.getItem(NATIVE_LAUNCH_MARKER) !== 'true') {
    for (const key of [...LEGACY_AUTH_KEYS, REMEMBERED_KEY]) {
      try {
        session?.removeItem(key);
      } catch {
        // Keep the login path usable if WebView storage is temporarily locked.
      }
    }
    try {
      session?.setItem(NATIVE_LAUNCH_MARKER, 'true');
    } catch {
      // No plaintext fallback is used.
    }
  }
}

export function getAccessToken(): string | null {
  return getBrowserStorage('sessionStorage')?.getItem(ACCESS_TOKEN_KEY) || null;
}

export function getRefreshToken(): string | null {
  return getBrowserStorage('sessionStorage')?.getItem(REFRESH_TOKEN_KEY) || null;
}

export function getCurrentUser(): AppUser | null {
  const storage = getBrowserStorage('sessionStorage');
  if (!storage) return null;
  const raw = storage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AppUser;
  } catch {
    return null;
  }
}

export function isAuthRemembered(): boolean {
  return getBrowserStorage('sessionStorage')?.getItem(REMEMBERED_KEY) === 'true';
}

export function setAuth(accessToken: string, refreshToken: string, user: AppUser, remember = true): void {
  clearAuth();
  const storage = getBrowserStorage('sessionStorage');
  if (!storage) return;
  storage.setItem(ACCESS_TOKEN_KEY, accessToken);
  storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  storage.setItem(USER_KEY, JSON.stringify(user));
  storage.setItem(REMEMBERED_KEY, remember ? 'true' : 'false');
}

export function markPasswordChangeRequired(): void {
  const user = getCurrentUser();
  const storage = getBrowserStorage('sessionStorage');
  if (user && storage) {
    storage.setItem(USER_KEY, JSON.stringify({ ...user, must_change_password: true }));
  }
}

export function clearAuth(): void {
  const sessionStorage = getBrowserStorage('sessionStorage');
  if (sessionStorage) {
    for (const key of [...LEGACY_AUTH_KEYS, REMEMBERED_KEY]) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // Ignore a locked storage area; no credential is written there by the
        // current build when the storage API is unavailable.
      }
    }
  }
  // Remove any pre-migration token left by an already-loaded old build.  The
  // current build never writes auth data to localStorage.
  const localStorage = getBrowserStorage('localStorage');
  if (localStorage) {
    for (const key of LEGACY_AUTH_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        // See clearLegacyAuthStorage: a storage implementation may expose
        // the object but reject mutations.
      }
    }
  }
}
