/**
 * Password hashing and token formats.
 *
 * These are the two places where a subtle change silently locks everybody out
 * (a hash that no longer verifies) or silently weakens the platform (a token
 * that is no longer unpredictable), so they get direct, fast tests.
 */
import { describe, expect, it } from 'vitest';
import {
  PASSWORD_ALGORITHM,
  hashPassword,
  needsRehash,
  normalizePassword,
  parsePasswordHash,
  passwordLength,
  verifyPassword,
} from '../../apps/api/src/lib/password.js';
import { sha256Hex, hmacSha256Hex, timingSafeEqual, bytesToBase64Url, base64UrlToBytes } from '../../apps/api/src/lib/crypto.js';
import { TOKEN_TTL, generateToken, hashToken, isExpired, expiresAtFromNow } from '../../apps/api/src/lib/tokens.js';

const ITERATIONS = 1000; // fast on purpose: the format is what is under test

describe('password hashing', () => {
  it('stores a self-describing hash and verifies the right password', async () => {
    const stored = await hashPassword('Correct horse battery staple', ITERATIONS);

    expect(stored.startsWith('pbkdf2$sha256$')).toBe(true);
    expect(stored.split('$')).toHaveLength(5);
    expect(stored.startsWith(`${PASSWORD_ALGORITHM.replace('-', '$')}$`)).toBe(true);

    const parsed = parsePasswordHash(stored);
    expect(parsed).not.toBeNull();
    expect(parsed?.iterations).toBe(ITERATIONS);
    expect(parsed?.salt.length).toBeGreaterThanOrEqual(8);

    await expect(verifyPassword(stored, 'Correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects a wrong password instead of throwing', async () => {
    const stored = await hashPassword('right-password', ITERATIONS);
    await expect(verifyPassword(stored, 'wrong-password')).resolves.toBe(false);
    await expect(verifyPassword(stored, '')).resolves.toBe(false);
  });

  it('salts every hash, so identical passwords are not identical stored values', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same-password', ITERATIONS),
      hashPassword('same-password', ITERATIONS),
    ]);
    expect(first).not.toBe(second);
    await expect(verifyPassword(first, 'same-password')).resolves.toBe(true);
    await expect(verifyPassword(second, 'same-password')).resolves.toBe(true);
  });

  it('verifies a password typed with different Unicode composition', async () => {
    // "é" as a single code point vs "e" + U+0301 combining accent.
    const stored = await hashPassword('caf\u00e9-pass', ITERATIONS);
    await expect(verifyPassword(stored, 'cafe\u0301-pass')).resolves.toBe(true);
    expect(normalizePassword('cafe\u0301-pass')).toBe('caf\u00e9-pass');
  });

  it('counts password length in code points, not UTF-16 units', () => {
    expect(passwordLength('abc')).toBe(3);
    // Two astral characters = 4 UTF-16 units but only 2 characters.
    expect(passwordLength('\u{1F600}\u{1F600}')).toBe(2);
  });

  it('refuses to hash with a nonsensical iteration count', async () => {
    await expect(hashPassword('x', 0)).rejects.toThrow(RangeError);
    await expect(hashPassword('x', 1.5)).rejects.toThrow(RangeError);
  });

  it('rejects malformed stored hashes rather than crashing a sign-in', () => {
    expect(parsePasswordHash('not-a-hash')).toBeNull();
    expect(parsePasswordHash('pbkdf2$sha512$1000$c2FsdA$a2V5')).toBeNull();
    expect(parsePasswordHash('pbkdf2$sha256$0$c2FsdA$a2V5')).toBeNull();
    expect(parsePasswordHash('pbkdf2$sha256$1000$c2FsdA$a2V5')).toBeNull(); // salt too short
  });

  it('flags hashes that should be upgraded after a policy change', async () => {
    const stored = await hashPassword('rotate-me', 1000);
    expect(needsRehash(stored, 1000)).toBe(false);
    expect(needsRehash(stored, 100_000)).toBe(true);
    expect(needsRehash('garbage', 1000)).toBe(true);
  });
});

describe('crypto primitives', () => {
  it('hashes with SHA-256 to the documented hex digest', async () => {
    // SHA-256("abc") — a published vector, so the digest itself is checked.
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('derives a secret-dependent HMAC that is stable for the same input', async () => {
    const first = await hmacSha256Hex('secret-a', 'message');
    const second = await hmacSha256Hex('secret-a', 'message');
    const other = await hmacSha256Hex('secret-b', 'message');
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compares strings in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('round-trips base64url bytes', () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 128, 63]);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
  });
});

describe('tokens', () => {
  it('generates a high-entropy token and stores only its digest', async () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const digest = await hashToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // The digest is what the database holds: the raw token must not be recoverable.
    await expect(hashToken(token)).resolves.toBe(digest);
    await expect(hashToken(`${token}x`)).resolves.not.toBe(digest);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
  });

  it('keeps the documented TTLs', () => {
    expect(TOKEN_TTL.EMAIL_VERIFICATION_MS).toBe(48 * 60 * 60 * 1000);
    expect(TOKEN_TTL.PASSWORD_RESET_MS).toBe(60 * 60 * 1000);
    // A student's QR identity card is valid for two years.
    expect(TOKEN_TTL.QR_STUDENT_MS).toBe(1000 * 60 * 60 * 24 * 365 * 2);
  });

  it('treats a past timestamp as expired and a future one as live', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(isExpired(new Date(now - 1000).toISOString(), now)).toBe(true);
    expect(isExpired(new Date(now + 1000).toISOString(), now)).toBe(false);
    // A missing expiry means "does not expire" (an optional column, not an expired
    // one) — the QR code and long-lived records rely on that reading.
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(undefined, now)).toBe(false);
    // An unparseable timestamp is treated as expired: fail closed.
    expect(isExpired('not-a-date', now)).toBe(true);
  });

  it('builds expiries from a TTL', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(expiresAtFromNow(60_000, now)).toBe(new Date(now + 60_000).toISOString());
  });
});
