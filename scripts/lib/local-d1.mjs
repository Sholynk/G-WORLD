/**
 * Shared helpers for the local D1 scripts (migrate / seed / reset).
 *
 * Everything here shells out to the project's own `wrangler` binary with the
 * API's wrangler config, so the scripts cannot drift from what `npm run dev`
 * actually uses. No third-party dependencies are involved.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const CONFIG_REL = 'apps/api/wrangler.jsonc';
export const CONFIG = path.join(ROOT, CONFIG_REL);
export const DB_NAME = 'g_world';
export const SEED_DIR = path.join(ROOT, 'database', 'seeds');
export const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
/** Miniflare's local state (the SQLite files D1 writes to in development). */
export const LOCAL_STATE_DIR = path.join(ROOT, 'apps', 'api', '.wrangler');

const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');

/**
 * Runs wrangler and returns { ok, status, stdout, stderr }.
 *
 * Output is inherited by default so the developer sees wrangler's own progress;
 * pass `capture: true` to collect it instead (used for `--json` queries).
 */
export function runWrangler(args, options = {}) {
  const { capture = false, allowFailure = false, quiet = false } = options;
  if (!existsSync(WRANGLER)) {
    throw new Error(
      'wrangler is not installed. Run `npm install` at the repository root first.',
    );
  }

  if (!quiet && !capture) {
    console.log(`\n$ wrangler ${args.join(' ')}`);
  }

  const result = spawnSync(WRANGLER, args, {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });

  const outcome = {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };

  if (!outcome.ok && !allowFailure) {
    const detail = capture ? `${outcome.stdout}${outcome.stderr}`.trim() : '';
    throw new Error(`wrangler ${args.join(' ')} failed (exit ${outcome.status})${detail ? `\n${detail}` : ''}`);
  }

  return outcome;
}

/** Applies every pending migration to the local D1 database. */
export function applyMigrations({ env } = {}) {
  return runWrangler([
    'd1',
    'migrations',
    'apply',
    DB_NAME,
    '--local',
    '--config',
    CONFIG_REL,
    ...(env ? ['--env', env] : []),
  ]);
}

/** Lists migrations with their applied status (wrangler prints a table). */
export function listMigrations() {
  return runWrangler(['d1', 'migrations', 'list', DB_NAME, '--local', '--config', CONFIG_REL], {
    allowFailure: true,
  });
}

/** Absolute paths of the seed files, in numeric order. */
export function seedFiles() {
  if (!existsSync(SEED_DIR)) return [];
  return readdirSync(SEED_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => path.join(SEED_DIR, name));
}

/** Executes one .sql file against the local D1 database. */
export function executeFile(file, { allowFailure = false } = {}) {
  const relative = path.relative(ROOT, file);
  return runWrangler(
    ['d1', 'execute', DB_NAME, '--local', '--file', relative, '--config', CONFIG_REL],
    { allowFailure, quiet: true },
  );
}

/** Runs a single SQL statement and returns the parsed `results` array. */
export function query(sql) {
  const result = runWrangler(
    ['d1', 'execute', DB_NAME, '--local', '--command', sql, '--json', '--config', CONFIG_REL],
    { capture: true, allowFailure: true, quiet: true },
  );
  if (!result.ok) return null;
  const start = result.stdout.indexOf('[');
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(result.stdout.slice(start));
    return parsed[0]?.results ?? null;
  } catch {
    return null;
  }
}

/** Deletes the local Miniflare state: sessions, uploads and the D1 file go away. */
export function wipeLocalState() {
  if (existsSync(LOCAL_STATE_DIR)) {
    rmSync(LOCAL_STATE_DIR, { recursive: true, force: true });
    return true;
  }
  return false;
}
