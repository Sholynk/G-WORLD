/** Full Hono middleware stack, real SQLite queries, in-memory R2 adapter. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteBinding } from '../helpers/sqlite-d1.js';
import { buildApp } from '../../apps/api/src/app.js';
import { createDb, type Db } from '../../apps/api/src/db/client.js';
import * as users from '../../apps/api/src/db/repositories/users.js';
import * as access from '../../apps/api/src/db/repositories/author-access.js';
import * as articles from '../../apps/api/src/db/repositories/articles.js';
import * as media from '../../apps/api/src/db/repositories/media.js';
import { createSession } from '../../apps/api/src/db/repositories/sessions.js';
import { hashPassword } from '../../apps/api/src/lib/password.js';
import { hashToken, csrfTokenFor } from '../../apps/api/src/lib/tokens.js';
import { renderAuthorCard, resolveAuthor } from '../../apps/api/src/lib/article-page.js';
import { authorRouteAllowed } from '../../apps/api/src/middleware/author-scope.js';

let sqlite: DatabaseSync;
let db: Db;
let env: Record<string, unknown>;
let app: ReturnType<typeof buildApp>;
let identities: Record<string, { id: string; token: string; slug: string; authorId: number }>;
let a: articles.ArticleDto;
let b: articles.ArticleDto;
let aImage: media.ImageDto;
let bImage: media.ImageDto;
let bucket: Map<string, unknown>;
const ownerCode = 'Owner-confirmation-test-42';
const secret = 'test-only-session-secret-for-author-workspace';

async function makeUser(name: string, owner = false) {
  const { userId } = await users.createUser(db, { email: owner ? access.OWNER_EMAIL : `${name.toLowerCase()}@example.test`,
    passwordHash: await hashPassword('WorkspacePassword42!', 1000), roleId: owner ? 'role_super_admin' : 'role_editor',
    status: 'pending_verification', authorApplication: !owner }, { displayName: name });
  await users.markEmailVerified(db, userId);
  if (owner) await db.run('INSERT INTO site_owner(singleton,user_id,confirmation_hash) VALUES(1,?,?)', [userId, await hashPassword(ownerCode, 1000)]);
  else await access.transition(db, identities.owner!.id, userId, 'approve');
  const profile = await db.first<{ slug: string; author_id: number }>(`SELECT p.slug, a.author_id FROM author_applications a JOIN authors p ON p.id=a.author_id WHERE a.user_id=?`, [userId]);
  const token = crypto.randomUUID();
  await createSession(db, { userId, tokenHash: await hashToken(token), expiresAt: '2099-01-01T00:00:00.000Z' });
  return { id: userId, token, slug: profile?.slug || 'oluwashola-busari', authorId: profile?.author_id || 0 };
}
beforeEach(async () => {
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('database/migrations').filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`database/migrations/${file}`, 'utf8'));
  const binding = sqliteBinding(sqlite); db = createDb(binding); identities = {};
  identities.owner = await makeUser('Owner', true);
  identities.alice = await makeUser('Alice'); identities.bob = await makeUser('Bob');
  a = await articles.create(db, { title: 'Alice private draft', category: 'Science', status: 'draft', body: 'Private Alice body', authorSlug: identities.alice.slug }, identities.alice.id);
  b = await articles.create(db, { title: 'Bob private draft', category: 'Secret Bob Category', status: 'draft', body: 'Private Bob body', authorSlug: identities.bob.slug }, identities.bob.id);
  aImage = (await media.create(db, { filename: 'alice.png', ownerUserId: identities.alice.id }))!;
  bImage = (await media.create(db, { filename: 'bob.png', ownerUserId: identities.bob.id }))!;
  bucket = new Map([['alice.png', new Uint8Array()], ['bob.png', new Uint8Array()]]);
  env = { DB: binding, SESSION_SECRET: secret, ENVIRONMENT: 'development', ENABLE_DEV_ROUTES: 'false', ENABLE_REGISTRATION: 'false',
    EMAIL_PROVIDER: 'console', PASSWORD_ITERATIONS: '10000', BUCKET: {
      put: async (key: string, value: unknown) => { bucket.set(key, value); },
      delete: async (key: string) => { bucket.delete(key); },
    } };
  app = buildApp();
});
afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });
async function call(path: string, method = 'GET', body?: unknown, who: string | null = 'alice', extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (who) headers.authorization = `Bearer ${identities[who]!.token}`;
  const data = body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body);
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  return app.request(`https://publication.example/api/v1${path}`, { method, headers, body: data }, env as never);
}
async function data(response: Response) {
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBeLessThan(300);
  return result.data;
}

describe('article ownership and author publishing', () => {
  it('lets approved authors publish immediately but binds identity and placement server-side', async () => {
    const created = await data(await call('/admin/articles', 'POST', { title: 'An author can publish', category: 'Science', status: 'published',
      body: 'My article body', author: 'Bob', authorSlug: identities.bob!.slug, submitterEmail: 'bob@example.test',
      owner_user_id: identities.bob!.id, featured: true, hero: true, heroOrder: 0 }));
    expect(created.status).toBe('published'); expect(created.author).toBe('Alice'); expect(created.authorSlug).toBe(identities.alice!.slug);
    expect(created.submitterEmail).toBe('alice@example.test'); expect(created.featured).toBe(false); expect(created.hero).toBe(false);
    expect(await db.first('SELECT owner_user_id FROM articles WHERE id=?', [created.id])).toEqual({ owner_user_id: identities.alice!.id });
  });
  it('defaults new author content to draft and can edit, unpublish and delete only own articles', async () => {
    const created = await data(await call('/admin/articles', 'POST', { title: 'New draft', category: 'Science' }));
    expect(created.status).toBe('draft');
    // Publishing now requires a body (a bodyless live article has nothing to read).
    expect((await data(await call(`/admin/articles/${a.id}`, 'PUT', { status: 'published', title: 'Updated Alice', body: 'Updated Alice body' }))).status).toBe('published');
    expect((await data(await call(`/admin/articles/${a.id}`, 'PATCH', { status: 'draft' }))).status).toBe('draft');
    for (const method of ['PATCH', 'PUT', 'DELETE']) expect((await call(`/admin/articles/${b.id}`, method, method === 'DELETE' ? undefined : { title: 'Stolen' })).status).toBe(404);
    expect((await articles.getById(db, b.id))!.title).toBe('Bob private draft');
    expect((await call(`/admin/articles/${a.id}`, 'DELETE')).status).toBe(204);
  });
  it('filters draft lists AND counts and protects detail/source preview routes', async () => {
    const response = await call(`/articles?status=all&owner_user_id=${identities.bob!.id}&limit=1`);
    const payload = await response.json();
    expect(payload.data.map((item: { id: number }) => item.id)).toEqual([a.id]); expect(payload.meta.pagination.total).toBe(1);
    for (const path of [`/articles/${b.id}`, `/articles/${b.slug}`, `/articles/${b.id}/sources`]) expect((await call(path)).status).toBe(404);
    expect((await call(`/articles/${a.id}`)).status).toBe(200);
    expect((await call('/articles?status=all', 'GET', undefined, null)).status).toBe(401);
    expect(await data(await call('/articles/categories?status=draft'))).not.toContain('Secret Bob Category');
  });
  it('allows normal public reading of other authors published articles', async () => {
    await articles.update(db, b.id, { status: 'published' });
    expect((await data(await call(`/articles/${b.id}`))).id).toBe(b.id);
    expect((await data(await call('/articles'))).map((item: { id: number }) => item.id)).toContain(b.id);
  });
  it('does not expose author login emails or review notes in public article responses', async () => {
    await articles.update(db, a.id, { status: 'published', submitterEmail: 'private@example.test', reviewNotes: 'Private editorial notes' });
    const publicDetail = await data(await call(`/articles/${a.id}`, 'GET', undefined, null));
    expect(publicDetail.submitterEmail).toBe(''); expect(publicDetail.reviewNotes).toBe('');
    const publicList = await data(await call('/articles', 'GET', undefined, null));
    expect(JSON.stringify(publicList)).not.toContain('private@example.test');
    expect(JSON.stringify(publicList)).not.toContain('Private editorial notes');
    const ownList = await data(await call('/articles?status=all'));
    expect(ownList[0].reviewNotes).toBe('Private editorial notes');
  });
  it('guards nested source mutations and rejects mixed article/source IDs', async () => {
    const source = await articles.addSource(db, b.id, { title: 'Private source', url: 'https://example.test/source' });
    expect((await call(`/admin/articles/${b.id}/sources`, 'POST', { title: 'Stolen', url: 'https://example.test' })).status).toBe(404);
    expect((await call(`/admin/articles/${a.id}/sources/${source!.id}`, 'DELETE')).status).toBe(404);
    expect((await call(`/admin/articles/${b.id}/sources/${source!.id}`, 'DELETE')).status).toBe(404);
    expect((await call(`/admin/articles/${a.id}/sources`, 'POST', { title: 'My source', url: 'https://example.test' })).status).toBe(201);
  });
  it('does not confer ownership through byline names or matching legacy author slugs', async () => {
    const legacy = await articles.create(db, { title: 'Legacy unassigned article', category: 'Science', status: 'draft', authorSlug: identities.alice!.slug });
    expect((await call(`/admin/articles/${legacy.id}`, 'PATCH', { title: 'Claimed' })).status).toBe(404);
    expect((await data(await call('/articles?status=all'))).map((item: { id: number }) => item.id)).toEqual([a.id]);
    await expect(db.run('UPDATE articles SET owner_user_id=? WHERE id=?', [identities.bob!.id, a.id])).rejects.toThrow(/immutable/);
  });
  it('reserves retired URLs against cross-author reuse, including direct database races', async () => {
    await articles.update(db, b.id, { slug: 'bob-renamed' });
    const created = await data(await call('/admin/articles', 'POST', { title: 'Not Bob', category: 'Science', slug: b.slug }));
    expect(created.slug).toBe(`${b.slug}-2`);
    await expect(db.run('UPDATE articles SET slug=? WHERE id=?', [b.slug, a.id])).rejects.toThrow(/reserved/);
    expect(await db.first('SELECT new_slug FROM redirects WHERE old_slug=?', [b.slug])).toEqual({ new_slug: 'bob-renamed' });
  });
  it('retains ownership and moves only own reader history when renaming', async () => {
    await db.run('INSERT INTO comments(article_slug,author,body) VALUES(?,?,?)', [a.slug, 'Reader', 'Comment']);
    const updated = await data(await call(`/admin/articles/${a.id}`, 'PATCH', { slug: 'alice-renamed' }));
    expect(updated.slug).toBe('alice-renamed');
    expect(await db.count("SELECT COUNT(*) AS total FROM comments WHERE article_slug='alice-renamed'")).toBe(1);
    expect((await articles.getById(db, b.id))!.slug).toBe(b.slug);
    expect(await db.first('SELECT owner_user_id FROM articles WHERE id=?', [a.id])).toEqual({ owner_user_id: identities.alice!.id });
  });
});

describe('media ownership', () => {
  it('scopes the media index and forbids editing/deleting another upload', async () => {
    expect((await data(await call('/images'))).map((item: { id: number }) => item.id)).toEqual([aImage.id]);
    expect((await call(`/admin/images/${bImage.id}`, 'PATCH', { alt: 'Stolen' })).status).toBe(404);
    expect((await call(`/admin/images/${bImage.id}`, 'DELETE')).status).toBe(404); expect(bucket.has('bob.png')).toBe(true);
    expect((await data(await call(`/admin/images/${aImage.id}`, 'PATCH', { alt: 'My image', owner_user_id: identities.bob!.id }))).alt).toBe('My image');
    expect((await call(`/admin/images/${aImage.id}`, 'DELETE')).status).toBe(204); expect(bucket.has('alice.png')).toBe(false);
    await expect(db.run('UPDATE images SET owner_user_id=? WHERE id=?', [identities.alice!.id, bImage.id])).rejects.toThrow(/immutable/);
  });
  it('assigns uploads to the authenticated author, never a submitted owner field', async () => {
    const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,...Array(40).fill(0)]);
    const form = new FormData(); form.append('image', new File([bytes], 'new.png', { type: 'image/png' }));
    form.append('owner_user_id', identities.bob!.id); form.append('alt', 'New image');
    const image = await data(await call('/admin/images', 'POST', form));
    expect(await db.first('SELECT owner_user_id FROM images WHERE id=?', [image.id])).toEqual({ owner_user_id: identities.alice!.id });
    expect(bucket.has(image.filename)).toBe(true);
  });
});

describe('author profiles, analytics and moderation', () => {
  it('updates own name, bio, photo and social links atomically with article bylines', async () => {
    const profile = await data(await call('/admin/author/profile', 'PATCH', { name: 'Alice Updated', bio: 'My biography', image: aImage.url,
      imageAlt: 'Alice portrait', profileUrl: 'https://alice.example', socialLinks: { x: 'https://x.com/alice', github: 'https://github.com/alice' } }));
    expect(profile.id).toBe(identities.alice!.authorId); expect(profile.socialLinks.github).toBe('https://github.com/alice');
    expect((await users.findById(db, identities.alice!.id))!.display_name).toBe('Alice Updated');
    expect((await articles.getById(db, a.id))!.author).toBe('Alice Updated'); expect((await users.findById(db, identities.bob!.id))!.display_name).toBe('Bob');
    const html = renderAuthorCard(resolveAuthor({ authorSlug: profile.slug }, [profile], 'https://publication.example'));
    expect(html).toContain('https://github.com/alice'); expect(html).toContain('Author social links');
  });
  it('rejects role/identity changes, unsafe links, and another authors uploaded profile photo', async () => {
    for (const payload of [{ name: 'Bad', role: 'super_admin' }, { user_id: identities.bob!.id }, { authorId: identities.bob!.authorId },
      { socialLinks: { x: 'javascript:alert(1)' } }, { profileUrl: '//attacker.test' }, { image: bImage.url, imageAlt: 'Stolen' }]) {
      expect((await call('/admin/author/profile', 'PATCH', payload)).status).toBe(422);
    }
    expect((await data(await call('/admin/author/profile'))).name).toBe('Alice');
  });
  it('lists and deletes comments only on the authors articles', async () => {
    const own = await db.run('INSERT INTO comments(article_slug,author,body) VALUES(?,?,?)', [a.slug, 'Reader', 'Alice comment']);
    const other = await db.run('INSERT INTO comments(article_slug,author,body) VALUES(?,?,?)', [b.slug, 'Reader', 'Bob comment']);
    const comments = await data(await call('/admin/comments'));
    expect(comments.map((row: { body: string }) => row.body)).toEqual(['Alice comment']);
    expect((await call(`/admin/comments/${other.lastRowId}`, 'DELETE')).status).toBe(404);
    expect((await call(`/admin/comments/${own.lastRowId}`, 'DELETE')).status).toBe(204);
    for (const path of [`/articles/${b.slug}/comments`, `/articles/${b.slug}/engagement`, `/articles/${b.slug}/reactions`]) {
      expect((await call(path, 'GET', undefined, null)).status).toBe(404);
    }
  });
  it('filters analytics aggregates and rows even with a forged account query', async () => {
    for (let i = 0; i < 3; i++) await db.run('INSERT INTO article_views(article_slug) VALUES(?)', [a.slug]);
    for (let i = 0; i < 9; i++) await db.run('INSERT INTO article_views(article_slug) VALUES(?)', [b.slug]);
    await db.run('INSERT INTO comments(article_slug,author,body) VALUES(?,?,?)', [a.slug, 'Reader', 'Alice comment']);
    const report = await data(await call(`/admin/author/analytics?days=7&user_id=${identities.bob!.id}`));
    expect(report.totals.articles).toBe(1); expect(report.totals.views).toBe(3); expect(report.totals.comments).toBe(1);
    expect(report.items.map((row: { id: number }) => row.id)).toEqual([a.id]);
    expect((await call('/admin/author/analytics?days=-1')).status).toBe(422);
  });
});

describe('complete new-author onboarding', () => {
  it('requires verification and owner approval before a real login cookie can publish', async () => {
    env.ENABLE_REGISTRATION = 'true';
    const registration = await data(await call('/auth/register', 'POST', {
      email: 'candidate@example.test', password: 'CandidatePassword42!', display_name: 'New Candidate', accepted_terms: true,
    }, null));
    const candidateId = registration.user.id;
    const email = await db.first<{ body_text: string }>("SELECT body_text FROM email_messages WHERE user_id = ? AND template = 'email_verification'", [candidateId]);
    // The existing verification template is intentionally stored by the local
    // console mailer; sensitive owner setup links are never stored this way.
    const stored = email ?? await db.first<{ body_text: string }>("SELECT body_text FROM email_messages WHERE user_id = ? AND body_text LIKE '%verify=%'", [candidateId]);
    const token = /verify=([A-Za-z0-9_-]+)/.exec(stored!.body_text)![1]!;
    const credentials = { email: 'candidate@example.test', password: 'CandidatePassword42!' };
    expect((await call('/auth/login', 'POST', credentials, null)).status).toBe(403);
    expect((await call('/auth/verify-email', 'POST', { token }, null)).status).toBe(200);
    expect((await call('/auth/login', 'POST', credentials, null)).status).toBe(403);
    expect((await call(`/admin/accounts/${candidateId}`, 'POST', { action: 'approve', confirmation_code: ownerCode }, 'owner')).status).toBe(200);
    const login = await call('/auth/login', 'POST', credentials, null);
    expect(login.status).toBe(200);
    const pairs = login.headers.getSetCookie().map((value) => value.split(';')[0]!);
    const cookie = pairs.join('; ');
    const csrf = decodeURIComponent(pairs.find((pair) => pair.startsWith('sk_csrf='))!.slice('sk_csrf='.length));
    const published = await data(await call('/admin/articles', 'POST', { title: 'First approved article', category: 'Science', status: 'published', body: 'An approved author can publish.' }, null,
      { cookie, 'X-CSRF-Token': csrf }));
    expect(published.status).toBe('published'); expect(published.author).toBe('New Candidate');
    expect(await db.first('SELECT owner_user_id FROM articles WHERE id=?', [published.id])).toEqual({ owner_user_id: candidateId });
  });
});

describe('owner boundary, suspension and legacy compatibility', () => {
  it('resolves author scope once per request without caching eligibility across requests', async () => {
    const prepare = vi.spyOn(env.DB as D1Database, 'prepare');
    expect((await call(`/admin/articles/${a.id}`, 'PATCH', { title: 'Scoped edit' })).status).toBe(200);
    const scopeLookups = () => prepare.mock.calls.filter(([sql]) => sql.includes('a.status AS review'));
    expect(scopeLookups()).toHaveLength(1);
    expect((await call('/admin/author/profile')).status).toBe(200);
    expect(scopeLookups()).toHaveLength(2);
    await access.transition(db, identities.owner!.id, identities.alice!.id, 'suspend');
    expect((await call('/admin/author/profile')).status).toBe(401);
  });
  it('denies all owner areas regardless of guessed routes or privileged request fields', async () => {
    for (const path of ['/admin/accounts', '/admin/analytics/overview', '/admin/analytics/stream', '/admin/subscriptions', '/admin/contact-messages', '/admin/system/audit']) {
      expect((await call(path)).status).toBe(403);
    }
    for (const [path, method] of [['/admin/settings', 'PUT'], ['/admin/authors', 'POST'], ['/admin/system/maintenance', 'POST'], [`/admin/accounts/${identities.bob!.id}`, 'POST']]) {
      expect((await call(path!, method, { role: 'super_admin', action: 'approve', confirmation_code: ownerCode })).status).toBe(403);
    }
    const capabilities = await data(await call('/admin/accounts/capabilities'));
    expect(capabilities.owner).toBe(false); expect(capabilities.author.userId).toBe(identities.alice!.id); expect(capabilities.workspace_pending).toBe(false);
    expect(authorRouteAllowed('GET', '/future-owner-tool')).toBe(false);
  });
  it('lets the owner manage another authors content with sensitive-action confirmation', async () => {
    expect((await call(`/admin/articles/${b.id}`, 'PATCH', { title: 'Owner edit' }, 'owner')).status).toBe(200);
    expect((await call(`/admin/articles/${b.id}`, 'DELETE', undefined, 'owner')).status).toBe(403);
    expect((await call(`/admin/articles/${b.id}`, 'DELETE', undefined, 'owner', { 'X-Owner-Confirmation': ownerCode })).status).toBe(204);
  });
  it('enforces CSRF on author mutations as well as session authentication', async () => {
    const token = identities.alice!.token;
    const headers = { cookie: `sk_session=${token}` };
    expect((await call(`/admin/articles/${a.id}`, 'PATCH', { title: 'CSRF edit' }, null, headers)).status).toBe(403);
    expect((await call(`/admin/articles/${a.id}`, 'PATCH', { title: 'Authorized edit' }, null, { ...headers, 'X-CSRF-Token': await csrfTokenFor(token, secret) })).status).toBe(200);
  });
  it('suspension immediately blocks sessions while articles, profiles and bylines survive restoration', async () => {
    await articles.update(db, a.id, { status: 'published' });
    await access.transition(db, identities.owner!.id, identities.alice!.id, 'suspend');
    expect((await call('/admin/author/profile')).status).toBe(401);
    expect((await call(`/admin/articles/${a.id}`, 'DELETE')).status).toBe(401);
    expect((await data(await call(`/articles/${a.id}`, 'GET', undefined, null))).authorSlug).toBe(identities.alice!.slug);
    await access.transition(db, identities.owner!.id, identities.alice!.id, 'restore');
    expect((await call('/admin/author/profile')).status).toBe(401);
    identities.alice!.token = crypto.randomUUID();
    await createSession(db, { userId: identities.alice!.id, tokenHash: await hashToken(identities.alice!.token), expiresAt: '2099-01-01T00:00:00.000Z' });
    expect((await call('/admin/author/profile')).status).toBe(200);
  });
  it('holds scheduled articles during suspension, then publishes after restoration', async () => {
    await articles.update(db, a.id, { status: 'scheduled', scheduledAt: '2000-01-01' });
    await access.transition(db, identities.owner!.id, identities.alice!.id, 'suspend');
    expect(await articles.publishDueScheduled(db)).toBe(0);
    await access.transition(db, identities.owner!.id, identities.alice!.id, 'restore');
    expect(await articles.publishDueScheduled(db)).toBe(1);
  });
});
