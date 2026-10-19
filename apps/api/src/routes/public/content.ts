/**
 * Routes — public content reads.
 *
 * The reading surface of the publication: article lists, single articles,
 * categories, author entities, the media index and site metadata. Everything
 * here is safe for signed-out readers; unpublished articles are visible only
 * to a signed-in editorial account (the legacy CMS enforced the same rule with
 * its admin token).
 *
 * List DTOs are camelCase. Published collections default to a `summary` payload
 * (no body/FAQ/source blobs, plus `hasBody`) so the homepage stays cheap;
 * editorial lists and `fields=full` still return the complete article.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { authorScope } from '../../middleware/author-scope.js';
import { createDb, type Db } from '../../db/client.js';
import * as articlesRepo from '../../db/repositories/articles.js';
import * as authorsRepo from '../../db/repositories/authors.js';
import * as settingsRepo from '../../db/repositories/settings.js';
import * as mediaRepo from '../../db/repositories/media.js';
import { articleListQuerySchema, idOrSlugParamSchema, LIMITS } from '@sholynk/shared';
import { parseQuery, parseParam } from '../../middleware/validate.js';
import { accountSuspended, notFound, unauthenticated } from '../../lib/errors.js';
import { ok } from '../helpers.js';

export const publicContentRoutes = new Hono<AppEnv>();
// Editorial contact details and review notes are not public article metadata.
const publicArticle = (article: articlesRepo.ArticleDto) => ({ ...article, submitterEmail: '', reviewNotes: '' });

/**
 * Inline session guard for endpoints that are public for published content but
 * editorial-only otherwise (the legacy `requireAdmin` fall-through branches).
 */
function assertEditorialSession(c: AppContext): void {
  const auth = c.get('auth');
  if (!auth) throw unauthenticated();
  if (auth.status === 'suspended' || auth.status === 'deactivated') throw accountSuspended();
}

/**
 * Reading another account's unpublished work needs `article.read.any`.
 *
 * A session alone is not enough: a contributing editor (`article.submit` only)
 * may only preview their own drafts, pending articles and scheduled pieces.
 * Everyone else sees the same 404 a reader would get, so unpublished IDs and
 * slugs do not leak either.
 */
function canReadAnyArticle(c: AppContext): boolean {
  return c.get('auth')?.permissions.includes('article.read.any') === true;
}

async function assertCanReadPrivateArticle(c: AppContext, db: Db, articleId: number): Promise<void> {
  assertEditorialSession(c);
  if (canReadAnyArticle(c)) return;
  const auth = c.get('auth');
  // Ownership is not part of the public DTO, so resolve it from the row.
  const owned = await db.first<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM articles WHERE id = ?',
    [articleId],
  );
  if (!owned?.owner_user_id || owned.owner_user_id !== auth?.userId) throw notFound('Article not found');
}

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

/* --------------------------------- articles -------------------------------- */

publicContentRoutes.get('/articles', async (c) => {
  const query = parseQuery(c, articleListQuerySchema);

  // The public site only ever fetches status=published. Anything else (drafts,
  // pending review, scheduled, all) requires a signed-in editorial account, and
  // accounts without `article.read.any` only ever see their own submissions.
  const privateQuery = query.status !== 'published';
  if (privateQuery) {
    assertEditorialSession(c);
    // Resolving the author boundary makes a revoked approval fail closed.
    await authorScope(c);
  }

  const db = dbFrom(c);
  const limit = query.limit ?? LIMITS.LIST_LIMIT_DEFAULT;
  const offset = query.offset ?? 0;
  const filters = {
    ownerUserId: privateQuery && !canReadAnyArticle(c) ? c.get('auth')!.userId : undefined,
    category: query.category,
    q: query.q,
    status: query.status === 'all' ? undefined : query.status,
    limit,
    offset,
    hero: query.hero === true ? true : undefined,
  };
  const mode =
    query.fields ?? (query.status === 'published' ? 'summary' : 'full');
  const [items, total] = await Promise.all([
    articlesRepo.list(db, filters, mode),
    articlesRepo.count(db, filters),
  ]);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (query.status === 'published') {
    c.header('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
  }
  return ok(c, query.status === 'published' ? items.map(publicArticle) : items, {
    pagination: {
      page,
      per_page: limit,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    },
  });
});

publicContentRoutes.get('/articles/categories', async (c) => {
  const db = dbFrom(c);
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  // Category discovery never exposes private draft metadata.
  return ok(c, await articlesRepo.categories(db, 'published'));
});

publicContentRoutes.get('/articles/:idOrSlug', async (c) => {
  const idOrSlug = parseParam(c, 'idOrSlug', idOrSlugParamSchema);
  const db = dbFrom(c);
  const article = /^\d+$/.test(idOrSlug)
    ? await articlesRepo.getById(db, idOrSlug)
    : await articlesRepo.getBySlug(db, idOrSlug);
  if (!article) throw notFound('Article not found');

  // Unpublished articles are a private editorial preview: `article.read.any`,
  // or the account that owns the record.
  if (article.status !== 'published') await assertCanReadPrivateArticle(c, db, article.id);
  if (article.status === 'published') {
    c.header('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
  }
  return ok(c, article.status === 'published' ? publicArticle(article) : article);
});

publicContentRoutes.get('/articles/:id/sources', async (c) => {
  const id = Number.parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) throw notFound('Article not found');
  const db = dbFrom(c);
  const article = await articlesRepo.getById(db, id);
  if (!article) throw notFound('Article not found');
  if (article.status !== 'published') await assertCanReadPrivateArticle(c, db, article.id);
  return ok(c, await articlesRepo.sourcesForArticle(db, article.id));
});

/* --------------------------------- authors --------------------------------- */

publicContentRoutes.get('/authors', async (c) => {
  const db = dbFrom(c);
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
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
  c.header('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
  return ok(c, await settingsRepo.all(db));
});

/* --------------------------------- images ---------------------------------- */

publicContentRoutes.get('/images', async (c) => {
  const db = dbFrom(c);
  return ok(c, await mediaRepo.list(db, (await authorScope(c))?.userId));
});
