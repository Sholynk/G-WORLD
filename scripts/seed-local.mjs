#!/usr/bin/env node
/**
 * Applies the demo seed files to the **local** D1 database.
 *
 *   npm run db:seed:local                 # every file in database/seeds
 *   npm run db:seed:local -- --file 001   # one file, by prefix
 *   npm run db:seed:local -- --verify     # print row counts afterwards
 *
 * Seeds are development fixtures, not migrations: they are all idempotent
 * (`INSERT OR IGNORE` on fixed ids), so running them twice changes nothing.
 * `scripts/db-reset.mjs` is the way to get back to a pristine database.
 */
import process from 'node:process';
import path from 'node:path';
import { applyMigrations, executeFile, query, seedFiles } from './lib/local-d1.mjs';

/** One statement so the read-back is a single D1 round trip. */
const kRows = `SELECT
  (SELECT COUNT(*) FROM departments) AS departments,
  (SELECT COUNT(*) FROM subjects) AS subjects,
  (SELECT COUNT(*) FROM courses) AS courses,
  (SELECT COUNT(*) FROM modules) AS modules,
  (SELECT COUNT(*) FROM lessons) AS lessons,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM enrollments) AS enrollments,
  (SELECT COUNT(*) FROM quiz_attempts) AS quiz_attempts,
  (SELECT COUNT(*) FROM certificates) AS certificates,
  (SELECT COUNT(*) FROM audit_logs) AS audit_logs`;

const args = process.argv.slice(2);

function flagValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? '';
}

const only = flagValue('--file');
const verify = args.includes('--verify');

const files = seedFiles();
if (files.length === 0) {
  console.error('No seed files found in database/seeds.');
  process.exit(1);
}

const selected = only ? files.filter((file) => path.basename(file).startsWith(only)) : files;
if (selected.length === 0) {
  console.error(`No seed file matches "${only}".`);
  process.exit(1);
}

// A missing schema is the most common reason a seed fails, and applying
// migrations is harmless when they are already applied.
console.log('Applying migrations (no-ops when already applied)…');
applyMigrations();

let failed = 0;
for (const file of selected) {
  const name = path.basename(file);
  process.stdout.write(`seeding ${name} … `);
  try {
    executeFile(file);
    console.log('ok');
  } catch (error) {
    failed += 1;
    console.log('FAILED');
    console.error(String(error.message).split('\n').slice(0, 20).join('\n'));
  }
}

if (verify && failed === 0) {
  const counts = query(kRows);
  if (!counts) {
    console.log('\nCould not read back row counts (wrangler --json returned nothing).');
  } else {
    console.log('\nrow counts');
    for (const [table, total] of Object.entries(counts[0] ?? {})) {
      console.log(`  ${table.padEnd(22)} ${total}`);
    }
  }
}

if (failed) {
  console.error(`\n${failed} seed file(s) failed.`);
  process.exit(1);
}

console.log(
  `\n${selected.length} seed file(s) applied. Sign in with the demo accounts from ` +
    'database/seeds/004_demo_users.sql (they are development-only credentials).',
);
