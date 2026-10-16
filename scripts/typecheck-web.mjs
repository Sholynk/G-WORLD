#!/usr/bin/env node
/**
 * G WORLD — frontend typecheck.
 *
 *   npm run typecheck:js
 *
 * `tsc -b` only covers the TypeScript projects (`apps/api`, `packages/shared`).
 * The frontend is plain JavaScript plus one Pages Function, so it needs its own
 * gate:
 *
 *   1. the Pages Function (`apps/web/functions/api/[[path]].ts`) is real
 *      TypeScript and runs on Cloudflare's runtime — it is type-checked strictly
 *      with the DOM libs, since it is compiled by Pages, not by tsc;
 *   2. every ES module under `apps/web/public/assets/js/**` is parsed with
 *      `node --check`, which catches the class of mistake a browser would only
 *      report at runtime on the page a user happened to open (a stray bracket, a
 *      missing brace after an edit).
 *
 * Exit code 0 = clean, 1 = something failed.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES_DIR = path.join(ROOT, 'apps/web/public/assets/js');
const PAGES_FUNCTION = 'apps/web/functions/api/[[path]].ts';

/** Runs a command, streaming nothing, and returns { ok, output }. */
function run(command, args, options = {}) {
  try {
    const output = execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...options });
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || String(error.message) };
  }
}

/** Every `.js` file under `directory`, recursively, sorted. */
function collectModules(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) found.push(...collectModules(absolute));
    else if (entry.endsWith('.js')) found.push(absolute);
  }
  return found.sort();
}

let failures = 0;

/* ------------------------------------------------------ 1. the Pages Function */

console.log('· type-checking the Pages Function (tsc --noEmit)');
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
  PAGES_FUNCTION,
]);
if (tsc.ok) {
  console.log('\u001b[32m✓\u001b[0m Pages Function type-checks');
} else {
  failures += 1;
  console.log('\u001b[31m✘\u001b[0m Pages Function failed to type-check');
  console.log(tsc.output);
}

/* --------------------------------------------------- 2. frontend ES modules */

const modules = collectModules(MODULES_DIR);
console.log(`· parsing ${modules.length} frontend module(s) (node --check)`);

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
  console.log(`\u001b[32m✓\u001b[0m all ${modules.length} module(s) parse`);
}

console.log(`\nfrontend typecheck: ${failures ? `${failures} failure(s)` : 'ok'}`);
process.exit(failures ? 1 : 0);
