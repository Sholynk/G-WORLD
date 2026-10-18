# 01 — Architecture

Sholynk Tech runs entirely on Cloudflare: a **Worker** (API + document rendering), **D1**
(SQLite), **R2** (media bytes) and **Pages** (static site + edge Functions). There is no
origin server, no build-time content export and no static JSON fallback — every article,
setting and engagement figure is a live database row.

```
                       ┌────────────────────────────────────────────────────┐
                       │ Cloudflare Pages project "sholynk-tech"            │
 Browser ─────────────▶│  static assets (apps/web/public)                   │
                       │  Pages Functions (apps/web/functions)              │
                       │    /api/*            → proxy  ┐                    │
                       │    /uploads/*        → proxy  │  service binding   │
                       │    /articles/<slug>  → render ├──────────┐         │
                       │    /article?slug=…   → 301    │          ▼         │
                       │    /robots.txt       → SEO    │   Worker "sholynk-tech-api"
                       │    /sitemap.xml      → SEO    │     Hono app (/api/v1)
                       │    /, /about, …      → inject │     D1 "sholynk_tech"
                       └───────────────────────────────┘     R2 "sholynk-uploads"
                                                             Cron 03:17 UTC
```

## Why the browser only ever sees one origin

The Pages Function `functions/api/[[path]].ts` forwards `/api/*` to the Worker through a
**service binding** (`API`, same-account, no public hop) or the `API_ORIGIN` variable
(fallback for `wrangler pages dev`). Consequences:

- the session cookie is first-party, so `SameSite=Lax` + `HttpOnly` is sufficient;
- CORS is irrelevant for the normal deployment (`ALLOWED_ORIGINS` stays empty);
- the CSRF double-submit (`sk_csrf` cookie → `X-CSRF-Token` header) works without exceptions;
- `scripts/dev-server.mjs` reproduces this locally: one origin on `:5173`, proxying `/api/*`,
  `/uploads/*`, `/articles/*`, `/article(.html)`, `/robots.txt` and `/sitemap.xml` to the
  Worker on `:8787`.

## Document routes (SSR + SEO)

| Public URL              | Function                          | Worker endpoint                        |
| ----------------------- | --------------------------------- | -------------------------------------- |
| `/articles/<slug>/`     | `functions/articles/[slug]*`      | `GET /api/v1/render/articles/:slug`    |
| `/article?slug=…`       | `functions/article.ts`            | `GET /api/v1/render/legacy-article`    |
| `/robots.txt`           | `functions/robots.txt.ts`         | `GET /api/v1/seo/robots.txt`           |
| `/sitemap.xml`          | `functions/sitemap.xml.ts`        | `GET /api/v1/seo/sitemap.xml`          |
| `/uploads/<file>`       | `functions/uploads/[[path]].ts`   | `GET /api/v1/uploads/:filename`        |
| `/`                     | `functions/index.ts`              | `GET /api/v1/render/home-meta`         |
| `/about`, `/contact`, `/help_&_support`, `/privacy_policy` | `functions/<page>.ts` | — (static asset + origin metadata injection) |

The Worker renders the **exact shell the static site ships**: `apps/api/src/lib/article-shell.html`
is imported as text (wrangler `rules`), and `tests/unit/deployment-parity.test.ts` fails if it
drifts from `apps/web/public/article.html`. The renderer (`lib/article-page.ts`) is a faithful
port of the legacy `cms/lib/article-page.js`: marked + sanitize-html, stable `<h2>` ids, TOC,
author cards, related stories, schema.org graph, intrinsic image dimensions (from
`lib/image-dimensions.json`) and `../../`-rewritten local links for the two-segment URL depth.

Document responses replace the JSON security headers with the **page CSP** (kept byte-identical
to `apps/web/public/_headers` — also parity-tested), so an SSR article and a static page behave
the same in the browser.

Origin resolution for canonical/OG/sitemap URLs: `?origin=` (passed by the Function) →
`SITE_URL` var → `x-forwarded-host` → request URL. Previews and `*.pages.dev` therefore emit
correct canonicals with no configuration; a custom domain sets `SITE_URL` once.

## API worker (Hono)

```
requestContext → onError(envelope) → security(CORS+CSRF) → resolveAuth → routes
```

- **Envelope.** Every JSON answer is `{ success, data, meta }` or
  `{ success:false, error:{ code, message, details }, meta }` (`packages/shared/src/api-contract.ts`).
  The ported browser client (`cms-client.js`) and dashboard (`admin.js`) unwrap it.
- **Routes.** `GET /health`, `/health/ready`, `/meta`; public content reads (`/articles`,
  `/articles/:idOrSlug`, `/articles/categories`, `/authors`, `/settings`, `/images`); reader
  engagement (`/articles/:slug/{engagement,reactions,comments,views}`); public forms
  (`/subscriptions`, `/contact` — JSON *and* urlencoded, honeypot + per-IP rate limit); the
  document/SEO renders above; and `/admin/*`.
- **`/admin/*`** is gated by a session (`requireAuth`) at the subtree and by the **permission
  catalogue** per route: editors (`article.submit`, `media.write`) can draft and upload; admins
  add `article.write`, `author.write`, `settings.write`, `engagement.moderate`, `inbox.*`,
  `analytics.read`, `audit.read`; super admins add account/role management. An editor asking for
  `status: "published"` is silently redirected into the **submit-for-review** queue (`pending` +
  a `submissions` row + an email to `EDITOR_EMAIL`), exactly like the legacy approval mode.
- **Auth.** Opaque session tokens (SHA-256 at rest), `sk_session` HttpOnly cookie + `sk_csrf`
  double-submit, PBKDF2-SHA256 passwords with transparent rehash, lockouts, IP+account rate
  limits, audit trail, single-use email tokens, Resend/console mailer. Registration is disabled
  by default (`ENABLE_REGISTRATION=false`); accounts are seeded or created by a super admin.

## Reader data model (privacy)

Readers have **no accounts**. Reactions, comments and read counts key on an anonymous
browser-generated voter id; one vote per reader is enforced server-side (UNIQUE constraint),
reads collapse to one per viewer per article per day (partial unique index), and no IP addresses
or personal data are stored beyond what a reader types into a form.

## Live dashboard (SSE on Workers)

`GET /api/v1/admin/analytics/stream` streams `event: change` nudges (never figures — the client
refetches). Workers are many short-lived isolates, so the legacy in-process event bus is replaced
by a cheap D1 "activity signature" poll every 5 s inside the stream, a 25 s keep-alive comment
and a self-close at ~55 s that the browser's `EventSource` reconnects through (`retry: 5000`).
A dropped or duplicated nudge is harmless by design.

## Cron (03:17 UTC nightly)

1. publishes `scheduled` articles whose time has come,
2. re-attributes articles orphaned by a deleted author to the house author,
3. purges expired sessions, consumed tokens and stale rate-limit windows,
4. prunes audit rows past the retention window (730 d production / 30 d dev).

`POST /api/v1/admin/system/maintenance` runs the identical work on demand.

## Media uploads

`POST /api/v1/admin/images` (multipart, `media.write`): magic-byte container validation
(no `sharp` on Workers — `lib/image-check.ts`), 8 MB cap, sanitised random-suffixed filename,
R2 `put` with the sniffed content type, intrinsic dimensions recorded, and an `images` row.
The row is the serve allow-list: `GET /api/v1/uploads/:filename` streams only recorded files.
PDF import runs **client-side** (pdf.js in the admin browser) — manuscripts never touch the
server until the author saves the article.

## Environments

`wrangler.jsonc` ships `development` (top-level defaults) and `production` envs. `check-config.mjs`
fails strict deploys on placeholder D1 ids, dev routes in production, weak PBKDF2 counts and
missing `SESSION_SECRET`. CI (`npm run verify` + `npm run build:web`) runs the same gates.
