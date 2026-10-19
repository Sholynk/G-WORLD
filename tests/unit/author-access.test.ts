/** Real SQLite migration/repository tests. Node 22 is pinned by .nvmrc. */
import { DatabaseSync } from 'node:sqlite';
import { sqliteBinding } from '../helpers/sqlite-d1.js';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createDb, type Db } from '../../apps/api/src/db/client.js';
import * as access from '../../apps/api/src/db/repositories/author-access.js';
import * as users from '../../apps/api/src/db/repositories/users.js';
import * as sessions from '../../apps/api/src/db/repositories/sessions.js';
import { hashPassword } from '../../apps/api/src/lib/password.js';
import { hashToken } from '../../apps/api/src/lib/tokens.js';
import { resolveAuth, requireAuth } from '../../apps/api/src/middleware/auth.js';
import { adminAccountRoutes } from '../../apps/api/src/routes/admin/accounts.js';
import { adminRoutes } from '../../apps/api/src/routes/admin/index.js';
import { authRoutes } from '../../apps/api/src/routes/auth.js';
import { handleApiError } from '../../apps/api/src/middleware/error-handler.js';
import { getConfig, type AppEnv } from '../../apps/api/src/env.js';

let sqlite: DatabaseSync;
let db: Db;
let binding: D1Database;
let ownerId: string;
let confirmationHash: string;
const logger = { info() {}, debug() {}, warn() {}, error() {} };


async function applicant(email = 'writer@example.test') {
  return users.createUser(db, { email, passwordHash: await hashPassword('WriterPassword123!', 1000),
    roleId: 'role_editor', status: 'pending_verification', authorApplication: true }, { displayName: 'Writer' });
}

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync('database/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`database/migrations/${name}`, 'utf8'));
  }
  binding = sqliteBinding(sqlite); db = createDb(binding);
  confirmationHash = await hashPassword('Private-code-ForTests', 1000);
  const result = await users.createUser(db, { email: access.OWNER_EMAIL, passwordHash: confirmationHash,
    roleId: 'role_super_admin', status: 'active' });
  ownerId = result.userId;
  await users.markEmailVerified(db, ownerId);
  await db.run('INSERT INTO site_owner(singleton, user_id, confirmation_hash) VALUES (1, ?, ?)', [ownerId, confirmationHash]);
});
afterEach(() => sqlite.close());

function app(actorId: string | null = ownerId, resolve = false, fullAdmin = false) {
  const instance = new Hono<AppEnv>();
  instance.onError(handleApiError);
  instance.use('*', async (c, next) => {
    c.set('logger', logger as never);
    c.set('config', { ...getConfig({} as never), passwordIterations: 1000,
      rateLimitMultiplier: 1, features: { registration: true, devRoutes: false } } as never);
    c.set('clientIpHash', 'test-client');
    c.set('auth', actorId ? { userId: actorId, email: access.OWNER_EMAIL, roleKey: 'super_admin',
      roleRank: 90, permissions: [], status: 'active', emailVerified: true, sessionId: 'test', displayName: 'Owner' } : null);
    await next();
  });
  if (resolve) instance.use('*', resolveAuth);
  instance.route('/auth', authRoutes);
  instance.use('/admin/*', requireAuth());
  instance.route('/admin', fullAdmin ? adminRoutes : adminAccountRoutes);
  instance.get('/protected', requireAuth(), (c) => c.json({ ok: true }));
  return instance;
}
function call(instance: ReturnType<typeof app>, path: string, body?: unknown, headers = {}) {
  return instance.request(`http://localhost${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }, { DB: binding });
}

describe('author application persistence and owner protection', () => {
  it('creates the linked account, public profile and application atomically', async () => {
    const { userId } = await applicant();
    expect(await access.reviewStatus(db, userId)).toBe('pending');
    expect(await db.count('SELECT COUNT(*) AS total FROM authors')).toBe(1);
    expect(await db.count('SELECT COUNT(*) AS total FROM user_profiles WHERE user_id = ?', [userId])).toBe(1);
  });
  it('rolls back all account rows if creating the author profile fails', async () => {
    sqlite.exec("CREATE TRIGGER reject_profile BEFORE INSERT ON authors BEGIN SELECT RAISE(ABORT, 'test'); END;");
    await expect(applicant()).rejects.toThrow();
    expect(await users.emailExists(db, 'writer@example.test')).toBe(false);
    expect(await db.count('SELECT COUNT(*) AS total FROM author_applications')).toBe(0);
  });
  it('verification cannot bypass approval and decline cannot be overwritten', async () => {
    const { userId } = await applicant();
    await users.markEmailVerified(db, userId);
    expect(await access.accessAllowed(db, userId)).toBe(false);
    await access.transition(db, ownerId, userId, 'decline');
    await users.markEmailVerified(db, userId);
    expect(await access.accessAllowed(db, userId)).toBe(false);
    await expect(access.transition(db, ownerId, userId, 'approve')).rejects.toThrow(/changed/);
  });
  it('does not approve unverified applicants or grant unmigrated accounts access', async () => {
    const { userId } = await applicant();
    await expect(access.transition(db, ownerId, userId, 'approve')).rejects.toThrow(/verify/);
    expect(await access.accessAllowed(db, 'unknown-user')).toBe(false);
    expect(await access.accessAllowed(db, ownerId)).toBe(true);
  });
  it('rejects non-owner transitions even when the caller claims a privileged role', async () => {
    const { userId } = await applicant();
    await expect(access.transition(db, userId, userId, 'approve')).rejects.toThrow(/Owner-only/);
    await expect(access.transition(db, ownerId, ownerId, 'suspend')).rejects.toThrow(/Owner-only/);
  });
  it('protects owner identity, status, role and record from deletion/transfer', async () => {
    for (const sql of [
      "UPDATE users SET status = 'suspended' WHERE id = ?",
      "UPDATE users SET role_id = 'role_editor' WHERE id = ?",
      "UPDATE users SET email = 'other@example.test' WHERE id = ?",
      'DELETE FROM users WHERE id = ?',
      'DELETE FROM site_owner WHERE user_id = ?',
      "UPDATE site_owner SET user_id = 'somebody-else' WHERE user_id = ?",
    ]) await expect(db.run(sql, [ownerId])).rejects.toThrow();
  });
  it('will not bind a second owner or an arbitrary super admin', async () => {
    await expect(db.run('INSERT INTO site_owner VALUES (2, ?, ?, ?)', [ownerId, confirmationHash, new Date().toISOString()])).rejects.toThrow();
    const another = await users.createUser(db, { email: 'other@example.test', passwordHash: confirmationHash, roleId: 'role_super_admin', status: 'active' });
    await users.markEmailVerified(db, another.userId);
    await expect(db.run('INSERT INTO site_owner(singleton, user_id, confirmation_hash) VALUES (1, ?, ?)', [another.userId, confirmationHash])).rejects.toThrow(/designated/);
    expect(await access.accessAllowed(db, another.userId)).toBe(false);
  });
  it('suspends and restores without deleting profiles or bylines, revoking sessions', async () => {
    const { userId } = await applicant(); await users.markEmailVerified(db, userId);
    await access.transition(db, ownerId, userId, 'approve');
    const tokenHash = await hashToken('private-test-session');
    await sessions.createSession(db, { userId, tokenHash, expiresAt: '2099-01-01T00:00:00.000Z' });
    const profile = await db.first<{ slug: string }>('SELECT slug FROM authors');
    await db.run("INSERT INTO articles(slug, title, author_slug) VALUES ('retained', 'Retained article', ?)", [profile!.slug]);
    await access.transition(db, ownerId, userId, 'suspend');
    expect((await users.findById(db, userId))?.status).toBe('suspended');
    expect(await sessions.findActiveSession(db, tokenHash)).toBe(null);
    await users.markEmailVerified(db, userId);
    expect((await users.findById(db, userId))?.status).toBe('suspended');
    await access.transition(db, ownerId, userId, 'restore');
    expect((await users.findById(db, userId))?.status).toBe('active');
    expect(await sessions.findActiveSession(db, tokenHash)).toBe(null);
    expect(await db.first('SELECT author_slug FROM articles WHERE slug = ?', ['retained'])).toEqual({ author_slug: profile!.slug });
    expect(await db.count('SELECT COUNT(*) AS total FROM authors')).toBe(1);
  });
});

describe('HTTP authorization boundaries', () => {
  it('requires both an authenticated session and the designated owner identity', async () => {
    expect((await call(app(null), '/admin/accounts')).status).toBe(401);
    expect((await call(app('fake-super-admin'), '/admin/accounts')).status).toBe(403);
    expect((await call(app(), '/admin/accounts')).status).toBe(200);
  });
  it('does not serialize password or confirmation hashes', async () => {
    await applicant();
    const text = await (await call(app(), '/admin/accounts')).text();
    expect(text).not.toContain('password'); expect(text).not.toContain(confirmationHash);
  });
  it('requires a valid confirmation code and rate-limits attempts across the owner account', async () => {
    const { userId } = await applicant(); await users.markEmailVerified(db, userId);
    const instance = app();
    const path = `/admin/accounts/${userId}`;
    expect((await call(instance, path, { action: 'approve' })).status).toBe(422);
    for (let i = 0; i < 4; i++) expect((await call(instance, path, { action: 'approve', confirmation_code: 'wrong' })).status).toBe(403);
    expect((await call(instance, path, { action: 'approve', confirmation_code: 'Private-code-ForTests' })).status).toBe(429);
    expect(await access.reviewStatus(db, userId)).toBe('pending');
  });
  it('approves once with the correct code and rejects replayed review decisions', async () => {
    const { userId } = await applicant(); await users.markEmailVerified(db, userId);
    const body = { action: 'approve', confirmation_code: 'Private-code-ForTests' };
    expect((await call(app(), `/admin/accounts/${userId}`, body)).status).toBe(200);
    expect((await call(app(), `/admin/accounts/${userId}`, body)).status).toBe(409);
    expect(await access.reviewStatus(db, userId)).toBe('approved');
  });
  it('blocks pending and declined logins after password/email verification', async () => {
    const { userId } = await applicant(); await users.markEmailVerified(db, userId);
    const body = { email: 'writer@example.test', password: 'WriterPassword123!' };
    expect((await call(app(null), '/auth/login', body)).status).toBe(403);
    await access.transition(db, ownerId, userId, 'decline');
    const response = await call(app(null), '/auth/login', body);
    expect(response.status).toBe(403); expect(await response.text()).toContain('declined');
  });
  it('checks approval against the database even for already issued sessions', async () => {
    const { userId } = await applicant(); await users.markEmailVerified(db, userId);
    const token = 'old-session-token';
    await sessions.createSession(db, { userId, tokenHash: await hashToken(token), expiresAt: '2099-01-01T00:00:00.000Z' });
    const instance = app(null, true);
    expect((await call(instance, '/protected', undefined, { authorization: `Bearer ${token}` })).status).toBe(401);
    await access.transition(db, ownerId, userId, 'approve');
    expect((await call(instance, '/protected', undefined, { authorization: `Bearer ${token}` })).status).toBe(200);
    await access.transition(db, ownerId, userId, 'suspend');
    expect((await call(instance, '/protected', undefined, { authorization: `Bearer ${token}` })).status).toBe(401);
  });
  it('rejects duplicate suspended email registrations and reserved owner registration', async () => {
    const { userId } = await applicant(); await users.markEmailVerified(db, userId);
    await access.transition(db, ownerId, userId, 'approve'); await access.transition(db, ownerId, userId, 'suspend');
    const registration = { email: 'writer@example.test', password: 'WriterPassword123!', accepted_terms: true };
    expect((await call(app(null), '/auth/register', registration)).status).toBe(409);
    expect((await call(app(null), '/auth/register', { ...registration, email: access.OWNER_EMAIL })).status).toBe(409);
    expect((await users.findById(db, userId))?.status).toBe('suspended');
  });
  it('keeps owner-only routes blocked after enabling the author workspace', async () => {
    const { userId } = await applicant(); await users.markEmailVerified(db, userId);
    await access.transition(db, ownerId, userId, 'approve');
    const response = await call(app(userId, false, true), '/admin/authors', { name: 'Do not create another profile' });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('reserved for the website owner');
  });
  it('registers applicants with a pending profile and notifies the owner', async () => {
    const response = await call(app(null), '/auth/register', { email: 'new@example.test', password: 'WriterPassword123!', display_name: 'New Writer', accepted_terms: true });
    expect(response.status).toBe(201);
    const payload = await response.json(); expect(payload.data.approval_required).toBe(true);
    expect(payload.data.debug_verification_token).toBeUndefined();
    expect(await access.reviewStatus(db, payload.data.user.id)).toBe('pending');
    expect(await db.count("SELECT COUNT(*) AS total FROM email_messages WHERE template = 'author_application'")).toBe(1);
    expect(await db.count('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?', [ownerId])).toBe(1);
  });
});
