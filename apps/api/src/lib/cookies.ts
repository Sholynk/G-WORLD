/**
 * Sholynk Tech — cookie handling.
 *
 * Two cookies, both scoped to the whole origin:
 *
 *   sk_session — the session token. HttpOnly (JavaScript cannot read it, so XSS
 *                cannot steal a session), Secure in production, SameSite=Lax
 *                (works with same-origin navigation and blocks cross-site POSTs),
 *                Path=/ so both the API and the pages that call it are covered.
 *
 *   sk_csrf    — a double-submit token derived from the session token with HMAC.
 *                Readable by JavaScript on purpose: the frontend echoes it in the
 *                `X-CSRF-Token` header, which a cross-site attacker cannot do
 *                because they cannot read our cookie.
 *
 * Session cookies always carry an explicit `Max-Age` and `Expires`, so the
 * browser — not JavaScript — decides when they disappear.
 */
import type { AppContext } from '../env.js';
import { csrfTokenFor } from './tokens.js';

export const SESSION_COOKIE = 'sk_session';
export const CSRF_COOKIE = 'sk_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
  path?: string;
}

function serialize(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    `Expires=${new Date(Date.now() + Math.max(0, options.maxAgeSeconds) * 1000).toUTCString()}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export async function setSessionCookies(
  c: AppContext,
  sessionToken: string,
  maxAgeSeconds: number,
): Promise<void> {
  const secure = c.get('config').isProduction;
  const sessionCookie = serialize(SESSION_COOKIE, sessionToken, {
    maxAgeSeconds,
    secure,
    httpOnly: true,
    sameSite: 'Lax',
  });
  const csrfToken = await csrfTokenFor(sessionToken, c.get('config').sessionSecret);
  const csrfCookie = serialize(CSRF_COOKIE, csrfToken, {
    maxAgeSeconds,
    secure,
    httpOnly: false,
    sameSite: 'Lax',
  });
  c.header('Set-Cookie', sessionCookie, { append: true });
  c.header('Set-Cookie', csrfCookie, { append: true });
}

export async function clearSessionCookies(c: AppContext): Promise<void> {
  const secure = c.get('config').isProduction;
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    c.header(
      'Set-Cookie',
      serialize(name, '', { maxAgeSeconds: 0, secure, httpOnly: name === SESSION_COOKIE, sameSite: 'Lax' }),
      { append: true },
    );
  }
}

/** Reads a cookie from the request headers without a cookie-parsing dependency. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const raw = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}
