/**
 * Unpublished content is not readable just because a session exists.
 *
 * The permission catalogue distinguishes `article.read.any` ("view drafts,
 * pending and scheduled articles through the API") from `article.submit`
 * ("create and edit own drafts"). A contributing editor holds only the latter,
 * so another account's private work — including its internal review notes and
 * submitter email — must never appear in their list or detail responses.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteBinding } from '../helpers/sqlite-d1.js';
import { buildApp } from '../../apps/api/src/app.js';
import { createDb, type Db } from '../../apps/api/src/db/client.js';
import * as users from '../../apps/api/src/db/repositories/users.js';
import * as articles from '../../apps/api/src/db/repositories/articles.js';
import { createSession } from '../../apps/api/src/db/repositories/sessions.js';
import { hashPassword } from '../../apps/api/src/lib/password.js';
import { hashToken } from '../../apps/api/src/lib/tokens.js';

let sqlite: DatabaseSync;
let db: Db;
let env: Record<string, unknown>;
let app: ReturnType<typeof buildApp>;
let identities: Record<string, { id: string; token: string }>;
let ownerDraft: articles.ArticleDto;
const sessionSecret = 'test-only-session-secret-for-unpublished-reads';

async function makeUser(name: string, owner = false) {
  const { userId } = await users.createUser(db, {
    email: `${name.toLowerCase()}@example.test`,
    passwordHash: await hashPassword('EditorPassword123!', 1000),
    roleId: owner ? 'role_super_admin' : 'role_editor',
    status: 'active',
  }, { displayName: name });
  await users.markEmailVerified(db, userId);
  const token = crypto.randomUUID();
  await createSession(db, { userId, tokenHash: await hashToken(token), expiresAt: '2099-01-01T00:00:00.000Z' });
  return { id: userId, token };
}

beforeEach(async () => {
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('database/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`database/migrations/${file}`, 'utf8'));
  }
  const binding = sqliteBinding(sqlite);
  db = createDb(binding);
  identities = {
    owner: await makeUser('Owner', true),
    editor: await makeUser('Editor'),
  };
  ownerDraft = await articles.create(db, {
    title: 'Owner private pending draft',
    category: 'AI',
    status: 'pending',
    body: 'Private planning notes and an unpublished story body.',
    reviewNotes: 'INTERNAL REVIEW NOTE - do not share',
    submitterEmail: 'owner@example.test',
    tags: ['internal', 'draft'],
  }, identities.owner!.id);
  env = {
    DB: binding,
    SESSION_SECRET: sessionSecret,
    ENVIRONMENT: 'development',
    ENABLE_DEV_ROUTES: 'false',
    ENABLE_REGISTRATION: 'false',
    EMAIL_PROVIDER: 'console',
    PASSWORD_ITERATIONS: '10000',
  };
  app = buildApp();
});

afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });

async function call(path: string, who: string | null = 'editor', method = 'GET', body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${identities[who]!.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(`https://publication.example/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env as never);
}

async function payload(response: Response) {
  return response.json() as Promise<{ data: unknown; error?: { code: string } }>;
}

describe('unpublished article reads', () => {
  it('keeps another account\'s private draft out of a contributing editor\'s list', async () => {
    const response = await call('/articles?status=all&fields=full');
    expect(response.status).toBe(200);
    const body = await payload(response);
    expect(body.data).toEqual([]);
  });

  it('returns the same 404 for the draft\'s id, slug and sources', async () => {
    for (const path of [`/articles/${ownerDraft.id}`, `/articles/${ownerDraft.slug}`, `/articles/${ownerDraft.id}/sources`]) {
      const response = await call(path);
      expect(response.status, path).toBe(404);
    }
  });

  it('lets an editor read and list their own unpublished submission', async () => {
    const created = await call('/admin/articles', 'editor', 'POST', {
      title: 'Editor own draft',
      category: 'AI',
      status: 'draft',
      body: 'A draft the editor owns.',
    });
    expect(created.status).toBe(201);
    const own = (await payload(created)).data as { id: number };

    const detail = await call(`/articles/${own.id}`);
    expect(detail.status).toBe(200);
    expect(((await payload(detail)).data as { title: string }).title).toBe('Editor own draft');

    const list = (await payload(await call('/articles?status=all'))).data as { id: number }[];
    expect(list.map((item) => item.id)).toEqual([own.id]);
  });

  it('still gives accounts with article.read.any the full private list and review notes', async () => {
    const list = (await payload(await call('/articles?status=all&fields=full', 'owner'))).data as {
      id: number; reviewNotes: string; submitterEmail: string;
    }[];
    const row = list.find((item) => item.id === ownerDraft.id);
    expect(row).toBeDefined();
    expect(row!.reviewNotes).toBe('INTERNAL REVIEW NOTE - do not share');
    expect(row!.submitterEmail).toBe('owner@example.test');

    const detail = await call(`/articles/${ownerDraft.id}`, 'owner');
    expect(detail.status).toBe(200);
    // Private previews are never cacheable.
    expect(detail.headers.get('cache-control')).toBe('no-store, private');
  });

  it('does not expose private content to signed-out readers', async () => {
    expect((await call('/articles?status=all', null)).status).toBe(401);
    expect((await call(`/articles/${ownerDraft.id}`, null)).status).toBe(401);
    expect((await call(`/articles/${ownerDraft.slug}`, null)).status).toBe(401);
  });
});
