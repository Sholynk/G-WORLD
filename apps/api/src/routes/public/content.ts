/**
 * Routes — public content reads.
 *
 * The reading surface of the publication: article lists, single articles,
 * categories, author entities, the media index and site metadata. Everything
 * here is safe for signed-out readers; unpublished articles are visible only
 * to a signed-in editorial account (the legacy CMS enforced the same rule with
 * its admin token).
 *
 * The DTO shapes match the legacy `/api` contract (camelCase, `body` included
 * in lists) because the ported homepage, article renderer and admin dashboard
 * read them unchanged.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as articlesRepo from '../../db/repositories/articles.js';
import * as authorsRepo from '../../db/repositories/authors.js';
import * as settingsRepo from '../../db/repositories/settings.js';
import * as mediaRepo from '../../db/repositories/media.js';
import { articleListQuerySchema, idOrSlugParamSchema } from '@sholynk/shared';
import { parseQuery, parseParam } from '../../middleware/validate.js';
import { accountSuspended, notFound, unauthenticated } from '../../lib/errors.js';
import { ok } from '../helpers.js';

export const publicContentRoutes = new Hono<AppEnv>();

/**
 * Inline session guard for endpoints that are public for published content but
 * editorial-only otherwise (the legacy `requireAdmin` fall-through branches).
 */
function assertEditorialSession(c: AppContext): void {
  const auth = c.get('auth');
  if (!auth) throw unauthenticated();
  if (auth.status === 'suspended' || auth.status === 'deactivated') throw accountSuspended();
}

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

/* --------------------------------- articles -------------------------------- */

publicContentRoutes.get('/articles', async (c) => {
  const query = parseQuery(c, articleListQuerySchema);

  // The public site only ever fetches status=published. Anything else (drafts,
  // pending review, scheduled, all) requires a signed-in editorial account.
  if (query.status !== 'published') assertEditorialSession(c);

  const db = dbFrom(c);
  const filters = {
    category: query.category,
    q: query.q,
    status: query.status === 'all' ? undefined : query.status,
    limit: query.limit,
    offset: query.offset,
    hero: query.hero === true ? true : undefined,
  };
  const [items, total] = await Promise.all([
    articlesRepo.list(db, filters),
    articlesRepo.count(db, filters),
  ]);

  const page = query.limit ? Math.floor((query.offset ?? 0) / query.limit) + 1 : 1;
  const totalPages = query.limit ? Math.max(1, Math.ceil(total / query.limit)) : 1;
  return ok(c, items, {
    pagination: {
      page,
      per_page: query.limit ?? total,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    },
  });
});

publicContentRoutes.get('/articles/categories', async (c) => {
  const db = dbFrom(c);
  const requested = c.req.query('status') || 'published';
  return ok(c, await articlesRepo.categories(db, requested === 'all' ? 'published' : requested));
});

publicContentRoutes.get('/articles/:idOrSlug', async (c) => {
  const idOrSlug = parseParam(c, 'idOrSlug', idOrSlugParamSchema);
  const db = dbFrom(c);
  const article = /^\d+$/.test(idOrSlug)
    ? await articlesRepo.getById(db, idOrSlug)
    : await articlesRepo.getBySlug(db, idOrSlug);
  if (!article) throw notFound('Article not found');

  // Unpublished articles are an editorial preview: session required.
  if (article.status !== 'published') assertEditorialSession(c);
  return ok(c, article);
});

publicContentRoutes.get('/articles/:id/sources', async (c) => {
  const id = Number.parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) throw notFound('Article not found');
  const db = dbFrom(c);
  const article = await articlesRepo.getById(db, id);
  if (!article) throw notFound('Article not found');
  if (article.status !== 'published') assertEditorialSession(c);
  return ok(c, await articlesRepo.sourcesForArticle(db, article.id));
});

/* --------------------------------- authors --------------------------------- */

publicContentRoutes.get('/authors', async (c) => {
  const db = dbFrom(c);
  return ok(c, await authorsRepo.list(db));
});

publicContentRoutes.get('/authors/:idOrSlug', async (c) => {
  const idOrSlug = parseParam(c, 'idOrSlug', idOrSlugParamSchema);
  const db = dbFrom(c);
  const author = await authorsRepo.get(db, idOrSlug);
  if (!author) throw notFound('Author not found');
  return ok(c, author);
});

/* -------------------------------- settings --------------------------------- */

publicContentRoutes.get('/settings', async (c) => {
  const db = dbFrom(c);
  return ok(c, await settingsRepo.all(db));
});

/* --------------------------------- images ---------------------------------- */

publicContentRoutes.get('/images', async (c) => {
  const db = dbFrom(c);
  return ok(c, await mediaRepo.list(db));
});
