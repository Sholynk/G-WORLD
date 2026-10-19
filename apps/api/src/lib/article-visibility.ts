/**
 * Who may read an unpublished article.
 *
 * The permission catalogue separates the two ideas the CMS needs:
 *
 *   `article.read.any` — "view drafts, pending and scheduled articles" (admins)
 *   `article.submit`   — "create and edit own drafts" (contributing editors)
 *
 * A session alone is therefore not enough to open someone else's private work.
 * Accounts without `article.read.any` may only read articles they own, and
 * everybody else gets the same 404 an unknown ID or slug produces — so private
 * titles, internal review notes and submitter emails never leak.
 */
import type { AppContext } from '../env.js';
import type { Db } from '../db/client.js';
import { accountSuspended, notFound, unauthenticated } from './errors.js';

/** True when the session may read any account's unpublished article. */
export function canReadAnyArticle(c: AppContext): boolean {
  return c.get('auth')?.permissions.includes('article.read.any') === true;
}

/** A signed-in, non-suspended editorial session is required for any private read. */
export function assertEditorialSession(c: AppContext): void {
  const auth = c.get('auth');
  if (!auth) throw unauthenticated();
  if (auth.status === 'suspended' || auth.status === 'deactivated') throw accountSuspended();
}

/**
 * Guards one unpublished article: `article.read.any`, or ownership of the row.
 * Ownership is resolved from the database because it is not part of the public
 * article DTO.
 */
export async function assertCanReadPrivateArticle(c: AppContext, db: Db, articleId: number): Promise<void> {
  assertEditorialSession(c);
  if (canReadAnyArticle(c)) return;
  const auth = c.get('auth');
  const owned = await db.first<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM articles WHERE id = ?',
    [articleId],
  );
  if (!owned?.owner_user_id || owned.owner_user_id !== auth?.userId) throw notFound('Article not found');
}
