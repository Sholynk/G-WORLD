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
    service: 'g-world-api',
    environment: c.get('config').environment,
    started_at: startedAtIso(),
    time: new Date().toISOString(),
  }),
);

healthRoutes.get('/health/ready', async (c) => {
  const config = c.get('config');
  const problems = findConfigProblems(config, c.env);

  let database: { reachable: boolean; migrations_applied: boolean; error?: string };
  try {
    const db = createDb(c.env.DB);
    const row = await db.first<{ total: number }>(`SELECT COUNT(*) AS total FROM roles`);
    database = { reachable: true, migrations_applied: Number(row?.total ?? 0) >= 4 };
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
    name: 'G WORLD',
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
