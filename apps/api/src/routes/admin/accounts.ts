/** Owner/super-admin application review and reversible account suspension. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext, AppEnv } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as access from '../../db/repositories/author-access.js';
import * as users from '../../db/repositories/users.js';
import { verifyOwnerCode } from '../../middleware/owner-confirmation.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { sendEmail } from '../../lib/mailer/index.js';
import { parseJson, parseQuery } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { authorScope } from '../../middleware/author-scope.js';
import { audit } from '../../services/audit.js';
import { ok } from '../helpers.js';

export const adminAccountRoutes = new Hono<AppEnv>();
const mutationSchema = z.object({
  action: z.enum(['approve', 'decline', 'suspend', 'restore']),
  // Only the designated owner proves each action with the separate
  // confirmation code; super administrators rely on their session grant.
  confirmation_code: z.string().min(1).max(128).optional(),
}).strict();

/**
 * The designated site owner and super administrators (holding the
 * `admin.manage` / `user.write.any` grant) may review author accounts.
 * Editors and authors are turned away with the same opaque message the
 * owner-only flow used — minimal disclosure of who else can review.
 */
async function assertAccountManager(c: AppContext) {
  const designated = await access.owner(createDb(c.env.DB));
  const userId = c.get('auth')?.userId;
  const isDesignatedOwner = designated?.user_id === userId;
  const perms = c.get('auth')?.permissions ?? [];
  const isSuperAdmin = perms.includes('admin.manage') || perms.includes('user.write.any');
  if (!isDesignatedOwner && !isSuperAdmin) throw forbidden('Only the website owner can manage accounts.');
  return { designated, isDesignatedOwner };
}

/** The owner proves sensitive actions with the separate confirmation code. */
async function requireOwnerCodeWhenOwner(c: AppContext, isDesignatedOwner: boolean, confirmation_code?: string) {
  if (!isDesignatedOwner) return;
  if (!confirmation_code) throw badRequest('Enter your separate owner confirmation code to perform this action.');
  await verifyOwnerCode(c, confirmation_code);
}

adminAccountRoutes.get('/accounts/capabilities', async (c) => {
  const db = createDb(c.env.DB);
  const designated = await access.owner(db);
  return ok(c, { owner: designated?.user_id === c.get('auth')!.userId,
    workspace_pending: false, author: await authorScope(c) });
});

adminAccountRoutes.use('/accounts', async (c, next) => {
  await assertAccountManager(c);
  await next();
});
adminAccountRoutes.use('/accounts/:userId', async (c, next) => {
  await assertAccountManager(c);
  await next();
});

adminAccountRoutes.get('/accounts', async (c) => {
  const { page } = parseQuery(c, z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }));
  const db = createDb(c.env.DB);
  return ok(c, { items: await access.listApplications(db, page), page, per_page: 50,
    pending: await db.count("SELECT COUNT(*) AS total FROM author_applications WHERE status = 'pending'") });
});

adminAccountRoutes.post('/accounts/:userId', rateLimit('owner.confirmation'), rateLimit('owner.confirmation', 'account'), async (c) => {
  const { action, confirmation_code } = await parseJson(c, mutationSchema);
  const db = createDb(c.env.DB);
  const designated = await access.owner(db);
  await requireOwnerCodeWhenOwner(c, designated?.user_id === c.get('auth')!.userId, confirmation_code);
  const userId = c.req.param('userId');
  await access.transition(db, c.get('auth')!.userId, userId, action);
  await audit(c, { action: `owner.author.${action}`, entityType: 'user', entityId: userId, description: `Author account action: ${action}` });
  const user = await users.findById(db, userId);
  // The committed state is authoritative even if the email provider is down.
  let emailDelivered = false;
  if (user) {
    try {
      const messages = {
        approve: 'Your author application has been approved. You can now sign in.',
        decline: 'Your author application has been declined. Contact the website owner with any questions.',
        suspend: 'Your author account has been suspended. Your articles and byline have been retained.',
        restore: 'Your author account access has been restored. You can sign in again.',
      };
      const delivery = await sendEmail(db, c.get('config'), c.get('logger'), user.email, {
        userId, content: { template: `author_${action}`, subject: 'Sholynk Tech author account update',
          text: messages[action], html: `<p>${messages[action]}</p>` },
      });
      emailDelivered = delivery.delivered;
    } catch {
      c.get('logger').warn('Author decision email could not be queued', { user_id: userId, action });
    }
  }
  return ok(c, { action, user_id: userId, email_delivered: emailDelivered });
});

adminAccountRoutes.delete('/accounts/:userId', rateLimit('owner.confirmation'), rateLimit('owner.confirmation', 'account'), async (c) => {
  const db = createDb(c.env.DB);
  const owner = await access.owner(db);
  const actingAsOwner = owner?.user_id === c.get('auth')?.userId;
  const { confirmation_code } = await parseJson(c, z.object({ confirmation_code: z.string().min(1).max(128).optional() }).strict());
  await requireOwnerCodeWhenOwner(c, actingAsOwner, confirmation_code);

  const userId = c.req.param('userId');
  if (c.get('auth')!.userId === userId) throw forbidden('You cannot remove your own account.');
  if (owner && owner.user_id === userId) throw forbidden('The site owner account cannot be removed.');
  const { notFound } = await import('../../lib/errors.js');
  const target = await users.findById(db, userId);
  if (!target) throw notFound('User not found');

  // Prevent deleting the designated site_owner even if it differs from current auth (bootstrap safety)
  const siteOwnerCheck = await db.first<{ user_id: string }>(`SELECT user_id FROM site_owner WHERE user_id = ? LIMIT 1`, [userId]);
  if (siteOwnerCheck) throw forbidden('The designated site owner cannot be removed. Transfer ownership first.');

  // Content reassigned to the designated owner when one exists, otherwise to
  // the acting super administrator (RESTRICT keys need a living user row).
  const ownerId = owner?.user_id ?? c.get('auth')!.userId;

  // Look up any author_application + linked authors row for the target
  const appRow = await db.first<{ author_id: string | null }>(
    `SELECT author_id FROM author_applications WHERE user_id = ? LIMIT 1`, [userId]
  );
  let oldSlug: string | null = null;
  let oldAuthorId: string | null = null;
  if (appRow?.author_id) {
    oldAuthorId = appRow.author_id;
    const authorRow = await db.first<{ slug: string }>(`SELECT slug FROM authors WHERE id = ? LIMIT 1`, [appRow.author_id]);
    oldSlug = authorRow?.slug ?? null;
  }

  // 1) Reassign articles/images owned by this user to the site owner (satisfies owner_user_id RESTRICT + immutable trigger semantics)
  // We reassign first so the subsequent DELETE users does not hit RESTRICT.
  await db.run(`UPDATE articles SET owner_user_id = ? WHERE owner_user_id = ?`, [ownerId, userId]);
  await db.run(`UPDATE images SET owner_user_id = ? WHERE owner_user_id = ?`, [ownerId, userId]);

  // 2) Nullify reviewed_by references (author_applications.reviewed_by ON DELETE RESTRICT)
  await db.run(`UPDATE author_applications SET reviewed_by = NULL WHERE reviewed_by = ?`, [userId]);

  // 3) Reassign bylines (author_slug is plain TEXT, not a FK, but we preserve content by moving to house author)
  const houseSlug = 'oluwashola-busari';
  const houseName = 'Oluwashola Busari';
  if (oldSlug && oldSlug !== houseSlug) {
    await db.run(`UPDATE articles SET author_slug = ?, author = ? WHERE author_slug = ?`, [houseSlug, houseName, oldSlug]);
  }

  // 4) Remove owner_enrollment entry if this user was a pending enrollment (RESTRICT)
  await db.run(`DELETE FROM owner_enrollment WHERE user_id = ?`, [userId]);

  // 5) Delete author application first (author_id ON DELETE RESTRICT requires this order)
  if (oldAuthorId) {
    await db.run(`DELETE FROM author_applications WHERE user_id = ?`, [userId]);
    // Only delete the authors row if it is not the protected house author
    // authors.id INTEGER, but author_applications.author_id stores same id
    // The house author is slug oluwashola-busari — never delete it.
    if (oldSlug !== houseSlug) {
      await db.run(`DELETE FROM authors WHERE id = ?`, [oldAuthorId]);
    }
  } else {
    // Also clean any stray application rows without author_id (defensive)
    await db.run(`DELETE FROM author_applications WHERE user_id = ?`, [userId]);
  }

  // 6) Finally delete the users row — remaining children (user_profiles, sessions, tokens, notifications, owner_security_tokens) cascade
  const deleted = await db.changes(`DELETE FROM users WHERE id = ?`, [userId]);
  if (!deleted) throw notFound('User could not be deleted (already removed?)');

  await audit(c, { action: 'owner.author.deleted', entityType: 'user', entityId: userId, description: `Author account permanently removed by owner`, metadata: { deleted_user_email: target.email, old_slug: oldSlug } });
  return ok(c, { deleted: true, user_id: userId, old_slug: oldSlug });
});
