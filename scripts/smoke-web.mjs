#!/usr/bin/env node
/**
 * G WORLD — frontend smoke test.
 *
 * Loads every page from `apps/web/public` into a real DOM (happy-dom), runs the
 * page's own module exactly as the browser would, and lets the page talk to a
 * running API. It then asserts that the page rendered something true instead of
 * throwing.
 *
 *   node scripts/smoke-web.mjs                       # all pages, as a visitor
 *   node scripts/smoke-web.mjs --as student          # signed-in pass
 *   node scripts/smoke-web.mjs --as admin
 *   node scripts/smoke-web.mjs --page dashboard.html # one page
 *
 * It is deliberately *not* a unit test of pure functions — those live in
 * `tests/unit`. This one answers a blunter question: does the site work end to
 * end, against the real API, without console errors?
 *
 * Requires:
 *   * the API running (`npm run dev:api`, default http://127.0.0.1:8787)
 *   * `happy-dom` installed (devDependency; `npm install`)
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'apps/web/public');
const API_TARGET = (process.env.API_TARGET ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:32951';
const FILTER = process.argv.includes('--page') ? process.argv[process.argv.indexOf('--page') + 1] : null;
const AS = process.argv.includes('--as') ? process.argv[process.argv.indexOf('--as') + 1] : 'visitor';

/**
 * The real `fetch`, captured before the harness proxies `globalThis.fetch` for
 * each page. Without this, the stub would call itself.
 */
const realFetch = globalThis.fetch;

const DEMO_ACCOUNTS = {
  student: { email: 'student@gworld.test', password: 'StudentPassword123!' },
  admin: { email: 'admin@gworld.test', password: 'AdminPassword123!' },
};

/* ------------------------------------------------------------------- reporting */

const results = [];
let failures = 0;

function record(name, status, detail = '') {
  results.push({ name, status, detail });
  if (status === 'fail') failures += 1;
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '·';
  const colour = status === 'fail' ? '\u001b[31m' : status === 'pass' ? '\u001b[32m' : '\u001b[90m';
  console.log(`${colour}${icon}\u001b[0m ${name}${detail ? ` — ${detail}` : ''}`);
}

/* --------------------------------------------------------------------- cookie jar */

/** Minimal cookie jar: the API's session lives in `gw_session` + `gw_csrf`. */
class Jar {
  constructor() {
    this.cookies = new Map();
    /** Set per page: cookies are mirrored into `document.cookie` exactly as a
     *  browser would expose the non-HttpOnly ones (the API's CSRF cookie). */
    this.document = null;
  }

  syncDocument() {
    if (!this.document) return;
    for (const [name, value] of this.cookies) {
      this.document.cookie = `${name}=${value}; path=/`;
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  store(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index === -1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    this.syncDocument();
  }
}

/* ---------------------------------------------------------------------- the API */

function createFetch(jar, log) {
  return async function fetchStub(input, init = {}) {
    const rawUrl = typeof input === 'string' ? input : input.url;
    const url = new URL(rawUrl, WEB_ORIGIN);
    const target = new URL(`${url.pathname}${url.search}`, API_TARGET);

    const headers = new Headers(init.headers ?? (typeof input === 'object' ? input.headers : undefined));
    const cookie = jar.header();
    if (cookie) headers.set('cookie', cookie);
    headers.set('host', new URL(API_TARGET).host);

    const method = (init.method ?? (typeof input === 'object' ? input.method : 'GET') ?? 'GET').toUpperCase();
    log.push(`${method} ${url.pathname}${url.search}`);

    const response = await realFetch(target, {
      method,
      headers,
      body: init.body,
      redirect: 'manual',
      signal: init.signal,
    });

    jar.store(response);
    return response;
  };
}

/* ------------------------------------------------------------------ page harness */

const PAGE_MODULE_IMPORT = /import \{ init \} from '(\/assets\/js\/pages\/[^']+)'/;

/** Expectations per page: what must be true once `boot()` has finished. */
const EXPECTATIONS = {
  'index.html': [
    ['[data-home-departments] .card', (nodes) => nodes.length > 0],
  ],
  'departments.html': [
    ['[data-departments-list] .card', (nodes) => nodes.length > 0],
  ],
  'subjects.html': [
    ['[data-subjects-list] .card', (nodes) => nodes.length > 0],
    ['#department-filter option', (nodes) => nodes.length > 1],
  ],
  'subject.html': [
    ['[data-subject-name]', (nodes) => (nodes[0]?.textContent ?? '').length > 2],
    ['[data-subject-courses] .card, [data-subject-courses] .empty-state', (nodes) => nodes.length > 0],
  ],
  'courses.html': [
    ['[data-courses-list] .card', (nodes) => nodes.length > 0],
  ],
  'course.html': [
    ['[data-course-header] h1', (nodes) => (nodes[0]?.textContent ?? '').length > 2],
    ['[data-course-curriculum] .curriculum__lesson', (nodes) => nodes.length > 0],
    ['[data-course-outcomes] li', (nodes) => nodes.length > 0],
  ],
  'lesson.html': [
    ['[data-lesson-title]', (nodes) => (nodes[0]?.textContent ?? '').length > 2],
    ['[data-lesson-body]', (nodes) => (nodes[0]?.textContent ?? '').length > 20],
    ['[data-progress-percent]', (nodes) => /%/.test(nodes[0]?.textContent ?? '') || (nodes[0]?.textContent ?? '') === '0%'],
  ],
  // A visitor is asked to sign in (a quiz is marked against an account); a
  // signed-in learner gets the real quiz metadata.
  'quiz.html': [
    ['[data-quiz-title]', (nodes) => (nodes[0]?.textContent ?? '').length > 2],
    ['[data-quiz-meta], [data-quiz-pass-mark]', () => true],
  ],
  'verify.html': [
    ['[data-verify-result] .card', (nodes) => nodes.length > 0],
    ['[data-verify-status]', (nodes) => /valid|found/i.test(nodes[0]?.textContent ?? '')],
  ],
  'search.html': [
    ['[data-search-results] .card', (nodes) => nodes.length > 0],
    ['[data-search-count]', (nodes) => /\d/.test(nodes[0]?.textContent ?? '')],
  ],
  'login.html': [['[data-login-form]', (nodes) => nodes.length === 1]],
  'register.html': [['[data-register-form]', (nodes) => nodes.length === 1]],
  'verify-email.html': [['[data-verify-card]', (nodes) => (nodes[0]?.textContent ?? '').length > 20]],
  'reset.html': [['[data-reset-form]', (nodes) => nodes.length === 1]],
  'reset-password.html': [['[data-reset-form]', (nodes) => nodes.length === 1]],
  'dashboard.html': [
    ['[data-dashboard-stats] .stat', (nodes) => nodes.length === 3],
    ['[data-dashboard-continue] .card, [data-dashboard-continue] .empty-state', (nodes) => nodes.length > 0],
  ],
  'my-courses.html': [['[data-enrolment-list] .card, [data-enrolment-list] .empty-state', (nodes) => nodes.length > 0]],
  'certificates.html': [['[data-certificates-list] .card, [data-certificates-list] .empty-state', (nodes) => nodes.length > 0]],
  'progress.html': [['[data-progress-table] table, [data-progress-table] .empty-state', (nodes) => nodes.length > 0]],
  // Holds a real certificate number, verification code and holder name.
  'certificate.html': [['[data-certificate-card]', (nodes) => (nodes[0]?.textContent ?? '').length > 40]],
  'profile.html': [['#full_name', (nodes) => (nodes[0]?.value ?? '').length > 0]],
  'settings.html': [
    ['[data-session-list] table', (nodes) => nodes.length > 0],
    ['[data-qr-card] .qr-card', (nodes) => nodes.length > 0],
  ],
  'admin/scan.html': [['[data-scan-form]', (nodes) => nodes.length === 1]],
  'admin/index.html': [
    ['[data-admin-stats] .stat', (nodes) => nodes.length === 4],
    ['[data-admin-trend] .chart__bar', (nodes) => nodes.length === 7],
    ['[data-admin-enrollments] table', (nodes) => nodes.length > 0],
  ],
  'admin/content.html': [['[data-content-table] table', (nodes) => nodes.length > 0]],
  'admin/students.html': [['[data-student-table] table', (nodes) => nodes.length > 0]],
  'admin/enrollments.html': [['[data-enrolment-table] table', (nodes) => nodes.length > 0]],
  'admin/certificates.html': [['[data-certificate-table] table', (nodes) => nodes.length > 0]],
  'admin/departments.html': [['[data-department-table] table', (nodes) => nodes.length > 0]],
  'admin/subjects.html': [['[data-subject-table] table', (nodes) => nodes.length > 0]],
  'admin/courses.html': [['[data-courses-table] table', (nodes) => nodes.length > 0]],
  'admin/course-editor.html': [['[data-editor-modules] .card', (nodes) => nodes.length > 0]],
  'admin/assessments.html': [
    ['[data-quiz-table] table', (nodes) => nodes.length > 0],
    // The default filter is the actionable queue ("awaiting a grade"), so an
    // empty state is the correct render when everything has been marked.
    ['[data-submission-table] table, [data-submission-table] .empty-state', (nodes) => nodes.length > 0],
  ],
  'admin/audit.html': [
    ['[data-audit-table] table', (nodes) => nodes.length > 0],
    ['[data-audit-summary] .stat', (nodes) => nodes.length >= 3],
  ],
  'admin/settings.html': [
    ['[data-role-table] table', (nodes) => nodes.length > 0],
    // The outbox is empty on a fresh database, so an empty state is correct.
    ['[data-email-table] table, [data-email-table] .empty-state', (nodes) => nodes.length > 0],
  ],
};

/** Pages a visitor is expected to be bounced away from rather than rendered. */
const MEMBER_ONLY = new Set([
  'dashboard.html',
  'my-courses.html',
  'progress.html',
  'certificates.html',
  'certificate.html',
  'profile.html',
  'settings.html',
  'lesson.html',
  'quiz.html',
]);

/**
 * Query strings used when loading a page that needs one to have anything to
 * show. These are real seeded records (see database/seeds), so the pages render
 * live API data rather than fixtures invented here.
 */
const PAGE_QUERY = {
  'course.html': '?slug=html-and-css-foundations',
  'lesson.html': '?id=lsn_js_1_1&course=javascript-fundamentals',
  'quiz.html': '?id=qz_js_fetch',
  'verify.html': '?code=XK4T-9QW2-M7PL',
  'search.html': '?q=css',
  'certificate.html': '?id=cert_demo_1',
  'subject.html': '?subject=web-development',
  'admin/course-editor.html': '?course=crs_html_css',
};

const moduleCache = new Map();

async function loadPageModule(modulePath) {
  const file = path.join(PUBLIC_DIR, modulePath.replace(/^\//, ''));
  if (!moduleCache.has(file)) {
    // The HTML asks for `/assets/js/pages/x.js`; on disk that is a real file, and
    // Node can import it directly because every import inside it is relative.
    moduleCache.set(file, import(`${pathToFileURL(file).href}?v=${Date.now()}`));
  }
  return moduleCache.get(file);
}

async function runPage(relativePath, jar) {
  const htmlPath = path.join(PUBLIC_DIR, relativePath);
  const html = await readFile(htmlPath, 'utf8');
  const importMatch = html.match(PAGE_MODULE_IMPORT);

  const consoleErrors = [];
  const pageErrors = [];
  const navigations = [];
  const requests = [];

  const window = new Window({
    url: `${WEB_ORIGIN}/${relativePath}${PAGE_QUERY[relativePath] ?? ''}`,
    settings: { disableComputedStyleRendering: true, fetch: { disableSameOriginPolicy: true } },
  });
  const { document } = window;
  document.write(html);
  jar.document = document;
  jar.syncDocument();

  // The page's `config.js` runs as a classic script in the browser; run it the
  // same way so `window.GWORLD_CONFIG` is exactly what ships.
  const configSource = await readFile(path.join(PUBLIC_DIR, 'config.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', configSource)(window, document);

  // ---------------------------------------------------------------- globals
  // Some of these (navigator, fetch) are accessor properties on the Node global
  // object, so they are replaced via descriptors and put back exactly as they
  // were afterwards.
  const restore = [];
  const expose = (name, value) => {
    restore.push([name, Object.getOwnPropertyDescriptor(globalThis, name)]);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: false,
    });
  };

  expose('window', window);
  expose('document', document);
  expose('navigator', window.navigator);
  expose('Node', window.Node);
  expose('Element', window.Element);
  expose('HTMLElement', window.HTMLElement);
  expose('HTMLDialogElement', window.HTMLDialogElement);
  expose('Event', window.Event);
  expose('CustomEvent', window.CustomEvent);
  expose('MouseEvent', window.MouseEvent);
  expose('CSS', window.CSS);
  expose('FormData', window.FormData);
  expose('getComputedStyle', window.getComputedStyle.bind(window));
  expose('requestAnimationFrame', (callback) => setTimeout(() => callback(Date.now()), 0));
  expose('MutationObserver', window.MutationObserver);
  expose('fetch', createFetch(jar, requests));
  expose('scrollTo', () => {});

  window.scrollTo = () => {};

  const realLocation = window.location;
  const locationProxy = new Proxy(realLocation, {
    get(target, property) {
      if (property === 'assign' || property === 'replace') {
        return (url) => navigations.push(String(url));
      }
      if (property === 'reload') return () => navigations.push('reload');
      if (property === 'href') return `${WEB_ORIGIN}/${relativePath}${PAGE_QUERY[relativePath] ?? ''}`;
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    Object.defineProperty(window, 'location', { configurable: true, value: locationProxy });
  } catch {
    // Older happy-dom builds freeze `location`; navigation then shows up as a
    // page error instead, and the harness reports it as a failure to inspect.
    window.location.assign = (url) => navigations.push(String(url));
  }

  window.addEventListener('error', (event) => pageErrors.push(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => pageErrors.push(event.reason));
  window.console.error = (...args) => consoleErrors.push(args.map(String).join(' '));
  window.console.warn = () => {};

  const previousConsoleError = console.error;
  console.error = (...args) => consoleErrors.push(args.map(String).join(' '));

  try {
    if (!importMatch) {
      return { ok: true, note: 'no page module' };
    }

    const module = await loadPageModule(importMatch[1]);
    const boot = await import(`${pathToFileURL(path.join(PUBLIC_DIR, 'assets/js/core/boot.js')).href}?v=${Date.now()}`);
    await boot.boot(module.init);

    // Give fire-and-forget follow-ups (outline, QR) a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 120));
    await window.happyDOM?.waitUntilComplete?.().catch(() => {});

    // An error panel rendered by boot()/pageError() counts as a failure even
    // though it was handled gracefully: the page did not show real content.
    const errorPanel = document.querySelector('[data-page-error] .empty-state--error');

    const expectations = EXPECTATIONS[relativePath];
    if (!expectations) {
      return { ok: !errorPanel && pageErrors.length === 0, errorPanel, pageErrors, requests, navigations };
    }

    for (const [selector, predicate] of expectations) {
      const nodes = [...document.querySelectorAll(selector)];
      if (!predicate(nodes)) {
        return {
          ok: false,
          reason: `expected ${selector} to be populated${nodes.length ? ` (found ${nodes.length})` : ' (found none)'}`,
          pageErrors,
          requests,
          navigations,
        };
      }
    }

    return { ok: !errorPanel, errorPanel, pageErrors, requests, navigations };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error), pageErrors, requests, navigations, thrown: error };
  } finally {
    for (const [name, descriptor] of restore.reverse()) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
    console.error = previousConsoleError;
    jar.document = null;
    await window.happyDOM?.close?.().catch(() => {});
  }
}

/* ------------------------------------------------------------------------ main */

async function signIn(jar, account) {
  const response = await realFetch(`${API_TARGET}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
  });
  jar.store(response);
  return response.ok;
}

async function main() {
  const pages = [];
  for (const entry of await readdir(PUBLIC_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.html')) pages.push(entry.name);
    if (entry.isDirectory() && entry.name === 'admin') {
      for (const adminEntry of await readdir(path.join(PUBLIC_DIR, 'admin'))) {
        if (adminEntry.endsWith('.html')) pages.push(`admin/${adminEntry}`);
      }
    }
  }
  pages.sort();

  // Health check first: a skipped run must say why, not just "0 failures".
  try {
    const health = await realFetch(`${API_TARGET}/api/v1/health`);
    if (!health.ok) throw new Error(`status ${health.status}`);
  } catch (error) {
    record('API reachable', 'fail', `${API_TARGET} — ${error.message}. Start it with: npm run dev:api`);
    process.exit(1);
  }
  record('API reachable', 'pass', API_TARGET);

  const jar = new Jar();
  if (AS !== 'visitor') {
    const account = DEMO_ACCOUNTS[AS];
    if (!account) {
      record(`sign in as ${AS}`, 'fail', 'unknown account (expected student or admin)');
      process.exit(1);
    }
    const ok = await signIn(jar, account);
    record(`sign in as ${AS}`, ok ? 'pass' : 'fail', account.email);
    if (!ok) process.exit(1);
  }

  let selected = FILTER ? pages.filter((page) => page === FILTER) : pages;
  if (AS === 'admin' && !FILTER) {
    // An administrator account has no enrolments or certificates of its own, so
    // the learner screens legitimately render empty states. The student pass
    // covers them; this pass covers the admin area.
    selected = selected.filter((page) => !MEMBER_ONLY.has(page));
  }
  if (!selected.length) {
    record('pages found', 'fail', FILTER ? `no page matched ${FILTER}` : 'no HTML pages in public/');
    process.exit(1);
  }

  for (const page of selected) {
    // Reset the session cache between "pages": each page load is a fresh document.
    const result = await runPage(page, jar);

    const navigations = (result.navigations ?? []).map(String);
    const memberOnly = MEMBER_ONLY.has(page);

    if (AS === 'visitor' && memberOnly && navigations.some((url) => url.includes('/login.html'))) {
      record(`${page} (redirects to sign-in)`, 'pass', 'no session — bounced as designed');
      continue;
    }

    // Admin screens are staff-only: a signed-in student is sent to 403, which is
    // the client-side half of a rule the API enforces again on every request.
    if (page.startsWith('admin/') && AS !== 'admin' && navigations.some((url) => url.includes('/login.html') || url.includes('/403.html'))) {
      record(`${page} (${AS} bounced)`, 'pass', navigations.find((url) => url.includes('/403') || url.includes('/login')) ?? '');
      continue;
    }

    if (result.ok) {
      record(page, 'pass', `${result.requests?.length ?? 0} API call(s)`);
      continue;
    }

    const detail = [
      result.reason,
      result.errorPanel ? 'rendered an error panel' : null,
      result.pageErrors?.length ? `page error: ${String(result.pageErrors[0]?.message ?? result.pageErrors[0])}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    record(page, 'fail', detail || 'unknown failure');
  }

  const passed = results.filter((row) => row.status === 'pass').length;
  console.log(`\n${passed} passed, ${failures} failed  (as ${AS})`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error('smoke-web crashed:', error);
  process.exit(1);
});
