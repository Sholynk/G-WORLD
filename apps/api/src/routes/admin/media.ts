/**
 * Admin routes — media library (R2-backed).
 *
 * Uploads replace the legacy Multer+Sharp pipeline: the multipart field
 * `image` is validated by container magic bytes (lib/image-check.ts) instead of
 * a native decode, stored in R2 under a sanitised random-suffixed filename, and
 * recorded in the `images` table with optional intrinsic dimensions (used by
 * the article renderer to keep layout stable).
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from '../../env.js';
import { createDb } from '../../db/client.js';
import * as mediaRepo from '../../db/repositories/media.js';
import { imageAltSchema } from '@sholynk/shared';
import { parseJson } from '../../middleware/validate.js';
import { requireScopedPermission as requirePermission, assertResourceOwner } from '../../middleware/author-scope.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { badRequest, dependencyUnavailable, notFound } from '../../lib/errors.js';
import { MAX_UPLOAD_BYTES, storedFilename, validateImageUpload } from '../../lib/image-check.js';
import { randomHex } from '../../lib/ids.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { audit } from '../../services/audit.js';
import { created, noContent, ok } from '../helpers.js';

export const adminMediaRoutes = new Hono<AppEnv>();

const dbFrom = (c: AppContext) => createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

/** Intrinsic pixel size for the common web formats, or null (AVIF et al.). */
function sniffDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const ascii = (start: number, length: number): string => {
    let out = '';
    for (let i = start; i < start + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]!);
    return out;
  };
  const u16be = (offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!;
  const u16le = (offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8);

  if (bytes.length > 24 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') {
    const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
    const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
    return { width, height };
  }
  if (bytes.length > 10 && ascii(0, 3) === 'GIF') {
    return { width: u16le(6), height: u16le(8) };
  }
  if (bytes.length > 32 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1]!;
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      const len = u16be(i + 2);
      const isSof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
      if (isSof) return { height: u16be(i + 5), width: u16be(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (bytes.length > 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b0 = bytes[21]!, b1 = bytes[22]!, b2 = bytes[23]!, b3 = bytes[24]!;
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    if (chunk === 'VP8X') {
      return {
        width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
        height: 1 + (bytes[28]! | (bytes[29]! << 8) | (bytes[30]! << 16)),
      };
    }
  }
  return null;
}

adminMediaRoutes.post('/images', requirePermission('media.write'), rateLimit('upload.request'), async (c) => {
  const bucket = c.env.BUCKET;
  if (!bucket) throw dependencyUnavailable('Media storage (R2) is not configured on this deployment');

  const body = await c.req.parseBody();
  const file = body['image'];
  if (!(file instanceof File)) {
    throw badRequest('No image file received (field name: image)');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw badRequest('Image too large. Maximum size is 8 MB.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateImageUpload(file.type, bytes);
  if ('error' in check) throw badRequest(check.error);

  const filename = storedFilename(file.name, check.format, randomHex(6));
  await bucket.put(filename, bytes, {
    httpMetadata: { contentType: check.mime, cacheControl: 'public, max-age=604800' },
  });

  const dimensions = sniffDimensions(bytes);
  const db = dbFrom(c);
  const record = await mediaRepo.create(db, {
    filename,
    ownerUserId: c.get('auth')!.userId,
    alt: String(body['alt'] ?? '').trim().slice(0, 500),
    mimeType: check.mime,
    sizeBytes: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.imageUploaded,
    entityType: 'image',
    entityId: String(record?.id ?? ''),
    description: `Image uploaded: ${filename}`,
    metadata: { size_bytes: file.size, mime: check.mime },
  });
  return created(c, record);
});

adminMediaRoutes.patch('/images/:id', requirePermission('media.write'), async (c) => {
  const id = Number.parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) throw notFound('Image not found');
  const payload = await parseJson(c, imageAltSchema);
  const db = dbFrom(c);
  await assertResourceOwner(c, 'images', id);
  const updated = await mediaRepo.updateAlt(db, id, payload.alt);
  if (!updated) throw notFound('Image not found');
  return ok(c, updated);
});

adminMediaRoutes.delete('/images/:id', requirePermission('media.write'), async (c) => {
  const id = Number.parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) throw notFound('Image not found');
  const db = dbFrom(c);
  await assertResourceOwner(c, 'images', id);
  const removed = await mediaRepo.remove(db, id);
  if (!removed) throw notFound('Image not found');

  // Best effort: the database row is gone either way, and an orphaned object
  // is invisible to the site (the row was the allow-list).
  try {
    await c.env.BUCKET?.delete(removed.filename);
  } catch (error) {
    c.get('logger')?.warn('R2 delete failed after image removal', {
      filename: removed.filename,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  await audit(c, {
    action: AUDIT_ACTIONS.imageDeleted,
    entityType: 'image',
    entityId: String(id),
    description: `Image deleted: ${removed.filename}`,
  });
  return noContent(c);
});
