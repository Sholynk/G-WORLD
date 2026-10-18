/**
 * Sholynk Tech — application factory.
 *
 * `buildApp()` returns a fresh Hono instance with the full middleware stack and
 * the v1 router mounted. Two reasons it is a factory rather than a module-level
 * singleton:
 *
 *   1. integration tests can build a fresh app per test file and be certain no
 *      state leaks between them;
 *   2. the hosting entry point (`index.ts`) can wrap or extend the app (scheduled
 *      handlers, queue consumers) without editing this file.
 *
 * Middleware order (outermost first):
 *   requestContext  → ids, logger, config, IP hash, security headers
 *   onError         → one JSON error envelope for every thrown error
 *   securityMiddleware → CORS policy + CSRF for unsafe methods
 *   resolveAuth     → session → auth context (never rejects)
 *   cors fallback for unmatched OPTIONS, then the routers
 */
import { Hono } from 'hono';
import type { AppEnv } from './env.js';
import { requestContext } from './middleware/request-context.js';
import { handleApiError, notFoundHandler } from './middleware/error-handler.js';
import { securityMiddleware } from './middleware/security.js';
import { resolveAuth } from './middleware/auth.js';
import { apiRoutes } from './routes/index.js';

export const API_PREFIX = '/api/v1';

export function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // 1. Context first: everything below needs the logger and config.
  app.use('*', requestContext);

  // 2. Error handling. `onError` (not a wrapping middleware) is the hook Hono
  //    actually dispatches thrown errors to — see the note in error-handler.ts.
  app.onError(handleApiError);

  // 3. Transport security: CORS policy and CSRF.
  app.use('*', securityMiddleware);

  // 4. Session resolution (populates c.get('auth') when a valid session exists).
  app.use(`${API_PREFIX}/*`, resolveAuth);

  // 5. API routes.
  app.route(API_PREFIX, apiRoutes);

  // 6. Anything else: a JSON 404 in the same envelope as every other response.
  app.notFound(notFoundHandler);

  return app;
}
