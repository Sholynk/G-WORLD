/**
 * The generated content seed (database/seeds/003_content.sql) is a committed
 * artifact produced from the legacy CMS checkout. These tests are its content
 * validation pass (the legacy repo had cms/validate-content.js): they apply the
 * real migrations and seeds to an in-memory SQLite database — the same engine
 * D1 runs — and assert that every slug is unique and well-formed, statuses and
 * categories are legal, and every image reference resolves to a file that
 * actually ships in apps/web/public with an entry in the renderer's dimensions
 * manifest.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(ROOT, 'apps/web/public');

interface ArticleRow {
  id: number;
  slug: string;
  title: string;
  category: string;
  status: string;
  img: string;
  body: string;
  hero: number;
  hero_order: number | null;
  external_link: string | null;
}

let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const files = [
    'database/migrations/0001_users_and_access.sql',
    'database/migrations/0002_platform_and_security.sql',
    'database/migrations/0003_editorial_content.sql',
    'database/migrations/0004_reader_engagement.sql',
    'database/migrations/0005_triggers_and_indexes.sql',
    'database/migrations/0006_reference_data.sql',
    'database/seeds/001_demo_users.sql',
    'database/seeds/003_content.sql',
  ];
  for (const file of files) {
    db.exec(readFileSync(path.join(ROOT, file), 'utf8'));
  }
});

const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[];

describe('migrations + seeds apply cleanly', () => {
  it('creates the catalogue and the accounts', () => {
    expect(all('SELECT id FROM roles').length).toBe(4);
    expect(all('SELECT id FROM permissions').length).toBe(15);
    expect(all('SELECT email FROM users').length).toBe(2);
  });

  it('is idempotent (INSERT OR IGNORE) when the content seed runs twice', () => {
    db.exec(readFileSync(path.join(ROOT, 'database/seeds/003_content.sql'), 'utf8'));
    expect(all('SELECT id FROM articles').length).toBe(56);
  });
});

describe('seeded articles', () => {
  it('carries the full legacy catalogue: 56 articles, 6 of them long-form', () => {
    const articles = all<ArticleRow>('SELECT * FROM articles');
    expect(articles.length).toBe(56);
    const longForm = articles
      .filter((article) => article.body.length > 500)
      .map((article) => article.slug)
      .sort();
    expect(longForm).toEqual([
      'distraction-by-design',
      'mastering-the-art-of-coding',
      'multimodal-ai-models',
      'stablecoins-and-digital-payments',
      'the-rise-of-esports',
      'the-rise-of-quantum-computing',
    ]);
  });

  it('uses unique, lowercase-hyphenated slugs within the legacy length bound', () => {
    const slugs = all<{ slug: string }>('SELECT slug FROM articles').map((row) => row.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(slug.length).toBeLessThanOrEqual(120);
    }
  });

  it('only uses legal statuses and the five live categories', () => {
    const statuses = new Set(all<{ status: string }>('SELECT status FROM articles').map((row) => row.status));
    for (const status of statuses) {
      expect(['published', 'draft', 'scheduled', 'pending']).toContain(status);
    }
    const categories = new Set(all<{ category: string }>('SELECT category FROM articles').map((row) => row.category));
    for (const expected of ['Technology', 'AI Trends', 'Cryptocurrency', 'Game', 'Web 3']) {
      expect(categories.has(expected), `missing category ${expected}`).toBe(true);
    }
  });

  it('keeps hero placements from the legacy homepage slider', () => {
    const heroes = all<ArticleRow>('SELECT * FROM articles WHERE hero = 1 ORDER BY hero_order');
    expect(heroes.length).toBe(5);
    expect(heroes.map((row) => row.slug)).toContain('mastering-the-art-of-coding');
    expect(heroes.map((row) => row.slug)).toContain('the-rise-of-quantum-computing');
  });

  it('keeps legacy card entries pointing at their category browse links', () => {
    const cardOnly = all<ArticleRow>("SELECT * FROM articles WHERE body = ''");
    expect(cardOnly.length).toBeGreaterThan(40);
    for (const article of cardOnly.slice(0, 40)) {
      if (article.external_link) {
        expect(/^(index\.html\?category=|https?:\/\/)/.test(article.external_link)).toBe(true);
      }
    }
  });

  it('attaches every source record to an existing article', () => {
    const orphans = all<{ n: number }>(
      'SELECT COUNT(*) AS n FROM article_sources s LEFT JOIN articles a ON a.id = s.article_id WHERE a.id IS NULL',
    );
    expect(Number(orphans[0]!.n)).toBe(0);
  });
});

describe('seeded image references', () => {
  function references(): Set<string> {
    const out = new Set<string>();
    for (const article of all<ArticleRow>('SELECT slug, img, body FROM articles')) {
      if (article.img) out.add(article.img);
      for (const match of article.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) out.add(match[1]!);
      for (const match of article.body.matchAll(/<img[^>]+src="([^"]+)"/g)) out.add(match[1]!);
    }
    for (const author of all<{ image: string }>('SELECT image FROM authors')) {
      if (author.image) out.add(author.image);
    }
    return out;
  }

  it('ships every referenced image inside apps/web/public', () => {
    const refs = references();
    expect(refs.size).toBeGreaterThan(40);
    for (const reference of refs) {
      if (/^https?:/i.test(reference)) continue;
      const relative = decodeURIComponent(reference).replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
      expect(existsSync(path.join(PUBLIC_DIR, relative)), `missing asset: ${reference}`).toBe(true);
    }
  });

  it('has a dimensions manifest entry for every local reference', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, 'apps/api/src/lib/image-dimensions.json'), 'utf8'),
    ) as Record<string, [number, number]>;
    for (const reference of references()) {
      if (/^https?:/i.test(reference)) continue;
      const relative = decodeURIComponent(reference).replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
      expect(manifest[relative], `no dimensions for ${relative}`).toBeDefined();
      const [width, height] = manifest[relative]!;
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    }
  });

  it('never carries legacy asset paths into the new deployment', () => {
    const sql = readFileSync(path.join(ROOT, 'database/seeds/003_content.sql'), 'utf8');
    expect(sql).not.toContain('Images and Assets/');
    expect(sql).not.toContain('Article cards images/');
    expect(sql).not.toContain('article-images/');
    expect(sql).not.toContain('Images%20and%20Assets/');
  });
});

describe('seeded author + settings', () => {
  it('seeds the house author with the migrated portrait path', () => {
    const authors = all<{ slug: string; name: string; image: string }>('SELECT slug, name, image FROM authors');
    expect(authors.length).toBe(1);
    expect(authors[0]).toEqual({
      slug: 'oluwashola-busari',
      name: 'Oluwashola Busari',
      image: 'assets/brand/my_pic.png',
    });
  });

  it('attributes every article to the house author', () => {
    const unattributed = all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM articles WHERE author_slug != 'oluwashola-busari'",
    );
    expect(Number(unattributed[0]!.n)).toBe(0);
  });

  it('seeds the four site settings, rebranded to Sholynk Tech', () => {
    const settings = all<{ key: string; value: string }>('SELECT key, value FROM settings');
    expect(settings.map((row) => row.key).sort()).toEqual([
      'homeTagline',
      'siteDescription',
      'siteKeywords',
      'siteTitle',
    ]);
    const title = settings.find((row) => row.key === 'siteTitle')!;
    expect(title.value).toBe('Sholynk Tech - AI, Web3 and Emerging Tech Insights');
  });
});

describe('demo accounts (development seed)', () => {
  it('stores PBKDF2 hashes with the development iteration count', () => {
    const users = all<{ email: string; password_hash: string; role_id: string }>(
      'SELECT email, password_hash, role_id FROM users ORDER BY email',
    );
    expect(users.map((user) => user.email)).toEqual(['admin@sholynk.test', 'editor@sholynk.test']);
    for (const user of users) {
      expect(user.password_hash).toMatch(/^pbkdf2\$sha256\$10000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    }
    expect(users[0]!.role_id).toBe('role_super_admin');
    expect(users[1]!.role_id).toBe('role_editor');
  });
});
