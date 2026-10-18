/**
 * Shared contracts — the catalogue and the SQL must not drift.
 *
 * packages/shared/src/roles.ts is the TypeScript mirror of
 * database/migrations/0006_reference_data.sql. These tests parse the migration
 * and assert both sides list the same roles, ranks, permissions and grants, so
 * a future permission added in only one place fails CI instead of silently
 * granting (or denying) the wrong thing at runtime.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  ERROR_STATUS,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSION_DEFAULTS,
  ROLE_RANK,
  buildPaginationMeta,
  isPermissionKey,
  isRoleKey,
  loginSchema,
  permissionSetForRole,
  refineArticlePayload,
  roleAtLeast,
  roleHasPermission,
  subscribeSchema,
  commentSchema,
  settingsSchema,
  articleInputSchema,
} from '@sholynk/shared';

const ROOT = path.resolve(process.cwd());
const MIGRATION = readFileSync(path.join(ROOT, 'database/migrations/0006_reference_data.sql'), 'utf8');

function sqlRoleRows(): { key: string; rank: number }[] {
  return [...MIGRATION.matchAll(/\('role_[a-z_]+',\s*'([a-z_]+)',\s*'[^']*',\s*'[^']*',\s*(\d+),\s*1\)/g)].map(
    (match) => ({ key: match[1]!, rank: Number(match[2]) }),
  );
}

function sqlPermissionKeys(): string[] {
  return [...MIGRATION.matchAll(/\('perm_[a-z_]+',\s*'([a-z.]+)'/g)].map((match) => match[1]!);
}

function sqlGrants(roleId: string): string[] {
  const block = MIGRATION.split(`SELECT '${roleId}', id FROM permissions WHERE key IN (`)[1];
  if (!block) return [];
  return block
    .split(');')[0]!
    .split(',')
    .map((part) => part.trim().replace(/'/g, '').replace(/\s+/g, ' '))
    .filter(Boolean)
    .flatMap((part) => part.split(' ').map((key) => key.trim()).filter(Boolean));
}

describe('role catalogue parity', () => {
  it('lists the same roles as the migration', () => {
    const sql = sqlRoleRows();
    expect(sql.map((row) => row.key).sort()).toEqual([...ROLE_KEYS].sort());
    for (const row of sql) {
      expect(ROLE_RANK[row.key as keyof typeof ROLE_RANK]).toBe(row.rank);
    }
  });

  it('keeps the rank hierarchy (public < editor < admin < super_admin)', () => {
    expect(ROLE_RANK.public).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK.super_admin);
    expect(roleAtLeast('admin', 'editor')).toBe(true);
    expect(roleAtLeast('editor', 'admin')).toBe(false);
  });

  it('labels every role', () => {
    for (const key of ROLE_KEYS) expect(ROLE_LABELS[key].length).toBeGreaterThan(0);
  });

  it('lists the same permissions as the migration', () => {
    expect(sqlPermissionKeys().sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('grants exactly the documented permissions per role', () => {
    for (const [roleId, roleKey] of [
      ['role_editor', 'editor'],
      ['role_admin', 'admin'],
      ['role_super_admin', 'super_admin'],
    ] as const) {
      expect(sqlGrants(roleId).sort()).toEqual([...ROLE_PERMISSION_DEFAULTS[roleKey]].sort());
    }
    expect(sqlGrants('role_public')).toEqual([]);
  });

  it('keeps privileged actions away from editors', () => {
    expect(roleHasPermission('editor', 'article.submit')).toBe(true);
    expect(roleHasPermission('editor', 'article.write')).toBe(false);
    expect(roleHasPermission('editor', 'analytics.read')).toBe(false);
    expect(roleHasPermission('admin', 'article.write')).toBe(true);
    expect(roleHasPermission('admin', 'admin.manage')).toBe(false);
    expect(roleHasPermission('super_admin', 'admin.manage')).toBe(true);
  });

  it('supersets cleanly: every admin power is also a super-admin power', () => {
    const admin = permissionSetForRole('admin');
    const superAdmin = permissionSetForRole('super_admin');
    for (const permission of admin) expect(superAdmin.has(permission)).toBe(true);
    expect(superAdmin.size).toBeGreaterThan(admin.size);
  });

  it('guards against unknown keys', () => {
    expect(isRoleKey('admin')).toBe(true);
    expect(isRoleKey('student')).toBe(false);
    expect(isPermissionKey('article.write')).toBe(true);
    expect(isPermissionKey('course.write')).toBe(false);
    expect(PERMISSIONS.every((permission) => permission.key.includes('.'))).toBe(true);
  });
});

describe('API contract', () => {
  it('maps every error code to a sensible HTTP status', () => {
    for (const code of API_ERROR_CODES) {
      const status = ERROR_STATUS[code];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThanOrEqual(599);
    }
    expect(ERROR_STATUS.VALIDATION_ERROR).toBe(422);
    expect(ERROR_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
  });

  it('derives pagination metadata consistently', () => {
    const meta = buildPaginationMeta(2, 10, 35);
    expect(meta).toEqual({
      page: 2,
      per_page: 10,
      total: 35,
      total_pages: 4,
      has_next: true,
      has_prev: true,
    });
    expect(buildPaginationMeta(1, 12, 0).total_pages).toBe(1); // never fewer than one page
  });
});

describe('validation schemas', () => {
  it('normalises and validates the login payload', () => {
    const parsed = loginSchema.parse({ email: ' Admin@Sholynk.test ', password: 'x', remember: true });
    expect(parsed.email).toBe('admin@sholynk.test');
    expect(parsed.remember).toBe(true);
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });

  it('carries the honeypot fields the public forms post', () => {
    const parsed = subscribeSchema.parse({
      name: 'Ada',
      email: 'ada@example.com',
      'bot-field': 'i-am-a-bot',
    });
    expect(parsed['bot-field']).toBe('i-am-a-bot');
  });

  it('enforces the legacy comment limits', () => {
    expect(commentSchema.safeParse({ author: 'x'.repeat(61), body: 'hello' }).success).toBe(false);
    expect(commentSchema.safeParse({ author: 'Ada', body: 'y'.repeat(2001) }).success).toBe(false);
    const parsed = commentSchema.parse({ author: '  Ada   Lovelace ', body: 'Great piece' });
    expect(parsed.author).toBe('Ada Lovelace');
  });

  it('accepts only the four site-metadata keys', () => {
    const parsed = settingsSchema.parse({ siteTitle: 'Sholynk Tech', unknownKey: 'nope' });
    expect(parsed.siteTitle).toBe('Sholynk Tech');
    expect('unknownKey' in parsed).toBe(false);
  });

  it('mirrors the legacy article field rules', () => {
    const base = { title: 'A story', category: 'Technology' };
    expect(articleInputSchema.parse(base).contentType).toBe('article');
    // canonicalUrl must be absolute HTTPS
    expect(articleInputSchema.safeParse({ ...base, canonicalUrl: 'http://x.dev/a' }).success).toBe(false);
    expect(articleInputSchema.safeParse({ ...base, canonicalUrl: 'https://x.dev/a' }).success).toBe(true);
    // externalLink accepts http(s) or a safe local path, never javascript:
    expect(articleInputSchema.safeParse({ ...base, externalLink: 'index.html?category=AI%20Trends' }).success).toBe(true);
    expect(articleInputSchema.safeParse({ ...base, externalLink: 'javascript:alert(1)' }).success).toBe(false);
    // relatedSlugs are normalised to lowercase hyphenated slugs (case folds,
    // garbage like "not a slug" is still rejected)
    const folded = articleInputSchema.parse({ ...base, relatedSlugs: ['Good-Slug'] });
    expect(folded.relatedSlugs).toEqual(['good-slug']);
    expect(articleInputSchema.safeParse({ ...base, relatedSlugs: ['not a slug'] }).success).toBe(false);
  });
});

describe('the editorial rules engine (refineArticlePayload)', () => {
  it('requires alt text whenever an image is set', () => {
    expect(refineArticlePayload({ img: 'assets/x.jpg', alt: '' })).toContain(
      'alt text is required whenever an image is set (accessibility)',
    );
    expect(refineArticlePayload({ img: 'assets/x.jpg', alt: 'A description' })).toEqual([]);
  });

  it('requires a time when scheduling', () => {
    expect(refineArticlePayload({ status: 'scheduled' })).toContain(
      'scheduledAt is required when status is scheduled',
    );
    expect(refineArticlePayload({ status: 'scheduled', scheduledAt: '2026-11-01T09:00' })).toEqual([]);
  });

  it('holds submissions to the review bar', () => {
    const errors = refineArticlePayload({ status: 'pending', title: 'Hi', description: 'short', body: 'tiny', tags: [] });
    expect(errors).toContain('Title is required (min 6 characters)');
    expect(errors).toContain('Article body must be at least 200 characters for review');
    expect(errors).toContain('Description/teaser is required (min 40 characters)');
    expect(errors).toContain('Add at least 2 tags');
    expect(errors.some((message) => message.includes('section heading'))).toBe(true);

    const ready = refineArticlePayload({
      status: 'pending',
      title: 'A long enough title',
      category: 'Technology',
      description: 'A'.padEnd(60, 'a'),
      body: `## Heading\n\n${'word '.repeat(60)}`,
      tags: ['ai', 'web3'],
    });
    expect(ready).toEqual([]);
  });

  it('accepts Markdown ## headings as the navigability signal', () => {
    const ready = refineArticlePayload({
      status: 'pending',
      title: 'A long enough title',
      category: 'Technology',
      description: 'D'.padEnd(60, 'd'),
      body: `## Section\n\n${'word '.repeat(60)}`,
      tags: ['a', 'b'],
    });
    expect(ready).toEqual([]);
  });
});
