#!/usr/bin/env node
/**
 * G WORLD — deploy the frontend to Cloudflare Pages.
 *
 *   npm run deploy:web                     # production (branch: main)
 *   npm run deploy:web -- --branch staging # preview deployment
 *   npm run deploy:web -- --skip-checks    # emergency only
 *
 * Order of operations, on purpose:
 *
 *   1. `check-config --strict` — a placeholder `API_ORIGIN` or an all-zero D1 id
 *      would deploy a site that cannot reach its API. Fail before uploading.
 *   2. `typecheck:js` — `wrangler pages deploy` uploads `public/` verbatim; a
 *      syntax error in a module is a broken page in production.
 *   3. `build:web` — the same artifact gate Cloudflare Pages runs from Git
 *      (lockfile in sync, routing rules and page links resolve, Pages limits).
 *      Deploying by hand still uploads exactly what Cloudflare would build.
 *   4. `wrangler pages deploy` — the actual upload, from `apps/web`, because that
 *      is where `wrangler.toml` lives (`pages_build_output_dir = "public"`).
 *
 * Nothing secret is passed to Pages: session secrets and email keys belong to
 * the API worker only.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = path.join(ROOT, 'apps/web');
const SKIP_CHECKS = process.argv.includes('--skip-checks');

function readFlag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const BRANCH = readFlag('branch', 'main');
const PROJECT = readFlag('project', 'g-world');

/** Streams a script's output through, returning its exit code. */
function step(label, script, args = []) {
  console.log(`\n\u001b[36m▶\u001b[0m ${label}`);
  const result = spawnSync(process.execPath, [path.join('scripts', script), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`\n\u001b[31m✘\u001b[0m ${label} failed — nothing was deployed.`);
    process.exit(result.status ?? 1);
  }
}

if (SKIP_CHECKS) {
  console.log('\u001b[33m▲\u001b[0m checks skipped (--skip-checks); deploying the working tree as-is');
} else {
  step('configuration check', 'check-config.mjs', ['--strict']);
  step('frontend typecheck', 'typecheck-web.mjs');
  step('frontend build', 'build-web.mjs', ['--strict']);
}

console.log(`\n\u001b[36m▶\u001b[0m wrangler pages deploy public --project-name ${PROJECT} --branch ${BRANCH}`);

let uploaded = false;
try {
  // `--commit-dirty=true` keeps the deploy idempotent from a working tree that
  // has uncommitted local changes (which is the normal case while iterating).
  const output = execFileSync(
    'npx',
    [
      'wrangler',
      'pages',
      'deploy',
      'public',
      '--project-name',
      PROJECT,
      '--branch',
      BRANCH,
      '--commit-dirty=true',
    ],
    { cwd: WEB_DIR, encoding: 'utf8', stdio: 'pipe' },
  );
  uploaded = true;
  console.log(output.trim());
} catch (error) {
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  console.error(output || String(error.message));
}

if (!uploaded) {
  console.error('\n\u001b[31m✘\u001b[0m the upload failed. Common causes:');
  console.error('  · not signed in            → npx wrangler login');
  console.error('  · project does not exist   → npx wrangler pages project create g-world');
  console.error('  · wrong account            → CLOUDFLARE_ACCOUNT_ID=… npx wrangler whoami');
  process.exit(1);
}

console.log('\n\u001b[32m✓\u001b[0m frontend deployed');
console.log('\u001b[90mNext: point API_ORIGIN (or the API service binding) at the deployed worker and');
console.log('check the API is live at /api/v1/health from the site. See docs/06-deployment.md.\u001b[0m');
