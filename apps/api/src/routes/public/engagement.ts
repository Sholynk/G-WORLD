/**
 * Routes — reader engagement and public forms.
 *
 * Reactions and comments are keyed by slug so generated and legacy
 * query-string article pages share their engagement history. The voter id is a
 * client-generated anonymous token, passed as a query parameter on reads and in
 * the body on writes — it enforces one-vote-per-reader without accounts or
 * personal data.
 *
 * The newsletter and contact forms accept JSON *and* classic urlencoded posts
 * (the ported footer/contact forms submit urlencoded exactly like the legacy
 * site), carry the hidden honeypot, and are rate limited per IP.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as engagementRepo from '../../db/repositories/engagement.js';
import * as analyticsRepo from '../../db/repositories/analytics.js';
import * as formsRepo from '../../db/repositories/forms.js';
import {
  commentSchema,
  contactSchema,
  engagementQuerySchema,
  idOrSlugParamSchema,
  reactionSchema,
  subscribeSchema,
  viewSchema,
} from '@sholynk/shared';
import { parseFormOrJson, parseJson, parseParam, parseQuery } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { created, ok } from '../helpers.js';

export const publicEngagementRoutes = new Hono<AppEnv>();

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

/** The honeypot fields a bot fills and a human never sees. */
function isBot(payload: Record<string, unknown>): boolean {
  const trap = payload['bot-field'] ?? payload['website'] ?? payload['companyWebsite'];
  return Boolean(String(trap ?? '').trim());
}

/* -------------------------------- reactions -------------------------------- */

publicEngagementRoutes.get('/articles/:slug/engagement', async (c) => {
  const slug = parseParam(c, 'slug', idOrSlugParamSchema);
  const query = parseQuery(c, engagementQuerySchema);
  const db = dbFrom(c);
  return ok(c, await engagementRepo.summary(db, slug, query.voterId ?? ''));
});

publicEngagementRoutes.get('/articles/:slug/reactions', async (c) => {
  const slug = parseParam(c, 'slug', idOrSlugParamSchema);
  const query = parseQuery(c, engagementQuerySchema);
  const db = dbFrom(c);
  return ok(c, await engagementRepo.tallies(db, slug, query.voterId ?? ''));
});

publicEngagementRoutes.post(
  '/articles/:slug/reactions',
  rateLimit('engagement.write'),
  async (c) => {
    const slug = parseParam(c, 'slug', idOrSlugParamSchema);
    const input = await parseJson(c, reactionSchema);
    const db = dbFrom(c);
    return ok(c, await engagementRepo.react(db, slug, input));
  },
);

/* -------------------------------- comments --------------------------------- */

publicEngagementRoutes.get('/articles/:slug/comments', async (c) => {
  const slug = parseParam(c, 'slug', idOrSlugParamSchema);
  const query = parseQuery(c, engagementQuerySchema);
  const db = dbFrom(c);
  return ok(c, await engagementRepo.listComments(db, slug, query.limit));
});

publicEngagementRoutes.post(
  '/articles/:slug/comments',
  rateLimit('comment.write'),
  async (c) => {
    const slug = parseParam(c, 'slug', idOrSlugParamSchema);
    const input = await parseJson(c, commentSchema);
    const db = dbFrom(c);
    return created(c, await engagementRepo.addComment(db, slug, input));
  },
);

/* ------------------------------ read tracking ------------------------------- */

/**
 * Records one article read. Public and unauthenticated by design: it is called
 * by readers. `recordView` only accepts slugs that exist and collapses repeat
 * reads by the same anonymous viewer on the same day, so the endpoint cannot be
 * used to write arbitrary rows or inflate a count by refreshing.
 */
publicEngagementRoutes.post('/articles/:slug/views', rateLimit('view.record'), async (c) => {
  const slug = parseParam(c, 'slug', idOrSlugParamSchema);
  const input = await parseJson(c, viewSchema);
  const db = dbFrom(c);
  const result = await analyticsRepo.recordView(db, slug, input);
  return ok(c, result, { status: 202 });
});

/* ------------------------------ public forms -------------------------------- */

publicEngagementRoutes.post('/subscriptions', rateLimit('forms.public'), async (c) => {
  const payload = await parseFormOrJson(c, subscribeSchema);
  if (isBot(payload)) return created(c, { message: 'Thank you for subscribing.' });
  const db = dbFrom(c);
  await formsRepo.subscribe(db, { name: payload.name, email: payload.email });
  return created(c, { message: 'Thank you for subscribing.' });
});

publicEngagementRoutes.post('/contact', rateLimit('forms.public'), async (c) => {
  const payload = await parseFormOrJson(c, contactSchema);
  if (isBot(payload)) return created(c, { message: 'Your message has been received.' });
  const db = dbFrom(c);
  const result = await formsRepo.addContactMessage(db, {
    name: payload.name,
    email: payload.email,
    subject: payload.subject,
    message: payload.message,
  });
  return created(c, { message: 'Your message has been received.', id: result.id });
});
