#!/usr/bin/env node
/**
 * Sholynk Tech — end-to-end API smoke test (the destructive pass).
 *
 *   npm run dev            # API on :8787 + site on :5173, seeded local D1
 *   npm run test:smoke
 *
 * Unlike tests/integration (read-only), this script exercises the full
 * editorial lifecycle against the *live local* API and cleans up after itself:
 *
 *   auth (admin + editor) · CSRF boundary · article create/publish/rename/delete
 *   · the submit-for-review queue and its notification email · SSR document
 *   rendering · legacy redirects · reactions/comments/views (incl. idempotency)
 *   · newsletter + contact forms (incl. the honeypot) · R2 media upload/serve/
 *   delete · analytics overview · the live SSE stream · settings · authors
 *
 * Exit code 0 = every step passed. Every mutation is undone where possible;
 * the leftovers (a revoked session, an audit trail) are the point.
 */
import process from 'node:process';

const BASE = (process.env.API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '') + '/api/v1';
const ADMIN = { email: 'admin@sholynk.test', password: 'AdminPassword123!' };
const EDITOR = { email: 'editor@sholynk.test', password: 'EditorPassword123!' };
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

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  log(ok, label, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return ok;
}

/* ------------------------------------------------------------------ plumbing */

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

async function call(path, { method = 'GET', body, jar, csrf, form, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (jar) headers.cookie = jar.header();
  const useCsrf = csrf ?? (method !== 'GET' ? jar?.get('sk_csrf') : undefined);
  if (useCsrf) headers['x-csrf-token'] = useCsrf;

  let payload;
  if (form) {
    payload = new URLSearchParams(form).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${path}`, { method, headers, body: payload, redirect: 'manual' });
  jar?.absorb(response);
  if (raw) return { response, text: await response.text() };
  if (response.status === 204) return { response, json: null };
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, json, text };
}

async function login(credentials) {
  const jar = new Jar();
  const { response, json } = await call('/auth/login', { method: 'POST', body: credentials, jar });
  if (response.status !== 200) {
    throw new Error(`login failed for ${credentials.email}: ${response.status} ${JSON.stringify(json?.error ?? json)}`);
  }
  return jar;
}

/* A real (tiny) PNG so the upload path validates magic bytes, not just a MIME header. */
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
);

async function uploadImage(jar, alt = 'A single blue pixel') {
  const boundary = `----smoke${Date.now().toString(16)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="smoke-pixel.png"\r\n` +
      'Content-Type: image/png\r\n\r\n',
  );
  const middle = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\n${alt}\r\n--${boundary}--\r\n`);
  const bodyBuffer = Buffer.concat([head, Buffer.from(PNG_BYTES), middle]);

  const response = await fetch(`${BASE}/admin/images`, {
    method: 'POST',
    headers: {
      cookie: jar.header(),
      'x-csrf-token': jar.get('sk_csrf') ?? '',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyBuffer,
  });
  const json = await response.json().catch(() => null);
  return { response, json };
}

/* --------------------------------------------------------------------- steps */

async function main() {
  console.log(`Sholynk Tech API smoke test → ${BASE}\n`);

  // 0. reachability + a clean rate-limit slate (dev route)
  {
    const { response } = await fetch(`${BASE}/health`).then((r) => ({ response: r })).catch(() => ({ response: null }));
    if (!response?.ok) {
      console.error('The API is not reachable. Start it with `npm run dev` (or `npm run dev:api`) and seed with `npm run db:reset:local`.');
      process.exit(1);
    }
    await call('/auth/dev/reset-limits', { method: 'POST' });
  }

  // 1. health
  {
    const { json } = await call('/health');
    assert(json?.success && json?.data?.status === 'ok', 'health reports ok');
    const ready = await call('/health/ready');
    assert(
      ready.json?.data?.database?.reachable && ready.json?.data?.database?.migrations_applied,
      'readiness sees a migrated database',
      `articles=${ready.json?.data?.database?.articles ?? '?'}`,
    );
  }

  // 2. anonymous boundary
  {
    const { response } = await call('/articles?status=all');
    assertEqual(response.status, 401, 'anonymous cannot list unpublished articles');
    const admin = await call('/admin/analytics/overview');
    assertEqual(admin.response.status, 401, 'anonymous cannot read analytics');
  }

  // 3. admin session
  const adminJar = await login(ADMIN);
  assert(Boolean(adminJar.get('sk_session')) && Boolean(adminJar.get('sk_csrf')), 'admin signs in and receives session + CSRF cookies');
  {
    const { json } = await call('/auth/me', { jar: adminJar });
    assertEqual(json?.data?.user?.role, 'super_admin', 'admin /me reports super_admin');
    const all = await call('/articles?status=all', { jar: adminJar });
    assert(all.json?.data?.length >= 56, 'editorial session lists the full catalogue', `${all.json?.data?.length} articles`);
  }

  // 4. CSRF boundary
  {
    const { response } = await call('/admin/settings', { method: 'PUT', body: { siteTitle: 'hijacked' }, jar: adminJar, csrf: 'wrong-token' });
    assertEqual(response.status, 403, 'a session cookie without a valid CSRF token is refused');
  }

  // 4b. inbox pagination envelope
  {
    const subs = await call('/admin/subscriptions?page=1&limit=2', { jar: adminJar });
    assertEqual(subs.response.status, 200, 'subscribers read with a page size');
    const subsMeta = subs.json?.meta?.pagination;
    assert(Boolean(subsMeta), 'the subscriber list returns pagination metadata');
    assert((subs.json?.data ?? []).length <= 2, 'the subscriber page respects its limit', String((subs.json?.data ?? []).length));
    assert(Number(subsMeta?.total) >= (subs.json?.data ?? []).length, 'the subscriber total covers the page');
    assert(Number(subsMeta?.total_pages) >= 1, 'the subscriber envelope reports a page count');

    const messages = await call('/admin/contact-messages?page=1&limit=1', { jar: adminJar });
    assertEqual(messages.response.status, 200, 'contact messages read with a page size');
    assert(Boolean(messages.json?.meta?.pagination), 'the message list returns pagination metadata');

    const comments = await call('/admin/comments?limit=1', { jar: adminJar });
    assertEqual(typeof comments.json?.meta?.total, 'number', 'the comment list reports how many entries exist in total');
  }

  // 5. article lifecycle (create draft → publish → rename → redirect → delete)
  const stamp = Date.now().toString(36);
  const draftTitle = `Smoke Test Story ${stamp}`;
  let articleId = null;
  let articleSlug = null;
  {
    const created = await call('/admin/articles', {
      method: 'POST',
      jar: adminJar,
      body: {
        title: draftTitle,
        category: 'Technology',
        description: 'A temporary story created by the API smoke test.',
        status: 'draft',
        body: '## Introduction\n\nDraft body for the smoke test.',
        img: '',
        author: 'Oluwashola Busari',
        authorSlug: 'oluwashola-busari',
      },
    });
    assertEqual(created.response.status, 201, 'admin creates a draft article');
    articleId = created.json?.data?.id;
    articleSlug = created.json?.data?.slug;
    assert(Boolean(articleId) && Boolean(articleSlug), 'the draft has an id and an auto slug', articleSlug ?? '');

    const published = await call(`/admin/articles/${articleId}`, {
      method: 'PUT',
      jar: adminJar,
      body: { status: 'published', body: '## Introduction\n\nPublished body.\n\n## Second section\n\nMore text.' },
    });
    assertEqual(published.json?.data?.status, 'published', 'admin publishes the draft');

    const publicRead = await call(`/articles/${articleSlug}`);
    assertEqual(publicRead.json?.data?.title, draftTitle, 'the published article is readable anonymously');

    // Optimistic concurrency: a save based on a stale `updatedAt` must not
    // overwrite the newer version, it must come back as a 409.
    const staleSave = await call(`/admin/articles/${articleId}`, {
      method: 'PUT',
      jar: adminJar,
      body: { title: `${draftTitle} (stale overwrite)`, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
    });
    assertEqual(staleSave.response.status, 409, 'a stale save is rejected with 409');
    assertEqual(staleSave.json?.error?.code, 'CONFLICT', 'the stale save reports CONFLICT');
    const afterConflict = await call(`/articles/${articleId}`);
    assertEqual(afterConflict.json?.data?.title, draftTitle, 'the stale save left the article untouched');

    // The same save with the version the editor actually loaded succeeds.
    const freshSave = await call(`/admin/articles/${articleId}`, {
      method: 'PUT',
      jar: adminJar,
      body: { title: `${draftTitle} (edited)`, expectedUpdatedAt: published.json?.data?.updatedAt },
    });
    assertEqual(freshSave.json?.data?.title, `${draftTitle} (edited)`, 'a save with the current version is accepted');
    const restoredTitle = await call(`/admin/articles/${articleId}`, {
      method: 'PUT',
      jar: adminJar,
      body: { title: draftTitle, expectedUpdatedAt: freshSave.json?.data?.updatedAt },
    });
    assertEqual(restoredTitle.json?.data?.title, draftTitle, 'the smoke article title is restored');

    const renamedSlug = `${articleSlug}-renamed`;
    const renamed = await call(`/admin/articles/${articleId}`, { method: 'PUT', jar: adminJar, body: { slug: renamedSlug } });
    assertEqual(renamed.json?.data?.slug, renamedSlug, 'renaming the article moves its slug');

    const oldUrl = await call(`/render/articles/${articleSlug}?origin=http://127.0.0.1:8787`, { raw: true });
    assertEqual(oldUrl.response.status, 301, 'the old clean URL 301-redirects');
    assert(
      (oldUrl.response.headers.get('location') ?? '').endsWith(`/articles/${renamedSlug}/`),
      'the redirect points at the new slug',
      oldUrl.response.headers.get('location') ?? '',
    );
  }

  // 6. SSR rendering + legacy redirects
  {
    const { response, text } = await call(`/render/articles/${SEEDED_STORY}?origin=http://127.0.0.1:8787`, { raw: true });
    assertEqual(response.status, 200, 'the seeded story renders at its clean URL');
    assert(text.includes('data-server-rendered="true"'), 'the SSR document carries the server-rendered marker');
    assert(text.includes('<link rel="canonical"'), 'the SSR document carries a canonical URL');
    assert(text.includes('application/ld+json'), 'the SSR document carries JSON-LD');

    const legacy = await call(`/render/legacy-article?slug=${SEEDED_STORY}&origin=http://127.0.0.1:8787`, { raw: true });
    assertEqual(legacy.response.status, 301, 'legacy article.html?slug= redirects');
    assertEqual(legacy.response.headers.get('location'), `/articles/${SEEDED_STORY}/`, 'the legacy redirect targets the clean URL');

    const missing = await call('/render/articles/no-such-story?origin=http://127.0.0.1:8787', { raw: true });
    assertEqual(missing.response.status, 404, 'an unknown story 404s as a document');
  }

  // 7. robots + sitemap from live data
  {
    const robots = await call('/seo/robots.txt?origin=http://127.0.0.1:8787', { raw: true });
    assert(robots.text.includes('Sitemap: http://127.0.0.1:8787/sitemap.xml'), 'robots.txt advertises the sitemap');
    const sitemap = await call('/seo/sitemap.xml?origin=http://127.0.0.1:8787', { raw: true });
    assert(sitemap.text.includes(`<loc>http://127.0.0.1:8787/articles/${SEEDED_STORY}/</loc>`), 'sitemap.xml lists the seeded story');
  }

  // 8. engagement: reactions, comments (idempotent), views (once per day)
  const voter = `smoke-${stamp}`;
  {
    const baseline = await call(`/articles/${SEEDED_STORY}/reactions?voterId=${voter}`);
    const baseLikes = baseline.json?.data?.likes ?? 0;
    const baseDislikes = baseline.json?.data?.dislikes ?? 0;

    const first = await call(`/articles/${SEEDED_STORY}/reactions`, { method: 'POST', body: { voterId: voter, type: 'like' } });
    assertEqual(
      first.json?.data,
      { slug: SEEDED_STORY, likes: baseLikes + 1, dislikes: baseDislikes, mine: 'like' },
      'a like is recorded',
    );
    const again = await call(`/articles/${SEEDED_STORY}/reactions`, { method: 'POST', body: { voterId: voter, type: 'like' } });
    assertEqual(again.json?.data?.mine, null, 'liking twice un-votes (legacy toggle rule)');
    assertEqual(again.json?.data?.likes, baseLikes, 'the un-vote restores the count');
    const flip = await call(`/articles/${SEEDED_STORY}/reactions`, { method: 'POST', body: { voterId: voter, type: 'dislike' } });
    assertEqual(
      flip.json?.data,
      { slug: SEEDED_STORY, likes: baseLikes, dislikes: baseDislikes + 1, mine: 'dislike' },
      'voting the other type switches sides',
    );
    // clean up: un-vote restores the baseline exactly
    const cleaned = await call(`/articles/${SEEDED_STORY}/reactions`, { method: 'POST', body: { voterId: voter, type: 'dislike' } });
    assertEqual(cleaned.json?.data, { slug: SEEDED_STORY, likes: baseLikes, dislikes: baseDislikes, mine: null }, 'the smoke voter leaves no trace');

    const clientId = `smoke-comment-${stamp}`;
    const comment = await call(`/articles/${SEEDED_STORY}/comments`, {
      method: 'POST',
      body: { author: 'Smoke Tester', body: 'A comment from the smoke test.', voterId: voter, clientId },
    });
    assertEqual(comment.response.status, 201, 'a comment is accepted');
    const commentId = comment.json?.data?.id;
    const retried = await call(`/articles/${SEEDED_STORY}/comments`, {
      method: 'POST',
      body: { author: 'Smoke Tester', body: 'A comment from the smoke test.', voterId: voter, clientId },
    });
    assertEqual(retried.json?.data?.id, commentId, 'the same clientId returns the original comment (idempotent retry)');

    const view1 = await call(`/articles/${SEEDED_STORY}/views`, { method: 'POST', body: { voterId: voter } });
    assertEqual(view1.json?.data?.counted, true, 'the first read of the day counts');
    const view2 = await call(`/articles/${SEEDED_STORY}/views`, { method: 'POST', body: { voterId: voter } });
    assertEqual(view2.json?.data?.counted, false, 'a repeat read by the same viewer does not count');
    const unknownView = await call('/articles/no-such-story/views', { method: 'POST', body: { voterId: voter } });
    assertEqual(unknownView.response.status, 404, 'views for unknown slugs are rejected');
    assertEqual(unknownView.json?.error?.code, 'NOT_FOUND', 'unknown article views use the standard error envelope');

    // moderation deletes the smoke comment
    const list = await call('/admin/comments?limit=200', { jar: adminJar });
    assert(list.json?.data?.some((row) => row.id === commentId), 'the comment appears in the moderation history');
    const deleted = await call(`/admin/comments/${commentId}`, { method: 'DELETE', jar: adminJar });
    assertEqual(deleted.response.status, 204, 'the moderator deletes the comment');
  }

  // 9. public forms + honeypot
  const subscriberEmail = `smoke-${stamp}@example.com`;
  {
    const subscribed = await call('/subscriptions', { method: 'POST', form: { name: 'Smoke Tester', email: subscriberEmail } });
    assertEqual(subscribed.response.status, 201, 'the newsletter form accepts a urlencoded submission');
    const trapped = await call('/subscriptions', {
      method: 'POST',
      form: { name: 'Bot', email: `bot-${stamp}@example.com`, 'bot-field': 'http://spam.example' },
    });
    assertEqual(trapped.response.status, 201, 'the honeypot pretends to accept the bot');

    const message = await call('/contact', {
      method: 'POST',
      form: { name: 'Smoke Tester', email: subscriberEmail, subject: `Smoke ${stamp}`, message: 'A message long enough to pass validation.' },
    });
    assertEqual(message.response.status, 201, 'the contact form accepts a urlencoded submission');
    const trappedMessage = await call('/contact', {
      method: 'POST',
      form: { name: 'Bot', email: `bot-${stamp}@example.com`, subject: 'spam', message: 'spam spam spam spam', website: 'x' },
    });
    assertEqual(trappedMessage.response.status, 201, 'the contact honeypot pretends to accept the bot');

    const subscribers = await call('/admin/subscriptions', { jar: adminJar });
    const rows = subscribers.json?.data ?? [];
    assert(rows.some((row) => row.email === subscriberEmail), 'the real subscriber is stored');
    assert(!rows.some((row) => row.email === `bot-${stamp}@example.com`), 'the trapped bot is NOT stored');
    const realRow = rows.find((row) => row.email === subscriberEmail);
    if (realRow) {
      const removed = await call(`/admin/subscriptions/${realRow.id}`, { method: 'DELETE', jar: adminJar });
      assertEqual(removed.response.status, 204, 'the subscriber is removable from the inbox');
    }

    const messages = await call('/admin/contact-messages', { jar: adminJar });
    const messageRow = (messages.json?.data ?? []).find((row) => row.subject === `Smoke ${stamp}`);
    assert(Boolean(messageRow), 'the contact message is stored');
    assert(!(messages.json?.data ?? []).some((row) => row.subject === 'spam'), 'the trapped contact message is NOT stored');
    if (messageRow) {
      const marked = await call(`/admin/contact-messages/${messageRow.id}`, { method: 'PATCH', jar: adminJar, body: { status: 'read' } });
      assertEqual(marked.json?.data?.status, 'read', 'the message can be marked read');
      const removed = await call(`/admin/contact-messages/${messageRow.id}`, { method: 'DELETE', jar: adminJar });
      assertEqual(removed.response.status, 204, 'the message is removable from the inbox');
    }
  }

  // 10. media upload → serve → recaption → delete (R2)
  {
    const upload = await uploadImage(adminJar);
    if (upload.response.status === 503) {
      log(true, 'media upload skipped (R2 not bound in this environment)', 'DEPENDENCY_UNAVAILABLE handled gracefully');
    } else {
      assertEqual(upload.response.status, 201, 'a valid PNG uploads to the media library');
      const record = upload.json?.data;
      assert(record?.url?.startsWith('/uploads/'), 'the record exposes the legacy /uploads URL shape', record?.url ?? '');

      // The worker serves media at /api/v1/uploads/<file>; the site proxy maps
      // the public /uploads/<file> URLs onto it (functions/uploads/[[path]].ts,
      // mirrored by scripts/dev-server.mjs in development).
      const served = await fetch(`${BASE}${record.url}`);
      assertEqual(served.status, 200, 'the uploaded file streams back from the API route');
      assertEqual(served.headers.get('content-type'), 'image/png', 'the served content type is the sniffed one');

      // A text file wearing an image MIME header must be refused.
      const badBoundary = `----bad${Date.now().toString(16)}`;
      const badBody = Buffer.concat([
        Buffer.from(`--${badBoundary}\r\nContent-Disposition: form-data; name="image"; filename="evil.png"\r\nContent-Type: image/png\r\n\r\n`),
        Buffer.from('<script>alert(1)</script>'),
        Buffer.from(`\r\n--${badBoundary}--\r\n`),
      ]);
      const bad = await fetch(`${BASE}/admin/images`, {
        method: 'POST',
        headers: { cookie: adminJar.header(), 'x-csrf-token': adminJar.get('sk_csrf') ?? '', 'content-type': `multipart/form-data; boundary=${badBoundary}` },
        body: badBody,
      });
      assertEqual(bad.status, 422, 'HTML disguised as an image is refused (validation envelope)');

      const recaptioned = await call(`/admin/images/${record.id}`, { method: 'PATCH', jar: adminJar, body: { alt: 'Updated alt text' } });
      assertEqual(recaptioned.json?.data?.alt, 'Updated alt text', 'alt text is editable');

      const deleted = await call(`/admin/images/${record.id}`, { method: 'DELETE', jar: adminJar });
      assertEqual(deleted.response.status, 204, 'the image is deletable');
      const afterDelete = await fetch(`${BASE}${record.url}`);
      assertEqual(afterDelete.status, 404, 'the deleted file no longer streams');
    }
  }

  // 11. editor role: can submit, cannot publish
  {
    const editorJar = await login(EDITOR);
    const editorMe = await call('/auth/me', { jar: editorJar });
    assertEqual(editorMe.json?.data?.user?.role, 'editor', 'the editor account signs in');

    const editorPublishAttempt = await call('/admin/articles', {
      method: 'POST',
      jar: editorJar,
      body: {
        title: `Editor Publish Attempt ${stamp}`,
        category: 'Technology',
        description: 'An editor cannot self-publish; this must land in the review queue instead.',
        status: 'published',
        body: `## Introduction\n\n${'The editor tried to publish directly. '.repeat(10)}`,
        tags: ['smoke', 'editorial'],
        submitterEmail: EDITOR.email,
      },
    });
    assertEqual(editorPublishAttempt.json?.data?.status, 'pending', "an editor's publish attempt is redirected to pending review");
    assert(
      Boolean(editorPublishAttempt.json?.data?.reviewNotice),
      'the response carries the review notice',
    );

    const outbox = await call('/auth/dev/outbox');
    const reviewEmail = (outbox.json?.data ?? []).find((row) => row.template === 'review_submission');
    assert(Boolean(reviewEmail), 'the review notification reached the email outbox');
    assertEqual(reviewEmail?.to, 'sholynktech@gmail.com', 'the review email is addressed to the editor inbox');

        const editorDelete = await call(`/admin/articles/${articleId}`, { method: 'DELETE', jar: editorJar });
    assertEqual(editorDelete.response.status, 403, 'an editor cannot delete articles');

    // cleanup: admin removes the editor's pending article
    const pendingId = editorPublishAttempt.json?.data?.id;
    if (pendingId) {
      const removed = await call(`/admin/articles/${pendingId}`, { method: 'DELETE', jar: adminJar });
      assertEqual(removed.response.status, 204, 'the admin cleans up the pending submission');
    }
    await call('/auth/logout', { method: 'POST', jar: editorJar });
  }

  // 12. analytics + the live SSE stream
  {
    const overview = await call('/admin/analytics/overview?days=7', { jar: adminJar });
    const totals = overview.json?.data?.totals;
    assert(totals?.articles >= 56, 'the analytics overview counts the catalogue', `articles=${totals?.articles}`);
    assert(Array.isArray(overview.json?.data?.series) && overview.json.data.series.length === 7, 'the daily series is zero-filled for the whole window');
    assert(Array.isArray(overview.json?.data?.authors) && overview.json.data.authors.length >= 1, 'the author leaderboard includes the house author');

    const controller = new AbortController();
    const streamResponse = await fetch(`${BASE}/admin/analytics/stream`, {
      headers: { cookie: adminJar.header(), accept: 'text/event-stream' },
      signal: controller.signal,
    });
    assertEqual(streamResponse.status, 200, 'the SSE stream opens for the admin session');
    assertEqual(streamResponse.headers.get('content-type'), 'text/event-stream', 'the stream has the SSE content type');
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let sawReady = false;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !sawReady) {
      const { value, done } = await reader.read();
      if (done) break;
      sawReady = decoder.decode(value, { stream: true }).includes('event: ready');
    }
    controller.abort();
    assert(sawReady, 'the stream emits its ready event');

    const anonymousStream = await fetch(`${BASE}/admin/analytics/stream`);
    assertEqual(anonymousStream.status, 401, 'the SSE stream is admin-only');
    anonymousStream.body?.cancel().catch(() => {});
  }

  // 13. settings round-trip
  {
    const before = await call('/settings');
    const originalTagline = before.json?.data?.homeTagline;
    const changed = await call('/admin/settings', { method: 'PUT', jar: adminJar, body: { homeTagline: `Smoke tagline ${stamp}` } });
    assertEqual(changed.json?.data?.homeTagline, `Smoke tagline ${stamp}`, 'the admin updates the homepage tagline');
    const homeMeta = await call('/render/home-meta?origin=http://127.0.0.1:8787');
    assertEqual(homeMeta.json?.tagline, `Smoke tagline ${stamp}`, 'the homepage renderer picks the tagline up');
    const restored = await call('/admin/settings', { method: 'PUT', jar: adminJar, body: { homeTagline: originalTagline } });
    assertEqual(restored.json?.data?.homeTagline, originalTagline, 'the tagline is restored');
  }

  // 14. authors CRUD + the house author guard
  {
    const created = await call('/admin/authors', { method: 'POST', jar: adminJar, body: { name: `Smoke Author ${stamp}`, role: 'Tester', bio: 'Temporary.' } });
    assertEqual(created.response.status, 201, 'a contributor author can be created');
    const authorId = created.json?.data?.id;
    const patched = await call(`/admin/authors/${authorId}`, { method: 'PATCH', jar: adminJar, body: { bio: 'Updated bio.' } });
    assertEqual(patched.json?.data?.bio, 'Updated bio.', 'the author profile is editable');

    const house = await call('/authors/oluwashola-busari');
    const houseDelete = await call(`/admin/authors/${house.json?.data?.id}`, { method: 'DELETE', jar: adminJar });
    assertEqual(houseDelete.response.status, 422, 'the house author cannot be deleted');

    const removed = await call(`/admin/authors/${authorId}`, { method: 'DELETE', jar: adminJar });
    assertEqual(removed.response.status, 204, 'a contributor author can be deleted');
  }

  // 15. cleanup: delete the smoke article, sign out, restore demo passwords
  {
    const deleted = await call(`/admin/articles/${articleId}`, { method: 'DELETE', jar: adminJar });
    assertEqual(deleted.response.status, 204, 'the smoke article is deleted');
    const gone = await call(`/articles/${articleSlug}-renamed`);
    assertEqual(gone.response.status, 404, 'the deleted article is gone from the public API');

    const maintenance = await call('/admin/system/maintenance', { method: 'POST', jar: adminJar });
    assert(maintenance.json?.success === true, 'the maintenance endpoint runs the housekeeping');

    const audit = await call('/admin/system/audit?limit=50', { jar: adminJar });
    const actions = (audit.json?.data ?? []).map((row) => row.action);
    assert(actions.includes('article.created') && actions.includes('article.deleted'), 'the audit trail recorded the lifecycle');

    await call('/auth/logout', { method: 'POST', jar: adminJar });
    const afterLogout = await call('/auth/me', { jar: adminJar });
    assertEqual(afterLogout.response.status, 401, 'sign-out revokes the session');

    await call('/auth/dev/reset-demo-accounts', { method: 'POST' });
  }

  console.log(`\n${failed === 0 ? '\u001b[32m' : '\u001b[31m'}smoke test: ${passed} passed, ${failed} failed\u001b[0m`);
  if (failed) {
    console.log('failed steps:');
    for (const label of failures) console.log(`  · ${label}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('\nsmoke test crashed:', error);
  process.exit(1);
});
