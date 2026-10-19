#!/usr/bin/env node
/** Operator-only owner bootstrap. Never provisions a known/default password. */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ROOT, CONFIG_REL, DB_NAME, runWrangler } from './lib/local-d1.mjs';
import { OWNER_EMAIL, ownerEnrollmentSql, validateOwnerOrigin } from './lib/owner-bootstrap.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run owner:provision -- --local --origin http://localhost:5173\nProduction: npm run owner:provision -- --remote --confirm-production --origin https://YOUR-SITE\nApply migrations first. Configure APP_BASE_URL and real email delivery. No password/code is accepted or printed.');
    return;
  }
  const remote = args.includes('--remote');
  if (remote === args.includes('--local')) throw new Error('Specify exactly one of --local or --remote.');
  if (remote && !args.includes('--confirm-production')) throw new Error('Remote provisioning requires --confirm-production. Review the deployment guide first.');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--origin') { i++; continue; }
    if (!['--local', '--remote', '--confirm-production'].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`);
  }
  const originIndex = args.indexOf('--origin');
  if (originIndex < 0 || !args[originIndex + 1]) throw new Error('--origin is required.');
  const origin = validateOwnerOrigin(args[originIndex + 1], remote);
  const target = [remote ? '--remote' : '--local', '--config', CONFIG_REL, ...(remote ? ['--env', 'production'] : [])];
  const state = runWrangler(['d1', 'execute', DB_NAME, ...target, '--json', '--command',
    `SELECT (SELECT COUNT(*) FROM site_owner) AS owners, (SELECT COUNT(*) FROM owner_enrollment) AS enrollments, (SELECT COUNT(*) FROM users WHERE email = '${OWNER_EMAIL}') AS reserved_accounts;`], { capture: true });
  const parsed = JSON.parse(state.stdout);
  const row = parsed[0]?.results?.[0];
  if (!row) throw new Error('Could not read owner setup state. No account was changed.');
  if (row.owners) {
    console.log('Owner setup is already complete. No account or credentials were changed.');
    return;
  }
  if (!row.enrollments) {
    if (row.reserved_accounts) throw new Error('The reserved email already belongs to an account. Operator review is required; this command will not overwrite or promote it.');
    mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
    const directory = mkdtempSync(path.join(ROOT, 'tmp', 'owner-enrollment-'));
    try {
      const file = path.join(directory, 'enrollment.sql');
      writeFileSync(file, ownerEnrollmentSql(), { mode: 0o600 });
      runWrangler(['d1', 'execute', DB_NAME, ...target, '--file', file], { capture: true });
    } finally { rmSync(directory, { recursive: true, force: true }); }
    console.log('Reserved owner enrollment created. No usable password was printed or stored in source control.');
  } else {
    console.log('Existing pending enrollment retained. Requesting another setup email does not invalidate earlier unexpired links.');
  }
  const response = await fetch(`${origin}/api/v1/auth/owner/setup/request`, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? 'Could not request the setup email. Enrollment remains safe; correct email/API configuration and rerun.');
  console.log(`Setup email requested for ${OWNER_EMAIL}. Check that inbox. The link expires in one hour.`);
  console.log('If no email arrives, verify the website points to this same Worker/D1 environment. Public registration remains unchanged.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
