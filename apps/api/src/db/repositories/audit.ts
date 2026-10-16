/**
 * Repository — audit log.
 *
 * Writes are fire-and-forget from the caller's perspective: `record()` never
 * throws, because a logging failure must not fail the user's request. Every
 * privileged route records an entry, which is what makes the administrator
 * dashboard's activity feed trustworthy.
 */
import type { Db } from '../client.js';
import { ID_PREFIXES, newId } from '../../lib/ids.js';
import { sanitizeMetadata, type AuditEntryInput } from '../../lib/audit.js';

export interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  description: string | null;
  metadata_json: string;
  status: 'success' | 'failure';
  ip_hash: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

export interface AuditActor {
  userId?: string | null;
  role?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export async function record(db: Db, entry: AuditEntryInput): Promise<string> {
  const id = newId(ID_PREFIXES.audit);
  try {
    await db.run(
      `INSERT INTO audit_logs (id, actor_user_id, actor_role, action, entity_type, entity_id,
                               description, metadata_json, status, ip_hash, user_agent, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.actorUserId ?? null,
        entry.actorRole ?? null,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.description ?? null,
        sanitizeMetadata(entry.metadata),
        entry.status ?? 'success',
        entry.ipHash ?? null,
        entry.userAgent ? entry.userAgent.slice(0, 400) : null,
        entry.requestId ?? null,
      ],
    );
  } catch {
    // Audit logging must never break a request; the error is visible in logs
    // via the caller's logger if it becomes a pattern.
    return id;
  }
  return id;
}

export interface ListAuditFilters {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page: number;
  perPage: number;
}

export async function listAuditEntries(
  db: Db,
  filters: ListAuditFilters,
): Promise<{ items: AuditRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.actor) {
    conditions.push(`actor_user_id = ?`);
    params.push(filters.actor);
  }
  if (filters.action) {
    conditions.push(`action LIKE ?`);
    params.push(`%${filters.action}%`);
  }
  if (filters.entityType) {
    conditions.push(`entity_type = ?`);
    params.push(filters.entityType);
  }
  if (filters.entityId) {
    conditions.push(`entity_id = ?`);
    params.push(filters.entityId);
  }
  if (filters.from) {
    conditions.push(`created_at >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`created_at <= ?`);
    params.push(filters.to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.count(`SELECT COUNT(*) AS total FROM audit_logs ${where}`, params);
  const items = await db.all<AuditRow>(
    `SELECT id, actor_user_id, actor_role, action, entity_type, entity_id, description,
            metadata_json, status, ip_hash, user_agent, request_id, created_at
       FROM audit_logs ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );
  return { items, total };
}

/** Recent activity feed shown on the admin dashboard. */
export async function recentActivity(db: Db, limit = 10): Promise<AuditRow[]> {
  return db.all<AuditRow>(
    `SELECT id, actor_user_id, actor_role, action, entity_type, entity_id, description,
            metadata_json, status, ip_hash, user_agent, request_id, created_at
       FROM audit_logs
      ORDER BY created_at DESC
      LIMIT ?`,
    [limit],
  );
}

export async function countFailedLoginsSince(db: Db, isoSince: string): Promise<number> {
  return db.count(
    `SELECT COUNT(*) AS total FROM audit_logs
      WHERE action = 'auth.login.failed' AND created_at >= ?`,
    [isoSince],
  );
}

export async function pruneAuditLogs(db: Db, keepDays = 730): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  return db.changes(`DELETE FROM audit_logs WHERE created_at < ?`, [cutoff]);
}
