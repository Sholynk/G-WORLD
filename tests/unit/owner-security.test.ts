/** Owner onboarding and security use actual SQLite, mocked email transport only. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteBinding } from '../helpers/sqlite-d1.js';
import { createDb, type Db } from '../../apps/api/src/db/client.js';
import { ownerEnrollmentSql, validateOwnerOrigin } from '../../scripts/lib/owner-bootstrap.mjs';
import { ownerSecurityRoutes } from '../../apps/api/src/routes/owner-security.js';
import { getConfig, type AppEnv } from '../../apps/api/src/env.js';
import { handleApiError } from '../../apps/api/src/middleware/error-handler.js';
import { securityMiddleware } from '../../apps/api/src/middleware/security.js';
import { assertOwnerPassword, requireSensitiveOwnerConfirmation, sensitiveOwnerAction } from '../../apps/api/src/middleware/owner-confirmation.js';
import { requireAuth, resolveAuth } from '../../apps/api/src/middleware/auth.js';
import { findById, markEmailVerified, updatePasswordHash } from '../../apps/api/src/db/repositories/users.js';
import { accessAllowed, owner, OWNER_EMAIL } from '../../apps/api/src/db/repositories/author-access.js';
import * as ownerSecurity from '../../apps/api/src/db/repositories/owner-security.js';
import { hashToken, csrfTokenFor } from '../../apps/api/src/lib/tokens.js';
import { redact } from '../../apps/api/src/lib/logger.js';
import { createResetToken, findResetToken } from '../../apps/api/src/db/repositories/tokens.js';
import { hashPassword, verifyPassword } from '../../apps/api/src/lib/password.js';
import { createSession, findActiveSession } from '../../apps/api/src/db/repositories/sessions.js';

let sqlite: DatabaseSync;
let binding: D1Database;
let db: Db;
let sent: { to: string[]; text: string; html: string }[];
let logged: string[];
const password = 'Owner-test-password-42';
const code = 'Separate-test-code-42';
const secret = 'local-test-session-secret-over-32-characters';

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync('database/migrations').filter((n) => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`database/migrations/${name}`, 'utf8'));
  binding = sqliteBinding(sqlite); db = createDb(binding); sent = []; logged = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
    sent.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({ id: 'test-mail' }), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });

function app(provider = 'resend') {
  const instance = new Hono<AppEnv>();
  instance.onError(handleApiError);
  instance.use('*', async (c, next) => {
    const log = (...args: unknown[]) => logged.push(JSON.stringify(args));
    c.set('logger', { info: log, debug: log, warn: log, error: log } as never);
    c.set('config', { ...getConfig({ ENVIRONMENT: 'production', EMAIL_PROVIDER: provider, RESEND_API_KEY: 'test-only-mail-key',
      APP_BASE_URL: 'https://publication.example', SESSION_SECRET: secret } as never), passwordIterations: 1000 });
    c.set('clientIpHash', c.req.header('test-ip') || 'test-ip');
    c.set('auth', null);
    await next();
  });
  instance.use('*', securityMiddleware);
  instance.use('*', resolveAuth);
  instance.route('/auth/owner', ownerSecurityRoutes);
  instance.use('/admin/*', requireAuth(), requireSensitiveOwnerConfirmation);
  instance.delete('/admin/articles/:id', (c) => c.json({ deleted: true }));
  instance.put('/admin/settings', (c) => c.json({ saved: true }));
  return instance;
}
function request(path: string, body: unknown = {}, headers = {}, provider = 'resend', method = 'POST') {
  return app(provider).request(`https://publication.example${path}`, { method,
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }, { DB: binding });
}
async function enroll() {
  sqlite.exec(ownerEnrollmentSql());
  return (await ownerSecurity.pendingEnrollment(db))!.user_id;
}
async function emailToken(purpose: 'setup' | 'code' = 'setup', headers = {}) {
  const response = await request(`/auth/owner/${purpose}/request`, {}, headers);
  expect(response.status, await response.clone().text()).toBe(200);
  const match = /#owner-(?:setup|code)=([A-Za-z0-9_-]+)/.exec(sent.at(-1)!.text);
  expect(match).not.toBeNull();
  return match![1]!;
}
async function initializeOwner() {
  const userId = await enroll();
  const token = await emailToken();
  const response = await request('/auth/owner/setup/complete', { token, password, confirmation_code: code });
  expect(response.status, await response.clone().text()).toBe(200);
  return { userId, token };
}
async function session(userId: string) {
  const token = 'test-session-' + crypto.randomUUID();
  await createSession(db, { userId, tokenHash: await hashToken(token), expiresAt: '2099-01-01T00:00:00.000Z' });
  return { authorization: `Bearer ${token}` };
}

describe('operator-only enrollment', () => {
  it('creates an unverified owner and profile atomically, never a known login password', async () => {
    const userId = await enroll();
    const user = await findById(db, userId);
    expect(user?.email).toBe(OWNER_EMAIL); expect(user?.status).toBe('pending_verification');
    expect(await owner(db)).toBeNull(); expect(await accessAllowed(db, userId)).toBe(false);
    expect(await db.count('SELECT COUNT(*) AS total FROM user_profiles WHERE user_id = ?', [userId])).toBe(1);
    expect(ownerEnrollmentSql()).not.toEqual(ownerEnrollmentSql());
  });
  it('cannot publicly provision an owner, or substitute a recipient', async () => {
    expect((await request('/auth/owner/setup/request')).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(await db.count('SELECT COUNT(*) AS total FROM users')).toBe(0);
    await enroll();
    expect((await request('/auth/owner/setup/request', { email: 'attacker@example.test' })).status).toBe(422);
    expect(sent).toHaveLength(0);
  });
  it('refuses a duplicate reservation without partially modifying the first account', async () => {
    await enroll();
    expect(() => sqlite.exec(ownerEnrollmentSql())).toThrow();
    expect(await db.count('SELECT COUNT(*) AS total FROM users')).toBe(1);
    expect(await db.count('SELECT COUNT(*) AS total FROM user_profiles')).toBe(1);
  });
  it('cannot bypass setup through ordinary verification or password recovery', async () => {
    const userId = await enroll();
    await markEmailVerified(db, userId);
    await updatePasswordHash(db, userId, await hashPassword(password, 1000));
    expect(await accessAllowed(db, userId)).toBe(false);
    const headers = await session(userId);
    expect((await request('/admin/articles/1', {}, headers, 'resend', 'DELETE')).status).toBe(401);
  });
  it('requires HTTPS for remote bootstrap and rejects URL credential/path tricks', () => {
    expect(validateOwnerOrigin('https://publication.example', true)).toBe('https://publication.example');
    expect(validateOwnerOrigin('http://localhost:5173', false)).toBe('http://localhost:5173');
    for (const url of ['http://publication.example', 'https://name:pass@publication.example', 'https://publication.example/path', 'https://publication.example/?email=other', 'https://publication.example/#token']) {
      expect(() => validateOwnerOrigin(url, true)).toThrow();
    }
  });
});

describe('one-time owner email setup', () => {
  it('mails only the fixed owner, storing just a token hash and redacted outbox body', async () => {
    await enroll(); const token = await emailToken();
    expect(sent[0]!.to).toEqual([OWNER_EMAIL]);
    expect(sent[0]!.text).toContain('https://publication.example/reset.html#owner-setup=');
    expect(await ownerSecurity.findToken(db, await hashToken(token), 'setup')).not.toBeNull();
    const persisted = JSON.stringify(await db.all('SELECT * FROM email_messages')) + JSON.stringify(await db.all('SELECT * FROM owner_security_tokens'));
    expect(persisted).not.toContain(token); expect(logged.join('')).not.toContain(token);
  });
  it('sets both separately hashed credentials, verifies email and activates exactly one owner', async () => {
    const { userId, token } = await initializeOwner();
    const user = await findById(db, userId);
    expect(user?.status).toBe('active'); expect(user?.email_verified_at).not.toBeNull();
    expect(await accessAllowed(db, userId)).toBe(true);
    const credentials = await db.first<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [userId]);
    expect(await verifyPassword(credentials!.password_hash, password)).toBe(true);
    expect(await verifyPassword((await owner(db))!.confirmation_hash, code)).toBe(true);
    expect(await ownerSecurity.findToken(db, await hashToken(token), 'setup')).toBeNull();
    expect((await request('/auth/owner/setup/complete', { token, password: 'replacement-password-42', confirmation_code: code })).status).toBe(409);
    expect(await db.count('SELECT COUNT(*) AS total FROM site_owner')).toBe(1);
  });
  it('does not consume a link on a GET or when codes/passwords are invalid', async () => {
    await enroll(); const token = await emailToken();
    expect((await app().request('https://publication.example/auth/owner/setup/complete', {}, { DB: binding })).status).toBe(404);
    expect((await request('/auth/owner/setup/complete', { token, password, confirmation_code: password })).status).toBe(422);
    expect((await request('/auth/owner/setup/complete', { token, password, confirmation_code: '1234' })).status).toBe(422);
    expect(await ownerSecurity.findToken(db, await hashToken(token), 'setup')).not.toBeNull();
  });
  it('rejects expired links without setting a password or consuming another token', async () => {
    await enroll(); const expired = await emailToken(); const live = await emailToken();
    await db.run("UPDATE owner_security_tokens SET expires_at = '2000-01-01' WHERE token_hash = ?", [await hashToken(expired)]);
    expect((await request('/auth/owner/setup/complete', { token: expired, password, confirmation_code: code })).status).toBe(409);
    expect(await owner(db)).toBeNull(); expect(await ownerSecurity.findToken(db, await hashToken(live), 'setup')).not.toBeNull();
  });
  it('resending leaves older links valid, but completion invalidates every sibling link', async () => {
    await enroll(); const first = await emailToken(); const second = await emailToken();
    expect(await ownerSecurity.findToken(db, await hashToken(first), 'setup')).not.toBeNull();
    expect((await request('/auth/owner/setup/complete', { token: first, password, confirmation_code: code })).status).toBe(200);
    expect(await ownerSecurity.findToken(db, await hashToken(second), 'setup')).toBeNull();
    const prior = sent.length;
    expect((await request('/auth/owner/setup/request')).status).toBe(200);
    expect(sent).toHaveLength(prior);
  });
  it('caps email requests globally even across rotating IP addresses', async () => {
    await enroll();
    for (let i = 0; i < 3; i++) expect((await request('/auth/owner/setup/request', {}, { 'test-ip': `ip-${i}` })).status).toBe(200);
    expect((await request('/auth/owner/setup/request', {}, { 'test-ip': 'new-ip' })).status).toBe(429);
    expect(sent).toHaveLength(3);
  });
  it('never leaks sensitive email content when delivery fails or console email is configured', async () => {
    await enroll();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret-provider-response', { status: 503 })));
    expect((await request('/auth/owner/setup/request')).status).toBe(503);
    expect(logged.join('')).not.toContain('secret-provider-response');
    expect((await request('/auth/owner/setup/request', {}, {}, 'console')).status).toBe(503);
    expect(await owner(db)).toBeNull();
    expect(JSON.stringify(await db.all('SELECT * FROM email_messages'))).not.toContain('#owner-setup=');
  });
  it('invalidates ordinary password-reset links issued before owner setup', async () => {
    const userId = await enroll();
    const resetHash = await hashToken('older-reset-token');
    await createResetToken(db, userId, resetHash, '2099-01-01T00:00:00.000Z');
    const token = await emailToken();
    expect((await request('/auth/owner/setup/complete', { token, password, confirmation_code: code })).status).toBe(200);
    expect((await findResetToken(db, resetHash))?.consumed_at).not.toBeNull();
  });
  it('rolls back password changes if creating the owner record fails', async () => {
    const userId = await enroll(); const token = await emailToken();
    const before = await db.first('SELECT password_hash, status FROM users WHERE id = ?', [userId]);
    sqlite.exec("CREATE TRIGGER reject_owner BEFORE INSERT ON site_owner BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
    await expect(ownerSecurity.completeSetup(db, await hashToken(token), await hashPassword(password, 1000), await hashPassword(code, 1000))).rejects.toThrow();
    expect(await db.first('SELECT password_hash, status FROM users WHERE id = ?', [userId])).toEqual(before);
    expect(await ownerSecurity.findToken(db, await hashToken(token), 'setup')).not.toBeNull();
  });
});

describe('confirmation code recovery and sensitive mutations', () => {
  it('requires owner login, a purpose-bound email link AND the current password', async () => {
    const { userId, token: setupToken } = await initializeOwner(); const headers = await session(userId);
    expect((await request('/auth/owner/code/request')).status).toBe(401);
    const token = await emailToken('code', headers);
    const body = { token, current_password: password, confirmation_code: 'new-separate-code-42' };
    expect((await request('/auth/owner/code/complete', body)).status).toBe(401);
    expect((await request('/auth/owner/code/complete', { ...body, token: setupToken }, headers)).status).toBe(409);
    expect((await request('/auth/owner/code/complete', { ...body, current_password: 'wrong' }, headers)).status).toBe(403);
    expect(await verifyPassword((await owner(db))!.confirmation_hash, code)).toBe(true);
  });
  it('recovers the code once, consumes sibling links and signs out every existing session', async () => {
    const { userId } = await initializeOwner(); const headers = await session(userId); const other = await session(userId);
    const token = await emailToken('code', headers); const sibling = await emailToken('code', headers);
    const nextCode = 'new-separate-code-42';
    const response = await request('/auth/owner/code/complete', { token, current_password: password, confirmation_code: nextCode }, headers);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await verifyPassword((await owner(db))!.confirmation_hash, nextCode)).toBe(true);
    expect(await verifyPassword((await owner(db))!.confirmation_hash, code)).toBe(false);
    for (const entry of [headers, other]) expect(await findActiveSession(db, await hashToken(entry.authorization.slice(7)))).toBeNull();
    expect(await ownerSecurity.findToken(db, await hashToken(sibling), 'code_recovery')).toBeNull();
    await expect(ownerSecurity.recoverCode(db, userId, await hashToken(token), await hashPassword('other-code-999', 1000))).rejects.toThrow(/already used/);
  });
  it('setup replay cannot consume a newer confirmation-code recovery token', async () => {
    const { userId, token } = await initializeOwner(); const headers = await session(userId);
    const recovery = await emailToken('code', headers);
    await expect(ownerSecurity.completeSetup(db, await hashToken(token), await hashPassword(password, 1000), await hashPassword(code, 1000))).rejects.toThrow();
    expect(await ownerSecurity.findToken(db, await hashToken(recovery), 'code_recovery')).not.toBeNull();
  });
  it('requires a fresh code on every delete/settings mutation (no session-wide bypass)', async () => {
    const { userId } = await initializeOwner(); const headers = await session(userId);
    expect((await request('/admin/articles/1', {}, headers, 'resend', 'DELETE')).status).toBe(403);
    expect((await request('/admin/articles/1', {}, { ...headers, 'X-Owner-Confirmation': code }, 'resend', 'DELETE')).status).toBe(200);
    expect((await request('/admin/settings', {}, headers, 'resend', 'PUT')).status).toBe(403);
    expect((await request('/admin/settings', {}, { ...headers, 'X-Owner-Confirmation': code }, 'resend', 'PUT')).status).toBe(200);
    expect(logged.join('')).not.toContain(code);
  });
  it('does not let the confirmation code bypass session-bound CSRF', async () => {
    const { userId } = await initializeOwner(); const headers = await session(userId);
    const token = headers.authorization.slice(7);
    const cookieHeaders = { cookie: `sk_session=${token}`, 'X-Owner-Confirmation': code };
    expect((await request('/admin/settings', {}, cookieHeaders, 'resend', 'PUT')).status).toBe(403);
    expect((await request('/admin/settings', {}, { ...cookieHeaders, 'X-CSRF-Token': await csrfTokenFor(token, secret) }, 'resend', 'PUT')).status).toBe(200);
  });
  it('keeps password strength and secret separation on later password resets/changes', async () => {
    const { userId } = await initializeOwner();
    await expect(assertOwnerPassword(db, userId, code)).rejects.toThrow(/different/);
    await expect(assertOwnerPassword(db, userId, 'Short123')).rejects.toThrow(/12/);
    await expect(assertOwnerPassword(db, userId, 'Another-long-password-42')).resolves.toBeUndefined();
  });
  it('redacts confirmation codes and hashes if accidentally supplied as structured log fields', () => {
    const fields = redact({ confirmation_code: code, confirmation_hash: 'hash',
      headers: { 'X-Owner-Confirmation': code }, bootstrap_password_hash: 'hash' });
    expect(JSON.stringify(fields)).not.toContain(code);
    expect(fields.confirmation_hash).toBe('[redacted]');
    expect(fields.bootstrap_password_hash).toBe('[redacted]');
  });
  it('does not lock the owner out of normal work after multiple correct confirmations', async () => {
    const { userId } = await initializeOwner(); const headers = { ...await session(userId), 'X-Owner-Confirmation': code };
    for (let i = 0; i < 7; i++) expect((await request(`/admin/articles/${i}`, {}, headers, 'resend', 'DELETE')).status).toBe(200);
  });
  it('covers destructive actions, site settings, maintenance and password changes', () => {
    expect(sensitiveOwnerAction('DELETE', '/admin/comments/1')).toBe(true);
    expect(sensitiveOwnerAction('PUT', '/admin/settings')).toBe(true);
    expect(sensitiveOwnerAction('POST', '/admin/system/maintenance')).toBe(true);
    expect(sensitiveOwnerAction('POST', '/auth/change-password')).toBe(true);
    expect(sensitiveOwnerAction('GET', '/admin/articles')).toBe(false);
    expect(sensitiveOwnerAction('POST', '/admin/articles')).toBe(false);
  });
});
