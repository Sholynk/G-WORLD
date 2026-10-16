# G WORLD — File & Folder Structure Plan

This is the authoritative map of the repository. Every directory below exists for a reason;
nothing is a placeholder. `npm run check:structure` verifies that the paths marked
**required** are present, so this document cannot silently drift from the code.

```
G-WORLD/
├── README.md                      Quickstart, feature list, deploy summary
├── LICENSE                        MIT
├── CONTRIBUTING.md                Branching, commit style, PR checklist
├── SECURITY.md                    Vulnerability disclosure + security model summary
├── CHANGELOG.md                   Keep-a-Changelog history of shipped increments
├── package.json                   npm workspaces root; all cross-cutting scripts
├── package-lock.json              Reproducible installs (committed)
├── tsconfig.json                  TS project references (shared -> api)
├── tsconfig.base.json             Shared strict compiler options
├── vitest.config.ts               Unit tests (Node env)
├── vitest.integration.config.ts   Integration tests (workerd + real D1 via Miniflare)
├── .editorconfig  .gitignore  .nvmrc
├── .dev.vars.example              Template for apps/api/.dev.vars (git-ignored)
├── .env.example                   Template for tooling-only variables
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 typecheck + unit + integration + migration check on every PR
│   │   ├── deploy-api.yml         D1 migrate + `wrangler deploy` on main (manual gate)
│   │   └── deploy-web.yml         `wrangler pages deploy` on main
│   ├── ISSUE_TEMPLATE/{bug_report.md,feature_request.md}
│   ├── pull_request_template.md
│   └── dependabot.yml
│
├── docs/                          Planning, architecture and operations documentation
│   ├── 01-architecture.md         System diagram, request lifecycle, module boundaries
│   ├── 02-file-structure.md       (this file) annotated repository map
│   ├── 03-database.md             4 schema domains, tables, relationships, migration rules
│   ├── 04-api-reference.md        Every /api/v1 endpoint, payloads, auth, errors
│   ├── 05-security.md             AuthN/AuthZ, hashing, sessions, CSRF, CSP, PII, audit
│   ├── 06-deployment.md           GitHub + Cloudflare Pages + Workers + D1 + R2 + email
│   ├── 07-development-workflow.md Local setup, scripts, conventions, testing strategy
│   ├── 08-roadmap.md              Phased delivery plan and definition of done
│   ├── 09-limits-and-costs.md     Free-tier quotas, upgrade triggers, cost controls
│   └── adr/
│       ├── 0001-monorepo-npm-workspaces.md
│       ├── 0002-cloudflare-pages-worker-same-origin.md
│       ├── 0003-database-backed-sessions-over-jwt.md
│       ├── 0004-pbkdf2-via-webcrypto-for-passwords.md
│       └── 0005-vanilla-es-modules-no-framework.md
│
├── database/                      Version-controlled D1 schema (single source of truth)
│   ├── migrations/                Applied in filename order; never edited after merge
│   │   ├── 0001_users_and_access.sql          Domain A
│   │   ├── 0002_platform_and_security.sql     Domain B
│   │   ├── 0003_academic_content.sql          Domain C
│   │   ├── 0004_learning_and_assessment.sql   Domain D
│   │   ├── 0005_triggers_and_indexes.sql      updated_at triggers, covering indexes
│   │   ├── 0006_analytics_views.sql           Read models for catalog/progress/analytics
│   │   └── 0007_reference_data.sql            roles + permissions + grants (idempotent)
│   ├── seeds/
│   │   ├── 001_demo_catalog.sql   DEMO departments/subjects/courses (dev only)
│   │   ├── 002_demo_curriculum.sql Modules, lessons, videos, resources, skills
│   │   ├── 003_demo_assessments.sql Quizzes/questions/answers + assignment
│   │   └── 004_demo_users.sql     dev admin/super-admin/student logins (hashes are dev-only)
│   └── README.md                  How to create, apply, roll back and review migrations
│
├── packages/
│   └── shared/                    Runtime-agnostic contracts shared by API (and tests)
│       ├── package.json           @g-world/shared workspace
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts           Barrel export
│           ├── roles.ts           Role keys, hierarchy rank, permission catalogue
│           ├── status.ts          Publication/account/enrollment status enums
│           ├── api-contract.ts    Success + error envelope types, pagination types
│           └── validation.ts      Zod schemas reused by API and integration tests
│
├── apps/
│   ├── api/                       Cloudflare Worker — the only component that touches D1
│   │   ├── package.json           @g-world/api workspace
│   │   ├── tsconfig.json
│   │   ├── wrangler.jsonc         D1 + R2 + vars + environments (development/production)
│   │   ├── src/
│   │   │   ├── index.ts           Worker entry (export default { fetch })
│   │   │   ├── app.ts             buildApp(): Hono app factory — testable, no globals
│   │   │   ├── env.ts             Env typing + config accessors + feature flags
│   │   │   ├── middleware/
│   │   │   │   ├── request-context.ts  request id, timing, structured logger
│   │   │   │   ├── error-handler.ts    one JSON error envelope, no stack leaks
│   │   │   │   ├── security.ts         security headers, CORS policy, origin guard
│   │   │   │   ├── auth.ts             session resolution + requireAuth/Role/Permission
│   │   │   │   ├── rate-limit.ts       D1-backed fixed-window limiter (login, register…)
│   │   │   │   ├── validate.ts         Zod body/query/param validators -> 422
│   │   │   │   └── pagination.ts       ?page/?per_page parsing + Link metadata
│   │   │   ├── lib/
│   │   │   │   ├── ids.ts         UUID/ULID-style ID + student/certificate number gen
│   │   │   │   ├── crypto.ts      SHA-256, HMAC, constant-time compare, random bytes
│   │   │   │   ├── password.ts    PBKDF2-SHA256 hashing + verify + needs-rehash
│   │   │   │   ├── tokens.ts      single-use opaque tokens (verification/reset/session)
│   │   │   │   ├── slug.ts        URL slug + uniqueness helpers
│   │   │   │   ├── text.ts        Markdown-lite renderer with HTML escaping
│   │   │   │   ├── youtube.ts     video-id extraction + embed URL validation
│   │   │   │   ├── qrcode.ts      QR SVG generation (uqr) for student/verification codes
│   │   │   │   ├── progress.ts    enrollment progress recalculation + completion rules
│   │   │   │   ├── certificates.ts Certificate issuance + verification codes
│   │   │   │   ├── scoring.ts     Pure quiz/assignment grading functions
│   │   │   │   ├── audit.ts       audit_logs writer (actor, action, entity, metadata)
│   │   │   │   └── mailer/        provider abstraction (console | resend) + templates
│   │   │   ├── db/
│   │   │   │   ├── client.ts      D1 helpers: query/all/first/run, batching, tracing
│   │   │   │   └── repositories/  one module per aggregate — all SQL lives here
│   │   │   │       ├── users.ts  sessions.ts  tokens.ts  qr.ts  notifications.ts
│   │   │   │       ├── audit.ts  catalog.ts  curriculum.ts  enrollments.ts
│   │   │   │       ├── progress.ts  assessments.ts  certificates.ts
│   │   │   │       └── analytics.ts  crud.ts (generic guarded CRUD factory)
│   │   │   ├── schemas/           Zod request schemas grouped by feature
│   │   │   ├── routes/
│   │   │   │   ├── index.ts       mounts every router under /api/v1
│   │   │   │   ├── health.ts      /health, /health/ready, /meta
│   │   │   │   ├── auth.ts        register, verify, login, logout, reset, password
│   │   │   │   ├── profile.ts     /me, profile updates, notification preferences
│   │   │   │   ├── public/        catalog.ts, search.ts, verify.ts (no auth needed)
│   │   │   │   ├── student/       enrollments.ts, lessons.ts, progress.ts, qr.ts,
│   │   │   │   │                  certificates.ts, dashboard.ts
│   │   │   │   ├── assessments/   quizzes.ts, assignments.ts
│   │   │   │   └── admin/         index.ts + resource routers + stats.ts + qr.ts
│   │   │   │                      + students.ts + audit.ts + users.ts (super admin)
│   │   │   └── types/bindings.d.ts  CloudflareEnvironment (D1, R2, secrets, vars)
│   │   └── test/                  Worker-runtime helpers used by tests/integration
│   │
│   └── web/                       Cloudflare Pages project (static, no bundler)
│       ├── package.json
│       ├── wrangler.toml          Pages project config + service binding to the API
│       ├── functions/api/[[path]].ts  Same-origin proxy Pages -> Worker service binding
│       └── public/
│           ├── index.html                    Home: hero, departments, featured courses
│           ├── browse.html                   Departments + subjects explorer
│           ├── courses.html                  Catalog with search, filters, pagination
│           ├── course.html                   Public course detail + curriculum preview
│           ├── lesson.html                   Enrolled lesson player (YouTube + resources)
│           ├── quiz.html                     Quiz runner (attempts, scoring feedback)
│           ├── login.html  register.html  verify-email.html
│           ├── forgot-password.html  reset-password.html
│           ├── dashboard.html                Student dashboard: progress, next lesson
│           ├── my-courses.html  certificates.html  certificate.html
│           ├── profile.html  settings.html   Account + QR identity card
│           ├── search.html
│           ├── verify.html                   Public certificate/ID verification
│           ├── 403.html  404.html  500.html  offline.html
│           ├── robots.txt  sitemap.xml  manifest.webmanifest  favicon.svg
│           ├── config.js                     Public runtime config (no secrets)
│           ├── _headers                      CSP, HSTS, cache + security headers
│           ├── _redirects                    Friendly URLs -> HTML pages
│           ├── admin/
│           │   ├── index.html                Admin dashboard (KPIs, quick actions)
│           │   ├── students.html  enrollments.html  certificates.html
│           │   ├── departments.html  subjects.html  courses.html  course-editor.html
│           │   ├── assessments.html  audit.html  scan.html  settings.html
│           └── assets/
│               ├── css/  tokens.css, base.css, layout.css, components.css,
│               │         forms.css, tables.css, animations.css,
│               │         pages/{home,catalog,course,lesson,dashboard,auth}.css
│               │         admin/{admin,editor}.css
│               └── js/
│                   ├── core/       config.js, api.js, session.js, dom.js, store.js,
│                   │               format.js, validate.js, errors.js, seo.js
│                   ├── components/ header.js, footer.js, toast.js, modal.js,
│                   │               table.js, pagination.js, form.js, progress.js,
│                   │               video.js, qrcode.js, empty-state.js, skeletons.js
│                   ├── pages/      one module per public page (home.js, courses.js, …)
│                   └── admin/      admin-shell.js, resources.js (schema-driven CRUD),
│                                   scanner.js, charts.js
│
├── scripts/
│   ├── dev-up.mjs          one command: API worker + static dev server
│   ├── dev-server.mjs      static file server + /api proxy (single-origin preview)
│   ├── seed-local.mjs      applies database/seeds/*.sql to local D1
│   ├── db-reset.mjs        wipes + re-migrates + re-seeds local D1
│   ├── check-config.mjs    fails if wrangler.jsonc still has placeholder IDs
│   ├── check-structure.mjs verifies required paths from this document exist
│   ├── typecheck-web.mjs   tsc --checkJs over the vanilla JS frontend
│   ├── deploy-web.mjs      Pages deploy wrapper (build-free static upload)
│   └── smoke-test.mjs      black-box end-to-end flow against a running API
│
└── tests/
    ├── README.md
    ├── helpers/            fixtures, test client, local-D1 harness
    ├── unit/               pure logic: password, tokens, slug, scoring, permissions,
    │                       qr, youtube parsing, validation schemas, formatting
    └── integration/        Hono app against a real D1: auth lifecycle, RBAC matrix,
                            enrollment + progress, quiz attempt, certificate issue,
                            admin CRUD + audit, rate limiting
```

## Placement rules

1. **SQL never leaves `database/`.** Application code never contains DDL; it calls repositories.
2. **Repositories own SQL.** A route handler may not import `env.DB` directly; it goes through
   `db/repositories/*`. This keeps queries reviewable in one place.
3. **`packages/shared` has zero Cloudflare imports** so it can be reused by tests, scripts and
   future consumers. It is TypeScript; the frontend deliberately mirrors the few display-only
   constants in `assets/js/core/config.js` instead of importing TS (see ADR-0005).
4. **One page = one HTML file + one page module.** No client-side router, no bundler; each page
   is independently cacheable, crawlable and printable.
5. **Admin features are schema-driven.** `assets/js/admin/resources.js` renders list/detail forms
   from a declarative resource descriptor, so adding an admin CRUD screen is data, not code.
6. **Tests live outside apps** so the deployed bundles stay small and tests can import from both
   workspaces.
