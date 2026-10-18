/**
 * Integration tests — the running API over HTTP.
 *
 *   npm run dev:api && npm run db:reset:local && npm run test:integration
 *
 * If the API is not reachable every suite here skips itself with a message, so
 * a clean checkout does not fail `npm test` for the wrong reason. Assertions
 * are read-only (plus one sign-in/sign-out pair, which creates and revokes a
 * single session row) so the suite can run against a seeded database
 * repeatedly. For the destructive, state-changing pass use `npm run test:smoke`.
 */
import { describe, expect, it } from 'vitest';

const API_ORIGIN = (process.env.API_BASE_URL ?? process.env.API_TARGET ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const BASE = `${API_ORIGIN}/api/v1`;

const DEMO_ADMIN = { email: 'admin@sholynk.test', password: 'AdminPassword123!' };
const SEEDED_STORY = 'the-rise-of-quantum-computing';

/** Minimal cookie jar: keeps `Set-Cookie` values and echoes them back. */
class Jar {
  private cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair!.indexOf('=');
      if (index > 0) this.cookies.set(pair!.slice(0, index).trim(), pair!.slice(index + 1).trim());
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
  const body = (await response.json()) as {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
  };
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
let reachable = false;
try {
  const probe = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
  reachable = probe.ok;
} catch {
  reachable = false;
}

describe.skipIf(!reachable)('health and metadata', () => {
  it('answers liveness without touching the database', async () => {
    const response = await call('/health');
    expect(response.status).toBe(200);
    const data = await dataOf<{ status: string; service: string }>(response);
    expect(data.status).toBe('ok');
    expect(data.service).toBe('sholynk-tech-api');
  });

  it('reports readiness against a migrated, seeded database', async () => {
    const response = await call('/health/ready');
    const data = await dataOf<{
      status: string;
      database: { reachable: boolean; migrations_applied: boolean; articles: number };
      config_problems: string[];
    }>(response);
    expect(data.database.reachable).toBe(true);
    expect(data.database.migrations_applied).toBe(true);
    expect(data.database.articles).toBeGreaterThanOrEqual(56);
    expect(data.config_problems).toEqual([]);
  });
});

describe.skipIf(!reachable)('public content surface', () => {
  it('lists published articles in the legacy DTO shape', async () => {
    const response = await call('/articles');
    expect(response.status).toBe(200);
    const articles = await dataOf<
      { slug: string; title: string; category: string; status: string; link: string; cleanLink: string; date: string }[]
    >(response);
    expect(articles.length).toBeGreaterThanOrEqual(50);
    for (const article of articles) {
      expect(article.status).toBe('published');
      expect(article.link).toBeTruthy();
    }
    const story = articles.find((article) => article.slug === SEEDED_STORY);
    expect(story, 'the seeded long-form story must be listed').toBeDefined();
    expect(story!.cleanLink).toBe(`articles/${SEEDED_STORY}/`);
  });

  it('filters by hero placement, category and search', async () => {
    const heroes = await dataOf<{ hero: boolean }[]>(await call('/articles?hero=true'));
    expect(heroes.length).toBeGreaterThanOrEqual(4);
    expect(heroes.every((article) => article.hero)).toBe(true);

    const gameCategory = await dataOf<{ category: string }[]>(await call('/articles?category=Game'));
    expect(gameCategory.length).toBeGreaterThan(0);
    expect(gameCategory.every((article) => article.category === 'Game')).toBe(true);

    const search = await dataOf<{ title: string; description: string }[]>(await call('/articles?q=quantum'));
    expect(search.length).toBeGreaterThan(0);
  });

  it('serves a single article with its body and sources', async () => {
    const article = await dataOf<{
      slug: string;
      body: string;
      sources: { url: string }[];
      authorSlug: string;
      keyTakeaways: string[];
    }>(await call(`/articles/${SEEDED_STORY}`));
    expect(article.slug).toBe(SEEDED_STORY);
    expect(article.body.length).toBeGreaterThan(1000);
    expect(article.authorSlug).toBe('oluwashola-busari');
    expect(Array.isArray(article.sources)).toBe(true);
  });

  it('404s unknown slugs inside the standard envelope', async () => {
    const response = await call('/articles/definitely-not-a-real-story');
    expect(response.status).toBe(404);
    const error = await errorOf(response);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Article not found');
  });

  it('exposes categories, authors and settings', async () => {
    const categories = await dataOf<string[]>(await call('/articles/categories'));
    expect(categories).toEqual(expect.arrayContaining(['Technology', 'AI Trends', 'Cryptocurrency', 'Game', 'Web 3']));

    const authors = await dataOf<{ slug: string; name: string; image: string }[]>(await call('/authors'));
    const house = authors.find((author) => author.slug === 'oluwashola-busari');
    expect(house).toBeDefined();
    expect(house!.image).toBe('assets/brand/my_pic.png');

    const settings = await dataOf<Record<string, string>>(await call('/settings'));
    expect(settings.siteTitle).toBe('Sholynk Tech - AI, Web3 and Emerging Tech Insights');
  });

  it('hides unpublished states behind a session', async () => {
    const response = await call('/articles?status=all');
    expect(response.status).toBe(401);
    const error = await errorOf(response);
    expect(error.code).toBe('UNAUTHENTICATED');
  });

  it('reads engagement for an anonymous voter', async () => {
    const summary = await dataOf<{
      reactions: { likes: number; dislikes: number; mine: string | null };
      comments: unknown[];
    }>(await call(`/articles/${SEEDED_STORY}/engagement?voterId=integration-tester`));
    expect(summary.reactions).toMatchObject({ likes: expect.any(Number), dislikes: expect.any(Number) });
    expect(Array.isArray(summary.comments)).toBe(true);
  });
});

describe.skipIf(!reachable)('server-rendered documents', () => {
  it('renders the clean article URL as a full HTML document', async () => {
    const response = await call(`/render/articles/${SEEDED_STORY}?origin=${encodeURIComponent(API_ORIGIN)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('data-server-rendered="true"');
    expect(html).toContain(`<link rel="canonical" href="${API_ORIGIN}/articles/${SEEDED_STORY}/" />`);
    expect(html).toContain('application/ld+json');
    // Document routes swap the JSON CSP for the page policy (parity with _headers).
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('404s an unknown story as plain text, like the legacy server', async () => {
    const response = await call('/render/articles/no-such-story?origin=' + encodeURIComponent(API_ORIGIN));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Article not found');
  });

  it('redirects legacy article.html links to the clean URL', async () => {
    const response = await call(
      `/render/legacy-article?slug=${SEEDED_STORY}&origin=${encodeURIComponent(API_ORIGIN)}`,
    );
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`/articles/${SEEDED_STORY}/`);
  });

  it('generates robots.txt and sitemap.xml from live data', async () => {
    const robots = await call(`/seo/robots.txt?origin=${encodeURIComponent(API_ORIGIN)}`);
    expect(robots.status).toBe(200);
    const robotsText = await robots.text();
    expect(robotsText).toContain('Disallow: /admin/');
    expect(robotsText).toContain(`Sitemap: ${API_ORIGIN}/sitemap.xml`);

    const sitemap = await call(`/seo/sitemap.xml?origin=${encodeURIComponent(API_ORIGIN)}`);
    expect(sitemap.status).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain('<urlset');
    expect(xml).toContain(`${API_ORIGIN}/articles/${SEEDED_STORY}/`);
    // Card-only entries (no body) are excluded, exactly like the legacy sitemap.
    expect(xml).not.toContain('/articles/web3-and-the-future-of-the-internet/');
  });
});

describe.skipIf(!reachable)('session auth and the admin boundary', () => {
  it('signs the seeded administrator in and out', async () => {
    const jar = new Jar();

    const login = await call('/auth/login', { method: 'POST', body: DEMO_ADMIN, jar });
    expect(login.status).toBe(200);
    const session = await dataOf<{ user: { email: string; role: string } }>(login);
    expect(session.user.email).toBe(DEMO_ADMIN.email);
    expect(session.user.role).toBe('super_admin');
    expect(jar.value('sk_session')).toBeTruthy();
    expect(jar.value('sk_csrf')).toBeTruthy();

    const me = await dataOf<{ user: { email: string }; permissions: string[] }>(await call('/auth/me', { jar }));
    expect(me.user.email).toBe(DEMO_ADMIN.email);
    expect(me.permissions).toContain('article.write');

    // Editorial reads unlock with the session.
    const all = await dataOf<unknown[]>(await call('/articles?status=all', { jar }));
    expect(all.length).toBeGreaterThanOrEqual(56);

    const overview = await dataOf<{ totals: { articles: number; published: number } }>(
      await call('/admin/analytics/overview?days=7', { jar }),
    );
    expect(overview.totals.articles).toBeGreaterThanOrEqual(56);
    expect(overview.totals.published).toBeGreaterThanOrEqual(56);

    const logout = await call('/auth/logout', { method: 'POST', jar, csrf: jar.value('sk_csrf') });
    expect(logout.status).toBe(200);

    const afterLogout = await call('/auth/me', { jar });
    expect(afterLogout.status).toBe(401);
  });

  it('rejects wrong passwords inside the envelope', async () => {
    const response = await call('/auth/login', {
      method: 'POST',
      body: { email: DEMO_ADMIN.email, password: 'wrong-password' },
    });
    expect(response.status).toBe(401);
    const error = await errorOf(response);
    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(error.message).toBe('Email or password is incorrect');
  });

  it('guards the admin subtree for anonymous callers', async () => {
    expect((await call('/admin/analytics/overview')).status).toBe(401);
    expect((await call('/admin/comments')).status).toBe(401);
    expect((await call('/admin/subscriptions')).status).toBe(401);
  });

  it('refuses unsafe methods that carry a session cookie but no CSRF token', async () => {
    const jar = new Jar();
    const login = await call('/auth/login', { method: 'POST', body: DEMO_ADMIN, jar });
    expect(login.status).toBe(200);

    const withoutCsrf = await call('/admin/settings', {
      method: 'PUT',
      body: { siteTitle: 'hijacked' },
      jar,
    });
    expect(withoutCsrf.status).toBe(403);
    const error = await errorOf(withoutCsrf);
    expect(error.message).toMatch(/CSRF/i);

    const withCsrf = await call('/admin/settings', {
      method: 'PUT',
      body: { siteTitle: 'Sholynk Tech - AI, Web3 and Emerging Tech Insights' },
      jar,
      csrf: jar.value('sk_csrf'),
    });
    // Same value as the seed → a no-op write that proves the guard passed.
    expect([200, 422]).toContain(withCsrf.status);

    await call('/auth/logout', { method: 'POST', jar, csrf: jar.value('sk_csrf') });
  });
});
