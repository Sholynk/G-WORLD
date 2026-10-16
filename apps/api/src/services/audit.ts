/**
 * Service — audit writing bound to the request context.
 *
 * `audit(c, entry)` fills in the actor (from the resolved session), the hashed
 * client IP, the user agent and the request id, then hands the entry to the
 * repository. Handlers therefore write a one-line audit record without repeating
 * the plumbing — which is what keeps the audit trail complete instead of
 * optional.
 *
 * It never throws: a logging failure must not fail a user's request.
 */
import type { AppContext } from '../env.js';
import { createDb } from '../db/client.js';
import * as auditRepo from '../db/repositories/audit.js';
import type { AuditEntryInput } from '../lib/audit.js';

export type AuditCall = Omit<
  AuditEntryInput,
  'ipHash' | 'userAgent' | 'requestId' | 'actorRole'
> & {
  actorRole?: string | null;
  actorUserId?: string | null;
};

export async function audit(c: AppContext, entry: AuditCall): Promise<string> {
  try {
    const db = createDb(c.env.DB);
    const auth = c.get('auth');
    return await auditRepo.record(db, {
      ...entry,
      actorUserId: entry.actorUserId ?? auth?.userId ?? null,
      actorRole: entry.actorRole ?? auth?.roleKey ?? null,
      ipHash: c.get('clientIpHash') ?? null,
      userAgent: c.req.header('user-agent') ?? null,
      requestId: c.get('requestId') ?? null,
    });
  } catch (error) {
    c.get('logger')?.warn('audit write failed', {
      action: entry.action,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return 'audit_unwritten';
  }
}
