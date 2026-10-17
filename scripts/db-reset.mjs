#!/usr/bin/env node
/**
 * Rebuilds the local D1 database from scratch: delete state → migrate → seed.
 *
 *   npm run db:reset:local              # asks for confirmation
 *   npm run db:reset:local -- --yes     # no prompt (CI, scripts)
 *   npm run db:reset:local -- --no-seed # schema only, no demo data
 *
 * This only ever touches `apps/api/.wrangler` — the Miniflare state directory
 * used by `wrangler dev --local`. A remote (production) database is never
 * contacted: every wrangler command below passes `--local`.
 */
import { createInterface } from 'node:readline/promises';
import process from 'node:process';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import {
  LOCAL_STATE_DIR,
  applyMigrations,
  executeFile,
  seedFiles,
  wipeLocalState,
} from './lib/local-d1.mjs';

const args = process.argv.slice(2);
const assumeYes = args.includes('--yes') || args.includes('-y') || args.includes('--force');
const skipSeed = args.includes('--no-seed');

console.log('G WORLD — reset local database');
console.log(`state directory: ${path.relative(process.cwd(), LOCAL_STATE_DIR)}`);
console.log('target: local Miniflare D1 only (no remote database is touched)');

if (!assumeYes) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('Delete local state, re-apply migrations and seed? [y/N] ');
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Cancelled — nothing was changed.');
    process.exit(0);
  }
}

const removed = wipeLocalState();
console.log(removed ? 'Local state deleted.' : 'No local state found (nothing to delete).');

console.log('\nApplying migrations…');
applyMigrations();

if (skipSeed) {
  console.log('\nSchema ready. Skipped seeding (--no-seed).');
  process.exit(0);
}

const files = seedFiles();
let failed = 0;
for (const file of files) {
  process.stdout.write(`seeding ${path.basename(file)} … `);
  try {
    executeFile(file);
    console.log('ok');
  } catch (error) {
    failed += 1;
    console.log('FAILED');
    console.error(String(error.message).split('\n').slice(0, 20).join('\n'));
  }
}

if (failed) {
  console.error(`\n${failed} seed file(s) failed.`);
  process.exit(1);
}

console.log(`\nDone: schema + ${files.length} seed file(s) in place.`);
console.log('Start the API with `npm run dev:api`, then `npm run test:smoke`.');
console.log(
  '\nNote: an API that is already running keeps its old database open — restart it\n'
    + '(`npm run dev`) so it serves the database that was just rebuilt.',
);
