/**
 * Admin routes — platform system endpoints.
 *
 *   GET  /admin/system/stats        headline account + content counts
 *   GET  /admin/system/audit        the audit trail (newest first)
 *   POST /admin/system/maintenance  the nightly housekeeping, on demand
 *
 * The maintenance endpoint runs exactly the same repository calls as the cron
 * trigger (see src/index.ts), so behaviour is identical whether housekeeping
 * is triggered by the schedule or by an administrator.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as usersRepo from '../../db/repositories/users.js';
import * as auditRepo from '../../db/repositories/audit.js';
import * as sessionsRepo from '../../db/repositories/sessions.js';
import * as tokensRepo from '../../db/repositories/tokens.js';
import * as rateLimitRepo from '../../db/repositories/rateLimit.js';
import * as articlesRepo from '../../db/repositories/articles.js';
import * as analyticsRepo from '../../db/repositories/analytics.js';
import { requirePermission } from '../../middleware/auth.js';
import { limitQuerySchema } from '@sholynk/shared';
import { parseQuery } from '../../middleware/validate.js';
import { toAuditDto } from '../../schemas/mappers.js';
import { ok } from '../helpers.js';

export const adminSystemRoutes = new Hono<AppEnv>();

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

adminSystemRoutes.get('/system/stats', requirePermission('analytics.read'), async (c) => {
  const db = dbFrom(c);
  const [users, statuses] = await Promise.all([
    usersRepo.userStats(db),
    analyticsRepo.statusBreakdown(db),
  ]);
  return ok(c, { users, articles: statuses });
});

adminSystemRoutes.get('/system/audit', requirePermission('audit.read'), async (c) => {
  const raw = c.req.query('action');
  const query = parseQuery(c, limitQuerySchema);
  const db = dbFrom(c);
  const limit = Math.min(query.limit ?? 50, 200);
  // Support filtering for failed logins: ?action=auth.login.failed
  if (raw) {
    const rows = await auditRepo.listAuditEntries(db, {
      page: 1,
      perPage: limit,
      action: raw,
    });
    return ok(c, rows.items.map(toAuditDto), { meta: { total: rows.total } });
  }
  const rows = await auditRepo.listAuditEntries(db, {
    page: 1,
    perPage: limit,
  });
  return ok(c, rows.items.map(toAuditDto));
});

adminSystemRoutes.get('/system/audit/failed-logins', requirePermission('audit.read'), async (c) => {
  const query = parseQuery(c, limitQuerySchema);
  const page = Number(c.req.query('page') ?? 1);
  const limit = Math.min(query.limit ?? 50, 200);
  const db = dbFrom(c);
  const rows = await auditRepo.listFailedLogins(db, { page: Number.isFinite(page) && page > 0 ? page : 1, perPage: limit });
  return ok(c, rows.items.map(toAuditDto), { meta: { total: rows.total, page, per_page: limit, total_pages: Math.ceil(rows.total / limit) || 1 } });
});

adminSystemRoutes.delete('/system/audit/failed-logins', requirePermission('admin.manage'), async (c) => {
  const db = dbFrom(c);
  const deleted = await auditRepo.deleteFailedLoginAudits(db);
  await c.get('logger')?.info?.('Failed login audit entries cleared', { deleted });
  return ok(c, { deleted });
});

adminSystemRoutes.delete('/system/audit/:id', requirePermission('admin.manage'), async (c) => {
  const db = dbFrom(c);
  const id = c.req.param('id');
  const deleted = await auditRepo.deleteAuditEntry(db, id);
  if (!deleted) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Audit entry not found' } }, 404);
  }
  return ok(c, { deleted: true, id });
});

adminSystemRoutes.post('/system/maintenance', requirePermission('settings.write'), async (c) => {
  const db = dbFrom(c);
  const config = c.get('config');

  const [sessions, tokens, limits, auditRows, published, attributed] = await Promise.all([
    sessionsRepo.deleteExpiredSessions(db, 30),
    tokensRepo.purgeStaleTokens(db, 7),
    rateLimitRepo.purgeExpired(db, 24),
    auditRepo.pruneAuditLogs(db, config.isProduction ? 730 : 30),
    articlesRepo.publishDueScheduled(db),
    articlesRepo.attributeOrphanedArticles(db),
  ]);

  return ok(c, {
    sessions_deleted: sessions,
    tokens_deleted: tokens,
    rate_limits_deleted: limits,
    audit_rows_deleted: auditRows,
    scheduled_published: published,
    articles_reattributed: attributed,
  });
});
