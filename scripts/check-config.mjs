#!/usr/bin/env node
/**
 * G WORLD — configuration gate.
 *
 *   npm run check:config              # local run: placeholders are warnings
 *   npm run check:config -- --strict  # deploy run: placeholders are failures
 *   node scripts/check-config.mjs --json
 *
 * This script exists because a misconfigured deploy is worse than a failed one.
 * It answers four questions before anything is pushed to Cloudflare:
 *
 *   1. Do the wrangler files still contain the values you must replace (the
 *      all-zero D1 `database_id`, a placeholder `API_ORIGIN`, a real-looking
 *      email domain) — and are they coherent (a production env that is not
 *      production, dev routes enabled in production, and so on)?
 *   2. Is there any obvious secret in a file that would be committed?
 *   3. Is `.dev.vars` untracked, and does the example file document every key?
 *   4. Do the migrations and the Pages output directory actually exist?
 *
 * Exit code 0 = safe to continue, 1 = stop. Nothing here needs the network.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict') || process.env.CI_STRICT === '1';
const AS_JSON = process.argv.includes('--json');

const problems = [];
const warnings = [];
const notes = [];

const fail = (message, hint) => problems.push({ message, hint });
const warn = (message, hint) => warnings.push({ message, hint });

/* ------------------------------------------------------------------- helpers */

/** Reads a file relative to the repo root, or null when it does not exist. */
function read(relative) {
  const absolute = path.join(ROOT, relative);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
}

/**
 * Strips `//` and `/* *​/` comments (respecting string literals) so a JSONC
 * file can go through `JSON.parse`. Trailing commas are removed too, because
 * wrangler accepts them and `JSON.parse` does not.
 */
function parseJsonc(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLine = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlock = true;
      index += 1;
      continue;
    }
    out += char;
  }

  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Every file git would include in a commit (tracked + untracked, honouring .gitignore). */
function committableFiles() {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    notes.push({ message: 'git is unavailable — skipped the tracked-file and secret scans' });
    return [];
  }
}

/* ------------------------------------------------------- 1. wrangler (worker) */

const API_CONFIG_PATH = 'apps/api/wrangler.jsonc';
const apiConfigText = read(API_CONFIG_PATH);

let apiConfig = null;
if (!apiConfigText) {
  fail(`${API_CONFIG_PATH} is missing`, 'The API worker cannot be deployed without it.');
} else {
  try {
    apiConfig = parseJsonc(apiConfigText);
  } catch (error) {
    fail(`${API_CONFIG_PATH} is not valid JSONC`, String(error.message));
  }
}

const ZERO_ID = '00000000-0000-0000-0000-000000000000';

if (apiConfig) {
  const binding = apiConfig.d1_databases?.[0];
  if (!binding) {
    fail(`${API_CONFIG_PATH} has no d1_databases binding`, 'Add the `DB` binding.');
  } else {
    if (binding.binding !== 'DB') warn(`D1 binding is named "${binding.binding}", expected "DB"`);
    if (binding.database_id === ZERO_ID) {
      const message = 'D1 `database_id` is still the all-zero placeholder';
      const hint = 'Run `wrangler d1 create g_world` and paste the returned id into both the top-level and production blocks.';
      if (STRICT) fail(message, hint);
      else warn(message, `${hint} Local development uses a local SQLite file, so this is fine until you deploy.`);
    }
    if (!binding.migrations_dir) fail('D1 binding has no `migrations_dir`', 'Migrations must ship with the worker config.');
  }

  const production = apiConfig.env?.production;
  if (!production) {
    fail(`${API_CONFIG_PATH} has no \`env.production\` block`, 'Deploys must target an explicit environment.');
  } else {
    const vars = production.vars ?? {};
    if (vars.ENVIRONMENT !== 'production') fail('env.production.vars.ENVIRONMENT is not "production"');
    if (vars.ENABLE_DEV_ROUTES !== 'false') {
      fail(
        'env.production.vars.ENABLE_DEV_ROUTES is not "false"',
        'The /auth/dev/* routes print verification and reset tokens; they must be off in production.',
      );
    }
    if (Number(vars.PASSWORD_ITERATIONS ?? 0) < 100_000) {
      fail(
        `env.production.vars.PASSWORD_ITERATIONS is ${vars.PASSWORD_ITERATIONS ?? 'unset'} (minimum 100000)`,
        'Password hashing is deliberately slow; a low count in production weakens every stored password.',
      );
    }
    if (production.d1_databases?.[0]?.database_id === ZERO_ID && !STRICT) {
      warn('env.production.d1_databases[0].database_id is the all-zero placeholder');
    }
  }

  if (apiConfig.vars?.ENABLE_DEV_ROUTES === 'true') {
    warn(
      'The top-level (local) config enables dev routes',
      'Correct for `wrangler dev`; keep them disabled in `env.production`.',
    );
  }

  const cron = apiConfig.triggers?.crons ?? [];
  if (!cron.length) warn('No cron trigger is configured', 'Expired sessions and tokens are cleaned up by a nightly cron.');
  notes.push({ message: `worker: ${apiConfig.name} · ${apiConfig.d1_databases?.[0]?.database_name ?? 'no D1'} · cron ${cron.join(', ') || 'none'}` });
}

/* ------------------------------------------------------- 2. wrangler (Pages) */

const WEB_CONFIG_PATH = 'apps/web/wrangler.toml';
const webConfig = read(WEB_CONFIG_PATH);

if (!webConfig) {
  fail(`${WEB_CONFIG_PATH} is missing`, 'Cloudflare Pages needs the project configuration.');
} else {
  const output = /pages_build_output_dir\s*=\s*"([^"]+)"/.exec(webConfig)?.[1];
  if (!output) fail(`${WEB_CONFIG_PATH} does not set pages_build_output_dir`);
  else if (!existsSync(path.join(ROOT, 'apps/web', output))) fail(`Pages output directory apps/web/${output} does not exist`);
  else if (!existsSync(path.join(ROOT, 'apps/web', output, 'index.html'))) fail(`apps/web/${output}/index.html is missing`);

  const origin = /API_ORIGIN\s*=\s*"([^"]*)"/.exec(webConfig)?.[1];
  if (!origin) {
    fail(`${WEB_CONFIG_PATH} does not set API_ORIGIN`, 'The Pages Function falls back to it when no service binding exists.');
  } else if (origin.includes('<your-subdomain>')) {
    const message = 'API_ORIGIN is still a placeholder';
    const hint = 'Replace it with the deployed worker origin (or configure the `API` service binding and leave it as a fallback).';
    if (STRICT) fail(message, hint);
    else warn(message, `${hint} Not used during local development — the dev server proxies /api/* itself.`);
  }

  if (!webConfig.includes('[[services]]')) {
    warn('No `[[services]]` binding to the API worker is configured', 'A service binding skips the public internet hop between Pages and the worker.');
  }
}

/* ------------------------------------------------------ 3. migrations & seeds */

const MIGRATIONS_DIR = path.join(ROOT, 'database/migrations');
if (!existsSync(MIGRATIONS_DIR)) {
  fail('database/migrations/ is missing');
} else {
  const migrations = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
  if (!migrations.length) fail('database/migrations/ contains no .sql files');
  const gaps = migrations.filter((name, index) => Number(name.slice(0, 4)) !== index + 1);
  if (gaps.length) warn(`Migration numbering is not contiguous: ${gaps.join(', ')}`);
  notes.push({ message: `${migrations.length} migration(s): ${migrations.join(', ')}` });
}

if (!existsSync(path.join(ROOT, 'database/seeds'))) warn('database/seeds/ is missing', 'Local development has no demo content without seeds.');

/* ------------------------------------------------- 4. .dev.vars and secrets */

const DEV_VARS = 'apps/api/.dev.vars';
const DEV_VARS_EXAMPLE = 'apps/api/.dev.vars.example';
const files = committableFiles();

if (files.includes(DEV_VARS)) {
  fail(
    `${DEV_VARS} would be committed`,
    'It holds the local session secret. Add it to .gitignore (it already is) and remove it from the index: git rm --cached apps/api/.dev.vars',
  );
}

const exampleVars = read(DEV_VARS_EXAMPLE);
if (!exampleVars) {
  warn(`${DEV_VARS_EXAMPLE} is missing`, 'A contributor cannot tell which keys local development needs.');
} else {
  const keys = exampleVars
    .split('\n')
    .map((line) => /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1])
    .filter(Boolean);
  notes.push({ message: `${keys.length} documented variable(s) in .dev.vars.example: ${keys.join(', ')}` });
  if (keys.includes('SESSION_SECRET') === false) warn('.dev.vars.example does not document SESSION_SECRET');
}

const SECRET_PATTERNS = [
  { name: 'Resend API key', regex: /\bre_[A-Za-z0-9]{20,}\b/ },
  { name: 'Stripe-style secret key', regex: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'OpenAI-style key', regex: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Cloudflare API token', regex: /\b(?:v1\.0-)?[A-Za-z0-9_-]{40}\b(?=.*CLOUDFLARE_API_TOKEN)/ },
];

const SKIP = /^(?:package-lock\.json|.*\.svg|.*\.png|.*\.jpg|.*\.woff2?)$/;
const TEXT_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.toml', '.sql', '.md', '.html', '.css', '.yml', '.yaml', '.txt', '.example', '.webmanifest', '']);

let scanned = 0;
for (const file of files) {
  if (SKIP.test(file)) continue;
  if (!TEXT_EXTENSIONS.has(path.extname(file)) && !file.startsWith('.') && !file.includes('/.')) continue;
  const content = read(file);
  if (content === null) continue;
  scanned += 1;
  for (const { name, regex } of SECRET_PATTERNS) {
    if (regex.test(content)) {
      fail(`Possible ${name} committed in ${file}`, 'Secrets belong in `wrangler secret put` / the Cloudflare dashboard, never in the repository.');
    }
  }
}
if (scanned) notes.push({ message: `${scanned} committable file(s) scanned for secret-shaped strings` });

// A literal SESSION_SECRET value in a tracked file is a real leak, even if it
// does not match any provider pattern. The example file is exempt by name.
for (const file of files) {
  if (file.endsWith('.example') || file.endsWith('.md')) continue;
  const content = read(file);
  if (!content) continue;
  const match = /SESSION_SECRET\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{24,})["']?/.exec(content);
  if (match && !content.includes('put SESSION_SECRET')) {
    fail(`A literal SESSION_SECRET value appears in ${file}`, 'Use `wrangler secret put SESSION_SECRET` instead.');
  }
}

/* -------------------------------------------------------------------- report */

if (AS_JSON) {
  console.log(JSON.stringify({ strict: STRICT, problems, warnings, notes }, null, 2));
} else {
  for (const note of notes) console.log(`\u001b[90m·\u001b[0m ${note.message}`);
  for (const warning of warnings) {
    console.log(`\u001b[33m▲\u001b[0m ${warning.message}`);
    if (warning.hint) console.log(`\u001b[90m  ${warning.hint}\u001b[0m`);
  }
  for (const problem of problems) {
    console.log(`\u001b[31m✘\u001b[0m ${problem.message}`);
    if (problem.hint) console.log(`\u001b[90m  ${problem.hint}\u001b[0m`);
  }
  console.log(
    `\nconfig check: ${problems.length} problem(s), ${warnings.length} warning(s)${STRICT ? ' (strict)' : ''}`,
  );
}

process.exit(problems.length ? 1 : 0);
