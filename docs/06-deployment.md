# G WORLD — Deployment (GitHub → Cloudflare Pages + Workers + D1)

Two independent deploys come out of this repository, and they fail for different reasons:

| What | Cloudflare product | Artifact | Configured by |
| --- | --- | --- | --- |
| Frontend (static site + `/api/*` proxy) | Pages project `g-world` | `apps/web/public` | `apps/web/wrangler.toml` |
| API | Worker `g-world-api` | `apps/api/dist` | `apps/api/wrangler.jsonc` |

Nothing secret is ever stored in the frontend: session secrets, the D1 binding and email keys belong to
the Worker. Pages serves static files from the edge and forwards `/api/*` to the Worker through the
Pages Function in `apps/web/functions/api/[[path]].ts`.

## 1. Install step — the rule that breaks builds first

Cloudflare installs dependencies with **`npm clean-install` (`npm ci`)** whenever a lock file is present.
`npm ci` deletes `node_modules` and refuses to run when `package.json` and `package-lock.json` disagree:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json
npm error or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install`
npm error Missing: happy-dom@21.0.3 from lock file
```

This fails **before** any build or deploy step, and it is not reproducible locally for anyone whose
`node_modules` is already installed — which is exactly why it is worth a dedicated check.

**The rule:** a commit that changes any `package.json` must contain the regenerated `package-lock.json`.

```bash
npm install              # regenerates package-lock.json
npm run check:lock       # offline: proves `npm ci` will succeed
git add package.json package-lock.json
```

`npm run check:lock` (`scripts/check-lockfile.mjs`) needs no network, no `node_modules` and no npm
binary: it compares every workspace manifest against the copies npm records inside the lock file and
re-resolves each declared range. It runs as part of `npm run verify` and as the first step of
`npm run build:web`, so the Pages build fails on Cloudflare's machine with the real cause instead of
npm's EUSAGE wall of text.

> Peer dependencies are the one place npm is more forgiving than this check: `wrangler` asks for
> `@cloudflare/workers-types@^5` while `apps/api` pins `^4` for the Worker's own types. npm treats that
> optional peer as advisory and installs `4.x` where the Worker needs it; `npm ci` stays green.

## 2. Cloudflare Pages — project settings

The frontend has no bundler: `apps/web/public` **is** the artifact. The build step only gates it
(`scripts/build-web.mjs`: lock file, routing rules, page links, module syntax, Pages limits).

**Recommended: build root `apps/web`.** This is the only configuration where Cloudflare finds all three
of the things it looks for relative to the build root — `wrangler.toml`, `functions/` and the output
directory:

> **Do not set the deploy command to `npx wrangler deploy`.** That deploys a Workers app, not a Pages
> site. From the monorepo root Wrangler detects a workspace but no specific application, producing
> “application detection logic has been run in the root of a workspace.” With Pages Git integration,
> set the build command/output below and let Pages publish the output. For a manual Pages upload run
> `npm run deploy:web` from the repository root (which invokes `wrangler pages deploy` in `apps/web`).

| Dashboard field | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `public` |
| Root directory (advanced) | `apps/web` |
| Node version | 22 (`.nvmrc` in both the root and `apps/web`) |

**Alternative: build root = repository root.** The install and build both work — npm walks up to the
workspace root, so `npm ci` at the repository root installs every workspace — but Cloudflare then looks
for `functions/` at the repository root and does not find `apps/web/functions`, so **`/api/*` is not
proxied** and every page loses its API. Use this only if you would rather add a root-level
`functions/` that re-exports the Pages Function, or if the site is deployed without an API:

| Dashboard field | Value |
| --- | --- |
| Build command | `npm run build:web` |
| Build output directory | `apps/web/public` |
| Root directory | (empty) |

### Routing: who owns clean URLs

Pages' own HTML handling owns the `.html` ↔ clean-URL mapping — it serves `/browse` from
`browse.html` (200, address bar unchanged) and rewrites a request for `/browse.html` to `/browse` with a
single 308. `public/_redirects` therefore contains **only** the short links Pages cannot infer
(`/verify/:code`, `/q/:code`, `/enrol/:slug`, `/learn/:lesson`, `/course/:slug`, `/lesson/:id`), pointing
straight at the clean destination so a browser makes one hop.

Do not add a `200` rewrite that targets a `.html` file (`/browse  /browse.html  200`). A `200` rewrites
internally to the file; Pages then strips the extension with a 308; the rewrite fires again — an
infinite redirect. Cloudflare reports it while parsing the file:

```
▲ Found 1 invalid redirect rule: Infinite loop detected in this rule and has been ignored.
  This will cause a redirect to strip `.html` or `/index` and end up triggering this rule again.
    at public/_redirects:10 | /                /index.html                          200
```

`npm run build:web` fails on that pattern, and `npx wrangler pages dev` (from `apps/web`) is the fastest
way to see the real routing table: `/browse`, `/admin/students` and `/verify?code=X` must answer `200`,
`/verify/CODE` must answer `302`, and nothing may answer `308` back to the URL it was requested at.

Notes that apply to both layouts:

* `apps/web/wrangler.toml` sets `pages_build_output_dir = "public"`, which Cloudflare prefers over the
  dashboard field for Pages projects created from `wrangler.toml`. Keep the two in agreement.
* `[vars] API_ORIGIN` in `apps/web/wrangler.toml` is injected at build time. While it still contains
  `<your-subdomain>` (and no `[[services]]` binding is set), the site deploys and every `/api/*` call
  answers `502 DEPENDENCY_UNAVAILABLE` with a readable JSON body. `npm run build:web -- --strict`
  turns that warning into a failure.
* Preview deployments inherit `[env.preview]` from the same file.
* `public/sitemap.xml` and the `Sitemap:` line in `public/robots.txt` name the production origin
  (`https://g-world.pages.dev`). Keep that in sync with the real host — `<project>.pages.dev` (the project
  here is `g-world`) or the custom domain — because they are the canonical URLs crawlers see. The two
  files are the only place the origin is written down.
* Free plan: unlimited static requests and bandwidth, 500 builds/month, 20,000 files per deployment,
  25 MiB per file. `build:web` checks the file count and per-file size.

### Wiring the API

1. Configure the production D1 ID and Worker secrets, then deploy with
   `npm run deploy:production -w @g-world/api`. The repository-level `npm run deploy:api` shortcut
   does not explicitly select the production environment.
2. Give the Worker a stable hostname (or a custom domain), then either
   * set `API_ORIGIN` in `apps/web/wrangler.toml` and redeploy the frontend — simplest; or
   * uncomment the `[[services]]` binding named `API` so Pages reaches the Worker inside Cloudflare's
     network with no public hop (keep `API_ORIGIN` as a fallback for local `wrangler pages dev`).
3. Verify from the deployed site: `GET /api/v1/health` must return the success envelope, and
   `curl -sI https://<site>/api/v1/health` must show the frontend's own origin.

Because the proxy keeps one origin, the session cookie stays first-party and no CORS configuration is
needed in production (`ALLOWED_ORIGINS` is empty in `env.production`).

## 3. API worker and D1

```bash
# From the repository root. These commands explicitly target the API config/environment.
npx wrangler d1 create g_world --config apps/api/wrangler.jsonc
# Copy the returned database_id into BOTH D1 bindings in apps/api/wrangler.jsonc.
npx wrangler r2 bucket create g-world-uploads
npm run db:migrate:remote -w @g-world/api
npx wrangler secret put SESSION_SECRET --env production --config apps/api/wrangler.jsonc
# Optional, if using Resend for production email:
npx wrangler secret put RESEND_API_KEY --env production --config apps/api/wrangler.jsonc
npm run deploy:production -w @g-world/api
npm run db:reset:local                # local only: re-migrate + re-seed
```

Migrations are forward-only and numbered; never edit one that has been applied anywhere. Seeds under
`database/seeds/` are demo data and must not be applied to production.

### Worker variables and secrets

`apps/api/.dev.vars.example` is the documented shape of the environment; the private local copy is
`apps/api/.dev.vars` (git-ignored). In production the same keys are set once per environment — `vars`
for the non-secret ones in `apps/api/wrangler.jsonc`, and `wrangler secret put KEY --env production`
for the rest:

| Key | Production value |
| --- | --- |
| `SESSION_SECRET` | secret — `openssl rand -base64 48`, never committed |
| `ALLOWED_ORIGINS` | empty (the Pages proxy makes every request same-origin) |
| `APP_BASE_URL` / `API_BASE_URL` | the public site and API origins (used in emails and links) |
| `EMAIL_PROVIDER` | `resend` (or `console`; the local outbox only exists in development) |
| `EMAIL_FROM` | a verified sender on the email provider |
| `RESEND_API_KEY` | secret — free tier is 3,000 emails/month, 100/day |
| `ENABLE_REGISTRATION`, `ENABLE_DEV_ROUTES` | `true` / `false` — dev routes must stay off in production |
| `PASSWORD_ITERATIONS`, `RATE_LIMIT_MULTIPLIER` | defaults are fine on the free plan |

## 4. Local equivalents

```bash
npm ci                # the same install Cloudflare runs
npm run verify        # config + lockfile + structure + typecheck + tests
npm run build:web     # the same artifact gate Cloudflare runs
npm run dev           # API worker + static server on one origin (localhost:5173)
npm run test:smoke    # black-box flow against the running API
npm run deploy:web    # manual Pages upload (config → typecheck → build → upload)
```

`npm run deploy:web` runs the same gates as the Git build, so a manual upload and a Git deploy cannot
produce different artifacts.

## 5. When a Cloudflare build fails

| Log line | Cause | Fix |
| --- | --- | --- |
| `npm error code EUSAGE` / `Missing: … from lock file` | `package.json` changed without the lock file | `npm install`, commit `package-lock.json`; `npm run check:lock` proves it |
| `npm error Invalid: lock file's … does not satisfy …` | same drift, seen through a bumped range | as above |
| `npm error code ELIFECYCLE` / `Missing script: "build"` | build command does not exist in the configured root directory | use the table in §2 |
| Build ok, `/api/*` returns `502` | `API_ORIGIN` placeholder, or the wrong build root (no `functions/`) | §2 “Wiring the API” — the Function answers `502 DEPENDENCY_UNAVAILABLE` with a JSON body, never a `500` |
| `/browse` redirects to itself (ERR_TOO_MANY_REDIRECTS) | a `200` rewrite targets a `.html` file | delete the rule; `npm run build:web` now fails on it (§2 “Routing”) |
| `Infinite loop detected ... and has been ignored` in the build log | same as above | as above |
| Pages shows the old site | build output directory does not match `pages_build_output_dir` | set both to `public` / `apps/web/public` |

### 5.1 The Workers Builds check fails in a second on every branch

The `Workers Builds: g-world` check currently reports **failure** for every
branch in this repository, and it does so *instantly* — the check starts and
finishes in the same second, which means the build never got as far as
running a command. It is not a code problem:

* the same check is **green on `main`**;
* it failed the same way on the five branches behind pull requests #1–#5,
  which were merged;
* `npm run build -w @g-world/api` (the worker bundle) and the same command
  with `--env production` both succeed locally, and the `ci` workflow is green
  on every branch.

The build configuration lives in the Cloudflare dashboard (the “Workers
Builds” settings of the `g-world` worker), not in the repository, so the fix
is on that side:

1. open **Workers & Pages → g-world → Settings → Builds**;
2. check the **Build command** and the **Root directory** against §3 — with
   the root directory set to the repository root the command is
   `npm run build -w @g-world/api`;
3. check that the build is not restricted to one branch, and that a branch
   build can reach the environment it deploys to (a preview build needs the
   secrets of that environment);
4. re-run the check from the GitHub checks page once the settings are saved.

Until then, treat a red `Workers Builds` check on a branch as a known
dashboard issue and rely on the `ci` workflow, which runs the same commands a
developer runs locally.
