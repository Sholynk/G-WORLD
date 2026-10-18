/**
 * Repository — media library records.
 *
 * Ported from the legacy CMS module (cms/lib/images.js) with one structural
 * change: the bytes live in the R2 bucket, not on a Node filesystem. This table
 * stores metadata plus the public URL (`/uploads/<filename>`), which the Pages
 * Function proxies to the Worker's R2 streaming route.
 */
import type { Db } from '../client.js';

export interface ImageDto {
  id: number;
  filename: string;
  url: string;
  alt: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

type ImageRow = Record<string, string | number | null> & { id: number };

function toApi(row: ImageRow | null): ImageDto | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    filename: String(row.filename ?? ''),
    url: String(row.url ?? ''),
    alt: String(row.alt ?? ''),
    mimeType: String(row.mime_type ?? ''),
    sizeBytes: Number(row.size_bytes ?? 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    createdAt: String(row.created_at ?? ''),
  };
}

export async function list(db: Db, ownerUserId?: string): Promise<ImageDto[]> {
  const rows = await db.all<ImageRow>(`SELECT * FROM images${ownerUserId ? ' WHERE owner_user_id = ?' : ''} ORDER BY id DESC`, ownerUserId ? [ownerUserId] : []);
  return rows.map((row) => toApi(row)!);
}

export async function getById(db: Db, id: number): Promise<ImageDto | null> {
  return toApi(await db.first<ImageRow>('SELECT * FROM images WHERE id = ?', [Number(id)]));
}

export async function getByFilename(db: Db, filename: string): Promise<ImageDto | null> {
  return toApi(await db.first<ImageRow>('SELECT * FROM images WHERE filename = ?', [filename]));
}

export async function create(
  db: Db,
  input: {
    filename: string;
    ownerUserId?: string;
    alt?: string;
    mimeType?: string;
    sizeBytes?: number;
    width?: number | null;
    height?: number | null;
  },
): Promise<ImageDto | null> {
  const result = await db.run(
    'INSERT INTO images (filename, url, alt, mime_type, size_bytes, width, height, owner_user_id) VALUES (?,?,?,?,?,?,?,?)',
    [
      input.filename,
      `/uploads/${input.filename}`,
      String(input.alt ?? ''),
      String(input.mimeType ?? ''),
      Number(input.sizeBytes ?? 0),
      input.width ?? null,
      input.height ?? null,
      input.ownerUserId ?? null,
    ],
  );
  return getById(db, Number(result.lastRowId ?? 0));
}

export async function updateAlt(db: Db, id: number, alt: string): Promise<ImageDto | null> {
  const existing = await getById(db, id);
  if (!existing) return null;
  await db.run('UPDATE images SET alt = ? WHERE id = ?', [String(alt ?? ''), existing.id]);
  return getById(db, existing.id);
}

/** Deletes the record; the caller removes the R2 object (best effort). */
export async function remove(db: Db, id: number): Promise<ImageDto | null> {
  const existing = await getById(db, id);
  if (!existing) return null;
  await db.run('DELETE FROM images WHERE id = ?', [existing.id]);
  return existing;
}
