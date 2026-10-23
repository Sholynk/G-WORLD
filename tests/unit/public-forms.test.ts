/** Real SQLite route tests for the public site forms (footer + contact). */
import { DatabaseSync } from 'node:sqlite';
import { sqliteBinding } from '../helpers/sqlite-d1.js';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createDb, type Db } from '../../apps/api/src/db/client.js';
import { publicEngagementRoutes } from '../../apps/api/src/routes/public/engagement.js';
import { handleApiError } from '../../apps/api/src/middleware/error-handler.js';
import { getConfig, type AppEnv } from '../../apps/api/src/env.js';

let sqlite: DatabaseSync;
let db: Db;
let binding: D1Database;
const logger = { info() {}, debug() {}, warn() {}, error() {} };

beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync('database/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`database/migrations/${name}`, 'utf8'));
  }
  binding = sqliteBinding(sqlite);
  db = createDb(binding);
});
afterEach(() => sqlite.close());

function app() {
  const instance = new Hono<AppEnv>();
  instance.onError(handleApiError);
  instance.use('*', async (c, next) => {
    c.set('logger', logger as never);
    c.set('config', { ...getConfig({} as never), passwordIterations: 1000,
      rateLimitMultiplier: 1, features: { registration: true, devRoutes: false } } as never);
    c.set('clientIpHash', 'test-client');
    c.set('auth', null);
    await next();
  });
  instance.route('/', publicEngagementRoutes);
  return instance;
}

/** The exact wire format the page JS sends: urlencoded, like a classic HTML form. */
function submit(path: string, fields: Record<string, string>) {
  return app().request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }, { DB: binding });
}

describe('public site forms', () => {
  it('stores a footer newsletter subscription from an urlencoded post', async () => {
    const response = await submit('/subscriptions', { name: 'Ada Lovelace', email: 'Ada@Example.com', 'bot-field': '' });
    expect(response.status).toBe(201);
    const row = await db.first<{ name: string; email: string; status: string }>(
      'SELECT name, email, status FROM newsletter_subscribers');
    expect(row).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com', status: 'active' });
  });

  it('re-subscribing an address reactivates instead of duplicating', async () => {
    await submit('/subscriptions', { name: 'Ada', email: 'ada@example.com' });
    await db.run("UPDATE newsletter_subscribers SET status = 'unsubscribed'");
    const again = await submit('/subscriptions', { name: 'Ada L', email: 'ada@example.com' });
    expect(again.status).toBe(201);
    expect(await db.count('SELECT COUNT(*) AS total FROM newsletter_subscribers')).toBe(1);
    expect((await db.first<{ status: string }>('SELECT status FROM newsletter_subscribers'))?.status).toBe('active');
  });

  it('stores a contact message and returns its id', async () => {
    const response = await submit('/contact', {
      name: 'Grace Hopper', email: 'grace@example.com', subject: 'Question',
      message: 'Where can I read more about the platform?', 'bot-field': '',
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { success: boolean; data: { id: number; message: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBeGreaterThan(0);
    expect(await db.count('SELECT COUNT(*) AS total FROM contact_messages')).toBe(1);
  });

  it('rejects an incomplete contact message with 422 and stores nothing', async () => {
    const response = await submit('/contact', {
      name: 'Short', email: 'short@example.com', subject: 'Hi', message: 'too short',
    });
    expect(response.status).toBe(422);
    expect(await db.count('SELECT COUNT(*) AS total FROM contact_messages')).toBe(0);
  });

  it('accepts but discards honeypot submissions, storing nothing', async () => {
    const subscribeTrap = await submit('/subscriptions', {
      name: 'Bot', email: 'bot@example.com', 'bot-field': 'https://spam.example',
    });
    expect(subscribeTrap.status).toBe(201);
    const contactTrap = await submit('/contact', {
      name: 'Bot', email: 'bot@example.com', subject: 'Buy now',
      message: 'Automated garbage that fills every field.', website: 'https://spam.example',
    });
    expect(contactTrap.status).toBe(201);
    expect(await db.count('SELECT COUNT(*) AS total FROM newsletter_subscribers')).toBe(0);
    expect(await db.count('SELECT COUNT(*) AS total FROM contact_messages')).toBe(0);
  });
});
