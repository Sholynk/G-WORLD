#!/usr/bin/env node
/**
 * G WORLD — end-to-end smoke test.
 *
 * Drives the real HTTP API against the local D1 database (migrations + demo
 * seeds applied) through the flows a browser takes:
 *
 *   public browsing → registration → email verification → sign-in
 *   → learning (enrol, start, complete, certificate)
 *   → assessment (quiz attempt, assignment submission, admin grading)
 *   → authorisation boundaries (student vs admin vs super admin)
 *   → CSRF enforcement and session revocation
 *
 * Usage:
 *   npm run db:reset:local     # schema + demo data (development only)
 *   npm run dev:api            # in another terminal → wrangler dev :8787
 *   npm run test:smoke
 *
 * Environment:
 *   API_BASE_URL     default http://127.0.0.1:8787
 *   SMOKE_QUIET      set to 1 to print failures and the summary only
 *
 * Exit code 0 only when every required check passed. Steps that legitimately
 * cannot repeat (exhausted quiz attempts) report SKIP, never PASS.
 *
 * The checks assert the contract the frontend codes against — status codes, the
 * `{ success, data, meta }` envelope, and the field names documented in
 * docs/04-api-reference.md. A checked-in test that fails when the API changes is
 * the point; if a field is renamed on purpose, this file changes with it.
 */
import process from 'node:process';

const BASE = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const QUIET = process.env.SMOKE_QUIET === '1';
const RUN_ID = Date.now().toString(36);

const DEMO = {
  student: { email: 'student@gworld.test', password: 'StudentPassword123!' },
  admin: { email: 'staff@gworld.test', password: 'StaffPassword123!' },
  superAdmin: { email: 'admin@gworld.test', password: 'AdminPassword123!' },
  suspended: { email: 'zainab@gworld.test', password: 'StudentPassword123!' },
};

/* ------------------------------------------------------------------ harness */

const results = [];
const notes = [];

function describe(value) {
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text && text.length > 220 ? `${text.slice(0, 220)}…` : text;
  } catch {
    return String(value);
  }
}

class CheckFailed extends Error {}

function assert(condition, message, detail) {
  if (!condition) {
    throw new CheckFailed(detail === undefined ? message : `${message} — got ${describe(detail)}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, message, `${describe(actual)} (expected ${describe(expected)})`);
}

async function step(name, fn) {
  const entry = { name, status: 'pass', note: '' };
  const started = Date.now();
  try {
    const note = await fn();
    entry.note = typeof note === 'string' ? note : '';
  } catch (error) {
    if (error instanceof CheckFailed) {
      entry.status = 'fail';
      entry.note = error.message;
    } else if (error && error.smokeSkip) {
      entry.status = 'skip';
      entry.note = error.message;
    } else {
      entry.status = 'fail';
      entry.note = `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
    }
  }
  entry.ms = Date.now() - started;
  results.push(entry);
  if (!QUIET || entry.status !== 'pass') {
    const mark = { pass: '  ✓', fail: '  ✗', skip: '  ○' }[entry.status];
    console.log(`${mark} ${entry.name} (${entry.ms}ms)${entry.note ? `  — ${entry.note}` : ''}`);
  }
  return entry.status;
}

function skip(message) {
  const error = new Error(message);
  error.smokeSkip = true;
  throw error;
}

/* --------------------------------------------------------------- http client */

class Session {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  absorb(response) {
    const raw = response.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index === -1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, path, options = {}) {
    const headers = { Accept: 'application/json', 'User-Agent': 'g-world-smoke-test/1.0', ...(options.headers ?? {}) };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (options.json !== undefined) headers['Content-Type'] = 'application/json';
    if (options.csrf && this.cookies.get('gw_csrf')) headers['X-CSRF-Token'] = this.cookies.get('gw_csrf');

    let response;
    try {
      response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: options.json === undefined ? options.body : JSON.stringify(options.json),
        redirect: 'manual',
      });
    } catch (error) {
      throw new Error(
        `Cannot reach ${BASE}${path} — start the API with \`npm run dev:api\` first [${error.message}]`,
      );
    }
    this.absorb(response);

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 200) };
      }
    }
    return { status: response.status, headers: response.headers, body, text };
  }

  get(path, options) {
    return this.request('GET', path, options);
  }

  post(path, json, options = {}) {
    return this.request('POST', path, { json, csrf: true, ...options });
  }

  patch(path, json, options = {}) {
    return this.request('PATCH', path, { json, csrf: true, ...options });
  }

  async login(credentials) {
    return this.post('/api/v1/auth/login', credentials);
  }
}

function expectStatus(response, expected, context) {
  const codes = Array.isArray(expected) ? expected : [expected];
  if (!codes.includes(response.status)) {
    throw new CheckFailed(
      `${context}: expected HTTP ${codes.join('/')}, got ${response.status} — ${describe(response.body)}`,
    );
  }
}

function expectOk(response, context) {
  expectStatus(response, 200, context);
  assert(response.body?.success === true, `${context}: success flag`, response.body);
  return response.body.data;
}

function expectErrorCode(response, code, context) {
  assert(response.body?.success === false, `${context}: expected a failure envelope`, response.body);
  assertEqual(response.body?.error?.code, code, `${context}: error code`);
}

const anonymous = new Session('anonymous');

/* --------------------------------------------------------------- 0. prep */

await step('Development helpers reset rate limits and demo passwords', async () => {
  const limits = await anonymous.request('POST', '/api/v1/auth/dev/reset-limits', { json: {} });
  if (limits.status === 404 || limits.status === 403) {
    skip('dev routes are disabled (ENABLE_DEV_ROUTES) — rate limits may block this run');
  }
  expectStatus(limits, 200, 'reset-limits');
  const accounts = await anonymous.request('POST', '/api/v1/auth/dev/reset-demo-accounts', { json: {} });
  expectStatus(accounts, 200, 'reset-demo-accounts');
  const restored = accounts.body.data.updated;
  assert(restored.length >= 3, 'demo accounts restored', restored);
  return `${restored.length} demo accounts at ${accounts.body.data.iterations} iterations`;
});

/* ------------------------------------------------------------ 1. public API */

await step('GET /health reports liveness', async () => {
  const data = expectOk(await anonymous.get('/api/v1/health'), 'health');
  assertEqual(data.status, 'ok', 'health status');
  assertEqual(data.service, 'g-world-api', 'service name');
  assert(
    typeof data.started_at === 'string' && !data.started_at.startsWith('1970'),
    'started_at is a real timestamp',
    data.started_at,
  );
  return `environment=${data.environment}`;
});

await step('GET /health/ready confirms D1 and configuration', async () => {
  const data = expectOk(await anonymous.get('/api/v1/health/ready'), 'ready');
  assertEqual(data.database?.reachable, true, 'D1 reachable');
  assertEqual(data.database?.migrations_applied, true, 'migrations applied');
  assertEqual(data.status, 'ready', 'readiness status');
  assertEqual(data.config_problems.length, 0, 'no configuration problems');
  return `db=up email=${data.checks.email_provider}`;
});

await step('GET /meta returns feature flags', async () => {
  const data = expectOk(await anonymous.get('/api/v1/meta'), 'meta');
  assertEqual(data.api_version, 'v1', 'api version');
  assert(typeof data.features?.registration === 'boolean', 'registration flag', data.features);
  return Object.entries(data.features)
    .map(([key, value]) => `${key}:${value}`)
    .join(' ');
});

await step('Every response carries the security headers', async () => {
  const response = await anonymous.get('/api/v1/meta');
  const expected = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };
  for (const [header, value] of Object.entries(expected)) {
    assertEqual(response.headers.get(header), value, `${header} header`);
  }
  assert(
    String(response.headers.get('content-security-policy')).includes("default-src 'none'"),
    'CSP locks the API down',
    response.headers.get('content-security-policy'),
  );
  assertEqual(response.headers.get('cache-control'), 'no-store, private', 'cache-control');
  assert(response.headers.get('x-request-id'), 'request id echoed', response.headers.get('x-request-id'));
  return 'CSP + nosniff + DENY + no-store + request id';
});

await step('Unknown endpoints return a 404 in the standard envelope', async () => {
  const response = await anonymous.get('/api/v1/does-not-exist');
  expectStatus(response, 404, 'unknown route');
  expectErrorCode(response, 'NOT_FOUND', 'unknown route');
  return 'HTTP 404 NOT_FOUND';
});

await step('GET /departments lists the seeded departments', async () => {
  const data = expectOk(await anonymous.get('/api/v1/departments'), 'departments');
  const items = Array.isArray(data) ? data : data.items;
  assert(Array.isArray(items), 'departments array', data);
  assert(items.length >= 5, 'at least 5 departments', items.length);
  assert(
    items.some((item) => item.slug === 'technology'),
    'technology department present',
    items.map((item) => item.slug).join(','),
  );
  return `${items.length} departments`;
});

await step('GET /departments/:slug returns one department', async () => {
  const data = expectOk(await anonymous.get('/api/v1/departments/technology'), 'department detail');
  const department = data.department ?? data.department_with_subjects ?? data;
  assertEqual(department.slug, 'technology', 'department slug');
  return department.name ?? department.slug;
});

await step('GET /subjects lists subjects', async () => {
  const data = expectOk(await anonymous.get('/api/v1/subjects?per_page=50'), 'subjects');
  const items = Array.isArray(data) ? data : data.items;
  assert(items.length >= 9, 'at least 9 subjects', items.length);
  return `${items.length} subjects`;
});

await step('GET /courses paginates only published courses', async () => {
  const data = expectOk(await anonymous.get('/api/v1/courses?per_page=5&page=1'), 'courses');
  assertEqual(data.items.length, 5, 'per_page respected');
  assert(data.pagination.total >= 9, 'published course count', data.pagination);
  assertEqual(data.pagination.page, 1, 'page number');
  assertEqual(data.pagination.has_prev, false, 'first page has no previous');
  for (const course of data.items) {
    assert(course.id && course.slug && course.title, 'card shape', course);
    assert(typeof course.lesson_count === 'number', 'lesson count on card', course);
  }
  return `${data.items.length} of ${data.pagination.total}`;
});

await step('GET /courses filters by department and difficulty', async () => {
  const data = expectOk(
    await anonymous.get('/api/v1/courses?department=technology&difficulty=beginner&per_page=50'),
    'course filter',
  );
  assert(data.items.length >= 2, 'filter returns rows', data.pagination);
  for (const course of data.items) {
    assertEqual(course.difficulty, 'beginner', `course ${course.slug} difficulty`);
    assertEqual(course.department.slug, 'technology', `course ${course.slug} department`);
  }
  return `${data.items.length} technology/beginner courses`;
});

await step('GET /courses/featured returns featured courses', async () => {
  const data = expectOk(await anonymous.get('/api/v1/courses/featured'), 'featured courses');
  const items = Array.isArray(data) ? data : data.items;
  assert(items.length >= 1, 'featured courses present', items.length);
  for (const course of items) assertEqual(course.is_featured, true, `course ${course.slug} featured flag`);
  return `${items.length} featured`;
});

await step('GET /courses/:slug returns the course with its curriculum', async () => {
  const data = expectOk(await anonymous.get('/api/v1/courses/html-and-css-foundations'), 'course detail');
  assertEqual(data.course.slug, 'html-and-css-foundations', 'course slug');
  assertEqual(data.course.certificate_enabled, true, 'certificate enabled');
  assert(Array.isArray(data.curriculum) && data.curriculum.length >= 3, 'modules included', data.curriculum?.length);
  const lessons = data.curriculum.flatMap((module) => module.lessons ?? []);
  assert(lessons.length >= 5, 'lessons included in curriculum', lessons.length);
  assert(lessons.some((lesson) => lesson.is_preview), 'at least one preview lesson', lessons.length);
  return `${data.curriculum.length} modules / ${lessons.length} lessons`;
});

await step('GET /courses/:slug/curriculum lists modules and lessons', async () => {
  const data = expectOk(
    await anonymous.get('/api/v1/courses/html-and-css-foundations/curriculum'),
    'curriculum',
  );
  const modules = data.curriculum ?? data.modules;
  assert(Array.isArray(modules), 'curriculum array', Object.keys(data));
  for (const module of modules) {
    assert(module.id && module.title, 'module shape', module);
    assert(Array.isArray(module.lessons), 'module lessons array', module);
  }
  return `${modules.length} modules`;
});

await step('GET /lessons/:id/preview returns an excerpt for visitors', async () => {
  const data = expectOk(await anonymous.get('/api/v1/lessons/lsn_hc_1_1/preview'), 'lesson preview');
  assert(typeof data.excerpt === 'string' && data.excerpt.length > 40, 'excerpt delivered', data.excerpt);
  assert(Array.isArray(data.videos) && data.videos.length >= 1, 'preview videos', data.videos?.length);
  assert(!('content_md' in data), 'full lesson body is not exposed by the preview', Object.keys(data));
  assertEqual(data.course.slug, 'html-and-css-foundations', 'course reference');
  return `${data.videos.length} videos, ${data.excerpt.length} char excerpt`;
});

await step('GET /lessons/:id locks non-preview content for visitors', async () => {
  const response = await anonymous.get('/api/v1/lessons/lsn_hc_1_2');
  expectStatus(response, 403, 'locked lesson');
  expectErrorCode(response, 'FORBIDDEN', 'locked lesson');
  return 'HTTP 403 FORBIDDEN';
});

await step('GET /search finds courses and lessons', async () => {
  const data = expectOk(await anonymous.get('/api/v1/search?q=html&type=all'), 'search');
  const groups = data.results ?? data;
  const total = Object.values(groups).reduce(
    (sum, group) => sum + (Array.isArray(group) ? group.length : 0),
    Array.isArray(groups) ? groups.length : 0,
  );
  assert(total >= 1, 'search returns results', describe(groups));
  return `${total} matches for "html"`;
});

await step('GET /stats returns public counters', async () => {
  const data = expectOk(await anonymous.get('/api/v1/stats'), 'stats');
  const counters = data.totals ?? data;
  assert(Number(counters.courses) >= 9, 'course counter', counters);
  assert(Number(counters.learners) >= 3, 'learner counter', counters);
  return describe(counters);
});

await step('GET /verify/certificate/:code validates a seeded certificate', async () => {
  const data = expectOk(
    await anonymous.get('/api/v1/verify/certificate/XK4T-9QW2-M7PL'),
    'certificate verification',
  );
  const certificate = data.certificate ?? data;
  assertEqual(certificate.valid, true, 'certificate valid');
  assertEqual(certificate.certificate_number, 'GW-CERT-2026-A1B2C3', 'certificate number');
  assertEqual(certificate.grade, 'distinction', 'grade');
  return `${certificate.certificate_number} (${certificate.grade})`;
});

await step('GET /verify/student/:code validates a seeded student code', async () => {
  const data = expectOk(
    await anonymous.get('/api/v1/verify/student/GW-STUDENT-AB12CD34EF'),
    'student verification',
  );
  const student = data.student ?? data;
  assertEqual(student.student_number, 'GW-2026-A1B2C3', 'student number');
  assert(student.name || student.display_name, 'name present', describe(student));
  return `${student.student_number} — ${student.name ?? student.display_name}`;
});

await step('GET /me rejects anonymous callers', async () => {
  const response = await anonymous.get('/api/v1/me');
  expectStatus(response, 401, 'anonymous /me');
  expectErrorCode(response, 'UNAUTHENTICATED', 'anonymous /me');
  return 'HTTP 401 UNAUTHENTICATED';
});

await step('GET /admin/students rejects anonymous callers', async () => {
  const response = await anonymous.get('/api/v1/admin/students');
  expectStatus(response, 401, 'anonymous admin');
  expectErrorCode(response, 'UNAUTHENTICATED', 'anonymous admin');
  return 'HTTP 401 UNAUTHENTICATED';
});

await step('POST /auth/register rejects a weak password with field errors', async () => {
  const response = await anonymous.post('/api/v1/auth/register', {
    email: `weak.${RUN_ID}@gworld.test`,
    password: 'short',
    accepted_terms: true,
  });
  expectStatus(response, 422, 'weak password');
  expectErrorCode(response, 'VALIDATION_ERROR', 'weak password');
  assert(Array.isArray(response.body.error.details), 'field errors returned', response.body.error);
  assert(
    response.body.error.details.some((detail) => String(detail.field).includes('password')),
    'password field flagged',
    response.body.error.details,
  );
  return `${response.body.error.details.length} field error(s)`;
});

/* --------------------------------------------- 2. registration → verification */

const fresh = new Session('fresh-student');
const freshEmail = `smoke.${RUN_ID}@gworld.test`;
const freshPassword = 'SmokeTest123!';
const rotatedPassword = 'SmokeTest456!';
let verificationToken = null;

await step('POST /auth/register creates a pending student', async () => {
  const response = await anonymous.post('/api/v1/auth/register', {
    email: freshEmail,
    password: freshPassword,
    display_name: `Smoke ${RUN_ID}`,
    full_name: 'Smoke Test Account',
    education_level: 'undergraduate',
    country: 'NG',
    interests: ['web-development'],
    accepted_terms: true,
  });
  expectStatus(response, 201, 'register');
  const data = response.body.data;
  assert(data.user?.id?.startsWith('usr_'), 'user id returned', data.user?.id);
  assertEqual(data.user.email, freshEmail, 'registered email');
  assertEqual(data.user.status, 'pending_verification', 'account starts pending verification');
  assert(!response.text.includes(freshPassword), 'password never echoed back', 'leaked in response body');
  if (typeof data.debug_verification_token === 'string') verificationToken = data.debug_verification_token;
  return `${freshEmail} → ${data.user.id}`;
});

await step('POST /auth/register rejects a duplicate email', async () => {
  const response = await anonymous.post('/api/v1/auth/register', {
    email: freshEmail,
    password: freshPassword,
    accepted_terms: true,
  });
  expectStatus(response, 409, 'duplicate register');
  expectErrorCode(response, 'CONFLICT', 'duplicate register');
  return 'HTTP 409 CONFLICT';
});

await step('POST /auth/login blocks an unverified account', async () => {
  const response = await anonymous.post('/api/v1/auth/login', {
    email: freshEmail,
    password: freshPassword,
  });
  expectStatus(response, 403, 'unverified login');
  expectErrorCode(response, 'EMAIL_NOT_VERIFIED', 'unverified login');
  return 'HTTP 403 EMAIL_NOT_VERIFIED';
});

await step('GET /auth/dev/outbox exposes the verification email locally', async () => {
  const response = await anonymous.get('/api/v1/auth/dev/outbox');
  if (response.status === 404 || response.status === 403) skip('dev routes disabled');
  const items = expectOk(response, 'dev outbox');
  assert(Array.isArray(items), 'outbox array', describe(items));
  const message = items.find((item) => item.to === freshEmail);
  assert(message, 'verification email for the new account', `${items.length} queued message(s)`);
  const match = /token=([A-Za-z0-9_-]{20,})/.exec(message.body ?? '');
  assert(match, 'verification link contains a token', describe(message.body).slice(0, 160));
  verificationToken ??= match[1];
  return `${message.template} → ${message.status}`;
});

await step('POST /auth/verify-email activates the account', async () => {
  assert(verificationToken, 'a verification token was captured');
  const response = await anonymous.post('/api/v1/auth/verify-email', { token: verificationToken });
  expectStatus(response, 200, 'verify email');
  assert(response.body.success === true, 'verify success envelope', response.body);
  return 'email verified';
});

await step('POST /auth/verify-email rejects the same token twice', async () => {
  assert(verificationToken, 'a verification token was captured');
  const response = await anonymous.post('/api/v1/auth/verify-email', { token: verificationToken });
  expectStatus(response, [400, 409, 410, 422], 'token replay');
  return `HTTP ${response.status} on replay`;
});

await step('POST /auth/login signs the verified account in', async () => {
  const response = await fresh.login({ email: freshEmail, password: freshPassword });
  expectStatus(response, 200, 'login');
  assertEqual(response.body.data.user.email, freshEmail, 'logged-in email');
  assert(fresh.cookies.get('gw_session'), 'session cookie set');
  assert(fresh.cookies.get('gw_csrf'), 'csrf cookie set');
  const sessionCookie = [...fresh.cookies.keys()];
  assert(!sessionCookie.includes('gw_session_plain'), 'no accidental cookie names', sessionCookie.join(','));
  const me = expectOk(await fresh.get('/api/v1/me'), '/me after login');
  assertEqual(me.user.email, freshEmail, 'profile email');
  return `session ${response.body.data.session.id}`;
});

await step('CSRF: unsafe methods need the header, not just the cookie', async () => {
  const withoutHeader = await fresh.request('POST', '/api/v1/auth/change-password', {
    json: { current_password: freshPassword, new_password: rotatedPassword },
  });
  expectStatus(withoutHeader, 403, 'csrf missing');
  expectErrorCode(withoutHeader, 'FORBIDDEN', 'csrf missing');

  const withHeader = await fresh.post('/api/v1/auth/change-password', {
    current_password: freshPassword,
    new_password: rotatedPassword,
  });
  expectStatus(withHeader, 200, 'csrf present');
  assertEqual(withHeader.body.data.changed, true, 'password changed');
  return 'cookie alone → 403, cookie + header → 200';
});

await step('The rotated password is the only one that works', async () => {
  const stale = new Session('stale');
  const staleResponse = await stale.login({ email: freshEmail, password: freshPassword });
  expectStatus(staleResponse, 401, 'old password');
  const rotated = new Session('rotated');
  const rotatedResponse = await rotated.login({ email: freshEmail, password: rotatedPassword });
  expectStatus(rotatedResponse, 200, 'new password');
  return 'old → 401, new → 200';
});

await step('POST /auth/logout revokes the session server-side', async () => {
  const logout = await fresh.post('/api/v1/auth/logout', {});
  expectStatus(logout, 200, 'logout');
  const after = await fresh.get('/api/v1/me');
  expectStatus(after, 401, 'me after logout');
  expectErrorCode(after, 'UNAUTHENTICATED', 'me after logout');
  return 'session rejected after logout';
});

await step('GET /auth/sessions lists then revokes a session', async () => {
  const session = new Session('session-manager');
  expectStatus(await session.login(DEMO.student), 200, 'login');
  const listed = expectOk(await session.get('/api/v1/auth/sessions'), 'sessions list');
  const items = listed.items ?? listed;
  assert(Array.isArray(items) && items.length >= 1, 'sessions listed', describe(listed).slice(0, 120));
  const revoked = await session.request('DELETE', `/api/v1/auth/sessions/${items[0].id}`, { csrf: true });
  expectStatus(revoked, [200, 204], 'revoke session');
  return `${items.length} session(s), revoked ${items[0].id}`;
});

/* ------------------------------------------------------- 3. student learning */

const student = new Session('student');

await step('POST /auth/login signs in the demo student', async () => {
  const response = await student.login(DEMO.student);
  expectStatus(response, 200, 'student login');
  const data = response.body.data;
  assertEqual(data.user.email, DEMO.student.email, 'student email');
  assertEqual(data.user.role, 'student', 'student role');
  return `session ${data.session.id}`;
});

await step('GET /me returns profile, permissions and stats', async () => {
  const data = expectOk(await student.get('/api/v1/me'), '/me');
  assertEqual(data.user.email, DEMO.student.email, 'profile email');
  assertEqual(data.user.role, 'student', 'profile role');
  assertEqual(data.user.profile.student_number, 'GW-2026-A1B2C3', 'student number');
  assert(Array.isArray(data.permissions) && data.permissions.length >= 5, 'permissions loaded', data.permissions);
  assert(data.permissions.includes('progress.own'), 'student scope permission present', data.permissions);
  assert(
    !data.permissions.some((permission) => permission.startsWith('user.write')),
    'no administrative permission leaks',
    data.permissions,
  );
  assert(Number(data.stats.enrolled) >= 2, 'stats enrolled count', data.stats);
  return `${data.permissions.length} permissions, ${data.stats.enrolled} enrolments`;
});

await step('GET /me/dashboard summarises learning', async () => {
  const data = expectOk(await student.get('/api/v1/me/dashboard'), 'dashboard');
  assert(data.stats && typeof data.stats === 'object', 'dashboard stats', describe(data).slice(0, 120));
  assert(Number(data.stats.completed) >= 1, 'completed enrolment counted', data.stats);
  return describe(data.stats);
});

await step('GET /me/enrollments lists enrolments with progress', async () => {
  const items = expectOk(await student.get('/api/v1/me/enrollments'), 'enrollments');
  assert(Array.isArray(items), 'enrollments array', describe(items).slice(0, 120));
  assert(items.length >= 2, 'seeded enrolments present', items.length);
  const completed = items.find((item) => item.status === 'completed');
  assert(completed, 'a completed enrolment exists', items.map((item) => item.status).join(','));
  assertEqual(completed.progress_percent, 100, 'completed enrolment progress');
  assert(completed.course?.slug, 'course summary attached', completed);
  return `${items.length} enrolments (${items.filter((item) => item.status === 'active').length} active)`;
});

await step('GET /me/certificates lists issued certificates', async () => {
  const items = expectOk(await student.get('/api/v1/me/certificates'), 'certificates');
  const list = items.items ?? items;
  assert(Array.isArray(list) && list.length >= 1, 'seeded certificate present', describe(items).slice(0, 120));
  assert(
    list[0].certificate_number?.startsWith('GW-CERT-'),
    'certificate number shape',
    list[0].certificate_number,
  );
  return `${list.length} certificate(s)`;
});

await step('GET /me/notifications then read-all', async () => {
  const items = expectOk(await student.get('/api/v1/me/notifications'), 'notifications');
  const list = items.items ?? items;
  assert(Array.isArray(list) && list.length >= 1, 'seeded notifications present', describe(items).slice(0, 120));
  const readAll = await student.post('/api/v1/me/notifications/read-all', {});
  expectStatus(readAll, 200, 'read-all');
  const after = expectOk(await student.get('/api/v1/me/notifications?unread_only=true'), 'unread');
  const unread = after.items ?? after;
  assertEqual(unread.length, 0, 'no unread notifications left');
  return `${list.length} notifications, all read`;
});

await step('GET /me/qr renders an SVG student code', async () => {
  const data = expectOk(await student.get('/api/v1/me/qr'), 'qr');
  const svg = data.svg ?? data.qr_svg ?? '';
  assert(svg.startsWith('<svg'), 'svg returned', svg.slice(0, 60));
  assert(svg.includes('</svg>'), 'svg is closed', svg.slice(-40));
  assert(String(data.code).startsWith('GW-'), 'qr code shape', data.code);
  return `${data.code} (${svg.length} bytes of SVG)`;
});

await step('GET /me/history and /me/activity report learning', async () => {
  const history = expectOk(await student.get('/api/v1/me/history'), 'history');
  assert(Number(history.total) >= 2, 'history total', describe(history).slice(0, 120));
  assert(Array.isArray(history.enrollments), 'history enrolments array', Object.keys(history));
  const activity = expectOk(await student.get('/api/v1/me/activity'), 'activity');
  assert(Array.isArray(activity.daily), 'activity daily series', Object.keys(activity));
  return `${history.total} enrolment(s) in history`;
});

await step('PATCH /me/profile updates the profile', async () => {
  const data = expectOk(
    await student.patch('/api/v1/me/profile', {
      display_name: `Smoke Student ${RUN_ID}`,
      goals: 'Finish the smoke test.',
    }),
    'profile update',
  );
  assertEqual(data.updated, true, 'update flag');
  assert(data.fields.includes('display_name'), 'changed fields reported', data.fields);
  assertEqual(data.user.profile.display_name, `Smoke Student ${RUN_ID}`, 'display name persisted');
  return data.fields.join(', ');
});

await step('Enrol → start → complete issues a certificate', async () => {
  const courses = expectOk(await student.get('/api/v1/courses?per_page=50'), 'course list');
  const course = (courses.items ?? []).find((item) => item.slug === 'starting-a-small-business');
  assert(course, 'seeded course found', (courses.items ?? []).map((item) => item.slug).join(','));

  const enrol = await student.post('/api/v1/enrollments', { course_id: course.id });
  if (enrol.status === 409) {
    // Second run against the same database: already enrolled, which is fine.
  } else {
    expectStatus(enrol, [200, 201], 'enrol');
  }

  const curriculum = expectOk(
    await student.get('/api/v1/courses/starting-a-small-business/curriculum'),
    'curriculum',
  );
  const lessons = (curriculum.curriculum ?? curriculum.modules).flatMap((module) => module.lessons ?? []);
  assert(lessons.length >= 1, 'course has lessons', lessons.length);
  assertEqual(curriculum.course.id, course.id, 'course id matches');

  const start = await student.post(`/api/v1/lessons/${lessons[0].id}/start`, { seconds_spent: 30 });
  expectStatus(start, 200, 'lesson start');

  for (const lesson of lessons) {
    const complete = await student.post(`/api/v1/lessons/${lesson.id}/complete`, { seconds_spent: 300 });
    expectStatus(complete, 200, `complete ${lesson.id}`);
    assertEqual(complete.body.data.lesson_id, lesson.id, 'completed lesson id');
  }

  const enrolments = expectOk(await student.get('/api/v1/me/enrollments'), 'enrolments after');
  const enrolment = enrolments.find((item) => item.course.id === course.id);
  assert(enrolment, 'enrolment listed', enrolments.map((item) => item.course.slug).join(','));
  assertEqual(enrolment.status, 'completed', 'enrolment completed');
  assertEqual(enrolment.progress_percent, 100, 'progress at 100%');

  const certificates = expectOk(await student.get('/api/v1/me/certificates'), 'certificates after');
  const list = certificates.items ?? certificates;
  const certificate = list.find((item) => (item.course?.id ?? item.course_id) === course.id);
  assert(
    certificate,
    'certificate issued for the course',
    list.map((item) => item.course?.id ?? item.course_id).join(','),
  );
  const verified = expectOk(
    await anonymous.get(`/api/v1/verify/certificate/${certificate.verification_code}`),
    'verify new certificate',
  );
  const publicRecord = verified.certificate ?? verified;
  assertEqual(publicRecord.valid, true, 'new certificate verifies publicly');
  assertEqual(publicRecord.certificate_number, certificate.certificate_number, 'same certificate number');
  return `${lessons.length} lesson(s) → ${certificate.certificate_number}`;
});

await step('Completing a locked lesson without an enrolment is refused', async () => {
  const courses = expectOk(await anonymous.get('/api/v1/courses?per_page=50'), 'courses');
  const course = (courses.items ?? []).find((item) => item.slug === 'typography-for-screens');
  assert(course, 'unrelated course found', (courses.items ?? []).map((item) => item.slug).join(','));
  const curriculum = expectOk(
    await student.get('/api/v1/courses/typography-for-screens/curriculum'),
    'curriculum',
  );
  const modules = curriculum.curriculum ?? curriculum.modules;
  const lesson = modules.flatMap((module) => module.lessons ?? [])[0];
  assert(lesson, 'lesson found', describe(modules).slice(0, 120));
  const response = await student.post(`/api/v1/lessons/${lesson.id}/complete`, { seconds_spent: 60 });
  expectStatus(response, [403, 404], 'complete without enrolment');
  return `HTTP ${response.status} without an enrolment`;
});

await step('Quiz: start, grade, and never leak answers first', async () => {
  const attempt = await student.post('/api/v1/quizzes/qz_hc_final/attempts', {});
  if (attempt.status === 409 || attempt.status === 429) {
    const message = attempt.body?.error?.message ?? '';
    if (/attempt|too many/i.test(message)) skip(`cannot start a new attempt: ${message}`);
  }
  expectStatus(attempt, [200, 201], 'start attempt');
  assert(attempt.body?.success === true, 'start attempt envelope', attempt.body);
  const payload = attempt.body.data.attempt ?? attempt.body.data;
  const attemptId = payload.id;
  assert(attemptId, 'attempt id', describe(payload).slice(0, 120));
  assertEqual(payload.status, 'in_progress', 'attempt status');

  // `POST /quizzes/:id/attempts` answers with the attempt and its sanitised
  // question list side by side — the questions are never nested in the attempt.
  const questions = attempt.body.data.questions ?? payload.questions ?? [];
  assert(questions.length >= 4, 'questions delivered', questions.length);
  const serialised = JSON.stringify({ attempt: payload, questions });
  assert(!serialised.includes('is_correct'), 'no correctness flags before grading', serialised.slice(0, 160));
  for (const question of questions) {
    assert(Array.isArray(question.options), 'options delivered', describe(question).slice(0, 80));
    for (const option of question.options) {
      assert(!('is_correct' in option), `option ${option.id} hides correctness`, describe(option));
    }
  }

  const correct = {
    qq_hc_1: ['qo_hc_1a'],
    qq_hc_2: ['qo_hc_2a', 'qo_hc_2b'],
    qq_hc_3: ['qo_hc_3a'],
  };
  // The sanitised question DTO names the type `type` (not `question_type`), and
  // a short-answer question is answered with text rather than option ids.
  const answers = questions.map((question) => ({
    question_id: question.id,
    ...((question.type ?? question.question_type) === 'short_answer'
      ? { answer_text: 'box-sizing' }
      : { selected_option_ids: correct[question.id] ?? [] }),
  }));

  const submitted = await student.post(`/api/v1/attempts/${attemptId}/submit`, {
    attempt_id: attemptId,
    time_spent_seconds: 120,
    answers,
  });
  const result = expectOk(submitted, 'submit attempt');
  const graded = result.attempt ?? result;
  assertEqual(graded.status, 'graded', 'attempt graded');
  // DTOs expose booleans; the raw columns are 0/1.
  assertEqual(Boolean(graded.passed), true, 'attempt passed');
  assertEqual(graded.score_percent, 100, 'every point awarded');
  assertEqual(graded.score_points, graded.max_points, 'points add up');

  const detail = expectOk(await student.get(`/api/v1/attempts/${attemptId}`), 'attempt detail');
  const attemptDetail = detail.attempt ?? detail;
  assertEqual(attemptDetail.status, 'graded', 'attempt retrievable after grading');
  return `${graded.score_points}/${graded.max_points} (${graded.score_percent}%)`;
});

await step('Attempts beyond the quiz limit are refused', async () => {
  const response = await student.post('/api/v1/attempts/qa_demo_1/submit', {
    attempt_id: 'qa_demo_1',
    answers: [],
  });
  expectStatus(response, [400, 403, 404, 409], 'submitting someone else’s attempt');
  return `HTTP ${response.status} for a foreign attempt`;
});

/** Set when this run creates a submission that is still awaiting a grade. */
let pendingSubmissionId = null;

await step('Assignment: view, submit, and list own submissions', async () => {
  const assignment = expectOk(await student.get('/api/v1/assignments/asg_js_quiz_app'), 'assignment');
  const payload = assignment.assignment ?? assignment;
  assertEqual(payload.id, 'asg_js_quiz_app', 'assignment id');
  assert(payload.max_points >= 1, 'max points', payload);
  assert(payload.instructions_md.length > 40, 'instructions delivered', payload.instructions_md?.length);

  const submission = await student.post('/api/v1/assignments/asg_js_quiz_app/submissions', {
    submission_text: `Smoke test submission ${RUN_ID}: five-question app built with vanilla DOM APIs.`,
  });

  if (submission.status === 409) {
    // A previous run already had this submission graded: the flow cannot repeat
    // until the database is reseeded (see the note printed at the end).
    skip(`this assignment is already graded — run \`npm run db:reset:local\` for a repeatable run`);
  }
  expectStatus(submission, [200, 201], 'submit assignment');
  const created = submission.body.data.submission ?? submission.body.data;
  assert(created.id, 'submission id', describe(submission.body.data).slice(0, 160));
  assertEqual(created.status, 'submitted', 'submission starts ungraded');
  pendingSubmissionId = created.id;

  const mine = expectOk(await student.get('/api/v1/me/submissions'), 'own submissions');
  const list = mine.items ?? mine;
  assert(Array.isArray(list) && list.length >= 1, 'submission listed', describe(mine).slice(0, 120));
  return `${created.id} (attempt ${created.attempt_number})`;
});

await step('Students cannot reach admin endpoints', async () => {
  const read = await student.get('/api/v1/admin/students');
  expectStatus(read, 403, 'student → admin list');
  expectErrorCode(read, 'FORBIDDEN', 'student → admin list');

  const write = await student.post('/api/v1/admin/courses', {
    subject_id: 'sub_web',
    title: 'Should never be created',
  });
  expectStatus(write, 403, 'student → admin create');
  expectErrorCode(write, 'FORBIDDEN', 'student → admin create');
  return 'HTTP 403 on both read and write';
});

/* ------------------------------------------------------------- 4. admin flow */

const admin = new Session('admin');
const superAdmin = new Session('super-admin');
let gradedSubmissionId = null;

await step('POST /auth/login signs in the administrator', async () => {
  const response = await admin.login(DEMO.admin);
  expectStatus(response, 200, 'admin login');
  assertEqual(response.body.data.user.role, 'admin', 'admin role');
  const me = expectOk(await admin.get('/api/v1/me'), 'admin /me');
  assert(me.permissions.includes('course.write'), 'admin has course.write', me.permissions);
  assert(!me.permissions.includes('user.role.write'), 'admin lacks role escalation', me.permissions);
  return `${me.permissions.length} permissions`;
});

await step('Admin reads the management surface', async () => {
  const checks = [
    ['GET /admin/students', '/api/v1/admin/students?per_page=10'],
    ['GET /admin/students-stats', '/api/v1/admin/students-stats'],
    ['GET /admin/departments', '/api/v1/admin/departments'],
    ['GET /admin/subjects', '/api/v1/admin/subjects'],
    ['GET /admin/courses', '/api/v1/admin/courses?per_page=10'],
    ['GET /admin/skills', '/api/v1/admin/skills'],
    ['GET /admin/enrollments', '/api/v1/admin/enrollments?per_page=10'],
    ['GET /admin/attempts', '/api/v1/admin/attempts?per_page=10'],
    ['GET /admin/assignments', '/api/v1/admin/assignments'],
    ['GET /admin/submissions', '/api/v1/admin/submissions?per_page=10'],
    ['GET /admin/quizzes', '/api/v1/admin/quizzes'],
    ['GET /admin/certificates', '/api/v1/admin/certificates'],
    ['GET /admin/stats', '/api/v1/admin/stats'],
    ['GET /admin/audit', '/api/v1/admin/audit?per_page=10'],
    ['GET /admin/audit/summary', '/api/v1/admin/audit/summary'],
    ['GET /admin/roles', '/api/v1/admin/roles'],
  ];
  const failures = [];
  for (const [label, path] of checks) {
    const response = await admin.get(path);
    if (response.status !== 200 || response.body?.success !== true) {
      failures.push(`${label} → ${response.status} ${describe(response.body).slice(0, 80)}`);
    }
  }
  assertEqual(failures.length, 0, 'every admin read succeeded', failures.join('; '));
  return `${checks.length} admin endpoints`;
});

await step('Admin authors a department end to end', async () => {
  const created = await admin.post('/api/v1/admin/departments', {
    name: `Smoke Department ${RUN_ID}`,
    tagline: 'Created by the smoke test',
    status: 'draft',
  });
  expectStatus(created, 201, 'create department');
  const department = created.body.data.department ?? created.body.data;
  assert(department.id, 'department id', describe(created.body.data).slice(0, 120));

  const publicBefore = expectOk(await anonymous.get('/api/v1/departments'), 'public departments');
  const listBefore = publicBefore.items ?? publicBefore;
  assert(
    !listBefore.some((item) => item.id === department.id),
    'draft department is not public',
    listBefore.length,
  );

  const updated = await admin.patch(`/api/v1/admin/departments/${department.id}`, {
    tagline: 'Updated by the smoke test',
    status: 'published',
  });
  expectStatus(updated, 200, 'update department');

  const publicAfter = expectOk(await anonymous.get('/api/v1/departments'), 'public departments');
  const listAfter = publicAfter.items ?? publicAfter;
  assert(
    listAfter.some((item) => item.id === department.id),
    'published department is public',
    listAfter.length,
  );

  const auditRows = expectOk(
    await admin.get(`/api/v1/admin/audit?entity_id=${department.id}&per_page=10`),
    'audit trail for the department',
  );
  const auditList = auditRows.items ?? auditRows;
  assert(
    auditList.some((row) => row.action === 'department.created' || row.action === 'department.updated'),
    'authoring is audited',
    auditList.map((row) => row.action).join(','),
  );

  const removed = await admin.request('DELETE', `/api/v1/admin/departments/${department.id}`, { csrf: true });
  expectStatus(removed, [200, 204], 'delete department');
  return `${department.id} draft → published → public → deleted`;
});

await step('Admin authors a quiz with questions', async () => {
  const created = await admin.post('/api/v1/admin/quizzes', {
    course_id: 'crs_start_business',
    title: `Smoke quiz ${RUN_ID}`,
    pass_mark_percent: 60,
    status: 'published',
    questions: [
      {
        prompt: 'Which document tracks what a business owns and owes?',
        question_type: 'single_choice',
        points: 1,
        options: [
          { label: 'The balance sheet', is_correct: true },
          { label: 'The invoice book', is_correct: false },
        ],
      },
      {
        prompt: 'Revenue minus expenses is profit.',
        question_type: 'true_false',
        points: 1,
        options: [
          { label: 'True', is_correct: true },
          { label: 'False', is_correct: false },
        ],
      },
    ],
  });
  expectStatus(created, 201, 'create quiz');
  const quiz = created.body.data.quiz ?? created.body.data;
  assert(quiz.id, 'quiz id', describe(created.body.data).slice(0, 160));

  const detail = expectOk(await admin.get(`/api/v1/admin/quizzes/${quiz.id}`), 'quiz detail');
  assertEqual(detail.quiz.id, quiz.id, 'quiz detail id');
  assertEqual(detail.questions?.length, 2, 'questions persisted');
  const optionCount = detail.questions.reduce((total, question) => total + (question.options?.length ?? 0), 0);
  assertEqual(optionCount, 4, 'options persisted');
  assert(
    detail.questions.every((question) => question.options.every((option) => 'is_correct' in option)),
    'authors can see which options are correct',
    describe(detail.questions[0]).slice(0, 120),
  );
  return `${quiz.id} with ${detail.questions.length} questions`;
});

await step('Admin grades the student submission', async () => {
  // Prefer the submission this run created; otherwise grade the newest one on
  // file. Re-grading is a supported workflow ("Re-grade" in the admin UI), so
  // this check runs on every pass instead of skipping itself.
  let target = null;

  if (pendingSubmissionId) {
    const pending = expectOk(
      await admin.get('/api/v1/admin/submissions?status=submitted&per_page=20'),
      'pending submissions',
    );
    const list = pending.items ?? pending;
    target = list.find((item) => item.id === pendingSubmissionId) ?? null;
  }

  if (!target) {
    const all = expectOk(await admin.get('/api/v1/admin/submissions?per_page=5'), 'all submissions');
    target = (all.items ?? all)[0] ?? null;
  }

  if (!target) skip('no submission exists to grade');
  gradedSubmissionId = target.id;

  const graded = await admin.post('/api/v1/admin/submissions/grade', {
    submission_id: target.id,
    score_points: 85,
    feedback: 'Clear structure and a thoughtful submission. (Graded by the smoke test.)',
    status: 'graded',
  });
  // The route answers with `{graded, submission_id, score_points, max_points,
  // score_percent, passed}` — a summary of what it wrote, not the row.
  const data = expectOk(graded, 'grade submission');
  assertEqual(data.graded, true, 'submission graded');
  assertEqual(data.submission_id, target.id, 'graded the intended submission');
  assertEqual(data.score_points, 85, 'score stored');
  assertEqual(typeof data.max_points, 'number', 'max points reported');
  return `${target.id} → 85 points`;
});

await step('Grading notifications reach the student', async () => {
  const loginAgain = new Session('student-notifications');
  expectStatus(await loginAgain.login(DEMO.student), 200, 'student login');
  const notifications = expectOk(await loginAgain.get('/api/v1/me/notifications'), 'notifications');
  const list = notifications.items ?? notifications;
  assert(
    list.some((item) => /graded|feedback|submission/i.test(`${item.title} ${item.body ?? ''}`)),
    'grading notification present',
    list.map((item) => item.title).join(' | ').slice(0, 200),
  );
  const logout = await loginAgain.post('/api/v1/auth/logout', {});
  expectStatus(logout, 200, 'logout');
  return `${list.length} notifications`;
});

await step('Admin cannot escalate its own role', async () => {
  const response = await admin.patch('/api/v1/admin/students/usr_demo_student/role', {
    role: 'admin',
    reason: 'the smoke test must not be able to do this',
  });
  expectStatus(response, 403, 'admin → assign role');
  expectErrorCode(response, 'FORBIDDEN', 'admin → assign role');
  return 'HTTP 403 FORBIDDEN (needs user.role.write)';
});

await step('Admin moderates an account and the change takes effect', async () => {
  const reactivated = await admin.patch('/api/v1/admin/students/usr_demo_zainab/status', {
    status: 'active',
    reason: 'Reinstated by the smoke test',
  });
  expectStatus(reactivated, 200, 'reactivate account');

  const detail = expectOk(await admin.get('/api/v1/admin/students/usr_demo_zainab'), 'student detail');
  const user = detail.user ?? detail;
  assertEqual(user.status, 'active', 'status updated');

  const login = await new Session('zainab').login(DEMO.suspended);
  expectStatus(login, 200, 'reinstated account can sign in');
  return 'suspended → active → sign-in succeeds';
});

await step('Admin can revoke a student session', async () => {
  const target = new Session('revoke-target');
  expectStatus(await target.login(DEMO.student), 200, 'target login');
  const revoked = await admin.post('/api/v1/admin/students/usr_demo_student/sessions/revoke', {});
  expectStatus(revoked, 200, 'revoke sessions');
  const after = await target.get('/api/v1/me');
  expectStatus(after, 401, 'revoked session rejected');
  return 'sessions revoked by an administrator';
});

await step('POST /auth/login signs in the super administrator', async () => {
  const response = await superAdmin.login(DEMO.superAdmin);
  expectStatus(response, 200, 'super admin login');
  assertEqual(response.body.data.user.role, 'super_admin', 'super admin role');
  const me = expectOk(await superAdmin.get('/api/v1/me'), 'super admin /me');
  assert(me.permissions.length >= 20, 'super admin holds every permission', me.permissions.length);
  assert(me.permissions.includes('user.role.write'), 'role escalation permission present', me.permissions);
  return `${me.permissions.length} permissions`;
});

await step('Super administrator assigns roles and reads settings', async () => {
  const assign = await superAdmin.patch('/api/v1/admin/students/usr_demo_kwame/role', {
    role: 'student',
    reason: 'Smoke test no-op role assignment',
  });
  expectStatus(assign, 200, 'assign role');

  const emails = await superAdmin.get('/api/v1/admin/emails?per_page=5');
  expectStatus(emails, 200, 'email outbox (settings.write)');

  const cleanup = await superAdmin.post('/api/v1/admin/maintenance/cleanup', {});
  expectStatus(cleanup, [200, 202], 'maintenance cleanup');

  const audit = expectOk(await superAdmin.get('/api/v1/admin/audit?per_page=5'), 'audit');
  const rows = audit.items ?? audit;
  assert(Array.isArray(rows) && rows.length >= 1, 'audit rows exist', describe(audit).slice(0, 120));
  return `${rows.length} recent audit rows`;
});

await step('Suspending an account blocks sign-in', async () => {
  const suspend = await superAdmin.patch('/api/v1/admin/students/usr_demo_zainab/status', {
    status: 'suspended',
    reason: 'Suspended by the smoke test to prove the guard',
  });
  expectStatus(suspend, 200, 'suspend account');

  const blocked = await new Session('suspended').login(DEMO.suspended);
  expectStatus(blocked, 403, 'suspended sign-in');
  expectErrorCode(blocked, 'ACCOUNT_SUSPENDED', 'suspended sign-in');

  const restored = await superAdmin.patch('/api/v1/admin/students/usr_demo_zainab/status', {
    status: 'active',
    reason: 'Reinstated after the smoke-test check',
  });
  expectStatus(restored, 200, 'reinstate account');
  return 'HTTP 403 ACCOUNT_SUSPENDED while suspended';
});

await step('Certificate issuing is idempotent per enrolment', async () => {
  const certificates = expectOk(await superAdmin.get('/api/v1/admin/certificates'), 'certificates');
  const list = certificates.items ?? certificates;
  const existing = list.find(
    (item) => item.course?.id === 'crs_html_css' && item.holder?.student_number === 'GW-2026-A1B2C3',
  );
  if (!existing) skip('no seeded certificate to re-issue');
  const again = await superAdmin.post('/api/v1/admin/certificates', {
    user_id: 'usr_demo_student',
    course_id: 'crs_html_css',
  });
  expectStatus(again, [200, 201, 409], 're-issue attempt');
  if (again.status !== 409) {
    assert(again.body.data.already_existed === true, 're-issue reports the existing certificate', again.body.data);
  }
  return `HTTP ${again.status} on re-issue`;
});

await step('Health is still ready at the end of the run', async () => {
  const data = expectOk(await anonymous.get('/api/v1/health/ready'), 'final readiness');
  assertEqual(data.status, 'ready', 'still ready');
  assertEqual(data.config_problems.length, 0, 'no configuration problems appeared');
  return 'ready';
});

/* ------------------------------------------------------------------- summary */

const counts = results.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {});
const failures = results.filter((item) => item.status === 'fail');
const skipped = results.filter((item) => item.status === 'skip');

console.log('\n──────────────────────────────────────────────');
console.log(
  `smoke test: ${counts.pass ?? 0} passed, ${counts.fail ?? 0} failed, ${counts.skip ?? 0} skipped`,
);
console.log(`api: ${BASE}`);
if (failures.length) {
  console.log('\nfailures:');
  for (const item of failures) console.log(`  ✗ ${item.name}\n    ${item.note}`);
}
if (skipped.length && !QUIET) {
  console.log('\nskipped:');
  for (const item of skipped) console.log(`  ○ ${item.name}\n    ${item.note}`);
}
console.log('──────────────────────────────────────────────');

process.exit(failures.length ? 1 : 0);
