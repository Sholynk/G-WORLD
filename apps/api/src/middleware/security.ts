/**
 * Middleware — CORS policy and CSRF protection.
 *
 * **Same-origin by default.** In the standard deployment the Pages proxy
 * forwards `/api/*` to this Worker through a service binding, so the browser
 * sees one origin and CORS is irrelevant. `ALLOWED_ORIGINS` exists for the case
 * where someone points a frontend at the Worker directly; only the exact listed
 * origins are accepted, and the API never reflects an arbitrary origin.
 *
 * **CSRF via session-bound double submit.** For unsafe methods the request must
 * carry an `X-CSRF-Token` header matching `HMAC(SESSION_SECRET, session token)`.
 * The CSRF cookie is readable by our own JavaScript (that is the whole point of
 * double submit) but not by another site, and the header cannot be set by a
 * cross-site HTML form. Requests that carry no session cookie — or that
 * authenticate with a bearer token, which is not an ambient credential — are
 * exempt.
 */
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env.js';
import { AppError } from '../lib/errors.js';
import { csrfTokenFor } from '../lib/tokens.js';
import { timingSafeEqual } from '../lib/crypto.js';
import { CSRF_HEADER, SESSION_COOKIE, readCookie } from '../lib/cookies.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-CSRF-Token',
  'X-Request-Id',
  'Accept',
  'Accept-Language',
  'Content-Language',
];
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

export const securityMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const config = c.get('config');
  const origin = c.req.header('origin');
  // `Boolean(origin)` does not narrow the type, and an undefined origin must
  // never match an allow-list entry — compare explicitly.
  const isAllowedOrigin = typeof origin === 'string' && origin.length > 0 && config.allowedOrigins.includes(origin);

  if (origin) c.header('Vary', 'Origin');

  if (c.req.method === 'OPTIONS') {
    if (!isAllowedOrigin) {
      // No allowed origin means "same-origin only": a cross-origin preflight is
      // refused rather than answered with a permissive policy.
      return c.body(null, 403);
    }
    return c.body(null, 204, {
      'Access-Control-Allow-Origin': origin!,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
      'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
      'Access-Control-Max-Age': '600',
    });
  }

  if (origin && isAllowedOrigin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  } else if (origin && UNSAFE_METHODS.has(c.req.method)) {
    // Reject the write outright: silently serving it would look like success to
    // a caller while the browser discards the response.
    throw new AppError('FORBIDDEN', 'This origin is not allowed to call the G WORLD API');
  }

  if (UNSAFE_METHODS.has(c.req.method)) {
    const sessionToken = readCookie(c.req.header('cookie'), SESSION_COOKIE);
    const usesBearer = Boolean(c.req.header('authorization'));

    if (sessionToken && !usesBearer) {
      const expected = await csrfTokenFor(sessionToken, config.sessionSecret);
      // Header only. Accepting the cookie as a fallback would defeat double
      // submit: a sibling-origin page (same registrable domain, so same site)
      // can have the cookie sent by the browser, but it cannot read it and
      // therefore cannot copy it into a header.
      const provided = c.req.header(CSRF_HEADER) ?? '';
      if (!provided || !timingSafeEqual(provided, expected)) {
        throw new AppError('FORBIDDEN', 'Missing or invalid CSRF token. Refresh the page and try again.', {
          logFields: { reason: 'csrf_mismatch' },
        });
      }
    }
  }

  await next();
});
