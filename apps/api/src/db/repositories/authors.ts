/**
 * Repository — author entities.
 *
 * Ported from the legacy CMS module (cms/lib/authors.js). Every article points
 * at one of these; the house author (site owner) is seeded in
 * database/seeds/003_content.sql, is the fallback for unknown author slugs and
 * cannot be deleted — removing it would orphan the entire archive.
 */
import type { Db } from '../client.js';
import { slugify, uniqueSlug } from '../../lib/slug.js';
import { badRequest } from '../../lib/errors.js';

export interface AuthorDto {
  id: number;
  slug: string;
  name: string;
  bio: string;
  role: string;
  image: string;
  imageAlt: string;
  profileUrl: string;
  socialLinks: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** The house author profile, mirroring the legacy DEFAULT_AUTHOR. */
export const DEFAULT_AUTHOR = Object.freeze({
  slug: 'oluwashola-busari',
  name: 'Oluwashola Busari',
  role: 'Founder, Software Engineer and Tech Journalist',
  bio: 'The founder of Sholynk Technology. Has a background in Mass Communication, Software Engineering, Digital Marketing, and Data Analysis. He is focused on explaining technical concepts in very simple terms.',
  image: 'assets/brand/my_pic.png',
  imageAlt: 'Portrait photo of Oluwashola Busari',
  profileUrl: 'about.html',
});

type AuthorRow = Record<string, string | number | null> & { id: number; slug: string };

function toApi(row: AuthorRow | null): AuthorDto | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    bio: String(row.bio ?? ''),
    role: String(row.role ?? ''),
    image: String(row.image ?? ''),
    imageAlt: String(row.image_alt ?? ''),
    profileUrl: String(row.profile_url ?? ''),
    socialLinks: JSON.parse(String(row.social_links_json || '{}')) as Record<string, string>,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function list(db: Db): Promise<AuthorDto[]> {
  const rows = await db.all<AuthorRow>('SELECT * FROM authors ORDER BY name ASC');
  return rows.map((row) => toApi(row)!);
}

export async function get(db: Db, idOrSlug: string | number): Promise<AuthorDto | null> {
  const row = /^\d+$/.test(String(idOrSlug))
    ? await db.first<AuthorRow>('SELECT * FROM authors WHERE id = ?', [Number(idOrSlug)])
    : await db.first<AuthorRow>('SELECT * FROM authors WHERE slug = ?', [String(idOrSlug)]);
  return toApi(row);
}

export interface AuthorInput {
  name: string;
  slug?: string;
  role?: string;
  bio?: string;
  image?: string;
  imageAlt?: string;
  profileUrl?: string;
}

async function uniqueAuthorSlug(db: Db, value: string, ignoreId?: number): Promise<string> {
  const base = slugify(value) || 'author';
  return uniqueSlug(base, async (candidate) =>
    ignoreId
      ? db.exists('SELECT 1 AS found FROM authors WHERE slug = ? AND id != ?', [candidate, ignoreId])
      : db.exists('SELECT 1 AS found FROM authors WHERE slug = ?', [candidate]),
  );
}

export async function create(db: Db, payload: AuthorInput): Promise<AuthorDto> {
  const slug = await uniqueAuthorSlug(db, payload.slug || payload.name);
  const result = await db.run(
    `INSERT INTO authors (slug, name, bio, role, image, image_alt, profile_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      slug,
      String(payload.name).trim(),
      String(payload.bio ?? ''),
      String(payload.role ?? ''),
      String(payload.image ?? ''),
      String(payload.imageAlt ?? ''),
      String(payload.profileUrl ?? ''),
    ],
  );
  const created = await get(db, Number(result.lastRowId ?? 0));
  if (!created) throw badRequest('Author could not be created');
  return created;
}

export async function update(
  db: Db,
  id: number,
  payload: Partial<AuthorInput>,
): Promise<AuthorDto | null> {
  const existing = await get(db, id);
  if (!existing) return null;
  const merged = { ...existing, ...payload } as AuthorDto & Partial<AuthorInput>;

  // Cross-field rules are validated on the *merged* author, exactly like the
  // legacy module: a partial patch can never leave an image without alt text.
  if (!String(merged.name ?? '').trim()) throw badRequest('author name is required');
  if (String(merged.image ?? '').trim() && !String(merged.imageAlt ?? '').trim()) {
    throw badRequest('author imageAlt is required whenever an image is set');
  }

  const slug = Object.prototype.hasOwnProperty.call(payload, 'slug')
    ? await uniqueAuthorSlug(db, payload.slug || merged.name, existing.id)
    : existing.slug;

  await db.batch([
    db.prepare(
      `UPDATE authors SET slug = ?, name = ?, bio = ?, role = ?, image = ?, image_alt = ?,
         profile_url = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        slug,
        String(merged.name ?? '').trim(),
        String(merged.bio ?? ''),
        String(merged.role ?? ''),
        String(merged.image ?? ''),
        String(merged.imageAlt ?? ''),
        String(merged.profileUrl ?? ''),
        existing.id,
      ],
    ),
    // Articles follow their author entity when the slug changes, so bylines
    // and the dashboard leaderboard keep reconciling.
    ...(slug !== existing.slug
      ? [
          db.prepare(
            "UPDATE articles SET author_slug = ?, updated_at = datetime('now') WHERE author_slug = ?",
            [slug, existing.slug],
          ),
        ]
      : []),
  ]);
  return get(db, existing.id);
}

/**
 * Deletes an author entity, keeping their articles: those are reassigned to the
 * site owner rather than left with an empty slug. Deleting the house author
 * itself is refused — it is the fallback every other article depends on.
 */
export async function remove(db: Db, id: number): Promise<boolean> {
  const existing = await get(db, id);
  if (!existing) return false;
  if (await db.exists('SELECT 1 AS found FROM author_applications WHERE author_id = ?', [id])) {
    throw badRequest('Registered author profiles are retained. Suspend their account in Author access instead.');
  }
  if (existing.slug === DEFAULT_AUTHOR.slug) {
    throw badRequest('the site owner profile cannot be deleted; every article falls back to it');
  }
  await db.batch([
    db.prepare(
      "UPDATE articles SET author_slug = ?, author = ?, updated_at = datetime('now') WHERE author_slug = ?",
      [DEFAULT_AUTHOR.slug, DEFAULT_AUTHOR.name, existing.slug],
    ),
    db.prepare('DELETE FROM authors WHERE id = ?', [existing.id]),
  ]);
  return true;
}

/**
 * Creates the default author on a fresh database (seeds normally do this); on
 * an existing installation only fields that were never filled in are
 * backfilled — anything edited in the admin is left untouched.
 */
export async function ensureDefault(db: Db): Promise<AuthorDto> {
  const existing = await get(db, DEFAULT_AUTHOR.slug);
  if (!existing) return create(db, { ...DEFAULT_AUTHOR });

  const patch: Partial<AuthorInput> = {};
  if (!String(existing.image || '').trim()) {
    patch.image = DEFAULT_AUTHOR.image;
    patch.imageAlt = String(existing.imageAlt || '').trim() || DEFAULT_AUTHOR.imageAlt;
  }
  if (!String(existing.bio || '').trim()) patch.bio = DEFAULT_AUTHOR.bio;
  if (Object.keys(patch).length) return (await update(db, existing.id, patch)) ?? existing;
  return existing;
}
