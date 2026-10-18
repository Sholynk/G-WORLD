/**
 * Repository — users and profiles.
 *
 * Note which columns are selected: `SELECT *` is never used, so a hash or token
 * cannot be accidentally serialised into a response. Anything that needs the
 * password hash asks for it explicitly via `findCredentialsByEmail()`.
 */
import type { Db, SqlParams } from '../client.js';
import type { AccountStatus, RoleKey } from '@sholynk/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface UserRow {
  id: string;
  email: string;
  role_id: string;
  role_key: RoleKey;
  role_rank: number;
  status: AccountStatus;
  email_verified_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  display_name: string | null;
  full_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  website: string | null;
  country: string | null;
  timezone: string | null;
}

export interface CredentialsRow {
  id: string;
  email: string;
  password_hash: string;
  role_id: string;
  role_key: RoleKey;
  role_rank: number;
  status: AccountStatus;
  email_verified_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
}

export const USER_SELECT = `
  SELECT u.id, u.email, u.role_id, u.status, u.email_verified_at, u.failed_login_attempts,
         u.locked_until, u.last_login_at, u.created_at, u.updated_at,
         r.key AS role_key, r.rank AS role_rank,
         p.display_name, p.full_name, p.bio, p.avatar_url, p.website, p.country, p.timezone
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN user_profiles p ON p.user_id = u.id`;

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  roleId: string;
  status: AccountStatus;
  termsAcceptedAt?: string | null;
}

export interface CreateProfileInput {
  displayName?: string | null;
  fullName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  website?: string | null;
  country?: string | null;
  timezone?: string | null;
}

export async function findById(db: Db, id: string): Promise<UserRow | null> {
  return db.first<UserRow>(`${USER_SELECT} WHERE u.id = ? LIMIT 1`, [id]);
}

export async function findByEmail(db: Db, email: string): Promise<UserRow | null> {
  return db.first<UserRow>(`${USER_SELECT} WHERE u.email = ? COLLATE NOCASE LIMIT 1`, [email]);
}

export async function emailExists(db: Db, email: string): Promise<boolean> {
  return db.exists(`SELECT 1 AS found FROM users WHERE email = ? COLLATE NOCASE LIMIT 1`, [email]);
}

export async function findCredentialsByEmail(db: Db, email: string): Promise<CredentialsRow | null> {
  return db.first<CredentialsRow>(
    `SELECT u.id, u.email, u.password_hash, u.role_id, u.status, u.email_verified_at,
            u.failed_login_attempts, u.locked_until, r.key AS role_key, r.rank AS role_rank
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.email = ? COLLATE NOCASE
      LIMIT 1`,
    [email],
  );
}

export async function findPasswordHash(db: Db, userId: string): Promise<string | null> {
  const row = await db.first<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return row?.password_hash ?? null;
}

export interface CreateUserResult {
  userId: string;
}

/**
 * Creates the account and its profile in one D1 batch, so a failure cannot
 * leave a user without a profile row.
 *
 * Public registration (when enabled) always mints the `editor` role — the role
 * id is resolved by the caller from that key, never from request input, which
 * is what keeps registration from ever minting an administrator.
 */
export async function createUser(
  db: Db,
  input: CreateUserInput,
  profile: CreateProfileInput = {},
): Promise<CreateUserResult> {
  const userId = newId(ID_PREFIXES.user);
  // `user_profiles.user_id` is the primary key and a foreign key onto
  // `users.id`, so the profile row is keyed by the user id.
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(
      `INSERT INTO users (id, email, password_hash, password_algo, password_changed_at, role_id, status,
                          terms_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pbkdf2-sha256', ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        input.email,
        input.passwordHash,
        now,
        input.roleId,
        input.status,
        input.termsAcceptedAt ?? now,
        now,
        now,
      ],
    ),
    db.prepare(
      `INSERT INTO user_profiles (user_id, display_name, full_name, bio, avatar_url, website,
                                  country, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        profile.displayName ?? null,
        profile.fullName ?? null,
        profile.bio ?? null,
        profile.avatarUrl ?? null,
        profile.website ?? null,
        profile.country ?? null,
        profile.timezone ?? null,
        now,
        now,
      ],
    ),
  ]);

  return { userId };
}

export async function updatePasswordHash(db: Db, userId: string, passwordHash: string): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE users SET password_hash = ?, password_changed_at = ?, failed_login_attempts = 0,
                      locked_until = NULL, updated_at = ?
      WHERE id = ?`,
    [passwordHash, now, now, userId],
  );
}

export async function markEmailVerified(db: Db, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, ?),
            status = CASE WHEN status = 'pending_verification' THEN 'active' ELSE status END,
            updated_at = ?
      WHERE id = ?`,
    [now, now, userId],
  );
}

export async function recordSuccessfulLogin(db: Db, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE users
        SET last_login_at = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ?`,
    [now, now, userId],
  );
}

/**
 * Increments the failed-attempt counter and locks the account after
 * `maxAttempts` failures. The lock is time-based (not permanent) so a legitimate
 * account recovers without administrator intervention, while brute forcing
 * becomes economically pointless.
 */
export async function recordFailedLogin(
  db: Db,
  userId: string,
  maxAttempts = 8,
  lockMinutes = 15,
): Promise<{ attempts: number; lockedUntil: string | null }> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE users SET failed_login_attempts = failed_login_attempts + 1, updated_at = ? WHERE id = ?`,
    [now, userId],
  );
  const row = await db.first<{ failed_login_attempts: number }>(
    `SELECT failed_login_attempts FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const attempts = Number(row?.failed_login_attempts ?? 0);
  if (attempts >= maxAttempts) {
    const lockedUntil = new Date(Date.now() + lockMinutes * 60_000).toISOString();
    await db.run(`UPDATE users SET locked_until = ?, updated_at = ? WHERE id = ?`, [
      lockedUntil,
      now,
      userId,
    ]);
    return { attempts, lockedUntil };
  }
  return { attempts, lockedUntil: null };
}

export async function setStatus(
  db: Db,
  userId: string,
  status: AccountStatus,
): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`, [status, now, userId]);
}

export async function setRole(db: Db, userId: string, roleId: string): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(`UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?`, [roleId, now, userId]);
}

export interface UpdateProfileInput {
  display_name?: string | null;
  full_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  website?: string | null;
  country?: string | null;
  timezone?: string | null;
}

/** Partial profile update — only provided keys are written. */
export async function updateProfile(db: Db, userId: string, input: UpdateProfileInput): Promise<number> {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  const push = (column: string, value: string | number | null) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (input.display_name !== undefined) push('display_name', input.display_name);
  if (input.full_name !== undefined) push('full_name', input.full_name);
  if (input.bio !== undefined) push('bio', input.bio);
  if (input.avatar_url !== undefined) push('avatar_url', input.avatar_url);
  if (input.website !== undefined) push('website', input.website);
  if (input.country !== undefined) push('country', input.country);
  if (input.timezone !== undefined) push('timezone', input.timezone);

  if (assignments.length === 0) return 0;
  push('updated_at', new Date().toISOString());

  // Ensure a profile row exists for accounts created before profiles were split.
  await db.run(`INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)`, [userId]);

  params.push(userId);
  return db.changes(
    `UPDATE user_profiles SET ${assignments.join(', ')} WHERE user_id = ?`,
    params,
  );
}

export interface ListUsersFilters {
  q?: string;
  status?: AccountStatus;
  role?: RoleKey;
  verified?: boolean;
  page: number;
  perPage: number;
}

export interface ListUsersResult {
  items: UserRow[];
  total: number;
}

/** Administrator account directory with search, filters and pagination. */
export async function listUsers(db: Db, filters: ListUsersFilters): Promise<ListUsersResult> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.q) {
    conditions.push(
      `(u.email LIKE ? COLLATE NOCASE OR p.display_name LIKE ? COLLATE NOCASE
        OR p.full_name LIKE ? COLLATE NOCASE)`,
    );
    const term = `%${filters.q}%`;
    params.push(term, term, term);
  }
  if (filters.status) {
    conditions.push(`u.status = ?`);
    params.push(filters.status);
  }
  if (filters.role) {
    conditions.push(`r.key = ?`);
    params.push(filters.role);
  }
  if (filters.verified !== undefined) {
    conditions.push(filters.verified ? `u.email_verified_at IS NOT NULL` : `u.email_verified_at IS NULL`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.count(
    `SELECT COUNT(*) AS total
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       ${where}`,
    params,
  );

  const items = await db.all<UserRow>(
    `${USER_SELECT} ${where}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );

  return { items, total };
}

export interface UserStats {
  total: number;
  editors: number;
  admins: number;
  pending: number;
  suspended: number;
  verified: number;
  newThisMonth: number;
}

export async function userStats(db: Db): Promise<UserStats> {
  const row = await db.first<Record<string, number>>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN r.key = 'editor' THEN 1 ELSE 0 END) AS editors,
       SUM(CASE WHEN r.key IN ('admin', 'super_admin') THEN 1 ELSE 0 END) AS admins,
       SUM(CASE WHEN u.status = 'pending_verification' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN u.status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
       SUM(CASE WHEN u.email_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified,
       SUM(CASE WHEN u.created_at >= strftime('%Y-%m-01T00:00:00.000Z', 'now') THEN 1 ELSE 0 END) AS newThisMonth
     FROM users u
     JOIN roles r ON r.id = u.role_id`,
  );

  const num = (value: unknown) => Number(value ?? 0);
  return {
    total: num(row?.total),
    editors: num(row?.editors),
    admins: num(row?.admins),
    pending: num(row?.pending),
    suspended: num(row?.suspended),
    verified: num(row?.verified),
    newThisMonth: num(row?.newThisMonth),
  };
}

/** Minimal user projection for admin pickers. */
export interface UserSummary {
  id: string;
  email: string;
  status: AccountStatus;
  role_key: RoleKey;
  display_name: string | null;
  created_at: string;
  email_verified_at: string | null;
}

export async function findSummaryById(db: Db, id: string): Promise<UserSummary | null> {
  return db.first<UserSummary>(
    `SELECT u.id, u.email, u.status, u.created_at, u.email_verified_at,
            r.key AS role_key, p.display_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ?
      LIMIT 1`,
    [id],
  );
}

/** Super-admin helper: how many active accounts hold a given role. */
export async function countUsersWithRole(db: Db, roleKey: RoleKey, excludeUserId?: string): Promise<number> {
  const params: SqlParams = [roleKey];
  let sql = `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = ?`;
  if (excludeUserId) {
    sql += ` AND u.id <> ?`;
    params.push(excludeUserId);
  }
  return db.count(sql, params);
}
