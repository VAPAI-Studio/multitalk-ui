import { AUTH_TOKEN_KEY } from './constants';

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(AUTH_TOKEN_KEY);
}

export function logout(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  window.location.href = '/login';
}

export function getToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}
