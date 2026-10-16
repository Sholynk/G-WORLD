# G WORLD — Architecture

## 1. System shape

```
                     ┌────────────────────────────────────────────┐
   Student / Admin   │  Browser                                   │
   Public visitor    │  HTML5 + CSS3 + vanilla ES modules         │
                     │  fetch() only, same-origin /api/v1         │
                     └───────────────┬────────────────────────────┘
                                     │ HTTPS
                     ┌───────────────▼────────────────────────────┐
   GitHub repo  ────►│  Cloudflare Pages  (static frontend)       │
   CI (Actions)      │  + functions/api/[[path]].ts proxy         │
                     └───────────────┬────────────────────────────┘
                                     │ Service binding (no public CORS needed)
                     ┌───────────────▼────────────────────────────┐
                     │  Cloudflare Worker  (Hono, TypeScript)     │
                     │  /api/v1/*  auth · RBAC · validation       │
                     │  Rate limiting · Audit logging             │
                     └───┬──────────────┬───────────────┬─────────┘
                         │ D1 binding   │ R2 binding    │ fetch()
                 ┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼─────────┐
                 │ D1 (SQLite)  │ │ R2 bucket  │ │ Email provider │
                 │ g_world      │ │ uploads    │ │ (Resend/…)     │
                 └──────────────┘ └────────────┘ └────────────────┘
                                                  YouTube (client-side embeds)
```

## 2. Request lifecycle (write path, e.g. `POST /api/v1/courses/:id/enroll`)

1. **Edge / Pages proxy** — the browser calls `/api/v1/...` on the Pages origin; `functions/api/[[path]].ts`
   forwards the request to the Worker through a **service binding** (`env.API.fetch`). Same origin ⇒
   no CORS preflight, cookies work with `SameSite=Lax`, and the API never has to be publicly routable.
2. **Worker entry** (`src/index.ts`) → `buildApp()` creates the Hono app once per isolate.
3. **request-context** middleware assigns `requestId`, start time, structured logger.
4. **security** middleware applies CORS policy (for the direct-Worker mode), security headers and the
   **CSRF origin guard**: unsafe methods (`POST/PUT/PATCH/DELETE`) must come from an allowed origin or
   carry a session that matches, otherwise `403`.
5. **rate-limit** middleware for sensitive paths (`/auth/*`, enrollment, quiz submit) using a D1
   fixed-window counter keyed by `route:identifier`.
6. **auth** middleware resolves the session cookie / bearer token into `c.set('auth', { user, role, permissions })`.
   `requireAuth`, `requireRole('admin')`, `requirePermission('course.write')` enforce access **server-side**.
7. **validate** middleware parses body/query/params with Zod → `422` with field-level errors.
8. **Handler** calls a repository, which runs parameterised D1 statements.
9. **audit** helper records privileged actions into `audit_logs` (actor, action, entity, metadata).
10. Response is returned through the single **error-handler** which emits one JSON envelope shape.

## 3. Layering rules (enforced by review, checked by `check:structure`)

| Layer | May import | Must never |
| --- | --- | --- |
| `routes/*` | middleware, schemas, `db/repositories/*`, `lib/*` | contain raw SQL, touch `env.DB` directly |
| `db/repositories/*` | `db/client`, `lib/*` | know about Hono `Context` or HTTP status codes |
| `lib/*` | nothing app-specific | import Hono, D1 or a repository (stays unit-testable in Node) |
| `middleware/*` | `lib/*`, repositories | hold business logic beyond access/validation |
| `packages/shared` | nothing | import Cloudflare types |

`lib/*` being runtime-agnostic is deliberate: those modules are unit-tested in plain Node
(`npm run test:unit`) with no Miniflare, so the pure logic is fast to verify.

## 4. Frontend architecture

- **No framework, no bundler.** Pages are static HTML; behaviour is ES modules loaded with
  `<script type="module" src="/assets/js/pages/…">`. The browser resolves imports natively.
- **`core/api.js`** is the single fetch wrapper: base URL, credentials, JSON handling, CSRF header,
  error normalisation (`ApiError`), 401 → session refresh prompt, 429 → retry-after messaging.
- **`core/session.js`** caches the current user in memory + `sessionStorage` (never `localStorage`
  for tokens — there are no tokens in JS; the session is an httpOnly cookie).
- **Progressive enhancement**: navigation, filters and forms work as real `<a>`/`<form>` elements;
  JS upgrades them (client-side filtering, async submit, live validation).
- **Accessibility**: skip link, landmarks, focus-visible styles, `aria-live` for async results,
  keyboard-operable dialogs, `prefers-reduced-motion` support, 4.5:1 minimum contrast in tokens.
- **Security posture**: no secrets, no `eval`, no inline scripts (CSP disallows them), all
  server-provided strings escaped through `core/dom.js` helpers before insertion.

## 5. Data flow for learning

```
admin publishes              student action                 server-derived state
─────────────────            ──────────────                 ────────────────────
department ─► subject        enroll(course)      ─►  enrollments row (status=active)
   └─► course                open lesson         ─►  lesson_progress (in_progress)
        └─► module           mark complete       ─►  lesson_progress (completed)
             └─► lesson      quiz attempt        ─►  quiz_attempts + quiz_answers
                  ├─ videos  submit assignment   ─►  assignment_submissions
                  └─ resources                    progress.recalculate()
                                                  ├─ progress_percent < 100 → keep learning
                                                  └─ == 100 → enrollment.completed +
                                                               certificate issued +
                                                               notification + audit log
```

Progress, pass/fail and certificate eligibility are **always computed on the server** from
`lesson_progress`, `quiz_attempts` and `assignment_submissions`. The frontend only renders them.

## 6. Environments

| Concern | Local | Production |
| --- | --- | --- |
| Frontend | `node scripts/dev-server.mjs` (`:5173`) serving `apps/web/public` | Cloudflare Pages |
| API | `wrangler dev` (`:8787`) | Cloudflare Workers, `production` env in `wrangler.jsonc` |
| Database | Local Miniflare SQLite under `.wrangler/state` | D1 `g_world` (remote) |
| Secrets | `apps/api/.dev.vars` (git-ignored) | `wrangler secret put …` |
| Email | `console` provider + `email_messages` outbox | Resend (or any HTTPS email API) |
| Origins | `ALLOWED_ORIGINS=http://localhost:5173` | empty (same-origin via Pages proxy) |

The dev server proxies `/api/*` to the Worker so that local development is **single-origin**, exactly
like production. This is why no code path needs to special-case CORS.

## 7. Failure modes and how they are handled

| Failure | Handling |
| --- | --- |
| D1 unavailable / query error | `error-handler` returns `503` envelope with `request_id`; the error is logged, never leaked |
| Session expired | `401` with `code: SESSION_EXPIRED`; frontend clears cache and redirects to login with `?next=` |
| Rate limit exceeded | `429` + `Retry-After`; login form shows a countdown |
| Email provider down | Verification email is queued in `email_messages` with `status='failed'`; resend endpoint retries |
| Duplicate enrollment | `409 CONFLICT` (also enforced by `UNIQUE(user_id, course_id)`) |
| Invalid YouTube URL | Rejected at validation time (no arbitrary iframe sources can be injected) |
| Deleted content with completions | `ON DELETE RESTRICT` on academic parents; archive instead of delete |
