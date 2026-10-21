/**
 * Readiness must reflect the schema the dashboard actually needs.
 *
 * Regression for the failure this suite was written from: a D1 database
 * migrated only through 0006 reports `migrations_applied: true` (it has four
 * roles) while sign-in dies with `no such table: owner_enrollment`. Every
 * public page keeps working, so the only visible symptom is the dashboard's
 * generic 500 — which is exactly how long this can go unnoticed.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqliteBinding } from '../helpers/sqlite-d1.js';
import { getConfig, type AppEnv } from '../../apps/api/src/env.js';
import { handleApiError } from '../../apps/api/src/middleware/error-handler.js';
import { healthRoutes } from '../../apps/api/src/routes/health.js';

let sqlite: DatabaseSync;
let app: Hono<AppEnv>;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync('database/migrations').filter((n) => n.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`database/migrations/${name}`, 'utf8'));
  }
  app = new Hono<AppEnv>();
  app.onError(handleApiError);
  // The pieces `requestContext` normally supplies; this file only exercises health.
  app.use('*', async (c, next) => {
    const log = () => {};
    c.set('logger', { info: log, debug: log, warn: log, error: log } as never);
    c.set('requestId', 'req_test_health');
    c.set('config', getConfig({ ENVIRONMENT: 'development' } as never));
    c.set('auth', null);
    await next();
  });
  app.route('/', healthRoutes);
});

afterEach(() => sqlite.close());

async function ready() {
  const response = await app.request('https://publication.example/health/ready', {}, {
    DB: sqliteBinding(sqlite),
  } as never);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: {
      status: string;
      database: { migrations_applied: boolean; missing_schema?: string[] };
    };
  };
  return body.data;
}

describe('health/ready schema probe', () => {
  it('is ready on a freshly migrated database', async () => {
    const data = await ready();
    expect(data.status).toBe('ready');
    expect(data.database.migrations_applied).toBe(true);
    expect(data.database.missing_schema).toBeUndefined();
  });

  it('reports the owner tables from 0007/0008 as missing instead of "ready"', async () => {
    // The exact state of a database migrated by an older deployment: all the
    // public content tables are there, the owner/author schema is not.
    sqlite.exec('DROP TABLE author_applications; DROP TABLE site_owner; DROP TABLE owner_enrollment;');
    sqlite.exec('DROP TABLE owner_security_tokens;');

    const data = await ready();
    expect(data.status).toBe('degraded');
    expect(data.database.migrations_applied).toBe(false);
    expect(data.database.missing_schema).toEqual(expect.arrayContaining([
      'table site_owner (0007_author_access.sql)',
      'table author_applications (0007_author_access.sql)',
      'table owner_enrollment (0008_owner_setup.sql)',
      'table owner_security_tokens (0008_owner_setup.sql)',
    ]));
  });

  it('reports an unwritten 0010 trigger as missing', async () => {
    sqlite.exec('DROP TRIGGER articles_reserved_slug_insert;');

    const data = await ready();
    expect(data.status).toBe('degraded');
    expect(data.database.missing_schema).toEqual([
      'trigger articles_reserved_slug_insert (0010_reserved_article_urls.sql)',
    ]);
  });
});
