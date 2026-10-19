/** Self-service author endpoints. Identity and resource IDs come from the session. */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as authors from '../../db/repositories/authors.js';
import { authorScope } from '../../middleware/author-scope.js';
import { parseJson, parseQuery } from '../../middleware/validate.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { audit } from '../../services/audit.js';
import { ok } from '../helpers.js';

export const authorWorkspaceRoutes = new Hono<AppEnv>();
const https = z.string().trim().max(2048).refine((value) => {
  if (value === '') return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, 'Use a valid HTTPS URL without embedded credentials');
const image = z.union([https, z.string().regex(/^\/uploads\/[a-zA-Z0-9._-]+$/)]);
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  bio: z.string().trim().max(1000).optional(),
  image: image.optional(), imageAlt: z.string().trim().max(500).optional(),
  profileUrl: https.optional(),
  socialLinks: z.object({ website: https.optional(), x: https.optional(), linkedin: https.optional(),
    github: https.optional(), instagram: https.optional(), youtube: https.optional() }).strict().optional(),
}).strict();

for (const method of ['get', 'patch'] as const) {
  authorWorkspaceRoutes[method]('/author/profile', async (c) => {
    const scope = await authorScope(c);
    if (!scope) throw forbidden('An approved author account is required.');
    const db = createDb(c.env.DB);
    const existing = (await authors.get(db, scope.authorId))!;
    if (method === 'get') return ok(c, existing);
    const input = await parseJson(c, profileSchema);
    const profile = { ...existing, ...input };
    if (profile.image && !profile.imageAlt) throw badRequest('Provide alt text for your profile photo.');
    // A site-uploaded profile image must be owned by this account. External
    // HTTPS portraits are allowed; they do not confer any media-management rights.
    if (profile.image.startsWith('/uploads/') && !(await db.exists(
      'SELECT 1 AS found FROM images WHERE url = ? AND owner_user_id = ?', [profile.image, scope.userId]))) {
      throw badRequest('Select a photo from your own media library.');
    }
    await db.batch([
      db.prepare(`UPDATE authors SET name = ?, bio = ?, image = ?, image_alt = ?, profile_url = ?, social_links_json = ?,
        updated_at = datetime('now') WHERE id = ?`, [profile.name, profile.bio, profile.image, profile.imageAlt, profile.profileUrl,
        JSON.stringify(profile.socialLinks), scope.authorId]),
      db.prepare(`UPDATE user_profiles SET display_name = ?, bio = ?, avatar_url = ?, website = ?, updated_at = ? WHERE user_id = ?`,
        [profile.name, profile.bio, profile.image, profile.profileUrl, new Date().toISOString(), scope.userId]),
      db.prepare(`UPDATE articles SET author = ?, updated_at = datetime('now') WHERE owner_user_id = ? AND author_slug = ?`,
        [profile.name, scope.userId, scope.slug]),
    ]);
    await audit(c, { action: 'author.profile.updated', entityType: 'author', entityId: String(scope.authorId), description: 'Author updated their public profile' });
    return ok(c, await authors.get(db, scope.authorId));
  });
}

authorWorkspaceRoutes.get('/author/analytics', async (c) => {
  const scope = await authorScope(c);
  if (!scope) throw forbidden('An approved author account is required.');
  const { days, page } = parseQuery(c, z.object({ days: z.coerce.number().int().min(1).max(365).default(30), page: z.coerce.number().int().min(1).max(10000).default(1) }));
  const db = createDb(c.env.DB);
  const since = `-${days - 1} days`;
  const totals = await db.first(`SELECT COUNT(*) AS articles,
    COALESCE(SUM(status = 'published'), 0) AS published, COALESCE(SUM(status = 'draft'), 0) AS drafts
    FROM articles WHERE owner_user_id = ?`, [scope.userId]);
  const countEngagement = (table: 'article_views' | 'comments' | 'reactions') => db.count(
    `SELECT COUNT(*) AS total FROM ${table} e JOIN articles a ON a.slug = e.article_slug
      WHERE a.owner_user_id = ? AND date(e.created_at) >= date('now', ?)`, [scope.userId, since]);
  const [views, comments, reactions, items] = await Promise.all([
    countEngagement('article_views'), countEngagement('comments'), countEngagement('reactions'),
    db.all(`SELECT a.id, a.title, a.slug, a.status,
      (SELECT COUNT(*) FROM article_views v WHERE v.article_slug = a.slug AND date(v.created_at) >= date('now', ?)) AS views,
      (SELECT COUNT(*) FROM comments c WHERE c.article_slug = a.slug AND date(c.created_at) >= date('now', ?)) AS comments,
      (SELECT COUNT(*) FROM reactions r WHERE r.article_slug = a.slug AND date(r.created_at) >= date('now', ?)) AS reactions
      FROM articles a WHERE a.owner_user_id = ? ORDER BY a.id DESC LIMIT 50 OFFSET ?`, [since, since, since, scope.userId, (page - 1) * 50]),
  ]);
  return ok(c, { days, page, perPage: 50, totals: { ...totals!, views, comments, reactions }, items });
});
