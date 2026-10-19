/**
 * Cron wiring — publishing happens every 15 minutes, housekeeping at night.
 *
 * Two triggers share one `scheduled()` handler, so this pins the split: if the
 * frequent tick ever starts running the destructive purge (or the nightly run
 * stops doing it), scheduled posts either go live hours late or sessions and
 * audit history are deleted every quarter of an hour.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteBinding } from '../helpers/sqlite-d1.js';
import worker from '../../apps/api/src/index.js';
import { createDb, type Db } from '../../apps/api/src/db/client.js';
import * as users from '../../apps/api/src/db/repositories/users.js';
import * as articles from '../../apps/api/src/db/repositories/articles.js';
import { hashPassword } from '../../apps/api/src/lib/password.js';
import { hashToken } from '../../apps/api/src/lib/tokens.js';

const PUBLISH_CRON = '*/15 * * * *';
const sessionSecret = 'test-only-session-secret-for-cron-split';
const NIGHTLY_CRON = '17 3 * * *';

let sqlite: DatabaseSync;
let db: Db;
let env: Record<string, unknown>;
let userId: string;
let articleId: string;

beforeEach(async () => {
  for (const method of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('database/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`database/migrations/${file}`, 'utf8'));
  }
  const binding = sqliteBinding(sqlite);
  db = createDb(binding);
  env = {
    DB: binding,
    SESSION_SECRET: sessionSecret,
    ENVIRONMENT: 'development',
    ENABLE_DEV_ROUTES: 'false',
    ENABLE_REGISTRATION: 'false',
    EMAIL_PROVIDER: 'console',
    PASSWORD_ITERATIONS: '10000',
  };

  const created = await users.createUser(db, {
    email: 'owner@example.test',
    passwordHash: await hashPassword('OwnerPassword123!', 1000),
    roleId: 'role_super_admin',
    status: 'active',
  }, { displayName: 'Owner' });
  userId = created.userId;
  await users.markEmailVerified(db, userId);

  const article = await articles.create(db, {
    title: 'Queued for the next publish tick',
    category: 'AI',
    status: 'scheduled',
    scheduledAt: '2020-01-01T00:00:00.000Z',
    body: '<p>Scheduled body.</p><h2>Section</h2>',
    description: 'A scheduled story used by the cron tests.',
    tags: ['scheduling', 'cron'],
  }, userId);
  articleId = article.id;

  // Rows the nightly housekeeping should remove: one expired session, one
  // stale rate-limit window and one audit entry past the retention window.
  // Inserted directly: `createSession` stamps `created_at` with the current
  // time, and the table requires `expires_at > created_at`.
  await db.run(
    `INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    ['session_expired', userId, await hashToken('expired-session-token'),
      '2020-01-01T00:00:00.000Z', '2020-06-01T00:00:00.000Z'],
  );
  await db.run(
    `INSERT INTO rate_limits (key, scope, count, window_start, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    ['stale-window', 'login', 3, '2020-01-01T00:00:00.000Z', '2020-01-01T01:00:00.000Z'],
  );
  await db.run(
    `INSERT INTO audit_logs (id, action, description, created_at)
     VALUES (?, ?, ?, ?)`,
    ['audit_old_entry', 'test.old', 'Ancient entry', '2000-01-01T00:00:00.000Z'],
  );
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

/** Runs the exported cron handler and waits for the work it scheduled. */
async function runCron(cron: string) {
  let pending: Promise<unknown> | undefined;
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { pending = promise; },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  await worker.scheduled({ cron, scheduledTime: Date.now(), noRetry: () => {} } as unknown as ScheduledController,
    env as never, ctx);
  await pending;
}

const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('cron split', () => {
  it('publishes due posts on the frequent tick without touching housekeeping', async () => {
    await runCron(PUBLISH_CRON);

    const row = sqlite.prepare('SELECT status, published_at FROM articles WHERE id = ?').get(articleId) as
      { status: string; published_at: string };
    expect(row.status).toBe('published');
    expect(row.published_at).toBe('2020-01-01');

    // Nothing destructive ran: the expired session, stale window and old audit
    // row are all still there for the nightly pass.
    expect(count('user_sessions')).toBe(1);
    expect(count('rate_limits')).toBe(1);
    expect(count('audit_logs')).toBe(1);
  });

  it('publishes and prunes on the nightly run', async () => {
    await runCron(NIGHTLY_CRON);

    expect((sqlite.prepare('SELECT status FROM articles WHERE id = ?').get(articleId) as { status: string }).status)
      .toBe('published');
    expect(count('user_sessions')).toBe(0);
    expect(count('rate_limits')).toBe(0);
    expect(count('audit_logs')).toBe(0);
  });

  it('is idempotent when both triggers fire back to back', async () => {
    await runCron(PUBLISH_CRON);
    await runCron(NIGHTLY_CRON);
    await runCron(PUBLISH_CRON);
    const rows = sqlite.prepare(`SELECT COUNT(*) AS n FROM articles WHERE status = 'published'`).get() as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe('scheduled publishing filter', () => {
  it('leaves a future post scheduled', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await db.run('UPDATE articles SET scheduled_at = ? WHERE id = ?', [future, articleId]);
    await runCron(PUBLISH_CRON);
    expect((sqlite.prepare('SELECT status FROM articles WHERE id = ?').get(articleId) as { status: string }).status)
      .toBe('scheduled');
  });
});
