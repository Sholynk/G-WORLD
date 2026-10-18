#!/usr/bin/env node
/**
 * Sholynk Tech — frontend smoke test (page-level pass).
 *
 *   npm run dev          # API on :8787 + site on :5173
 *   npm run test:web     # everything
 *   npm run test:web:reader   # public pages only
 *   npm run test:web:admin    # sign-in + dashboard only
 *
 * Talks to the dev server exactly like a browser would: one origin, relative
 * URLs, cookies. It asserts the things a broken deploy would show immediately:
 * every page answers, the SSR article route renders from live data, legacy
 * links redirect, generated SEO files come from the database, the /api proxy
 * works, static assets ship, and the dashboard is reachable only through a
 * session.
 *
 * Exit code 0 = every check passed.
 */
import process from 'node:process';

const WEB = (process.env.WEB_BASE_URL ?? 'http://127.0.0.1:5173').replace(/\/+$/, '');
const MODE = process.argv.includes('--as')
  ? process.argv[process.argv.indexOf('--as') + 1]
  : 'all';
const ADMIN = { email: 'admin@sholynk.test', password: 'AdminPassword123!' };
const SEEDED_STORY = 'the-rise-of-quantum-computing';

let passed = 0;
let failed = 0;
const failures = [];

function log(ok, label, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`\u001b[32m✓\u001b[0m ${label}${detail ? ` \u001b[90m(${detail})\u001b[0m` : ''}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`\u001b[31m✘\u001b[0m ${label}${detail ? ` \u001b[90m(${detail})\u001b[0m` : ''}`);
  }
}

function assert(condition, label, detail = '') {
  log(Boolean(condition), label, detail);
  return Boolean(condition);
}

class Jar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get(name) {
    return this.cookies.get(name);
  }
}

async function get(path, { jar } = {}) {
  const headers = jar ? { cookie: jar.header() } : {};
  const response = await fetch(`${WEB}${path}`, { headers, redirect: 'manual' });
  jar?.absorb(response);
  const text = await response.text();
  return { status: response.status, headers: response.headers, text };
}

async function main() {
  console.log(`Sholynk Tech web smoke test → ${WEB} (mode: ${MODE})\n`);

  const probe = await fetch(`${WEB}/`).then((r) => r.status).catch(() => 0);
  if (!probe) {
    console.error('The site is not reachable. Start it with `npm run dev` (API + static server + proxies).');
    process.exit(1);
  }

  const wantsReader = MODE === 'all' || MODE === 'reader';
  const wantsAdmin = MODE === 'all' || MODE === 'admin';

  if (wantsReader) {
    // --- pages ---------------------------------------------------------------
    const home = await get('/');
    assert(home.status === 200, 'the homepage answers');
    assert(home.text.includes('hero-section'), 'the homepage ships the hero slider mount point');
    assert(home.text.includes('cardsContainer'), 'the homepage ships the card grid mount point');
    assert(home.text.includes('Sholynk Tech'), 'the homepage is branded Sholynk Tech');
    assert(home.text.includes('/api/v1/subscriptions'), 'the newsletter form posts to the API proxy');
    assert(!/<script>(?![^<]*ld\+json)/.test(home.text.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')), 'the homepage has no inline scripts (CSP-safe)');

    for (const [page, marker] of [
      ['/about', 'About'],
      ['/contact', 'contactForm'],
      ['/help_&_support', 'Help'],
      ['/privacy_policy', 'Privacy'],
    ]) {
      const response = await get(page);
      assert(response.status === 200 && response.text.toLowerCase().includes(marker.toLowerCase()), `${page} answers with its content`);
    }

    // --- server-rendered article ---------------------------------------------
    const story = await get(`/articles/${SEEDED_STORY}/`);
    assert(story.status === 200, 'the seeded story renders at its clean URL');
    assert(story.text.includes('data-server-rendered="true"'), 'the story document is server-rendered');
    assert(story.text.includes('article-toc'), 'the story carries its table of contents');
    assert(story.text.includes('../../styles.css'), 'the story rewrites assets for its URL depth');
    assert(story.text.includes('engagementRoot'), 'the story mounts the engagement widgets');

    const missing = await get('/articles/definitely-not-a-story/');
    assert(missing.status === 404 && missing.text.includes('Article not found'), 'an unknown story 404s as a document');

    // --- legacy redirect -------------------------------------------------------
    const legacy = await get(`/article.html?slug=${SEEDED_STORY}`);
    assert(legacy.status === 301, 'the legacy article.html link redirects (301)');
    assert((legacy.headers.get('location') ?? '').endsWith(`/articles/${SEEDED_STORY}/`), 'the legacy redirect targets the clean URL');

    // --- generated SEO files -----------------------------------------------------
    const robots = await get('/robots.txt');
    assert(robots.status === 200 && robots.text.includes('Disallow: /admin/'), 'robots.txt is generated with the admin exclusion');
    assert(robots.text.includes(`Sitemap: ${WEB}/sitemap.xml`), 'robots.txt advertises the sitemap for this origin');

    const sitemap = await get('/sitemap.xml');
    assert(sitemap.status === 200 && sitemap.text.includes('<urlset'), 'sitemap.xml is generated');
    assert(sitemap.text.includes(`/articles/${SEEDED_STORY}/`), 'the sitemap lists live articles');

    // --- API proxy -----------------------------------------------------------------
    const health = await get('/api/v1/health');
    const healthJson = JSON.parse(health.text || '{}');
    assert(health.status === 200 && healthJson.success === true, 'the /api proxy reaches the worker');

    const articles = await get('/api/v1/articles');
    const articlesJson = JSON.parse(articles.text || '{}');
    assert(Array.isArray(articlesJson.data) && articlesJson.data.length >= 50, 'the proxied article list carries the catalogue', `${articlesJson.data?.length ?? 0} articles`);

    const settings = JSON.parse((await get('/api/v1/settings')).text || '{}');
    assert(settings.data?.siteTitle?.startsWith('Sholynk Tech'), 'the proxied settings are live');

    // --- static assets ---------------------------------------------------------------
    const stylesheet = await get('/styles.css');
    assert(stylesheet.status === 200 && stylesheet.headers.get('content-type')?.includes('text/css'), 'the stylesheet ships');
    const logo = await get('/assets/brand/page_logo.png');
    assert(logo.status === 200 && logo.headers.get('content-type')?.includes('image/png'), 'brand assets ship');
    const cardImage = await get('/assets/cards/web-3/article_card_02.jpg');
    assert(cardImage.status === 200 && cardImage.headers.get('content-type')?.includes('image/jpeg'), 'migrated card images ship');
    const storyImage = await get('/assets/articles/quantum/quantum-computer-chandelier.jpg');
    assert(storyImage.status === 200, 'migrated story images ship');

    // --- error page ---------------------------------------------------------------------
    const notFound = await get('/this-page-does-not-exist');
    assert(notFound.status === 404 && notFound.text.includes('Error 404'), 'unknown URLs answer with the styled 404');
  }

  if (wantsAdmin) {
    // --- the dashboard shell ------------------------------------------------------------
    const adminPage = await get('/admin/');
    assert(adminPage.status === 200 && adminPage.text.includes('admin-tabs'), 'the dashboard shell loads (data requires a session)');
    assert(adminPage.text.includes('data-panel="inbox"'), 'the dashboard ships the inbox tab');
    assert(!adminPage.text.includes('adminToken'), 'the legacy admin-token field is gone');
    assert(adminPage.text.includes('signOutBtn'), 'the dashboard has a session sign-out control');

    // --- signed-out visitors cannot read editorial data --------------------------------------
    const anonymous = await get('/api/v1/admin/analytics/overview');
    assert(anonymous.status === 401, 'analytics refuse anonymous callers');

    // --- sign in through the same origin the browser uses ----------------------------------------
    const jar = new Jar();
    const loginResponse = await fetch(`${WEB}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ADMIN),
    });
    jar.absorb(loginResponse);
    assert(loginResponse.status === 200, 'the login page endpoint signs the admin in');
    assert(Boolean(jar.get('sk_session')), 'the session cookie is set through the proxy');

    const overview = await get('/api/v1/admin/analytics/overview?days=7', { jar });
    const overviewJson = JSON.parse(overview.text || '{}');
    assert(overview.status === 200 && overviewJson.data?.totals?.articles >= 56, 'the signed-in dashboard reads analytics', `articles=${overviewJson.data?.totals?.articles ?? '?'}`);

    const allArticles = await get('/api/v1/articles?status=all', { jar });
    assert(JSON.parse(allArticles.text || '{}').data?.length >= 56, 'the signed-in article manager lists every status');

    // CSRF: a cookie-bearing unsafe request without the header is refused
    const noCsrf = await fetch(`${WEB}/api/v1/admin/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: jar.header() },
      body: JSON.stringify({ homeTagline: 'should not stick' }),
    });
    assert(noCsrf.status === 403, 'the double-submit CSRF guard protects mutations');

    // with the header it works — write the same tagline back so nothing changes
    const settingsNow = JSON.parse((await get('/api/v1/settings', { jar })).text || '{}');
    const withCsrf = await fetch(`${WEB}/api/v1/admin/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: jar.header(), 'x-csrf-token': jar.get('sk_csrf') ?? '' },
      body: JSON.stringify({ homeTagline: settingsNow.data?.homeTagline ?? '' }),
    });
    assert(withCsrf.status === 200, 'the dashboard can save settings with its CSRF token');

    const logout = await fetch(`${WEB}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: jar.header(), 'x-csrf-token': jar.get('sk_csrf') ?? '' },
    });
    jar.absorb(logout);
    assert(logout.status === 200, 'sign-out succeeds through the proxy');

    const afterLogout = await get('/api/v1/auth/me', { jar });
    assert(afterLogout.status === 401, 'the revoked session no longer authenticates');

    // --- the login page ships ------------------------------------------------------------------
    const loginPage = await get('/login.html');
    assert(loginPage.status === 200 && loginPage.text.includes('loginForm'), 'the login page ships');
    const resetPage = await get('/reset.html');
    assert(resetPage.status === 200 && resetPage.text.includes('forgotForm'), 'the recovery page ships');
  }

  console.log(`\n${failed === 0 ? '\u001b[32m' : '\u001b[31m'}web smoke test: ${passed} passed, ${failed} failed\u001b[0m`);
  if (failed) {
    console.log('failed checks:');
    for (const label of failures) console.log(`  · ${label}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('\nweb smoke test crashed:', error);
  process.exit(1);
});
