/**
 * Routes — media file streaming from R2.
 *
 * The media library stores bytes in the R2 bucket under their plain filename
 * and metadata in the `images` table. The public URL shape (`/uploads/<file>`)
 * matches the legacy site, so stored article bodies and author photos keep
 * working; the Pages Function at functions/uploads/[[path]].ts forwards here.
 *
 * Only files that exist in the `images` table are served: the database row is
 * the allow-list, exactly like the legacy uploads directory was.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as mediaRepo from '../../db/repositories/media.js';
import { dependencyUnavailable, notFound } from '../../lib/errors.js';

export const publicUploadsRoutes = new Hono<AppEnv>();

/** Conservative filename shape: no traversal, no shell surprises. */
const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]{0,120}\.(jpe?g|png|webp|gif|avif)$/i;

publicUploadsRoutes.get('/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!SAFE_FILENAME.test(filename)) throw notFound('File not found');

  const bucket = c.env.BUCKET;
  if (!bucket) throw dependencyUnavailable('Media storage is not configured on this deployment');

  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const record = await mediaRepo.getByFilename(db, filename);
  if (!record) throw notFound('File not found');

  const object = await bucket.get(filename);
  if (!object) throw notFound('File not found');

  // The legacy site served uploads with a 7-day cache; the filename contains a
  // random suffix, so a re-upload never collides with a cached response.
  c.header('Cache-Control', 'public, max-age=604800');
  c.header('Content-Type', object.httpMetadata?.contentType ?? record.mimeType ?? 'application/octet-stream');
  if (record.alt) c.header('X-Alt-Text', encodeURIComponent(record.alt));

  return c.body(object.body, 200);
});
