/**
 * Repository — database-backed sessions (ADR-0003).
 *
 * The raw session token only ever exists in the user's httpOnly cookie. This
 * repository stores and looks up its SHA-256 hash, so the database is useless
 * to an attacker who cannot also set the victim's cookie.
 */
import type { Db } from '../client.js';
import type { AccountStatus, RoleKey } from '@sholynk/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip_hash: string | null;
  user_agent: string | null;
}

/** Session joined with everything the auth middleware needs. */
export interface SessionUserRow extends SessionRow {
  email: string;
  role_key: RoleKey;
  role_rank: number;
  role_id: string;
  status: AccountStatus;
  email_verified_at: string | null;
  display_name: string | null;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  ipHash?: string | null;
  userAgent?: string | null;
}

export async function createSession(db: Db, input: CreateSessionInput): Promise<string> {
  const id = newId(ID_PREFIXES.session);
  await db.run(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.tokenHash,
      input.expiresAt,
      input.ipHash ?? null,
      input.userAgent ? input.userAgent.slice(0, 400) : null,
    ],
  );
  return id;
}

/**
 * Resolves a live session by token hash. Revoked and expired rows are excluded
 * by the query itself, so a caller cannot forget the check.
 */
export async function findActiveSession(
  db: Db,
  tokenHash: string,
  now: string = new Date().toISOString(),
): Promise<SessionUserRow | null> {
  return db.first<SessionUserRow>(
    `SELECT s.id, s.user_id, s.token_hash, s.created_at, s.last_seen_at, s.expires_at,
            s.revoked_at, s.ip_hash, s.user_agent,
            u.email, u.status, u.email_verified_at, u.role_id,
            r.key AS role_key, r.rank AS role_rank,
            p.display_name
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
      LIMIT 1`,
    [tokenHash, now],
  );
}

/** Updates `last_seen_at` at most once per hour to avoid a write per request. */
export async function touchSession(db: Db, sessionId: string, now: string = new Date().toISOString()): Promise<void> {
  await db.run(
    `UPDATE user_sessions
        SET last_seen_at = ?
      WHERE id = ?
        AND last_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-1 hour')`,
    [now, sessionId, now],
  );
}

export async function revokeSession(db: Db, sessionId: string, reason = 'logout'): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(
    `UPDATE user_sessions SET revoked_at = ?, revoked_reason = ?
      WHERE id = ? AND revoked_at IS NULL`,
    [now, reason, sessionId],
  );
}

export async function revokeSessionByTokenHash(
  db: Db,
  tokenHash: string,
  reason = 'logout',
): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(
    `UPDATE user_sessions SET revoked_at = ?, revoked_reason = ?
      WHERE token_hash = ? AND revoked_at IS NULL`,
    [now, reason, tokenHash],
  );
}

/**
 * Revokes every session of a user — used after a password change, a role change
 * or an account suspension, so a stolen cookie stops working immediately.
 * The caller may keep the current session by passing its id.
 */
export async function revokeAllUserSessions(
  db: Db,
  userId: string,
  reason: string,
  keepSessionId?: string,
): Promise<number> {
  const now = new Date().toISOString();
  if (keepSessionId) {
    return db.changes(
      `UPDATE user_sessions SET revoked_at = ?, revoked_reason = ?
        WHERE user_id = ? AND revoked_at IS NULL AND id <> ?`,
      [now, reason, userId, keepSessionId],
    );
  }
  return db.changes(
    `UPDATE user_sessions SET revoked_at = ?, revoked_reason = ?
      WHERE user_id = ? AND revoked_at IS NULL`,
    [now, reason, userId],
  );
}

export interface SessionSummary {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip_hash: string | null;
  user_agent: string | null;
}

export async function listUserSessions(db: Db, userId: string): Promise<SessionSummary[]> {
  return db.all<SessionSummary>(
    `SELECT id, created_at, last_seen_at, expires_at, ip_hash, user_agent
       FROM user_sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC
      LIMIT 50`,
    [userId, new Date().toISOString()],
  );
}

/**
 * Housekeeping for expired sessions. Called from a scheduled handler (or a
 * manual admin action) rather than on every request.
 */
export async function deleteExpiredSessions(db: Db, olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  return db.changes(`DELETE FROM user_sessions WHERE expires_at < ?`, [cutoff]);
}

export async function countActiveSessions(db: Db, userId: string): Promise<number> {
  return db.count(
    `SELECT COUNT(*) AS total FROM user_sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    [userId, new Date().toISOString()],
  );
}
