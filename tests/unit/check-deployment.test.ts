/**
 * `scripts/check-deployment.mjs` is the step that decides whether a deploy
 * actually worked, so it is tested against a real HTTP server rather than a
 * mock: the point is that it reads the readiness *body* — which stays HTTP 200
 * when the deployment is degraded — and turns it into a failing exit code.
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

// `execFile` (async) rather than `spawnSync`: the stub server lives in this
// process, and a synchronous spawn would block the event loop that has to answer
// the child's request.
const execFileAsync = promisify(execFile);

const SCRIPT = path.join(path.resolve(process.cwd()), 'scripts/check-deployment.mjs');

let server: Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

/** Serves the given payloads in order (the last one repeats). */
async function serve(payloads: unknown[], status = 200): Promise<string> {
  let call = 0;
  server = createServer((_request, response) => {
    const payload = payloads[Math.min(call, payloads.length - 1)];
    call += 1;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function run(
  base: string,
  { attempts = 1, delayMs = 0, flags = [] }: { attempts?: number; delayMs?: number; flags?: string[] } = {},
) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCRIPT, '--base-url', base, '--attempts', String(attempts), '--delay-ms', String(delayMs), ...flags],
      { timeout: 20_000 },
    );
    return { code: 0, stdout, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

const ready = {
  success: true,
  data: {
    status: 'ready',
    database: { reachable: true, migrations_applied: true, articles: 56 },
    config_problems: [],
    checks: { session_secret_configured: true },
  },
};

const degraded = {
  success: true,
  data: {
    status: 'degraded',
    database: {
      reachable: true,
      migrations_applied: false,
      articles: 56,
      missing_schema: ['table owner_enrollment (0008_owner_setup.sql)'],
    },
    config_problems: [],
  },
};

describe('a healthy deployment passes', () => {
  it('exits 0 and reports the article count', async () => {
    const { code, output } = await run(await serve([ready]));
    expect(code).toBe(0);
    expect(output).toContain('is ready');
    expect(output).toContain('56 article(s)');
  });
});

describe('a degraded deployment fails, and says why', () => {
  it('exits 1 and names the missing schema object', async () => {
    const { code, output } = await run(await serve([degraded]));
    expect(code).toBe(1);
    expect(output).toContain('not ready');
    expect(output).toContain('missing schema: table owner_enrollment (0008_owner_setup.sql)');
    expect(output).toContain('migrations_applied is false');
  });

  it('exits 1 when the configuration is incomplete', async () => {
    const incomplete = {
      success: true,
      data: {
        status: 'degraded',
        database: { reachable: true, migrations_applied: true, articles: 56 },
        config_problems: ['SESSION_SECRET is not configured'],
      },
    };
    const { code, output } = await run(await serve([incomplete]));
    expect(code).toBe(1);
    expect(output).toContain('config: SESSION_SECRET is not configured');
  });

  it('exits 1 on a non-200 response', async () => {
    const { code, output } = await run(await serve([{ success: false }], 502));
    expect(code).toBe(1);
    expect(output).toContain('HTTP 502');
  });

  it('emits machine-readable output with --json', async () => {
    const { code, stdout } = await run(await serve([degraded]), { flags: ['--json'] });
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.ready).toBe(false);
    expect(parsed.problems).toContain('status is "degraded"');
  });
});

describe('a deployment that is still coming up is retried', () => {
  it('succeeds when the second attempt is ready', async () => {
    const base = await serve([degraded, ready]);
    const { code, output } = await run(base, { attempts: 3, delayMs: 10 });
    expect(code).toBe(0);
    expect(output).toContain('attempt 1/3: not ready');
  });
});
