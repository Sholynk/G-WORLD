/** Owner-only application review and reversible account suspension. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as access from '../../db/repositories/author-access.js';
import * as users from '../../db/repositories/users.js';
import { verifyOwnerCode } from '../../middleware/owner-confirmation.js';
import { forbidden } from '../../lib/errors.js';
import { sendEmail } from '../../lib/mailer/index.js';
import { parseJson, parseQuery } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { authorScope } from '../../middleware/author-scope.js';
import { audit } from '../../services/audit.js';
import { ok } from '../helpers.js';

export const adminAccountRoutes = new Hono<AppEnv>();
const mutationSchema = z.object({
  action: z.enum(['approve', 'decline', 'suspend', 'restore']),
  confirmation_code: z.string().min(1).max(128),
}).strict();

adminAccountRoutes.get('/accounts/capabilities', async (c) => {
  const db = createDb(c.env.DB);
  const designated = await access.owner(db);
  return ok(c, { owner: designated?.user_id === c.get('auth')!.userId,
    workspace_pending: false, author: await authorScope(c) });
});

adminAccountRoutes.use('/accounts', async (c, next) => {
  const designated = await access.owner(createDb(c.env.DB));
  if (!designated || designated.user_id !== c.get('auth')?.userId) throw forbidden('Only the website owner can manage accounts.');
  await next();
});
adminAccountRoutes.use('/accounts/:userId', async (c, next) => {
  const designated = await access.owner(createDb(c.env.DB));
  if (!designated || designated.user_id !== c.get('auth')?.userId) throw forbidden('Only the website owner can manage accounts.');
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
  await verifyOwnerCode(c, confirmation_code);
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
