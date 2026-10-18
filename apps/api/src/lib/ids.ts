/**
 * Sholynk Tech — identifier generation.
 *
 * Two kinds of identifiers exist:
 *
 * 1. Internal record ids — `usr_01JD8Q…`, a ULID-style value: a 48-bit
 *    millisecond timestamp in Crockford base32 followed by 80 bits of
 *    randomness. They sort chronologically (so `ORDER BY id` is a stable
 *    creation order) and are generated without a database round trip.
 *
 * Editorial content (articles, authors, comments…) keeps the legacy CMS's
 * INTEGER AUTOINCREMENT ids; only platform entities use prefixed ULIDs.
 */
import { randomBytes, randomString } from './crypto.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** ULID-compatible: 10 chars of time + 16 chars of randomness. */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let remaining = Math.floor(now);
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[remaining % 32]! + time;
    remaining = Math.floor(remaining / 32);
  }
  return time + randomString(16, CROCKFORD);
}

const PREFIX_PATTERN = /^[a-z][a-z0-9]{1,9}$/;

/** `newId('usr')` -> `usr_01JD8QZ6M9V4T2N8QW1F5H7K3B` */
export function newId(prefix: string, now?: number): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new RangeError(`invalid id prefix: ${prefix}`);
  }
  return `${prefix}_${ulid(now)}`;
}

export const ID_PREFIXES = {
  user: 'usr',
  session: 'ses',
  role: 'role',
  permission: 'perm',
  profile: 'prf',
  notification: 'ntf',
  emailMessage: 'eml',
  verificationToken: 'evt',
  resetToken: 'prt',
  audit: 'aud',
  image: 'img',
  request: 'req',
} as const;

export function prefixed(prefix: keyof typeof ID_PREFIXES, now?: number): string {
  return newId(ID_PREFIXES[prefix], now);
}

/** Request ids appear in logs and in the `meta.request_id` of every response. */
export function requestId(): string {
  return `req_${ulid()}`;
}

/** Length-independent check used by integration tests and admin search. */
export function looksLikeId(value: string, prefix?: string): boolean {
  const match = /^([a-z][a-z0-9]{1,9})_([0-9A-HJKMNP-TV-Z]{26})$/.exec(value);
  if (!match) return false;
  return prefix ? match[1] === prefix : true;
}

/** Random hex string — used for test fixtures and cache-busting keys. */
export function randomHex(bytes = 8): string {
  return Array.from(randomBytes(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
