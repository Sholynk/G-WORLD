#!/usr/bin/env node
/**
 * Sholynk Tech — post-deploy readiness check.
 *
 *   node scripts/check-deployment.mjs                       # the production worker
 *   node scripts/check-deployment.mjs --base-url http://127.0.0.1:8787
 *   node scripts/check-deployment.mjs --attempts 10 --delay-ms 6000
 *   node scripts/check-deployment.mjs --json
 *
 * Why this exists
 * ---------------
 * Deploying is not the same as succeeding. A worker can publish cleanly and
 * still be useless — that is exactly what happened in October 2026, when a
 * healthy-looking deployment ran against a database four migrations behind:
 * every public route answered, `/health` said "ok", and sign-in died with a
 * generic 500. Nothing in the deploy output noticed.
 *
 * This script reads the readiness payload the way an operator would, and turns
 * "degraded" into a non-zero exit code. It is what `deploy-api.yml` runs after
 * `wrangler deploy`, and it can be run by hand against any deployment.
 *
 * `/health/ready` answers 200 even when degraded, deliberately: a monitor wants
 * the body, not the status code. The verdict therefore lives in the JSON, and
 * this script is the thing that insists on it.
 *
 * Exit code 0 = ready, 1 = degraded / unreachable.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------- input */

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const AS_JSON = process.argv.includes('--json');
const ATTEMPTS = Math.max(1, Number(argument('attempts', 1)));
const DELAY_MS = Math.max(0, Number(argument('delay-ms', 0)));

/**
 * The production worker origin, read from the Pages configuration so the two
 * cannot drift: `apps/web/wrangler.toml` is already the single source of truth
 * for where the frontend proxies `/api/*`.
 */
function configuredOrigin() {
  try {
    const toml = readFileSync(path.join(ROOT, 'apps/web/wrangler.toml'), 'utf8');
    return /API_ORIGIN\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? null;
  } catch {
    return null;
  }
}

const BASE = (
  argument('base-url') ??
  process.env.DEPLOY_BASE_URL ??
  configuredOrigin() ??
  'http://127.0.0.1:8787'
).replace(/\/+$/, '');

/* ------------------------------------------------------------------- check */

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Returns the list of reasons the payload is not acceptable (empty = ready). */
function evaluate(status, payload) {
  if (status !== 200) return [`HTTP ${status} from ${BASE}/api/v1/health/ready`];
  const data = payload?.data;
  if (!data) return ['the response carried no `data` object'];

  const problems = [];
  if (data.status !== 'ready') problems.push(`status is "${data.status}"`);
  if (data.database?.reachable !== true) {
    problems.push(`database is unreachable${data.database?.error ? ` (${data.database.error})` : ''}`);
  }
  if (data.database?.migrations_applied !== true) problems.push('migrations_applied is false');
  for (const missing of data.database?.missing_schema ?? []) {
    problems.push(`missing schema: ${missing}`);
  }
  for (const problem of data.config_problems ?? []) {
    problems.push(`config: ${problem}`);
  }
  return problems;
}

async function probe() {
  try {
    const response = await fetch(`${BASE}/api/v1/health/ready`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      return { status: response.status, payload: null, problems: [`HTTP ${response.status} with a non-JSON body`] };
    }
    return { status: response.status, payload, problems: evaluate(response.status, payload) };
  } catch (error) {
    return { status: 0, payload: null, problems: [`cannot reach ${BASE}: ${error.message}`] };
  }
}

let last = null;
let attempt = 0;

while (attempt < ATTEMPTS) {
  attempt += 1;
  last = await probe();
  if (last.problems.length === 0) break;
  if (attempt < ATTEMPTS) {
    console.log(`attempt ${attempt}/${ATTEMPTS}: not ready — ${last.problems.join('; ')}`);
    await sleep(DELAY_MS);
  }
}

const ready = last.problems.length === 0;

if (AS_JSON) {
  console.log(JSON.stringify({ ready, base: BASE, attempts: attempt, problems: last.problems, payload: last.payload }, null, 2));
} else if (ready) {
  const database = last.payload.data.database;
  console.log(`\u001b[32m✓\u001b[0m ${BASE} is ready (${database.articles} article(s), migrations applied)`);
} else {
  console.log(`\u001b[31m✘\u001b[0m ${BASE} is not ready after ${attempt} attempt(s):`);
  for (const problem of last.problems) console.log(`  · ${problem}`);
  console.log('\nThe deployment is live but not serving. Fix the schema or configuration before announcing it.');
}

process.exit(ready ? 0 : 1);
