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
> knowledge in this repository. Create the first administrator through the dev flow or directly:
> hash a password with PBKDF2 (`pbkdf2$sha256$100000$<salt_b64>$<key_b64>`) and insert a `users`
> row with `role_id='role_super_admin'`, `status='active'`, `email_verified_at` set.

## 4. Deploy the API worker

```bash
npm run check:config -- --strict       # refuses placeholders/dev-routes in production
npm run deploy:production -w @sholynk/api
curl https://sholynk-tech-api.<your-subdomain>.workers.dev/api/v1/health/ready
```

`health/ready` must report `database.reachable`, `migrations_applied`, the article count and an
empty `config_problems` array. The cron trigger (03:17 UTC: scheduled publishing + housekeeping)
is registered by `wrangler.jsonc` automatically.

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
curl -I https://sholynk-tech.pages.dev/articles/the-rise-of-quantum-computing/
```

The admin mode of the web smoke test (`test:web:admin`) signs in with the **development** demo
accounts; it is for local use, not production.

## 7. Email (Resend)

1. Verify your sending domain at resend.com → set `EMAIL_FROM` to an address on it.
2. `wrangler secret put RESEND_API_KEY … --env production`.
3. `EMAIL_PROVIDER=resend` is already the production default; failures are recorded in the
   `email_messages` outbox (`status='failed'`) instead of breaking requests, and review
   notifications to `EDITOR_EMAIL` degrade to the outbox when delivery fails.

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
