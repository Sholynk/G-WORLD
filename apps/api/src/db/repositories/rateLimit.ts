/**
 * Repository — fixed-window rate limiting, backed by D1.
 *
 * Why the database rather than Durable Objects or KV?
 *   - D1 is already a required binding, so limiting works with zero extra
 *     services and zero extra cost on the free plan (see docs/09).
 *   - The counters are small and short-lived: one row per key per window.
 *   - Correctness matters more than sub-millisecond latency here: sign-in,
 *     registration and password-reset endpoints benefit from a hard, shared
 *     limit per IP address, which is exactly what a central store gives us.
 *
 * Keys are hashed (`login:ip:<hmac>`, `login:acct:<userId>`), so raw IP
 * addresses are never persisted.
 */
import type { Db } from '../client.js';

export interface RateLimitRule {
  /** Logical scope, e.g. `auth.login`. */
  scope: string;
  /** Maximum allowed hits inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Optional extra lockout applied once the limit is exceeded. */
  blockSeconds?: number;
}

export interface RateLimitState {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  count: number;
}

/** Sensible defaults per sensitive endpoint (documented in docs/05-security.md). */
export const RATE_LIMIT_RULES: Record<string, RateLimitRule> = {
  'owner.setup.request': { scope: 'owner.setup.request', limit: 3, windowSeconds: 3600, blockSeconds: 3600 },
  'owner.setup.complete': { scope: 'owner.setup.complete', limit: 8, windowSeconds: 900, blockSeconds: 900 },
  'owner.code.request': { scope: 'owner.code.request', limit: 3, windowSeconds: 3600, blockSeconds: 3600 },
  'owner.confirmation': { scope: 'owner.confirmation', limit: 5, windowSeconds: 900, blockSeconds: 900 },
  'auth.register': { scope: 'auth.register', limit: 5, windowSeconds: 3600, blockSeconds: 1800 },
  'auth.login': { scope: 'auth.login', limit: 10, windowSeconds: 900, blockSeconds: 900 },
  'auth.login.account': { scope: 'auth.login.account', limit: 8, windowSeconds: 900, blockSeconds: 900 },
  'auth.forgot_password': { scope: 'auth.forgot_password', limit: 5, windowSeconds: 3600, blockSeconds: 1800 },
  'auth.resend_verification': { scope: 'auth.resend_verification', limit: 3, windowSeconds: 3600, blockSeconds: 1800 },
  'auth.reset_password': { scope: 'auth.reset_password', limit: 10, windowSeconds: 3600, blockSeconds: 900 },
  'forms.public': { scope: 'forms.public', limit: 8, windowSeconds: 600 },
  'engagement.write': { scope: 'engagement.write', limit: 60, windowSeconds: 900 },
  'comment.write': { scope: 'comment.write', limit: 20, windowSeconds: 900 },
  'view.record': { scope: 'view.record', limit: 240, windowSeconds: 900 },
  'upload.request': { scope: 'upload.request', limit: 30, windowSeconds: 3600 },
  'api.read': { scope: 'api.read', limit: 600, windowSeconds: 300 },
};

export function windowStartIso(windowSeconds: number, now: number = Date.now()): string {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now / windowMs) * windowMs).toISOString();
}

export function windowExpiryIso(windowSeconds: number, now: number = Date.now()): string {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now / windowMs) * windowMs + windowMs).toISOString();
}

/**
 * Counts a hit and returns the resulting state.
 *
 * The `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count` upsert makes the
 * increment atomic in a single statement, so two concurrent requests cannot
 * both observe a stale count. A previous lockout (`blocked_until`) is honoured
 * even after the window rolls over, which is what turns a burst into a cool-off.
 */
export async function consume(
  db: Db,
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): Promise<RateLimitState> {
  const start = windowStartIso(rule.windowSeconds, now);
  const expires = windowExpiryIso(rule.windowSeconds, now);
  const nowIso = new Date(now).toISOString();

  const row = await db.first<{ count: number; blocked_until: string | null }>(
    `INSERT INTO rate_limits (key, scope, count, window_start, expires_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start
                    THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at
     RETURNING count, blocked_until`,
    [key, rule.scope, start, expires, nowIso],
  );

  const count = Number(row?.count ?? 1);
  const blockedUntil = row?.blocked_until ?? null;

  if (blockedUntil && blockedUntil > nowIso) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(blockedUntil) - now) / 1000)),
      count,
    };
  }

  if (count > rule.limit) {
    const blockMs = (rule.blockSeconds ?? rule.windowSeconds) * 1000;
    const until = new Date(now + blockMs).toISOString();
    await db.run(`UPDATE rate_limits SET blocked_until = ?, updated_at = ? WHERE key = ?`, [
      until,
      nowIso,
      key,
    ]);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(blockMs / 1000), count };
  }

  return {
    allowed: true,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: 0,
    count,
  };
}

/** Clears a counter — called after a successful sign-in to stop punishing users. */
export async function reset(db: Db, key: string): Promise<void> {
  await db.run(`DELETE FROM rate_limits WHERE key = ?`, [key]);
}

/** Read-only check used by tests and diagnostics. */
export async function peek(db: Db, key: string): Promise<{ count: number; blockedUntil: string | null } | null> {
  const row = await db.first<{ count: number; blocked_until: string | null }>(
    `SELECT count, blocked_until FROM rate_limits WHERE key = ? LIMIT 1`,
    [key],
  );
  return row ? { count: Number(row.count), blockedUntil: row.blocked_until } : null;
}

/** Housekeeping for expired windows. */
export async function purgeExpired(db: Db, olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000).toISOString();
  return db.changes(
    `DELETE FROM rate_limits
      WHERE expires_at < ?
        AND (blocked_until IS NULL OR blocked_until < ?)`,
    [cutoff, cutoff],
  );
}
