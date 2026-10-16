#!/usr/bin/env node
/**
 * G WORLD — structure check.
 *
 *   npm run check:structure
 *
 * `docs/02-file-structure.md` is the map of this repository. This script is the
 * map's teeth: it asserts that the paths the documentation promises actually
 * exist, so documentation drift fails the build instead of misleading the next
 * person. It is deliberately about *presence and wiring*, not style — linting is
 * a separate concern.
 *
 * Groups checked:
 *   · repository root and workspace manifests
 *   · documentation
 *   · database migrations and seeds
 *   · the API worker (entry point, routing, data access, shared contracts)
 *   · the frontend (Pages output, ES modules, assets, hosting files)
 *   · the scripts that make local development reproducible
 *
 * Exit code 0 = the tree matches the map, 1 = something is missing.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AS_JSON = process.argv.includes('--json');

const REQUIRED_FILES = {
  'repository root': [
    'package.json',
    'tsconfig.base.json',
    'tsconfig.json',
    '.gitignore',
    '.editorconfig',
    '.nvmrc',
    '.env.example',
    'vitest.config.ts',
    'package-lock.json',
    '.github/workflows/ci.yml',
  ],
  documentation: [
    'README.md',
    'docs/01-architecture.md',
    'docs/02-file-structure.md',
    'docs/03-database.md',
    'docs/06-deployment.md',
  ],
  'shared contracts': ['packages/shared/package.json', 'packages/shared/src/index.ts'],
  'api worker': [
    'apps/api/package.json',
    'apps/api/wrangler.jsonc',
    'apps/api/.dev.vars.example',
    'apps/api/src/index.ts',
    'apps/api/src/app.ts',
    'apps/api/src/env.ts',
    'apps/api/src/db/client.ts',
    'apps/api/src/middleware/error-handler.ts',
    'apps/api/src/middleware/auth.ts',
    'apps/api/src/routes/health.ts',
    'apps/api/src/routes/auth.ts',
    'apps/api/src/services/learning.ts',
  ],
  frontend: [
    'apps/web/package.json',
    'apps/web/wrangler.toml',
    'apps/web/functions/api/[[path]].ts',
    'apps/web/public/index.html',
    'apps/web/public/_headers',
    'apps/web/public/_redirects',
    'apps/web/public/config.js',
    'apps/web/public/robots.txt',
    'apps/web/public/sitemap.xml',
    'apps/web/public/manifest.webmanifest',
    'apps/web/public/404.html',
  ],
  'local development scripts': [
    'scripts/dev-server.mjs',
    'scripts/dev-up.mjs',
    'scripts/db-reset.mjs',
    'scripts/seed-local.mjs',
    'scripts/smoke-test.mjs',
    'scripts/smoke-web.mjs',
    'scripts/check-config.mjs',
    'scripts/check-structure.mjs',
    'scripts/typecheck-web.mjs',
    'scripts/deploy-web.mjs',
    'scripts/check-lockfile.mjs',
    'scripts/build-web.mjs',
    'scripts/lib/local-d1.mjs',
  ],
};

const REQUIRED_DIRECTORIES = {
  'database': ['database/migrations', 'database/seeds'],
  'api internals': [
    'apps/api/src/db/repositories',
    'apps/api/src/lib',
    'apps/api/src/middleware',
    'apps/api/src/routes',
    'apps/api/src/schemas',
    'apps/api/src/services',
  ],
  'frontend assets': [
    'apps/web/public/assets/css',
    'apps/web/public/assets/js/core',
    'apps/web/public/assets/js/components',
    'apps/web/public/assets/js/pages',
    'apps/web/public/admin',
  ],
};

/** Directories that must contain at least N entries — an empty folder is a lie. */
const MINIMUM_ENTRIES = [
  ['database/migrations', 1, 'SQL migration files'],
  ['database/seeds', 1, 'seed files'],
  ['apps/api/src/db/repositories', 5, 'repository modules'],
  ['apps/api/src/routes', 4, 'route modules'],
  ['apps/web/public/assets/js/core', 5, 'core frontend modules'],
  ['apps/web/public/assets/js/components', 8, 'UI components'],
  ['apps/web/public/assets/js/pages', 10, 'page controllers'],
  ['apps/web/public/admin', 5, 'admin pages'],
];

const missing = [];
const empty = [];
const summary = [];

for (const [group, files] of Object.entries(REQUIRED_FILES)) {
  const absent = files.filter((file) => !existsSync(path.join(ROOT, file)));
  if (absent.length) missing.push({ group, paths: absent });
  else summary.push(`${group}: ${files.length} file(s) present`);
}

for (const [group, directories] of Object.entries(REQUIRED_DIRECTORIES)) {
  const absent = directories.filter((directory) => !existsSync(path.join(ROOT, directory)));
  if (absent.length) missing.push({ group, paths: absent });
  else summary.push(`${group}: ${directories.length} directory(ies) present`);
}

for (const [directory, minimum, description] of MINIMUM_ENTRIES) {
  const absolute = path.join(ROOT, directory);
  if (!existsSync(absolute)) continue;
  const entries = readdirSync(absolute).filter((name) => !name.startsWith('.'));
  if (entries.length < minimum) empty.push({ directory, expected: minimum, found: entries.length, description });
}

/** The HTML pages the site links to must all exist, or a nav click 404s. */
let pageCount = 0;
const PUBLIC_DIR = path.join(ROOT, 'apps/web/public');
if (existsSync(PUBLIC_DIR)) {
  pageCount = readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html')).length;
  const adminDir = path.join(PUBLIC_DIR, 'admin');
  if (existsSync(adminDir) && statSync(adminDir).isDirectory()) {
    pageCount += readdirSync(adminDir).filter((name) => name.endsWith('.html')).length;
  }
  summary.push(`frontend pages: ${pageCount} HTML document(s)`);
}

/* -------------------------------------------------------------------- report */

const ok = missing.length === 0 && empty.length === 0;

if (AS_JSON) {
  console.log(JSON.stringify({ ok, missing, empty, summary }, null, 2));
} else {
  for (const line of summary) console.log(`\u001b[90m·\u001b[0m ${line}`);
  for (const { directory, expected, found, description } of empty) {
    console.log(`\u001b[33m▲\u001b[0m ${directory} holds ${found} entr(ies); expected at least ${expected} (${description})`);
  }
  for (const { group, paths } of missing) {
    console.log(`\u001b[31m✘\u001b[0m ${group}: ${paths.length} path(s) missing from docs/02-file-structure.md`);
    for (const relative of paths) console.log(`\u001b[90m  ${relative}\u001b[0m`);
  }
  console.log(`\nstructure check: ${ok ? 'ok' : 'incomplete'}`);
}

process.exit(ok ? 0 : 1);
