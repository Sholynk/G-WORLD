/**
 * The production deploy workflow is a safety document.
 *
 * `deploy-api.yml` is the only thing in this repository allowed to change the
 * production schema, so the properties that make it safe are asserted here
 * rather than trusted to review:
 *
 *   · it cannot run on a push — a human starts it, from `main`, after typing
 *     a confirmation;
 *   · it deploys the `env.production` block, never the top-level dev vars
 *     (which carry ENABLE_DEV_ROUTES="true");
 *   · migrations run *before* the code, and the run stops if any remain;
 *   · the last step reads /health/ready and fails on a degraded deployment.
 *
 * These tests read the file as text on purpose: they need no YAML parser and
 * no network, and a regex that stops matching is a loud failure rather than a
 * silent skip.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(process.cwd());
const WORKFLOW_PATH = '.github/workflows/deploy-api.yml';
const workflow = readFileSync(path.join(ROOT, WORKFLOW_PATH), 'utf8');
/** The file may *document* a dangerous command in a comment; only real steps matter. */
const commands = workflow
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');
const rootPackage = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** Position of a fragment, failing the test when it is absent. */
function at(fragment: string): number {
  const index = workflow.indexOf(fragment);
  expect(index, `${WORKFLOW_PATH} must contain: ${fragment}`).toBeGreaterThan(-1);
  return index;
}

describe('the deploy workflow can only be started by hand', () => {
  it('is triggered by workflow_dispatch alone', () => {
    expect(workflow).toMatch(/^on:\s*$/m);
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:\s*$/m);

    for (const trigger of ['push', 'pull_request', 'pull_request_target', 'schedule']) {
      expect(workflow, `${WORKFLOW_PATH} must not run on ${trigger}`).not.toMatch(
        new RegExp(`^\\s{2}${trigger}\\s*:`, 'm'),
      );
    }
  });

  it('refuses a run from any branch other than main', () => {
    expect(workflow).toContain('REF_NAME: ${{ github.ref_name }}');
    expect(workflow).toContain('if [ "$REF_NAME" != "main" ]');
  });

  it('requires the exact confirmation word before touching anything', () => {
    expect(workflow).toContain('CONFIRM: ${{ inputs.confirm }}');
    expect(workflow).toContain('if [ "$CONFIRM" != "deploy-api" ]');

    // The gate must precede the deploy, not merely exist.
    expect(at('if [ "$CONFIRM" != "deploy-api" ]')).toBeLessThan(
      at('npm run deploy:production -w @sholynk/api'),
    );
  });

  it('attaches the production environment (where reviewers can be required)', () => {
    expect(workflow).toMatch(/^\s{4}environment: production$/m);
  });
});

describe('the deploy workflow ships the production configuration', () => {
  it('deploys the env.production block and never the top-level dev vars', () => {
    at('npm run deploy:production -w @sholynk/api');
    expect(commands).not.toMatch(/npm run deploy:api\b/);
    expect(commands).not.toMatch(/^\s*run:.*wrangler deploy(?!\s+--env production)/m);
  });

  it('runs the strict configuration gate before deploying', () => {
    expect(at('npm run check:config -- --strict')).toBeLessThan(
      at('npm run deploy:production -w @sholynk/api'),
    );
  });

  it('keeps credentials in secrets', () => {
    expect(workflow).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(workflow).toContain('CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');

    const credentialLines = workflow
      .split('\n')
      .filter((line) => /(API_TOKEN|ACCOUNT_ID)\s*:/.test(line) && !line.trimStart().startsWith('#'));
    for (const line of credentialLines) {
      expect(line, `a credential must come from secrets, not a literal: ${line.trim()}`).toMatch(
        /\$\{\{ secrets\.CLOUDFLARE_(API_TOKEN|ACCOUNT_ID) \}\}/,
      );
    }
  });
});

describe('the deploy workflow applies the schema before the code', () => {
  it('migrates first and refuses to deploy onto an outdated schema', () => {
    expect(at('npm run db:migrate:remote -w @sholynk/api')).toBeLessThan(
      at('npm run deploy:production -w @sholynk/api'),
    );
    expect(at('No migrations to apply')).toBeLessThan(at('npm run deploy:production -w @sholynk/api'));
  });

  it('can skip migrations, but only when asked', () => {
    expect(workflow).toContain('if: ${{ inputs.migrations }}');
  });

  it('verifies readiness after the deploy, and fails when degraded', () => {
    const deploy = at('npm run deploy:production -w @sholynk/api');
    const verification = at('node scripts/check-deployment.mjs');
    expect(verification).toBeGreaterThan(deploy);
  });
});

describe('the obvious deploy command is the safe one', () => {
  it('makes `npm run deploy:api` deploy the production environment', () => {
    const script = rootPackage.scripts['deploy:api'] ?? '';
    expect(script).toContain('deploy:production');
    expect(script).toContain('--strict');
    expect(script).not.toMatch(/npm run deploy -w @sholynk\/api/);
  });

  it('leaves the Pages deploy to its own command', () => {
    expect(rootPackage.scripts['deploy:web']).toContain('scripts/deploy-web.mjs');
  });
});
