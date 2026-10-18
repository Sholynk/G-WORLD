# 02 — File structure

This document is the map of the repository, and `npm run check:structure` is the map's teeth:
it asserts the paths listed here actually exist, so documentation drift fails the build.

```
.
├── package.json                  # npm workspaces root: apps/*, packages/*
├── package-lock.json             # committed; CI + Cloudflare run `npm ci`
├── tsconfig.base.json            # strict TS defaults shared by both projects
├── vitest.config.ts              # unit suite (node env, html-as-text plugin)
├── vitest.integration.config.ts  # HTTP suite against a running API
├── .nvmrc                        # Node 22
├── .env.example                  # root tooling variables (names, public URLs)
├── .dev.vars.example             # copy of apps/api/.dev.vars.example
│
├── .github/workflows/ci.yml      # npm ci → verify → build:web
│
├── database/
│   ├── migrations/               # D1 schema, applied in order, never edited once shipped
│   │   ├── 0001_users_and_access.sql       # roles, permissions, users, user_profiles
│   │   ├── 0002_platform_and_security.sql  # sessions, tokens, notifications, outbox, audit, rate limits
│   │   ├── 0003_editorial_content.sql      # articles, authors, article_sources, settings, images, redirects, submissions
│   │   ├── 0004_reader_engagement.sql      # reactions, comments, subscribers, messages, article_views
│   │   ├── 0005_triggers_and_indexes.sql   # updated_at triggers
│   │   └── 0006_reference_data.sql         # role/permission catalogue (mirror of packages/shared/src/roles.ts)
│   └── seeds/                    # development fixtures — idempotent, never run in production
│       ├── 001_demo_users.sql    # admin@sholynk.test / editor@sholynk.test (public passwords!)
│       └── 003_content.sql       # the migrated publication: 56 articles, 6 long-form stories,
│                                 #   hero placements, 21 sources, house author, site settings
│
├── packages/shared/src/          # @sholynk/shared — runtime-agnostic contracts
│   ├── index.ts                  # barrel
│   ├── roles.ts                  # roles, ranks, permission catalogue, default grants
│   ├── status.ts                 # status/type vocabularies + LIMITS (mirror the SQL CHECKs)
│   ├── validation.ts             # Zod schemas (auth, articles, authors, forms, engagement…)
│   └── api-contract.ts           # the response envelope + error-code → HTTP-status map
│
├── apps/api/                     # @sholynk/api — the Worker
│   ├── wrangler.jsonc            # name sholynk-tech-api, D1/R2 bindings, cron, dev+prod envs
│   ├── .dev.vars.example         # documented local secrets shape
│   └── src/
│       ├── index.ts              # fetch + scheduled handlers
│       ├── app.ts                # buildApp(): middleware order + /api/v1 router
│       ├── env.ts                # Bindings/AppConfig/getConfig/publicOrigin
│       ├── db/
│       │   ├── client.ts         # Db: prepared statements only, slow-query logging, batch()
│       │   └── repositories/     # every SQL statement in the app lives here
│       │       ├── articles.ts   # content table: CRUD, slug renames + redirects, submissions, scheduling
│       │       ├── authors.ts    # author entities incl. the undeletable house author
│       │       ├── settings.ts   # site metadata (read merges defaults, never writes)
│       │       ├── engagement.ts # reactions (toggle/switch) + comments (idempotent by clientId)
│       │       ├── analytics.ts  # recordView + the whole dashboard overview in one round trip
│       │       ├── forms.ts      # newsletter subscribers + contact messages
│       │       ├── media.ts      # images table (R2 metadata)
│       │       ├── users.ts · sessions.ts · roles.ts · tokens.ts
│       │       ├── rateLimit.ts  # fixed-window D1 limiter + RULES
│       │       ├── audit.ts · email.ts · notifications.ts
│       ├── lib/
│       │   ├── markdown.ts       # marked + sanitize-html pipeline, h2 ids, intrinsic sizes
│       │   ├── article-page.ts   # the SSR document renderer (port of cms/lib/article-page.js)
│       │   ├── article-shell.html# the shell, text-imported; parity-tested against public/article.html
│       │   ├── image-dimensions.json # deployed asset → [w,h]; generated from the real files
│       │   ├── image-check.ts    # magic-byte container validation for uploads
│       │   ├── cookies.ts        # sk_session / sk_csrf
│       │   ├── tokens.ts · password.ts · crypto.ts · ids.ts · slug.ts · text.ts
│       │   ├── errors.ts         # AppError + factories (envelope codes)
│       │   ├── audit.ts          # action names + metadata sanitisation
│       │   ├── logger.ts · security-headers.ts
│       │   └── mailer/           # console|resend providers + templates (incl. review submission)
│       ├── middleware/           # request-context, security(CORS+CSRF), auth, rate-limit, validate, error-handler
│       ├── routes/
│       │   ├── index.ts          # mount: health, auth, public, /admin
│       │   ├── health.ts · auth.ts · helpers.ts
│       │   ├── public/           # content.ts, engagement.ts, uploads.ts, seo.ts (render/robots/sitemap)
│       │   └── admin/            # articles, authors+settings, media, inbox (comments/subscribers/messages),
│       │                         #   analytics (overview + SSE), system (stats/audit/maintenance)
│       ├── schemas/mappers.ts    # row → DTO allow-lists (redaction by construction)
│       ├── services/audit.ts     # context-bound audit writer
│       └── types/                # workers-types reference, *.html ambient module
│
├── apps/web/                     # @sholynk/web — Pages project (root directory: apps/web)
│   ├── wrangler.toml             # name sholynk-tech, API_ORIGIN, SITE_URL, service binding
│   ├── functions/
│   │   ├── _lib/                 # env.ts (proxy/origin helpers), presentation.ts (factories), articles.ts
│   │   ├── api/[[path]].ts       # the /api proxy (binding first, API_ORIGIN fallback)
│   │   ├── uploads/[[path]].ts   # /uploads/* → worker R2 route
│   │   ├── articles/[slug].ts    # clean article URLs (also [slug]/index.ts for the trailing slash)
│   │   ├── article.ts            # legacy /article?slug=… redirects
│   │   ├── index.ts              # homepage: static shell + live settings injection
│   │   ├── about.ts · contact.ts · help_&_support.ts · privacy_policy.ts   # origin metadata
│   │   └── robots.txt.ts · sitemap.xml.ts                                   # live SEO files (+ edge fallbacks)
│   └── public/                   # the deployment artifact — committed as-is, no bundler
│       ├── index.html · about.html · contact.html · help_&_support.html · privacy_policy.html
│       ├── article.html          # the SSR shell / graceful static fallback
│       ├── styles.css            # the whole design system (port of the legacy stylesheet)
│       ├── cms-client.js         # API client: envelope unwrap, CSRF, availability probe
│       ├── index.js              # hero slider, card grid, search, filters, pagination
│       ├── script.js             # shared chrome: nav, sidebar, newsletter forms, scroll UX
│       ├── engagement.js         # reactions + comments + read tracking widgets
│       ├── article.js            # article-page enhancements: TOC, progress bar, share, copy
│       ├── cookie-consent.js     # consent banner + first-party preference cookies
│       ├── contact-form.js       # contact page form (extracted from inline for the CSP)
│       ├── login.html/login.js · reset.html/reset.js   # session auth pages
│       ├── 403.html · 404.html · 500.html · error.js   # depth-safe error pages
│       ├── config.js             # public runtime config (window.SHOLYNK_CONFIG)
│       ├── manifest.webmanifest · favicon.svg · _headers · _redirects
│       ├── admin/                # the editorial dashboard (session-based; no admin token)
│       │   ├── index.html · admin.css · admin.js
│       │   └── pdf-extract.js    # client-side pdf.js draft extraction
│       └── assets/
│           ├── brand/            # logos, portrait, hero fallback
│           ├── cards/<category>/ # migrated card images (ai, cryptocurrency, game, home, technology, web-3)
│           └── articles/<topic>/ # migrated in-story photography
│
├── scripts/
│   ├── dev-up.mjs                # npm run dev: worker + site, idempotent
│   ├── dev-server.mjs            # static server + the document/API proxies (one origin)
│   ├── build-web.mjs             # the Pages deployment gate (links, redirects, limits, functions)
│   ├── deploy-web.mjs            # wrangler pages deploy sholynk-tech
│   ├── seed-local.mjs · db-reset.mjs · lib/local-d1.mjs
│   ├── check-config.mjs          # placeholders, secrets, coherence — strict on deploy
│   ├── check-lockfile.mjs        # `npm ci` would succeed here
│   ├── check-structure.mjs       # this document, enforced
│   ├── typecheck-web.mjs         # Pages Functions tsc + browser scripts node --check
│   ├── smoke-test.mjs            # destructive end-to-end API pass
│   └── smoke-web.mjs             # page-level pass (reader/admin modes)
│
├── tests/
│   ├── unit/                     # node env: slugs/text/ids, passwords/tokens, shared contracts
│   │                             #   + parity, markdown, article-page, seed content, pdf heuristics
│   └── integration/api.test.ts   # HTTP against a running API; self-skips when it is down
│
└── docs/                         # you are here
```

## Rules that keep this tree honest

- **Never edit a shipped migration** — add a new numbered file. Seeds are dev-only and idempotent.
- **`package.json` changes ship with a regenerated `package-lock.json`** (`npm ci` fails otherwise —
  `check-lockfile.mjs` runs first in `build:web` and in CI).
- **No `200` rewrite targeting a `.html` file** in `_redirects` — Pages strips `.html` itself and
  such a rule loops forever; `build-web.mjs` rejects it.
- **SQL lives in repositories**, never in routes. **Secrets live in bindings/vars**, never in code.
- The frontend has **no build step**: `apps/web/public` *is* the deployment artifact.
