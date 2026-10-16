/**
 * Repository — single-use email verification and password reset tokens.
 *
 * Both token types follow the same rules:
 *   - only the SHA-256 hash is stored
 *   - exactly one live token per purpose per user (issuing a new one invalidates
 *     the previous one, so an old email in an inbox cannot be replayed)
 *   - consumption is an UPDATE … WHERE consumed_at IS NULL, making the token
 *     single-use even under a race between two concurrent requests
 */
import type { Db } from '../client.js';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface TokenRow {
  id: string;
  user_id: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
  email?: string;
}

/* ------------------------------- verification ------------------------------ */

export async function invalidateVerificationTokens(db: Db, userId: string): Promise<number> {
  return db.changes(
    `UPDATE email_verification_tokens SET consumed_at = ?
      WHERE user_id = ? AND consumed_at IS NULL`,
    [new Date().toISOString(), userId],
  );
}

export async function createVerificationToken(
  db: Db,
  userId: string,
  email: string,
  tokenHash: string,
  expiresAt: string,
): Promise<string> {
  const id = newId(ID_PREFIXES.verificationToken);
  await invalidateVerificationTokens(db, userId);
  await db.run(
    `INSERT INTO email_verification_tokens (id, user_id, email, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, email, tokenHash, expiresAt],
  );
  return id;
}

export async function findVerificationToken(
  db: Db,
  tokenHash: string,
): Promise<(TokenRow & { email: string }) | null> {
  return db.first<TokenRow & { email: string }>(
    `SELECT id, user_id, email, expires_at, consumed_at, created_at
       FROM email_verification_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );
}

/** Atomic single-use consumption; returns true only for the winning caller. */
export async function consumeVerificationToken(db: Db, tokenHash: string): Promise<boolean> {
  const changed = await db.changes(
    `UPDATE email_verification_tokens SET consumed_at = ?
      WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    [new Date().toISOString(), tokenHash, new Date().toISOString()],
  );
  return changed > 0;
}

/* ------------------------------ password reset ----------------------------- */

export async function invalidateResetTokens(db: Db, userId: string): Promise<number> {
  return db.changes(
    `UPDATE password_reset_tokens SET consumed_at = ?
      WHERE user_id = ? AND consumed_at IS NULL`,
    [new Date().toISOString(), userId],
  );
}

export async function createResetToken(
  db: Db,
  userId: string,
  tokenHash: string,
  expiresAt: string,
  requestedIpHash?: string | null,
): Promise<string> {
  const id = newId(ID_PREFIXES.resetToken);
  await invalidateResetTokens(db, userId);
  await db.run(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, requested_ip_hash)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, tokenHash, expiresAt, requestedIpHash ?? null],
  );
  return id;
}

export async function findResetToken(db: Db, tokenHash: string): Promise<TokenRow | null> {
  return db.first<TokenRow>(
    `SELECT id, user_id, expires_at, consumed_at, created_at
       FROM password_reset_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );
}

export async function consumeResetToken(db: Db, tokenHash: string): Promise<boolean> {
  const now = new Date().toISOString();
  const changed = await db.changes(
    `UPDATE password_reset_tokens SET consumed_at = ?
      WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    [now, tokenHash, now],
  );
  return changed > 0;
}

/** Housekeeping: drop consumed/expired tokens older than a week. */
export async function purgeStaleTokens(db: Db, olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const verification = await db.changes(
    `DELETE FROM email_verification_tokens WHERE expires_at < ?`,
    [cutoff],
  );
  const resets = await db.changes(`DELETE FROM password_reset_tokens WHERE expires_at < ?`, [cutoff]);
  return verification + resets;
}
