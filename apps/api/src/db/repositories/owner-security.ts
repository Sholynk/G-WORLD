import type { Db } from '../client.js';
import { conflict } from '../../lib/errors.js';

export type OwnerTokenPurpose = 'setup' | 'code_recovery';
export const invalidOwnerLink = () => conflict('This owner link is invalid, expired or already used. Request a new email.');

export async function pendingEnrollment(db: Db): Promise<{ user_id: string } | null> {
  return db.first(`SELECT e.user_id FROM owner_enrollment e JOIN users u ON u.id = e.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE e.singleton = 1 AND e.completed_at IS NULL AND NOT EXISTS (SELECT 1 FROM site_owner)
      AND u.email = 'sholabusari66@gmail.com' COLLATE NOCASE AND r.key = 'super_admin'`);
}

export async function createToken(db: Db, userId: string, hash: string, purpose: OwnerTokenPurpose) {
  // Do not invalidate existing links on request: an anonymous caller must not
  // cancel the legitimate owner's email by requesting another one.
  await db.run('INSERT INTO owner_security_tokens(token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)',
    [hash, userId, purpose, new Date(Date.now() + 3600_000).toISOString()]);
}

export async function findToken(db: Db, hash: string, purpose: OwnerTokenPurpose) {
  return db.first<{ user_id: string }>(`SELECT user_id FROM owner_security_tokens
    WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?`,
  [hash, purpose, new Date().toISOString()]);
}

/** D1 batch is atomic. Re-check the live token INSIDE the write transaction. */
export async function completeSetup(db: Db, tokenHash: string, passwordHash: string, confirmationHash: string) {
  const now = new Date().toISOString();
  const eligible = `SELECT e.user_id FROM owner_enrollment e JOIN owner_security_tokens t ON t.user_id = e.user_id
    WHERE e.singleton = 1 AND e.completed_at IS NULL AND t.token_hash = ? AND t.purpose = 'setup'
      AND t.consumed_at IS NULL AND t.expires_at > ? AND NOT EXISTS (SELECT 1 FROM site_owner)`;
  const results = await db.batch([
    db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = ?, email_verified_at = ?,
      status = 'active', failed_login_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id IN (${eligible})`, [passwordHash, now, now, now, tokenHash, now]),
    db.prepare(`INSERT INTO site_owner(singleton, user_id, confirmation_hash)
      SELECT 1, user_id, ? FROM owner_enrollment WHERE user_id IN (${eligible})`, [confirmationHash, tokenHash, now]),
    db.prepare(`UPDATE owner_enrollment SET completed_at = COALESCE(completed_at, ?)
      WHERE user_id IN (SELECT user_id FROM site_owner) AND user_id IN
        (SELECT user_id FROM owner_security_tokens WHERE token_hash = ? AND purpose = 'setup'
          AND consumed_at IS NULL AND expires_at > ?)`, [now, tokenHash, now]),
    db.prepare(`UPDATE user_sessions SET revoked_at = ?, revoked_reason = 'owner_setup'
      WHERE revoked_at IS NULL AND user_id IN (SELECT user_id FROM owner_security_tokens WHERE token_hash = ?
        AND purpose = 'setup' AND consumed_at IS NULL AND expires_at > ?)`, [now, tokenHash, now]),
    ...['password_reset_tokens', 'email_verification_tokens'].map((table) => db.prepare(
      `UPDATE ${table} SET consumed_at = ? WHERE consumed_at IS NULL AND user_id IN
        (SELECT user_id FROM owner_security_tokens WHERE token_hash = ? AND purpose = 'setup'
          AND consumed_at IS NULL AND expires_at > ?)`, [now, tokenHash, now])),
    db.prepare(`UPDATE owner_security_tokens SET consumed_at = ? WHERE consumed_at IS NULL AND user_id IN
      (SELECT user_id FROM owner_security_tokens WHERE token_hash = ? AND purpose = 'setup'
        AND consumed_at IS NULL AND expires_at > ?)`, [now, tokenHash, now]),
  ]);
  if (!results[1]?.changes) throw invalidOwnerLink();
}

export async function recoverCode(db: Db, userId: string, tokenHash: string, confirmationHash: string) {
  const now = new Date().toISOString();
  const eligible = `SELECT user_id FROM owner_security_tokens WHERE user_id = ? AND token_hash = ?
    AND purpose = 'code_recovery' AND consumed_at IS NULL AND expires_at > ?`;
  const args = [userId, tokenHash, now];
  const results = await db.batch([
    db.prepare(`UPDATE site_owner SET confirmation_hash = ? WHERE user_id IN (${eligible})`, [confirmationHash, ...args]),
    db.prepare(`UPDATE user_sessions SET revoked_at = ?, revoked_reason = 'owner_code_recovery'
      WHERE revoked_at IS NULL AND user_id IN (${eligible})`, [now, ...args]),
    db.prepare(`UPDATE owner_security_tokens SET consumed_at = ? WHERE user_id IN (${eligible}) AND consumed_at IS NULL`, [now, ...args]),
  ]);
  if (!results[0]?.changes) throw invalidOwnerLink();
}
