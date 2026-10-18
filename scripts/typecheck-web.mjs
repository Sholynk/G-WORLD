#!/usr/bin/env node
/**
 * Sholynk Tech — frontend typecheck.
 *
 *   npm run typecheck:js
 *
 * `tsc -b` only covers the TypeScript projects (`apps/api`, `packages/shared`).
 * The frontend is classic browser JavaScript plus a set of Pages Functions, so
 * it needs its own gate:
 *
 *   1. every Pages Function (`apps/web/functions/**\/*.ts`) is real TypeScript
 *      compiled by Cloudflare at deploy time — it is type-checked strictly with
 *      the DOM libs here, so a deploy cannot be the first place a type error
 *      surfaces;
 *   2. every browser script under `apps/web/public` (root-level page scripts
 *      and the admin dashboard) is parsed with `node --check`, which catches
 *      the class of mistake a browser would only report at runtime on the page
 *      a user happened to open (a stray bracket, a missing brace after an edit).
 *
 * Exit code 0 = clean, 1 = something failed.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'apps/web/public');
const FUNCTIONS_DIR = path.join(ROOT, 'apps/web/functions');

/** Runs a command, streaming nothing, and returns { ok, output }. */
function run(command, args, options = {}) {
  try {
    const output = execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...options });
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || String(error.message) };
  }
}

/** Every file with one of `extensions` under `directory`, recursively, sorted. */
function collect(directory, extensions, { skipDirs = [] } = {}) {
  const found = [];
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return found;
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      if (skipDirs.includes(entry)) continue;
      found.push(...collect(absolute, extensions, { skipDirs }));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(absolute);
    }
  }
  return found.sort();
}

let failures = 0;

/* ------------------------------------------------------- 1. the Pages Functions */

const functions = collect(FUNCTIONS_DIR, ['.ts']);
console.log(`· type-checking ${functions.length} Pages Function file(s) (tsc --noEmit)`);
const tsc = run('npx', [
  'tsc',
  '--noEmit',
  '--strict',
  '--target',
  'es2022',
  '--module',
  'es2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'es2022,dom,dom.iterable',
  '--skipLibCheck',
  ...functions.map((file) => path.relative(ROOT, file)),
]);
if (tsc.ok) {
  console.log('\u001b[32m✓\u001b[0m Pages Functions type-check');
} else {
  failures += 1;
  console.log('\u001b[31m✘\u001b[0m Pages Functions failed to type-check');
  console.log(tsc.output);
}

/* ------------------------------------------------------ 2. browser-side scripts */

// Root-level page scripts + the admin dashboard. `assets/` holds images only.
const modules = collect(PUBLIC_DIR, ['.js'], { skipDirs: ['assets'] });
console.log(`· parsing ${modules.length} browser script(s) (node --check)`);

const broken = [];
for (const file of modules) {
  const checked = run(process.execPath, ['--check', path.relative(ROOT, file)]);
  if (!checked.ok) broken.push({ file: path.relative(ROOT, file), output: checked.output });
}

if (broken.length) {
  failures += broken.length;
  for (const { file, output } of broken) {
    console.log(`\u001b[31m✘\u001b[0m ${file}`);
    console.log(`\u001b[90m  ${output.split('\n')[0]}\u001b[0m`);
  }
} else {
  console.log(`\u001b[32m✓\u001b[0m all ${modules.length} script(s) parse`);
}

console.log(`\nfrontend typecheck: ${failures ? `${failures} failure(s)` : 'ok'}`);
process.exit(failures ? 1 : 0);
