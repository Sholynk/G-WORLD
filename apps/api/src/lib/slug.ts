/**
 * Sholynk Tech — URL slug generation.
 *
 * Slugs are the public identifiers of articles (`/articles/<slug>/`), so they
 * must be stable, lowercase, ASCII and unique. The rules here are byte-for-byte
 * compatible with the legacy Sholynk CMS slugify(), because every seeded slug,
 * every redirect and every reader's bookmark was produced by them.
 *
 * Uniqueness is resolved deterministically (`-2`, `-3`, …) and finally
 * guaranteed by the UNIQUE index on `articles.slug` — the helper only avoids a
 * pointless failed insert.
 */

/** The legacy CMS slugify: NFKD, strip everything but [a-z0-9 -], dash-join. */
export function slugify(value: string = '', maxLength = 80): string {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, maxLength);
}

/** Validates a slug supplied by an editor (lowercase, hyphenated). */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length >= 1 && value.length <= 120;
}

/**
 * Resolves a unique slug using the provided existence check, mirroring the
 * legacy `uniqueSlug(base, ignoreId)`: try the base, then `-2`, `-3`, …
 * `exists` performs one indexed lookup (SELECT 1 … WHERE slug = ? [AND id != ?]).
 */
export async function uniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
  fallback?: string,
): Promise<string> {
  const root = base || fallback || `article-${Date.now()}`;
  let candidate = root;
  let suffix = 2;
  // Bounded instead of `while (true)`: 100 collisions on an 80-char slug space
  // is already pathological, and a Worker must not spin forever.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await exists(candidate))) return candidate;
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return `${root}-${Date.now().toString(36)}`;
}
