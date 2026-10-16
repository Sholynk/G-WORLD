/**
 * G WORLD — cryptographic primitives.
 *
 * Every function here relies exclusively on the Web Crypto API available in the
 * Workers runtime, so there are no native dependencies and the behaviour is
 * identical in workerd (production), Miniflare (tests) and Node (unit tests).
 *
 * Rules enforced by this module:
 *   - secrets are compared in constant time
 *   - random values always come from `crypto.getRandomValues`
 *   - hashes are hex-encoded lowercase, so they are safe as database keys
 */

const HEX_ALPHABET = '0123456789abcdef';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX_ALPHABET[byte >> 4]! + HEX_ALPHABET[byte & 0x0f]!;
  }
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Cryptographically secure random bytes. */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Cryptographically secure random string in a given alphabet.
 *
 * Uses rejection sampling so every character is uniformly distributed — modulo
 * arithmetic on random bytes would bias the low characters (and therefore
 * shorten effective token entropy).
 */
export function randomString(length: number, alphabet: string): string {
  if (alphabet.length < 2 || alphabet.length > 256) {
    throw new RangeError('alphabet must contain between 2 and 256 characters');
  }
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    const chunk = randomBytes(Math.max(16, length - out.length));
    for (const byte of chunk) {
      if (byte >= limit) continue; // reject to remove modulo bias
      out += alphabet[byte % alphabet.length]!;
      if (out.length === length) break;
    }
  }
  return out;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

type HmacUsage = 'sign' | 'verify';

async function hmacKey(secret: string, usages: HmacUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Irreversible, non-reversible-in-practice keyed hash of a client IP address.
 * Storing `HMAC(secret, ip)` satisfies audit/rate-limit needs without keeping
 * raw IP addresses (personal data) in the database.
 */
export async function hashIp(ip: string | null | undefined, secret: string): Promise<string> {
  const normalized = (ip ?? 'unknown').trim();
  return hmacSha256Hex(secret, `g-world:ip:${normalized}`);
}

/** Constant-time string comparison. Length differences are still detectable. */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}
