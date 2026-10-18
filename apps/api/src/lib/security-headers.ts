/**
 * Sholynk Tech — security response headers for the API.
 *
 * The Worker only ever returns JSON and SVG, never HTML, so the policy can be as
 * strict as it gets: `default-src 'none'` blocks every fetch/script/frame
 * directive, and the response cannot be embedded in a page at all.
 *
 * Headers are applied from two places — the request-context middleware (before
 * the handler runs) and the error handler (before it writes an error envelope) —
 * so no response shape can bypass them. `applySecurityHeaders` is idempotent.
 */
import type { Context } from 'hono';
import type { AppEnv } from '../env.js';

export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Responses are per-user and must never be stored by a shared cache.
  'Cache-Control': 'no-store, private',
};

/** Adds HSTS only where HTTPS is guaranteed (production). */
export const HSTS_HEADER = 'max-age=31536000; includeSubDomains';

export function applySecurityHeaders(c: Context<AppEnv>): void {
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    c.header(name, value);
  }
  if (c.get('config')?.isProduction) {
    c.header('Strict-Transport-Security', HSTS_HEADER);
  }
}
