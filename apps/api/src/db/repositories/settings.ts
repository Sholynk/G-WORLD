/**
 * Repository — site metadata settings (key/value).
 *
 * Ported from the legacy CMS module (cms/lib/settings.js) with one change:
 * reads never write. The defaults are merged in memory, and the canonical rows
 * are seeded by database/seeds/003_content.sql, so a read-only replica or a
 * fresh database both behave without a write on GET.
 */
import type { Db } from '../client.js';

/** Defaults mirror the legacy CMS; the seed file writes the same values. */
export const DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  siteTitle: 'Sholynk Tech - AI, Web3 and Emerging Tech Insights',
  siteDescription:
    'Explore editor picks, practical guides and analysis on AI trends, Web3, software development, cybersecurity and emerging technology.',
  siteKeywords: 'technology, AI trends, Web3, software development, cybersecurity, articles',
  homeTagline: 'Insightful tech stories for builders, creators and curious minds.',
});

export type SettingsMap = Record<string, string>;

export async function all(db: Db): Promise<SettingsMap> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const merged: SettingsMap = { ...DEFAULTS };
  for (const row of rows) merged[row.key] = row.value;
  return merged;
}

export async function set(db: Db, patch: SettingsMap): Promise<SettingsMap> {
  const entries = Object.entries(patch).filter(([, value]) => value != null);
  if (entries.length) {
    await db.batch(
      entries.map(([key, value]) =>
        db.prepare(
          `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [String(key), String(value)],
        ),
      ),
    );
  }
  return all(db);
}
