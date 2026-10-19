/** Account approval never mutates bylines or deletes editorial content. */
import type { Db } from '../client.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';

export const OWNER_EMAIL = 'sholabusari66@gmail.com';
export type ReviewStatus = 'pending' | 'approved' | 'declined';
export type AccountAction = 'approve' | 'decline' | 'suspend' | 'restore';
export interface OwnerRow { user_id: string; confirmation_hash: string }

export async function owner(db: Db): Promise<OwnerRow | null> {
  return db.first<OwnerRow>('SELECT user_id, confirmation_hash FROM site_owner WHERE singleton = 1');
}

export async function reviewStatus(db: Db, userId: string): Promise<ReviewStatus | null> {
  const row = await db.first<{ status: ReviewStatus }>('SELECT status FROM author_applications WHERE user_id = ?', [userId]);
  return row?.status ?? null;
}

/** Applied at login AND on every authenticated request, including old sessions. */
export async function accessAllowed(db: Db, userId: string): Promise<boolean> {
  if (await db.exists('SELECT 1 AS found FROM owner_enrollment WHERE user_id = ? AND completed_at IS NULL', [userId])) return false;
  const review = await reviewStatus(db, userId);
  if (review) return review === 'approved';
  const designated = await owner(db);
  // Preserve the legacy development installation until secure owner setup.
  // Once provisioned, unmigrated accounts fail closed, not silently approved.
  return !designated || designated.user_id === userId;
}

export async function listApplications(db: Db, page = 1) {
  return db.all<{
    user_id: string; author_id: number; email: string; display_name: string | null;
    review_status: ReviewStatus; account_status: string; email_verified_at: string | null;
    created_at: string; reviewed_at: string | null;
  }>(`SELECT a.user_id, a.author_id, u.email, p.display_name,
      a.status AS review_status, u.status AS account_status, u.email_verified_at,
      a.created_at, a.reviewed_at
    FROM author_applications a JOIN users u ON u.id = a.user_id
    LEFT JOIN user_profiles p ON p.user_id = u.id
    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC, a.user_id
    LIMIT 50 OFFSET ?`, [(page - 1) * 50]);
}

export function validTransition(action: AccountAction, review: ReviewStatus, status: string): boolean {
  if (action === 'approve' || action === 'decline') return review === 'pending';
  if (action === 'suspend') return review === 'approved' && status === 'active';
  return review === 'approved' && status === 'suspended';
}

export async function transition(db: Db, actorId: string, userId: string, action: AccountAction) {
  const designated = await owner(db);
  if (!designated || designated.user_id !== actorId || actorId === userId) throw forbidden('Owner-only action');
  const row = await db.first<{ status: ReviewStatus; account_status: string; email_verified_at: string | null }>(
    `SELECT a.status, u.status AS account_status, u.email_verified_at FROM author_applications a
     JOIN users u ON u.id = a.user_id WHERE a.user_id = ?`, [userId]);
  if (!row) throw notFound('Author application not found');
  if (!validTransition(action, row.status, row.account_status)) throw conflict('The account has changed. Refresh before trying again.');
  if (action === 'approve' && !row.email_verified_at) throw conflict('The applicant must verify their email before approval.');
  const now = new Date().toISOString();
  if (action === 'approve' || action === 'decline') {
    const changed = await db.changes(`UPDATE author_applications SET status = ?, reviewed_by = ?, reviewed_at = ?
      WHERE user_id = ? AND status = 'pending'`, [action === 'approve' ? 'approved' : 'declined', actorId, now, userId]);
    if (!changed) throw conflict('This application has already been reviewed.');
  } else {
    const results = await db.batch([
      db.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND status = ?
        AND EXISTS (SELECT 1 FROM author_applications WHERE user_id = ? AND status = 'approved')`,
      [action === 'suspend' ? 'suspended' : 'active', now, userId, row.account_status, userId]),
      // Also revoke on restoration: previously issued cookies never regain access.
      db.prepare(`UPDATE user_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL`,
        [now, `owner_${action}`, userId]),
    ]);
    if (!results[0]?.changes) throw conflict('The account has changed. Refresh before trying again.');
  }
}
