#!/usr/bin/env node
/**
 * Sholynk Tech — one-command local development.
 *
 *   npm run dev                       # API on :8787, site on :5173
 *   npm run dev -- --port 32951       # pick the static-server port
 *   npm run dev -- --api-port 8787
 *
 * Brings up the two halves of the platform:
 *
 *   1. the API worker (`wrangler dev`, Cloudflare's local workerd + a local D1
 *      file) on `--api-port`, and
 *   2. the static frontend (`scripts/dev-server.mjs`, which also proxies
 *      `/api/*` to the worker) on `--port`.
 *
 * It is deliberately idempotent: if something already answers on a port it is
 * reused instead of started a second time, so running this while the servers
 * are up is a no-op that just prints where they are. Ctrl-C stops only the
 * processes this command started, never a server it adopted.
 *
 * Requirements: `npm install` (wrangler), a local D1 database
 * (`npm run db:reset:local` seeds one).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_CONFIG = path.join('apps', 'api', 'wrangler.jsonc');

/* ---------------------------------------------------------------------- flags */

function readFlag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const WEB_PORT = Number(readFlag('port', process.env.PORT ?? '5173'));
const API_PORT = Number(readFlag('api-port', process.env.API_PORT ?? '8787'));
const API_TARGET = `http://127.0.0.1:${API_PORT}`;

if (!Number.isInteger(WEB_PORT) || !Number.isInteger(API_PORT)) {
  console.error('Ports must be numbers, e.g. --port 5173 --api-port 8787');
  process.exit(1);
}

/* ------------------------------------------------------------------ utilities */

const COLOURS = { api: '\u001b[36m', web: '\u001b[35m', dim: '\u001b[90m', reset: '\u001b[0m' };

/** Prefixes a child's output so two servers in one terminal stay readable. */
function pump(child, label) {
  const colour = COLOURS[label] ?? '';
  const write = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) process.stdout.write(`${colour}[${label}]${COLOURS.reset} ${line}\n`);
    }
  };
  child.stdout?.on('data', write);
  child.stderr?.on('data', write);
}

async function fetchStatus(url, timeoutMs = 1500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.status;
  } catch {
    return 0;
  }
}

/** Waits for `url` to answer 2xx/3xx, or gives up and returns false. */
async function waitFor(url, { attempts = 60, delayMs = 500, label = url } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await fetchStatus(url);
    if (status >= 200 && status < 400) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.error(`${COLOURS.dim}timed out waiting for${COLOURS.reset} ${label}`);
  return false;
}

/* ------------------------------------------------------------------- starting */

const started = [];
const children = [];

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...options.env },
  });
  child.on('exit', (code, signal) => {
    if (signal) return;
    const index = children.indexOf(child);
    if (index !== -1) children.splice(index, 1);
    if (code !== 0 && code !== null) {
      console.error(`${COLOURS[label]}${label}${COLOURS.reset} exited with code ${code}`);
    }
  });
  pump(child, label);
  children.push(child);
  started.push(label);
  return child;
}

async function shutdown(signal) {
  if (!children.length) return;
  console.log(`\n${COLOURS.dim}stopping ${started.join(' + ')}…${COLOURS.reset}`);
  for (const child of children) child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const child of children) if (!child.killed) child.kill('SIGKILL');
  process.exit(signal === 'SIGINT' ? 130 : 0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

/* ----------------------------------------------------------------------- main */

const apiAlreadyUp = (await fetchStatus(`${API_TARGET}/api/v1/health`)) === 200;
if (apiAlreadyUp) {
  console.log(`${COLOURS.dim}API already answering on${COLOURS.reset} ${API_TARGET} ${COLOURS.dim}(reusing it)${COLOURS.reset}`);
} else {
  console.log(`${COLOURS.dim}starting API worker on${COLOURS.reset} ${API_TARGET}`);
  start('api', process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'wrangler',
    'dev',
    '--config',
    API_CONFIG,
    '--port',
    String(API_PORT),
    '--ip',
    '0.0.0.0',
  ]);
  if (!(await waitFor(`${API_TARGET}/api/v1/health`, { label: 'the API worker' }))) {
    console.error('The API never came up. Check the [api] output above for build errors.');
    await shutdown('SIGTERM');
    process.exit(1);
  }
}

const webAlreadyUp = (await fetchStatus(`http://127.0.0.1:${WEB_PORT}/`)) === 200;
if (webAlreadyUp) {
  console.log(`${COLOURS.dim}site already answering on${COLOURS.reset} http://127.0.0.1:${WEB_PORT} ${COLOURS.dim}(reusing it)${COLOURS.reset}`);
} else {
  console.log(`${COLOURS.dim}starting the site on${COLOURS.reset} http://127.0.0.1:${WEB_PORT}`);
  start('web', process.execPath, [path.join('scripts', 'dev-server.mjs')], {
    env: { PORT: String(WEB_PORT), API_TARGET },
  });
  if (!(await waitFor(`http://127.0.0.1:${WEB_PORT}/`, { label: 'the site' }))) {
    await shutdown('SIGTERM');
    process.exit(1);
  }
}

console.log(`
${COLOURS.reset}Sholynk Tech is up.
  site  http://localhost:${WEB_PORT}
  api   ${API_TARGET}/api/v1/health
  ${COLOURS.dim}smoke tests: npm run test:smoke (API) · npm run test:web (pages)${COLOURS.reset}
`);

if (!children.length) {
  console.log(`${COLOURS.dim}Both servers were already running; nothing new to supervise.${COLOURS.reset}`);
  process.exit(0);
}
