/**
 * Sholynk Tech — opaque token generation and storage rules.
 *
 * Tokens (session cookies, email verification, password reset) are random
 * 32-byte values encoded as base64url. Only their SHA-256 hash is stored, so:
 *   - a leaked database dump cannot be used to hijack a session
 *   - a leaked log line cannot be replayed
 *   - token comparison never needs constant time (hash lookup is by index)
 *
 * The single exception is the HMAC-derived CSRF value, which is computed from
 * the session token rather than stored; see middleware/security.ts.
 */
import { bytesToBase64Url, hmacSha256Hex, randomBytes, sha256Hex } from './crypto.js';

export const TOKEN_BYTES = 32;

/** Raw token — returned to the caller exactly once (cookie or email link). */
export function generateToken(bytes: number = TOKEN_BYTES): string {
  return bytesToBase64Url(randomBytes(bytes));
}

/** Storage form. Tokens are high-entropy, so a plain SHA-256 is sufficient. */
export async function hashToken(token: string): Promise<string> {
  return sha256Hex(`sholynk:token:${token}`);
}

export async function tokenDigest(token: string, secret: string): Promise<string> {
  return hmacSha256Hex(secret, `sholynk:token:${token}`);
}

/** Double-submit CSRF token bound to the session token. */
export async function csrfTokenFor(sessionToken: string, secret: string): Promise<string> {
  const digest = await hmacSha256Hex(secret, `sholynk:csrf:${sessionToken}`);
  return digest.slice(0, 32);
}

export const TOKEN_TTL = {
  /** Email verification links stay valid for two days. */
  EMAIL_VERIFICATION_MS: 1000 * 60 * 60 * 48,
  /** Password reset links are short-lived on purpose. */
  PASSWORD_RESET_MS: 1000 * 60 * 60,
} as const;

export function expiresAtFromNow(ttlMs: number, now: number = Date.now()): string {
  return new Date(now + ttlMs).toISOString();
}

/** True when an ISO timestamp is in the past. Missing timestamps never expire. */
export function isExpired(isoTimestamp: string | null | undefined, now: number = Date.now()): boolean {
  if (!isoTimestamp) return false;
  const value = Date.parse(isoTimestamp);
  if (Number.isNaN(value)) return true;
  return value <= now;
}

/**
 * Number of seconds until an ISO timestamp, floored at zero. Used to populate
 * `Retry-After` on rate-limited responses.
 */
export function secondsUntil(isoTimestamp: string | null | undefined, now: number = Date.now()): number {
  if (!isoTimestamp) return 0;
  const value = Date.parse(isoTimestamp);
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.ceil((value - now) / 1000));
}
