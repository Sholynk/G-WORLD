/**
 * G WORLD — Cloudflare Worker entry point.
 *
 * Exports the standard `fetch` handler plus a `scheduled` handler used by
 * Cloudflare Cron Triggers for housekeeping (see wrangler.jsonc → triggers):
 *
 *   - expired sessions, consumed tokens and stale rate-limit windows are purged
 *   - orphaned audit rows older than the retention window are pruned
 *
 * The scheduled handler runs the same repositories as the admin maintenance
 * endpoint, so behaviour is identical whether housekeeping is triggered by cron or
 * by an administrator.
 */
import { buildApp } from './app.js';
import type { Bindings } from './env.js';
import { createDb } from './db/client.js';
import { createLogger } from './lib/logger.js';
import { getConfig } from './env.js';

const app = buildApp();

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger({ cron: event.cron, source: 'scheduled' });
    const config = getConfig(env);
    const db = createDb(env.DB);

    const work = async () => {
      const sessionsRepo = await import('./db/repositories/sessions.js');
      const tokensRepo = await import('./db/repositories/tokens.js');
      const rateLimitRepo = await import('./db/repositories/rateLimit.js');
      const auditRepo = await import('./db/repositories/audit.js');

      const [sessions, tokens, limits, auditRows] = await Promise.all([
        sessionsRepo.deleteExpiredSessions(db, 30),
        tokensRepo.purgeStaleTokens(db, 7),
        rateLimitRepo.purgeExpired(db, 24),
        auditRepo.pruneAuditLogs(db, config.isProduction ? 730 : 30),
      ]);

      logger.info('scheduled maintenance complete', {
        sessions_deleted: sessions,
        tokens_deleted: tokens,
        rate_limits_deleted: limits,
        audit_rows_deleted: auditRows,
      });
    };

    // `waitUntil` keeps the isolate alive until housekeeping finishes, so the
    // cron trigger does not report completion prematurely.
    ctx.waitUntil(work());
  },
};
