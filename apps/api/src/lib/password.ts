/**
 * G WORLD — password hashing (PBKDF2-HMAC-SHA256 via Web Crypto).
 *
 * Stored format (self-describing, so the algorithm can be rotated later):
 *
 *   pbkdf2$sha256$<iterations>$<salt_base64>$<derived_key_base64>
 *
 * Design notes
 *   - Plaintext passwords never leave this module: they are not logged, not
 *     stored, and not returned in any API response.
 *   - `needsRehash()` lets a successful sign-in transparently upgrade a hash
 *     when the configured iteration count increases.
 *   - Verification is constant-time with respect to the derived key.
 *   - The iteration count is configurable because the Cloudflare free plan
 *     allows 10 ms of CPU per request; see docs/adr/0004-pbkdf2-via-webcrypto-for-passwords.md
 *     for the trade-off and the recommended production value.
 */
import { base64UrlToBytes, bytesToBase64, bytesToHex, randomBytes, timingSafeEqual } from './crypto.js';

export const PASSWORD_ALGORITHM = 'pbkdf2-sha256';
const PREFIX = 'pbkdf2$sha256';
const SALT_BYTES = 16;
const KEY_BITS = 256;

export interface ParsedPasswordHash {
  iterations: number;
  salt: Uint8Array;
  keyHex: string;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    // Web Crypto requires a BufferSource; copy so the caller's array is untouched.
    { name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations },
    keyMaterial,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Normalises a password before hashing.
 *
 * Unicode normalisation means a password typed on a different keyboard layout
 * (or composed with different combining characters) still verifies. The length
 * is also measured in code points so a malformed emoji sequence cannot be used
 * to bypass a minimum-length check.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export function passwordLength(password: string): number {
  return [...normalizePassword(password)].length;
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError('iterations must be a positive integer');
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(normalizePassword(password), salt, iterations);
  return `${PREFIX}$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(key)}`;
}

export function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.split('$');
  if (parts.length !== 5) return null;
  const [scheme, hash, iterationsRaw, saltRaw, keyRaw] = parts as [string, string, string, string, string];
  if (scheme !== 'pbkdf2' || hash !== 'sha256') return null;
  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5_000_000) return null;
  try {
    const saltBytes = base64UrlToBytes(saltRaw.replace(/\+/g, '-').replace(/\//g, '_'));
    const keyBytes = base64UrlToBytes(keyRaw.replace(/\+/g, '-').replace(/\//g, '_'));
    if (saltBytes.length < 8 || keyBytes.length < 16) return null;
    return { iterations, salt: saltBytes, keyHex: bytesToHex(keyBytes) };
  } catch {
    return null;
  }
}

/** Verifies a password against a stored hash. Never throws on malformed input. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const derived = await deriveKey(normalizePassword(password), parsed.salt, parsed.iterations);
  return timingSafeEqual(bytesToHex(derived), parsed.keyHex);
}

/** True when a stored hash was created with a weaker configuration than now. */
export function needsRehash(stored: string, desiredIterations: number): boolean {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return true;
  return parsed.iterations < desiredIterations;
}

/**
 * A cheap-but-expensive check used to keep sign-in timing uniform for unknown
 * email addresses (prevents account enumeration through response timing).
 */
export async function dummyVerify(password: string, iterations: number): Promise<void> {
  await deriveKey(normalizePassword(password), new Uint8Array(SALT_BYTES).fill(7), iterations);
}
