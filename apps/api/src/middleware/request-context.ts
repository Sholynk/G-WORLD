/**
 * Middleware — request context.
 *
 * Runs first for every request and establishes the values the rest of the stack
 * relies on: a request id (echoed in the response and in every log line), a
 * structured logger, the parsed configuration, and a hashed client IP.
 *
 * Raw IP addresses are hashed here and never stored: rate limiting and audit
 * logging need a stable identifier, not the address itself.
 */
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env.js';
import { getConfig } from '../env.js';
import { createLogger } from '../lib/logger.js';
import { hashIp } from '../lib/crypto.js';
import { requestId as newRequestId } from '../lib/ids.js';
import { applySecurityHeaders } from '../lib/security-headers.js';

export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.req.header('cf-ray') ? `req_${c.req.header('cf-ray')}` : newRequestId();
  const config = getConfig(c.env);

  // Cloudflare sets cf-connecting-ip; X-Forwarded-For is the fallback used by
  // `wrangler dev` and by the local dev proxy.
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = c.req.header('cf-connecting-ip') ?? forwarded ?? null;
  const clientIpHash = await hashIp(ip, config.sessionSecret);

  const logger = createLogger({
    request_id: requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
  });

  c.set('requestId', requestId);
  c.set('logger', logger);
  c.set('config', config);
  c.set('clientIpHash', clientIpHash);
  c.set('auth', null);

  // Applied before the handler runs so that error responses — which are written
  // by the error handler, not by this middleware — carry them too.
  applySecurityHeaders(c);

  const started = Date.now();
  await next();

  c.header('X-Request-Id', requestId);
  // Server-Timing is safe to expose and makes slow endpoints obvious in devtools.
  c.header('Server-Timing', `app;dur=${Date.now() - started}`);

  const status = c.res.status;
  const fields = { status, duration_ms: Date.now() - started };
  if (status >= 500) logger.error('request failed', fields);
  else if (status >= 400) logger.warn('request rejected', fields);
  else logger.info('request completed', fields);
});
