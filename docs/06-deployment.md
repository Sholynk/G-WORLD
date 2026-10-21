# 06 — Deployment (Cloudflare)

Everything runs on one Cloudflare account: a **Worker** (`sholynk-tech-api`), a **D1** database
(`sholynk_tech`), an **R2** bucket (`sholynk-uploads`) and a **Pages** project (`sholynk-tech`).
Free-tier shapes are fine: Workers 100k req/day, Pages Functions 100k req/day (static assets are
free and unlimited), D1 5 M row-reads/day, R2 10 GB storage + no egress fees.

## 0. Prerequisites

```bash
npm install
npx wrangler login
cp apps/api/.dev.vars.example apps/api/.dev.vars    # local development only
```

## 1. Create the resources (once)

```bash
wrangler d1 create sholynk_tech
# → paste the returned database_id into apps/api/wrangler.jsonc
#   BOTH the top-level d1_databases[0] and env.production.d1_databases[0]
#   (they ship as the all-zero sentinel; `npm run check:config -- --strict` fails until replaced)

wrangler r2 bucket create sholynk-uploads
wrangler r2 bucket create sholynk-uploads-preview   # used by local/dev bindings
```

## 2. Secrets (never in the repo)

```bash
wrangler secret put SESSION_SECRET --config apps/api/wrangler.jsonc --env production
#   generate with: openssl rand -base64 48   (≥32 chars; signs sessions + CSRF)
wrangler secret put RESEND_API_KEY --config apps/api/wrangler.jsonc --env production
#   only when EMAIL_PROVIDER=resend (the production default); get one at resend.com
```

Production `vars` (non-secret) live in `wrangler.jsonc → env.production.vars`:

| Var                 | Value                                        | Why |
| ------------------- | -------------------------------------------- | --- |
| `APP_BASE_URL`      | `https://sholynk-tech.pages.dev` (or custom domain) | links inside emails |
| `SITE_URL`          | your canonical domain (empty = derive per request) | canonical/OG URLs, robots, sitemap |
| `API_BASE_URL`      | `/api/v1`                                    | same-origin proxy |
| `EMAIL_FROM`        | address verified in your Resend domain       | deliverability |
| `EDITOR_EMAIL`      | `sholynktech@gmail.com`                      | review notifications |
| `ENABLE_REGISTRATION` | `false`                                    | accounts are created by admins |
| `ENABLE_DEV_ROUTES` | `false`                                      | `/auth/dev/*` must be off |
| `PASSWORD_ITERATIONS` | `100000`                                   | PBKDF2 strength |

## 3. Schema + content (production database)

```bash
npm run db:migrate:remote        # wrangler d1 migrations apply sholynk_tech --remote --env production

# The migrated publication (56 articles, authors, sources, settings). Idempotent
# (INSERT OR IGNORE) — safe to re-run; it never overwrites live edits.
wrangler d1 execute sholynk_tech --remote --env production \
  --file database/seeds/003_content.sql
```

> ⚠ **Never** apply `database/seeds/001_demo_users.sql` to production — its passwords are public
> knowledge in this repository. Use the operator-only owner enrollment and email setup procedure
> below; do not manually seed a usable production password or enable development auth routes.

## 4. Deploy the API worker

**Migrations first, code second.** The worker is written against the latest schema; deploying it
onto an older database is how the October 2026 login outage happened. Both routes below enforce
that order.

### From GitHub Actions (recommended)

`.github/workflows/deploy-api.yml` — manual only, `main` only, confirmation-gated:

1. **One-time setup.** Repository secrets (`Settings → Secrets and variables → Actions`):
   `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit · D1: Edit · Account Settings: Read) and
   `CLOUDFLARE_ACCOUNT_ID`.
2. **Recommended.** `Settings → Environments → production` → required reviewers. That is the
   approval gate; the typed `deploy-api` confirmation is the second one.
3. `Actions → deploy-api → Run workflow`, type `deploy-api`, choose whether to apply pending
   migrations.

The run lists pending migrations, applies them (wrangler stops at the first failure and aborts the
job), **refuses to deploy while any migration remains**, deploys `env.production`, then calls
`/health/ready` and fails the run when the deployment is degraded. A publish is not a success.

### From a laptop

```bash
npm run check:config -- --strict                 # refuses placeholders/dev-routes in production
npm run db:migrate:remote -w @sholynk/api        # schema before code
npm run deploy:api                               # strict gate + env.production
npm run check:deploy                             # reads API_ORIGIN from apps/web/wrangler.toml
```

> `npm run deploy:api` used to publish the **top-level** wrangler block, whose vars are
> `ENVIRONMENT: "development"`, `EMAIL_PROVIDER: "console"` and `ENABLE_DEV_ROUTES: "true"` — it
> would have exposed the `/auth/dev/*` token-printing routes. It now runs the strict configuration
> gate and deploys `env.production`; `npm run deploy:production -w @sholynk/api` is the same thing
> spelled out.

`health/ready` must report `database.reachable`, `migrations_applied`, the article count and an
empty `config_problems` array — `npm run check:deploy` asserts exactly that, and names the missing
schema objects when it fails. Two cron triggers are registered by `wrangler.jsonc`
automatically: `*/15 * * * *` publishes scheduled articles within 15 minutes of their
time, and `17 3 * * *` adds the nightly housekeeping pass (re-attribution, expired
sessions/tokens, rate-limit windows, audit retention).

## 5. Deploy the frontend (Pages)

**Cloudflare Pages settings for this checkout:**

| Setting                  | Value             |
| ------------------------ | ----------------- |
| Project name             | `sholynk-tech`    |
| Root directory           | **`apps/web`**    |
| Build command            | `npm run build`   |
| Build output directory   | `public`          |
| Production branch        | `main`            |

The root directory **must** be `apps/web`: with the repository root as the build root, Cloudflare
looks for `functions/` there and never finds `apps/web/functions`, so `/api/*` (and every SSR
route) silently disappears. The build command runs `scripts/build-web.mjs` — the deployment gate
(lockfile sync, required files, `_redirects` sanity, link checking, module parsing, Pages limits).
It is dependency-free by design.

Manual deploy instead of Git integration:

```bash
npm run deploy:web          # wrangler pages deploy (project sholynk-tech, from apps/web)
```

`API_ORIGIN` and the `API` service binding (Worker ↔ Pages, same account) are configured in
`apps/web/wrangler.toml`. Set `SITE_URL` in `[env.production].vars` once a custom domain exists —
until then canonicals are derived from the request origin, which is correct for `*.pages.dev`.

### `API_ORIGIN` rule

- Same account (normal): keep the **service binding** — requests never leave Cloudflare's
  network. `API_ORIGIN` is only the fallback used by `wrangler pages dev` locally.
- The value must be an **absolute** `https://` origin of the deployed worker; a leftover
  placeholder (`<your-subdomain>`) is caught by `build-web.mjs`/`check-config.mjs`.

## 6. Verify a deployment

```bash
WEB_BASE_URL=https://sholynk-tech.pages.dev npm run test:web:reader   # pages + SSR + SEO (read-only)
curl https://sholynk-tech.pages.dev/api/v1/health/ready               # proxy → worker → D1
DEPLOY_BASE_URL=https://sholynk-tech.pages.dev npm run check:deploy   # exit 1 unless fully ready
curl -I https://sholynk-tech.pages.dev/articles/the-rise-of-quantum-computing/
```

`npm run check:deploy` reads the readiness body (which stays HTTP 200 when degraded) and exits
non-zero on a missing schema object, an unreachable database or a configuration problem. It is
the same check `deploy-api.yml` runs after every deploy.

The admin mode of the web smoke test (`test:web:admin`) signs in with the **development** demo
accounts; it is for local use, not production.

### "Something went wrong on our side" on the dashboard

That sentence is the API's generic `INTERNAL_ERROR` (`apps/api/src/lib/errors.ts`); it is what the
dashboard shows when *any* admin endpoint answers 500. The public site can look completely
healthy at the same time, because the two halves touch different tables:

| Request | Tables it needs |
| ------- | --------------- |
| every public page / public API route | 0001–0006 |
| sign-in and **every** authenticated request | 0007–0010 (`owner_enrollment`, `site_owner`, `author_applications`, `articles.owner_user_id`, …) |

`accessAllowed()` runs on login and on every session request, so a database migrated only
through 0006 answers `POST /api/v1/auth/login` with a 500 (`D1_ERROR: no such table:
owner_enrollment`) while `/`, `/articles/<slug>/` and `/api/v1/articles` keep working.

Diagnose it in two commands:

```bash
# 1. what the live schema is missing (the endpoint now names each object)
curl https://sholynk-tech.pages.dev/api/v1/health/ready
#    status "degraded" + database.missing_schema: ["table owner_enrollment (0008_owner_setup.sql)", …]

# 2. which migrations the remote database has actually had applied
npx wrangler d1 migrations list sholynk_tech --remote --config apps/api/wrangler.jsonc
```

Repair it by applying the pending migrations (never by editing the schema by hand):

```bash
npm run db:migrate:remote
curl https://sholynk-tech.pages.dev/api/v1/health/ready     # status must be "ready"
```

Locally the equivalent is `npm run db:reset:local -- --yes` (wipes and rebuilds
`apps/api/.wrangler`), then restart `npm run dev` so the Worker reopens the new database.

The dashboard prints the API's `request_id` (`ref req_…`) with any 5xx; the same id is in
`wrangler tail` and in the Worker's logs. A 5xx during bootstrap is shown on the page rather than
redirecting to sign-in, precisely so it cannot be mistaken for an expired session.

## 7. Email (Resend)

1. Verify your sending domain at resend.com → set `EMAIL_FROM` to an address on it.
2. `wrangler secret put RESEND_API_KEY … --env production`.
3. `EMAIL_PROVIDER=resend` is already the production default; failures are recorded in the
   `email_messages` outbox (`status='failed'`) instead of breaking requests, and review
   notifications to `EDITOR_EMAIL` degrade to the outbox when delivery fails.

## Owner enrollment and private setup

Owner security and the ownership-scoped author workspace are implemented and locally tested.
**Keep `ENABLE_REGISTRATION=false` until staging acceptance and private owner setup are complete.**
No migration automatically creates or emails a production owner.

### Before provisioning

1. Back up D1 and review existing accounts. Completing owner setup intentionally blocks legacy
   accounts without approved author applications. The command refuses to overwrite an existing
   account using the reserved owner email; review that case manually rather than deleting records.
2. Apply migrations through `0010_reserved_article_urls.sql` to the intended environment and deploy the
   updated Worker and frontend together. For production, use the workspace command that explicitly
   selects `--env production`:
   ```bash
   npm run db:migrate:remote -w @sholynk/api
   ```
3. Configure `APP_BASE_URL` to your canonical **HTTPS website origin**, `EMAIL_PROVIDER=resend`,
   a verified `EMAIL_FROM`, and the private `RESEND_API_KEY` secret. Ensure the website's `/api/*`
   proxy points to this same Worker and D1 database. Setup emails are always sent to
   **sholabusari66@gmail.com**, never a request-supplied address.
4. Review local tests before deployment. Real email delivery must be verified separately; the
   automated tests mock the mail provider and do not send a real setup email.

### Explicit production command (operator only)

Run from a private terminal with Cloudflare authorization already configured:

```bash
npm run owner:provision -- --remote --confirm-production --origin https://YOUR-WEBSITE
```

This command:
- Creates the reserved, unverified owner account/profile in a single SQL statement through a
  database trigger, with a randomly generated, unknown bootstrap password.
- Requests a one-hour setup email through the deployed API. It does not print a setup link,
  password or confirmation code. The temporary SQL file is private, ignored by Git, and removed.
- Is safe to rerun: completed owners are unchanged; pending enrollments are retained and can
  receive another email within the rate limit. Unexpired earlier emails remain valid until setup
  completes, at which point all sibling links and old recovery/session credentials are invalidated.

Open the email privately. Choose a new password and a **different** confirmation code/passphrase,
minimum 12 characters each. Never use a password previously disclosed in chat. The page removes
its token fragment from browser history; merely opening the page does not consume the token.
After submission, sign in at `/login.html`.

For local development, `--local --origin http://localhost:5173` is available, but **sensitive
owner emails deliberately cannot use the console provider**. Use the mocked test suite for
normal offline development; otherwise configure a real test email provider privately. Do not
provision the shared local demo database if you still need the legacy demo-account smoke tests.

### Delivery errors and recovery

- A failed mail request does not delete or replace the enrollment. Correct the configuration and
  rerun the command, or open `/reset.html#owner-request`. Requests are capped per IP and globally
  to protect the sole owner's inbox. A provider timeout may still deliver mail; unexpired links
  remain valid even if the provider reports failure.
- Sensitive email bodies are omitted from database outbox records and logs. There is no outbox
  shortcut to retrieve an owner's private token. Ordinary email verification/reset behavior is
  otherwise unchanged.
- Forgot the separate code? Sign in, open **Author access**, and request a code-recovery email.
  Open the link while signed in, supply the current login password and choose a new code. All
  sessions will be revoked. If opening on another device, sign in first and then reopen the email.
- Forgot the login password? Use the existing password-reset email flow first, then sign in and
  request confirmation-code recovery if needed. A password reset never approves or unsuspends an
  author, and cannot bypass unfinished owner enrollment.
- Owner account review actions require the code in their request body. Existing destructive
  mutations, site settings, maintenance, session revocation and authenticated password changes use the
  `X-Owner-Confirmation` header **in addition to** session authentication and CSRF. The dashboard
  prompts for it each time and never persists it in browser storage.

### Author workspace rollout checks

- Migration 0009 intentionally leaves legacy article/image ownership NULL (owner-managed).
  Do not infer or transfer ownership using names, email addresses or mutable bylines. New records
  receive the authenticated account ID; database triggers prevent ownership changes. Review any
  required legacy reassignment as a separate audited migration before activation.
- Approved authors can publish directly, but cannot set homepage hero/featured placement, impersonate
  another byline or access owner account/settings/inbox/global analytics tools. Each author sees only
  their own private articles, media-management library, comments and analytics. Published content
  and uploaded asset URLs remain public; uploads are not confidential file storage.
- Author profile edits include name, biography, portrait, external profile and HTTPS social links.
  Existing application profile slugs are normalized to lowercase hyphenated values during migration.
  Retired article URLs stay reserved; new collisions receive a suffix instead of stealing a redirect.
- Validate two separate authors in staging: draft/publish/edit/delete, photo upload, profile/social
  rendering, analytics and moderation. Attempt cross-author IDs, private previews and owner routes.
  Suspend one author, confirm immediate session revocation and retained public content, restore them
  and verify that only a new login works. Also exercise owner confirmation prompts and email recovery.
- After email delivery, account migration and staging acceptance pass, enable registration in the
  production Worker configuration and redeploy deliberately. Never enable production dev helpers.

## 8. Repository rename (after this rebuild merges)

The GitHub repository is renamed once, at the end:

```bash
gh repo rename Sholynk-Technology --repo Sholynk/G-WORLD --yes
git remote set-url origin https://github.com/Sholynk/Sholynk-Technology.git
```

GitHub keeps redirects for clones/PRs, but CI badges, `wrangler` docs and bookmarks should be
updated to the new URL.

## Rollback

- Worker: `wrangler deployments list --config apps/api/wrangler.jsonc` → `wrangler deployments rollback <id>`.
- Pages: dashboard → Deployment log → *Rollback to previous deployment* (static artifact + functions
  roll back together).
- Database: migrations are additive; a bad content import is fixed by an opposite migration, never
  by editing a shipped one.
