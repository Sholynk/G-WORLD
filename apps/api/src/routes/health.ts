/**
 * Routes — health, readiness and metadata.
 *
 * `/health` is liveness: it must answer even if D1 is unreachable, so it does no
 * I/O at all. `/health/ready` is readiness: it checks the database and reports
 * configuration problems, which is what a deployment smoke test and the uptime
 * monitor should call.
 *
 * Neither endpoint exposes secrets: `config_problems` describes *what* is
 * missing, never the value.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { findConfigProblems, PASSWORD_ITERATIONS_DEFAULT } from '../env.js';
import { createDb } from '../db/client.js';
import { ok } from './helpers.js';

export const healthRoutes = new Hono<AppEnv>();

/**
 * The isolate's start time, captured on the first request rather than at module
 * scope: module scope is evaluated once and cached, so a value read there can
 * predate the deployment — and under Miniflare it is the epoch.
 */
let startedAt: string | null = null;
function startedAtIso(): string {
  startedAt ??= new Date().toISOString();
  return startedAt;
}

healthRoutes.get('/health', (c) =>
  ok(c, {
    status: 'ok',
    service: 'sholynk-tech-api',
    environment: c.get('config').environment,
    started_at: startedAtIso(),
    time: new Date().toISOString(),
  }),
);

/**
 * Schema objects that later migrations add and that only the *authenticated*
 * half of the API touches.
 *
 * This list exists because counting roles is not a migration check: a database
 * migrated through 0006 looks perfectly healthy to every public route, while
 * sign-in (`accessAllowed` → `owner_enrollment`) and the whole admin dashboard
 * fail with `no such table`. That is a 500 that says nothing useful, so the
 * readiness probe now names the missing objects instead.
 */
const REQUIRED_SCHEMA = {
  tables: [
    ['site_owner', '0007_author_access.sql'],
    ['author_applications', '0007_author_access.sql'],
    ['owner_enrollment', '0008_owner_setup.sql'],
    ['owner_security_tokens', '0008_owner_setup.sql'],
  ],
  columns: [
    ['articles', 'owner_user_id', '0009_author_workspace.sql'],
    ['images', 'owner_user_id', '0009_author_workspace.sql'],
    ['authors', 'social_links_json', '0009_author_workspace.sql'],
  ],
  triggers: [
    ['articles_reserved_slug_insert', '0010_reserved_article_urls.sql'],
    ['articles_reserved_slug_update', '0010_reserved_article_urls.sql'],
  ],
} as const;

/** Objects in REQUIRED_SCHEMA that the live database does not have. */
async function missingSchema(db: ReturnType<typeof createDb>): Promise<string[]> {
  const tables = new Set(
    (await db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table'
        AND name IN (${REQUIRED_SCHEMA.tables.map(() => '?').join(',')})`,
      REQUIRED_SCHEMA.tables.map(([name]) => name),
    )).map((row) => row.name),
  );
  const columns = new Map<string, Set<string>>();
  for (const table of new Set(REQUIRED_SCHEMA.columns.map(([name]) => name))) {
    const rows = await db.all<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, [table]);
    columns.set(table, new Set(rows.map((row) => row.name)));
  }
  const triggers = new Set(
    (await db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger'
        AND name IN (${REQUIRED_SCHEMA.triggers.map(() => '?').join(',')})`,
      REQUIRED_SCHEMA.triggers.map(([name]) => name),
    )).map((row) => row.name),
  );

  const missing: string[] = [];
  for (const [name, migration] of REQUIRED_SCHEMA.tables) {
    if (!tables.has(name)) missing.push(`table ${name} (${migration})`);
  }
  for (const [table, column, migration] of REQUIRED_SCHEMA.columns) {
    if (!columns.get(table)?.has(column)) missing.push(`column ${table}.${column} (${migration})`);
  }
  for (const [name, migration] of REQUIRED_SCHEMA.triggers) {
    if (!triggers.has(name)) missing.push(`trigger ${name} (${migration})`);
  }
  return missing;
}

healthRoutes.get('/health/ready', async (c) => {
  const config = c.get('config');
  const problems = findConfigProblems(config, c.env);

  let database: {
    reachable: boolean;
    migrations_applied: boolean;
    articles?: number;
    missing_schema?: string[];
    error?: string;
  };
  try {
    const db = createDb(c.env.DB);
    const [roles, articles, missing] = await Promise.all([
      db.first<{ total: number }>(`SELECT COUNT(*) AS total FROM roles`),
      db.first<{ total: number }>(`SELECT COUNT(*) AS total FROM articles`),
      missingSchema(db),
    ]);
    database = {
      reachable: true,
      // Reference data (0006) *and* the owner/author schema (0007–0010): the
      // dashboard cannot sign in without the latter, even though every public
      // page works.
      migrations_applied: Number(roles?.total ?? 0) >= 4 && missing.length === 0,
      articles: Number(articles?.total ?? 0),
      ...(missing.length ? { missing_schema: missing } : {}),
    };
  } catch (error) {
    database = {
      reachable: false,
      migrations_applied: false,
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
    };
  }

  const ready = database.reachable && database.migrations_applied && problems.length === 0;
  return ok(
    c,
    {
      status: ready ? 'ready' : 'degraded',
      database,
      config_problems: problems,
      checks: {
        session_secret_configured: Boolean(c.env.SESSION_SECRET && c.env.SESSION_SECRET.length >= 32),
        email_provider: config.email.provider,
        r2_configured: Boolean(c.env.BUCKET),
        registration_enabled: config.features.registration,
        password_iterations: config.passwordIterations,
      },
    },
    { status: 200 },
  );
});

/** Public metadata the frontend uses to decide what to render. */
healthRoutes.get('/meta', (c) => {
  const config = c.get('config');
  return ok(c, {
    name: 'Sholynk Tech',
    api_version: 'v1',
    environment: config.environment,
    features: {
      registration: config.features.registration,
      file_uploads: config.features.fileUploads,
      dev_routes: config.features.devRoutes,
    },
    password_iterations_supported: PASSWORD_ITERATIONS_DEFAULT,
    email_verification_required: true,
  });
});
