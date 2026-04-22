import { User } from '@/types';

const ACCESS_KEY = 'sg_access_token';
const REFRESH_KEY = 'sg_refresh_token';
const USER_KEY = 'sg_user';

function hasWindow() {
  return typeof window !== 'undefined';
}

export function setAuth(accessToken: string, refreshToken: string, user: User) {
  if (!hasWindow()) return;
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getAccessToken(): string | null {
  if (!hasWindow()) return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (!hasWindow()) return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function getUser(): User | null {
  if (!hasWindow()) return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function clearAuth() {
  if (!hasWindow()) return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}
