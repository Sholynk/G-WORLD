/**
 * Admin routes — comment moderation and the inbox (subscribers + messages).
 *
 * The comment history is the record the dashboard's moderation tab shows;
 * deleting is the only mutation (the legacy CMS modelled comments as
 * delete-or-keep, no editing).
 *
 * The inbox endpoints are new relative to the legacy UI (the API always had
 * them; the old dashboard never surfaced them): list/delete newsletter
 * subscribers and list/update/delete contact messages, behind `inbox.read` /
 * `inbox.write`.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as engagementRepo from '../../db/repositories/engagement.js';
import * as formsRepo from '../../db/repositories/forms.js';
import { buildPaginationMeta, limitQuerySchema, messageStatusSchema } from '@sholynk/shared';
import { z } from 'zod';
import { parseJson, parseQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { requireScopedPermission, authorScope } from '../../middleware/author-scope.js';
import { notFound } from '../../lib/errors.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { audit } from '../../services/audit.js';
import { noContent, ok } from '../helpers.js';

export const adminModerationRoutes = new Hono<AppEnv>();
export const adminInboxRoutes = new Hono<AppEnv>();

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

function numericId(c: AppContext, label: string): number {
  const id = Number.parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) throw notFound(label);
  return id;
}

/* ------------------------------- moderation -------------------------------- */

adminModerationRoutes.get('/comments', requireScopedPermission('engagement.moderate'), async (c) => {
  const query = parseQuery(c, limitQuerySchema);
  const db = dbFrom(c);
  const ownerUserId = (await authorScope(c))?.userId;
  const [items, total] = await Promise.all([
    engagementRepo.listAllComments(db, query.limit, ownerUserId),
    engagementRepo.countAllComments(db, ownerUserId),
  ]);
  // `total` lets the dashboard say "showing the latest 200 of 1,431".
  return ok(c, items, { meta: { total } });
});

adminModerationRoutes.delete('/comments/:id', requireScopedPermission('engagement.moderate'), async (c) => {
  const id = numericId(c, 'Comment not found');
  const db = dbFrom(c);
  if (!(await engagementRepo.removeComment(db, id, (await authorScope(c))?.userId))) throw notFound('Comment not found');
  await audit(c, {
    action: AUDIT_ACTIONS.commentDeleted,
    entityType: 'comment',
    entityId: String(id),
    description: 'Reader comment deleted',
  });
  return noContent(c);
});

/* ---------------------------------- inbox ----------------------------------- */

const inboxPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

adminInboxRoutes.get('/subscriptions', requirePermission('inbox.read'), async (c) => {
  const { page, limit } = parseQuery(c, inboxPageSchema);
  const db = dbFrom(c);
  const [items, total] = await Promise.all([
    formsRepo.listSubscribers(db, limit, (page - 1) * limit),
    formsRepo.countSubscribers(db),
  ]);
  return ok(c, items, { pagination: buildPaginationMeta(page, limit, total) });
});

adminInboxRoutes.delete('/subscriptions/:id', requirePermission('inbox.write'), async (c) => {
  const id = numericId(c, 'Subscriber not found');
  const db = dbFrom(c);
  if (!(await formsRepo.removeSubscriber(db, id))) throw notFound('Subscriber not found');
  await audit(c, {
    action: AUDIT_ACTIONS.subscriberDeleted,
    entityType: 'subscriber',
    entityId: String(id),
    description: 'Newsletter subscriber deleted',
  });
  return noContent(c);
});

adminInboxRoutes.get('/contact-messages', requirePermission('inbox.read'), async (c) => {
  const { page, limit } = parseQuery(c, inboxPageSchema);
  const db = dbFrom(c);
  const [items, total] = await Promise.all([
    formsRepo.listContactMessages(db, limit, (page - 1) * limit),
    formsRepo.countContactMessages(db),
  ]);
  return ok(c, items, { pagination: buildPaginationMeta(page, limit, total) });
});

adminInboxRoutes.patch('/contact-messages/:id', requirePermission('inbox.write'), async (c) => {
  const id = numericId(c, 'Message not found');
  const { status } = await parseJson(c, messageStatusSchema);
  const db = dbFrom(c);
  if (!(await formsRepo.setContactMessageStatus(db, id, status))) throw notFound('Message not found');
  await audit(c, {
    action: AUDIT_ACTIONS.contactMessageUpdated,
    entityType: 'contact_message',
    entityId: String(id),
    description: `Contact message marked ${status}`,
  });
  return ok(c, { id, status });
});

adminInboxRoutes.delete('/contact-messages/:id', requirePermission('inbox.write'), async (c) => {
  const id = numericId(c, 'Message not found');
  const db = dbFrom(c);
  if (!(await formsRepo.removeContactMessage(db, id))) throw notFound('Message not found');
  await audit(c, {
    action: AUDIT_ACTIONS.contactMessageDeleted,
    entityType: 'contact_message',
    entityId: String(id),
    description: 'Contact message deleted',
  });
  return noContent(c);
});
