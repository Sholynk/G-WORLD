/**
 * Admin routes — article mutations.
 *
 * Ported from the legacy CMS write endpoints (cms/routes/api.js) onto the
 * session/permission model:
 *
 *   - creating and editing articles requires `article.submit` (editors and
 *     admins);
 *   - *publishing* (status=published), scheduling and deleting additionally
 *     require `article.write` — an editor's "Publish" is silently redirected
 *     into the submit-for-review queue, exactly like the legacy
 *     CMS_REQUIRE_APPROVAL mode;
 *   - entering the `pending` state records a submission row and emails the
 *     editor address (EDITOR_EMAIL) so review requests never get lost.
 *
 * Reads (including status=all) live on the public content router, guarded by a
 * session check for unpublished states.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as articlesRepo from '../../db/repositories/articles.js';
import { articleInputSchema, articleUpdateSchema, refineArticlePayload, articleSourceSchema } from '@sholynk/shared';
import { parseJson } from '../../middleware/validate.js';
import { requireScopedPermission as requirePermission, authorScope, assertResourceOwner } from '../../middleware/author-scope.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { audit } from '../../services/audit.js';
import { sendEmail, TEMPLATES } from '../../lib/mailer/index.js';
import { created, noContent, ok } from '../helpers.js';
import type { ArticleDto } from '../../db/repositories/articles.js';

export const adminArticleRoutes = new Hono<AppEnv>();

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

/** True when the signed-in account may move articles into the public state. */
function canPublish(c: AppContext): boolean {
  return c.get('auth')?.permissions.includes('article.write') === true;
}

/**
 * Editorial gate: an account without `article.write` cannot self-publish — the
 * requested status is redirected to `pending` (submit for review), mirroring
 * the legacy approval mode.
 */
async function applyApprovalPolicy(c: AppContext, payload: articlesRepo.ArticleWriteInput, existing?: ArticleDto) {
  const scope = await authorScope(c);
  if (scope) {
    // Never trust client bylines, submitter identity or site-wide placement.
    payload.author = scope.name; payload.authorSlug = scope.slug;
    payload.submitterEmail = c.get('auth')!.email;
    if (!existing && !payload.status) payload.status = 'draft';
    payload.featured = existing?.featured ?? false;
    payload.hero = existing?.hero ?? false;
    payload.heroOrder = existing?.heroOrder ?? null;
    return payload;
  }
  if (payload.status === 'published' && !canPublish(c) && existing?.status !== 'published') {
    payload.status = 'pending';
  }
  return payload;
}

/** Runs the cross-field editorial rules and throws them as one 422. */
function assertEditorialRules(merged: Parameters<typeof refineArticlePayload>[0]): void {
  const errors = refineArticlePayload(merged);
  if (errors.length) {
    throw badRequest(errors.join('; '), errors.map((message) => ({ message })));
  }
}

/** Records the submission trail and notifies the editor inbox. */
async function notifyReview(c: AppContext, article: ArticleDto, notes: string): Promise<void> {
  const db = dbFrom(c);
  const config = c.get('config');
  await articlesRepo.recordSubmission(db, article, notes);

  const content = TEMPLATES.reviewSubmissionEmail({
    article: {
      title: article.title,
      slug: article.slug,
      author: article.author,
      authorSlug: article.authorSlug,
      category: article.category,
      subcategory: article.subcategory,
      status: article.status,
      description: article.description,
      body: article.body,
      tags: article.tags,
      submitterEmail: article.submitterEmail,
    },
    editorEmail: config.editorEmail,
    branding: { siteName: 'Sholynk Tech', appBaseUrl: config.appBaseUrl },
  });

  const delivery = await sendEmail(db, config, c.get('logger')!, config.editorEmail, {
    userId: c.get('auth')?.userId ?? null,
    content,
  });
  if (delivery.delivered) {
    await db.run(
      "UPDATE submissions SET notified_at = datetime('now') WHERE article_id = ? AND notified_at IS NULL",
      [article.id],
    );
  }
}

/* --------------------------------- create ---------------------------------- */

adminArticleRoutes.post('/articles', requirePermission('article.submit'), async (c) => {
  const payload = await parseJson(c, articleInputSchema);
  await applyApprovalPolicy(c, payload);
  assertEditorialRules(payload);

  const db = dbFrom(c);
  const article = await articlesRepo.create(db, payload, c.get('auth')!.userId);

  let data: ArticleDto & { reviewNotice?: string } = article;
  if (article.status === 'pending') {
    await notifyReview(c, article, payload.reviewNotes ?? '');
    data = { ...article, reviewNotice: 'Article submitted for review. Sholynk Tech has been notified.' };
  }

  await audit(c, {
    action: article.status === 'pending' ? AUDIT_ACTIONS.articleSubmitted : AUDIT_ACTIONS.articleCreated,
    entityType: 'article',
    entityId: String(article.id),
    description: `Article created: ${article.title}`,
    metadata: { slug: article.slug, status: article.status },
  });

  return created(c, data);
});

/* --------------------------------- update ---------------------------------- */

for (const method of ['put', 'patch'] as const) {
  adminArticleRoutes[method]('/articles/:id', requirePermission('article.submit'), async (c) => {
    const articleId = Number.parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(articleId) || articleId <= 0) throw notFound('Article not found');

    const payload = await parseJson(c, articleUpdateSchema);
    const db = dbFrom(c);
    await assertResourceOwner(c, 'articles', articleId);
    const existing = await articlesRepo.getById(db, articleId);
    if (!existing) throw notFound('Article not found');

    await applyApprovalPolicy(c, payload, existing);
    assertEditorialRules({ ...existing, ...payload });

    const updated = await articlesRepo.update(db, articleId, payload);
    if (!updated) throw notFound('Article not found');

    let data: ArticleDto & { reviewNotice?: string } = updated;
    if (updated.status === 'pending' && existing.status !== 'pending') {
      await notifyReview(c, updated, String(payload.reviewNotes ?? ''));
      data = { ...updated, reviewNotice: 'Article submitted for review. Sholynk Tech has been notified.' };
    }

    await audit(c, {
      action:
        updated.status === 'published' && existing.status !== 'published'
          ? AUDIT_ACTIONS.articlePublished
          : updated.status === 'pending' && existing.status !== 'pending'
            ? AUDIT_ACTIONS.articleSubmitted
            : AUDIT_ACTIONS.articleUpdated,
      entityType: 'article',
      entityId: String(updated.id),
      description: `Article updated: ${updated.title}`,
      metadata: { slug: updated.slug, status: updated.status, previous_status: existing.status },
    });

    return ok(c, data);
  });
}

/* --------------------------------- delete ---------------------------------- */

adminArticleRoutes.delete('/articles/:id', requirePermission('article.write'), async (c) => {
  const id = Number.parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) throw notFound('Article not found');
  const db = dbFrom(c);
  await assertResourceOwner(c, 'articles', id);
  const existing = await articlesRepo.getById(db, id);
  if (!existing) throw notFound('Article not found');

  const removed = await articlesRepo.remove(db, id);
  if (!removed) throw notFound('Article not found');

  await audit(c, {
    action: AUDIT_ACTIONS.articleDeleted,
    entityType: 'article',
    entityId: String(id),
    description: `Article deleted: ${existing.title}`,
    metadata: { slug: existing.slug },
  });
  return noContent(c);
});

/* --------------------------------- sources ---------------------------------- */

adminArticleRoutes.post(
  '/articles/:id/sources',
  requirePermission('article.submit'),
  async (c) => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    if (!Number.isFinite(id) || id <= 0) throw notFound('Article not found');
    const source = await parseJson(c, articleSourceSchema);
    const db = dbFrom(c);
    await assertResourceOwner(c, 'articles', id);
    const added = await articlesRepo.addSource(db, id, source);
    if (!added) throw notFound('Article not found');
    return created(c, added);
  },
);

adminArticleRoutes.delete(
  '/articles/:id/sources/:sourceId',
  requirePermission('article.submit'),
  async (c) => {
    const id = Number.parseInt(c.req.param('id') ?? '', 10);
    const sourceId = Number.parseInt(c.req.param('sourceId') ?? '', 10);
    if (!Number.isFinite(id) || !Number.isFinite(sourceId)) throw notFound('Source not found');
    const db = dbFrom(c);
    await assertResourceOwner(c, 'articles', id);
    const removed = await articlesRepo.removeSource(db, id, sourceId);
    if (!removed) throw notFound('Source not found');
    return noContent(c);
  },
);
