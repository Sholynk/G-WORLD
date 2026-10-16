/**
 * Integration tests — the running API over HTTP.
 *
 *   npm run test:integration
 *
 * Start the API first (`npm run dev:api`); if it is not reachable every suite
 * here skips itself with a message, so a clean checkout does not fail `npm test`
 * for the wrong reason. Everything asserted below is read-only (a sign-in and a
 * sign-out, which create and revoke one session row) so the suite can run
 * against a seeded database repeatedly.
 *
 * For the destructive, state-changing pass use `npm run test:smoke`.
 */
import { describe, expect, it } from 'vitest';

const API_ORIGIN = (process.env.API_BASE_URL ?? process.env.API_TARGET ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const BASE = `${API_ORIGIN}/api/v1`;

const DEMO_STUDENT = { email: 'student@gworld.test', password: 'StudentPassword123!' };

/** Minimal cookie jar: keeps `Set-Cookie` values and echoes them back. */
class Jar {
  private cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  value(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

interface CallOptions {
  method?: string;
  body?: unknown;
  jar?: Jar;
  csrf?: string;
}

async function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.jar) headers.cookie = options.jar.header();
  if (options.csrf) headers['x-csrf-token'] = options.csrf;

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  options.jar?.absorb(response);
  return response;
}

/** Unwraps `{ success, data }` and fails loudly on an error envelope. */
async function dataOf<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { success: boolean; data?: T; error?: { code: string; message: string } };
  if (!body.success) throw new Error(`API error ${body.error?.code}: ${body.error?.message}`);
  return body.data as T;
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json()) as { error?: { code: string; message: string } };
  return body.error ?? { code: 'NONE', message: 'no error envelope' };
}

/**
 * Reachability is resolved *now*, at collection time, because `describe.skipIf`
 * is evaluated while the file is being collected — a `beforeAll` hook would run
 * too late and silently skip everything.
 */
const reachable = await (async () => {
  try {
    const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
  } catch {
    return false;
  }

  // The failed-sign-in checks below count toward the per-account lockout. In
  // development the API exposes a route that clears the rate-limit windows so
  // repeated runs of this suite cannot lock the demo student out; in production
  // it does not exist and the call simply fails, which is fine.
  try {
    await fetch(`${BASE}/auth/dev/reset-limits`, { method: 'POST', signal: AbortSignal.timeout(3000) });
  } catch {
    /* development-only convenience */
  }
  return true;
})();

if (!reachable) {
  console.warn(
    `\n[integration] no API at ${BASE} — skipping. Start one with: npm run dev:api\n`,
  );
}

describe.skipIf(!reachable)('health', () => {
  it('reports itself healthy', async () => {
    const response = await call('/health');
    expect(response.status).toBe(200);
    const data = await dataOf<{ status: string; service: string; environment: string; started_at: string }>(response);
    expect(data.status).toBe('ok');
    expect(data.service).toBe('g-world-api');
    expect(data.environment).toBeTruthy();
    expect(Number.isNaN(Date.parse(data.started_at))).toBe(false);
  });

  it('is ready, with a reachable database and no configuration problems', async () => {
    const response = await call('/health/ready');
    expect(response.status).toBe(200);
    const data = await dataOf<{
      status: string;
      database: { reachable: boolean; migrations_applied: boolean };
      config_problems: string[];
    }>(response);
    expect(data.status).toBe('ready');
    expect(data.database.reachable).toBe(true);
    expect(data.database.migrations_applied).toBe(true);
    expect(data.config_problems).toEqual([]);
  });

  it('advertises the API version and features via /meta', async () => {
    const response = await call('/meta');
    expect(response.status).toBe(200);
    const data = await dataOf<{ name: string; api_version: string; features: Record<string, boolean> }>(response);
    expect(data.name).toBe('G WORLD');
    expect(data.api_version).toBe('v1');
    expect(typeof data.features.registration).toBe('boolean');
  });
});

describe.skipIf(!reachable)('public catalog', () => {
  it('returns a paginated list of published courses', async () => {
    const response = await call('/courses?per_page=5');
    expect(response.status).toBe(200);
    const data = await dataOf<{
      items: { id: string; slug: string; title: string }[];
      pagination: { page: number; per_page: number; total: number; total_pages: number };
    }>(response);

    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeLessThanOrEqual(5);
    expect(data.pagination.page).toBe(1);
    expect(data.pagination.per_page).toBe(5);
    for (const course of data.items) {
      expect(course.id).toMatch(/^crs_/);
      expect(course.slug).toMatch(/^[a-z0-9-]+$/);
      expect(course.title.length).toBeGreaterThan(0);
    }
  });

  it('never exposes an unpublished course in the public list', async () => {
    const response = await call('/courses?per_page=100');
    const data = await dataOf<{ items: { status?: string }[] }>(response);
    for (const course of data.items) {
      if (course.status) expect(course.status).toBe('published');
    }
  });

  it('serves departments as a bare array', async () => {
    const response = await call('/departments');
    expect(response.status).toBe(200);
    const data = await dataOf<{ id: string; name: string; slug: string }[]>(response);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    for (const department of data) {
      expect(department.id).toMatch(/^dep_/);
      expect(department.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('searches and reports how many results matched', async () => {
    const response = await call('/search?q=html');
    expect(response.status).toBe(200);
    const data = await dataOf<{ query: string; items: unknown[]; total: number }>(response);
    expect(data.query).toBe('html');
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a search term that is too short', async () => {
    const response = await call('/search?q=a');
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 404 with an error envelope for an unknown course', async () => {
    const response = await call('/courses/definitely-not-a-course');
    expect(response.status).toBe(404);
    const error = await errorOf(response);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).not.toMatch(/SQL|D1|stack/i);
  });
});

describe.skipIf(!reachable)('authorisation boundary', () => {
  it('refuses anonymous access to the learner area', async () => {
    const response = await call('/me');
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
  });

  it('refuses anonymous access to admin routes', async () => {
    const response = await call('/admin/students');
    expect([401, 403]).toContain(response.status);
  });

  it('refuses anonymous access to a quiz', async () => {
    const response = await call('/quizzes/qz_js_fetch');
    expect(response.status).toBe(401);
  });

  it('signs a student in, then out', async () => {
    const jar = new Jar();

    const login = await call('/auth/login', { method: 'POST', body: DEMO_STUDENT, jar });
    expect(login.status).toBe(200);
    const session = await dataOf<{ user: { id: string; email: string; role: string }; session: { expires_in_seconds: number } }>(
      login,
    );
    expect(session.user.email).toBe(DEMO_STUDENT.email);
    expect(session.user.role).toBe('student');
    expect(session.session.expires_in_seconds).toBeGreaterThan(0);
    expect(jar.value('gw_session')).toBeTruthy();

    // Permissions are resolved per request (they can change server-side at any
    // moment), so they come from /me rather than being cached in the cookie.
    const me = await call('/me', { jar });
    expect(me.status).toBe(200);
    const identity = await dataOf<{ user: { email: string; role: string }; permissions: string[] }>(me);
    expect(identity.user.email).toBe(DEMO_STUDENT.email);
    expect(identity.permissions.length).toBeGreaterThan(0);
    expect(identity.permissions).not.toContain('user.role.write');

    const logout = await call('/auth/logout', { method: 'POST', body: {}, jar, csrf: jar.value('gw_csrf') });
    expect(logout.status).toBe(200);

    // The session cookie is gone from the jar's perspective only after the
    // response; the API must reject the old cookie regardless.
    const after = await call('/me', { jar });
    expect(after.status).toBe(401);
  });

  it('requires the CSRF header for an authenticated state change', async () => {
    const jar = new Jar();
    await call('/auth/login', { method: 'POST', body: DEMO_STUDENT, jar });

    const withoutToken = await call('/me/profile', {
      method: 'PATCH',
      body: { full_name: 'Should never be saved' },
      jar,
    });
    expect(withoutToken.status).toBe(403);
    expect((await errorOf(withoutToken)).message).toMatch(/csrf/i);

    await call('/auth/logout', { method: 'POST', body: {}, jar, csrf: jar.value('gw_csrf') });
  });

  it('stops a student from reaching an administrator endpoint', async () => {
    const jar = new Jar();
    await call('/auth/login', { method: 'POST', body: DEMO_STUDENT, jar });

    const response = await call('/admin/students', { jar });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('FORBIDDEN');

    await call('/auth/logout', { method: 'POST', body: {}, jar, csrf: jar.value('gw_csrf') });
  });

  it('rejects a bad password without revealing whether the account exists', async () => {
    const wrongPassword = await call('/auth/login', {
      method: 'POST',
      body: { email: DEMO_STUDENT.email, password: 'DefinitelyNotThePassword1' },
    });
    const unknownAccount = await call('/auth/login', {
      method: 'POST',
      body: { email: 'nobody@gworld.test', password: 'DefinitelyNotThePassword1' },
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    // Identical envelopes: no account enumeration through messages or codes.
    expect((await errorOf(unknownAccount)).code).toBe((await errorOf(wrongPassword)).code);
  });
});
