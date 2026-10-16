/**
 * G WORLD — URL slug generation.
 *
 * Slugs are the public identifiers used in URLs (`/courses/javascript-basics`),
 * so they must be stable, lowercase, ASCII and unique. Uniqueness is resolved
 * deterministically (`-2`, `-3`, …) and finally guaranteed by a UNIQUE index in
 * the database — the helper only avoids a pointless failed insert.
 */

const DIACRITICS = /[\u0300-\u036f]/g;

export function slugify(input: string, maxLength = 80): string {
  const base = input
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .replace(/['’"]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (!base) return 'item';
  if (base.length <= maxLength) return base;

  // Trim on a word boundary where possible so slugs stay readable.
  const truncated = base.slice(0, maxLength);
  const lastDash = truncated.lastIndexOf('-');
  return (lastDash > maxLength * 0.6 ? truncated.slice(0, lastDash) : truncated).replace(/-+$/, '');
}

/** Pure candidate generator — the caller decides when to stop asking. */
export function slugCandidates(input: string, maxAttempts = 25): string[] {
  const base = slugify(input);
  const candidates = [base];
  for (let i = 2; i <= maxAttempts; i += 1) candidates.push(slugify(`${base}-${i}`));
  return candidates;
}

/**
 * Resolves a unique slug using the provided existence check.
 * `exists` performs one indexed lookup (SELECT 1 … WHERE slug = ?).
 */
export async function uniqueSlug(
  input: string,
  exists: (candidate: string) => Promise<boolean>,
  fallbackSuffix?: string,
): Promise<string> {
  for (const candidate of slugCandidates(input)) {
    if (!(await exists(candidate))) return candidate;
  }
  return slugify(`${input}-${fallbackSuffix ?? Date.now().toString(36)}`);
}

/** Validates a slug supplied by an administrator. */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length >= 2 && value.length <= 120;
}
