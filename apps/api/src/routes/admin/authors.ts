/**
 * Admin routes — author entities and site metadata.
 *
 * Authors: full CRUD behind `author.write`. Deleting an author keeps their
 * articles (reassigned to the house author); the house author itself cannot be
 * deleted — the repository refuses with a 400.
 *
 * Settings: the four site-metadata keys the homepage, robots and SEO tags are
 * built from, behind `settings.write`.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as authorsRepo from '../../db/repositories/authors.js';
import * as settingsRepo from '../../db/repositories/settings.js';
import { authorInputSchema, authorUpdateSchema, settingsSchema } from '@sholynk/shared';
import { parseJson } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { audit } from '../../services/audit.js';
import { created, noContent, ok } from '../helpers.js';

export const adminAuthorRoutes = new Hono<AppEnv>();
export const adminSettingsRoutes = new Hono<AppEnv>();

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

function authorId(c: AppContext): number {
  const id = Number.parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) throw notFound('Author not found');
  return id;
}

/* --------------------------------- authors --------------------------------- */

adminAuthorRoutes.post('/authors', requirePermission('author.write'), async (c) => {
  const payload = await parseJson(c, authorInputSchema);
  const db = dbFrom(c);
  const author = await authorsRepo.create(db, payload);
  await audit(c, {
    action: AUDIT_ACTIONS.authorCreated,
    entityType: 'author',
    entityId: String(author.id),
    description: `Author created: ${author.name}`,
    metadata: { slug: author.slug },
  });
  return created(c, author);
});

adminAuthorRoutes.patch('/authors/:id', requirePermission('author.write'), async (c) => {
  const id = authorId(c);
  const payload = await parseJson(c, authorUpdateSchema);
  const db = dbFrom(c);
  const author = await authorsRepo.update(db, id, payload);
  if (!author) throw notFound('Author not found');
  await audit(c, {
    action: AUDIT_ACTIONS.authorUpdated,
    entityType: 'author',
    entityId: String(author.id),
    description: `Author updated: ${author.name}`,
    metadata: { slug: author.slug },
  });
  return ok(c, author);
});

adminAuthorRoutes.delete('/authors/:id', requirePermission('author.write'), async (c) => {
  const id = authorId(c);
  const db = dbFrom(c);
  const existing = await authorsRepo.get(db, id);
  if (!existing) throw notFound('Author not found');
  const removed = await authorsRepo.remove(db, id);
  if (!removed) throw notFound('Author not found');
  await audit(c, {
    action: AUDIT_ACTIONS.authorDeleted,
    entityType: 'author',
    entityId: String(id),
    description: `Author deleted: ${existing.name}`,
    metadata: { slug: existing.slug },
  });
  return noContent(c);
});

/* -------------------------------- settings --------------------------------- */

adminSettingsRoutes.put('/settings', requirePermission('settings.write'), async (c) => {
  const payload = await parseJson(c, settingsSchema);
  const db = dbFrom(c);
  const settings = await settingsRepo.set(db, payload as settingsRepo.SettingsMap);
  await audit(c, {
    action: AUDIT_ACTIONS.settingsUpdated,
    entityType: 'settings',
    description: 'Site metadata updated',
    metadata: { keys: Object.keys(payload) },
  });
  return ok(c, settings);
});
