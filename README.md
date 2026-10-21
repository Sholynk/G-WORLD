# Sholynk Technology — the Sholynk Tech publication

**Sholynk Tech** is a technology publication (AI, Web3, cryptocurrency, software and gaming
stories) with a full editorial CMS: server-rendered articles, an analytics dashboard, reader
engagement, a media library and newsletter/contact inboxes.

This repository is the Cloudflare-native rebuild of the original Express + `node:sqlite` site
(`github.com/Sholynk/sholynk-tech`). Every article, hero slide, image and full-length story from
that site was migrated into the new stack — **D1 is the single runtime source of truth**; there is
no static JSON fallback anywhere.

```
Reader ──▶ Cloudflare Pages (static site + Pages Functions)
             │  /                     → index.html + live settings injected (function)
             │  /articles/<slug>/     → server-rendered from D1 (function → worker)
             │  /article?slug=…       → 301 to the clean URL (function → worker)
             │  /robots.txt, /sitemap.xml → generated from live data (function → worker)
             │  /uploads/<file>       → streamed from R2 (function → worker)
             │  /api/*                → proxied to the worker (service binding)
             ▼
           Cloudflare Worker "sholynk-tech-api" (Hono)
             │  D1 "sholynk_tech"  — articles, authors, engagement, auth, analytics
             │  R2 "sholynk-uploads" — media library bytes
             │  Cron 03:17 UTC     — publish scheduled articles + housekeeping
```

## Stack

| Layer     | Technology                                                              |
| --------- | ----------------------------------------------------------------------- |
| Backend   | Cloudflare Worker (Hono, TypeScript), D1 (SQLite), R2                    |
| Frontend  | Cloudflare Pages: static HTML/CSS/vanilla JS + Pages Functions (SSR/SEO) |
| Contracts | `@sholynk/shared` — Zod 4 schemas, roles/permissions, API envelope       |
| Email     | Resend (production) / console outbox (development)                       |
| Tests     | Vitest unit + HTTP integration, two smoke scripts, CI gates              |
| Tooling   | npm workspaces, wrangler, zero-bundler frontend                          |

## Quick start (local)

```bash
npm install                 # workspaces: apps/api, apps/web, packages/shared
npm run db:reset:local      # build + seed the local D1 (migrations + content)
npm run dev                 # API on :8787, site on :5173 (one origin, proxies)
```

Open **http://localhost:5173** — the homepage, the hero slider, the card grid and the
server-rendered stories (`/articles/the-rise-of-quantum-computing/`) all read live D1 rows.

Editorial accounts (development only — see `database/seeds/001_demo_users.sql`):

| Role              | Email               | Password            |
| ----------------- | ------------------- | ------------------- |
| Super admin       | `admin@sholynk.test`  | `AdminPassword123!` |
| Contributing editor | `editor@sholynk.test` | `EditorPassword123!` |

Sign in at `/login.html`; the dashboard lives at `/admin/`. An editor can submit articles for
review (they land in `pending` and email the editor inbox) but cannot publish, schedule or
delete — those need `article.write`, which only admins hold.

## Commands

```bash
npm run dev                 # API + site with the document/API proxies
npm run verify              # every gate: config, lockfile, structure, typecheck, unit + integration
npm run test:smoke          # destructive end-to-end API pass (needs `npm run dev`)
npm run test:web            # page-level pass against the dev server (reader + admin)
npm run build:web           # the Pages deployment gate (runs in CI and on Cloudflare)
npm run db:reset:local      # wipe → migrate → seed the local D1
npm run db:migrate:remote   # apply pending migrations to the production D1
npm run deploy:api          # strict gate + wrangler deploy (production env)
npm run check:deploy        # exit 1 unless the deployment is actually ready
npm run deploy:web          # wrangler pages deploy
```

Production releases also run from GitHub: **Actions → deploy-api** (manual, `main` only,
confirmation-gated, migrations before code, readiness verified afterwards). See
[docs/06-deployment.md](docs/06-deployment.md) §4.

## Cloudflare resources (created once, by you)

| Resource        | Name                | Notes                                             |
| --------------- | ------------------- | ------------------------------------------------- |
| Worker          | `sholynk-tech-api`  | `apps/api/wrangler.jsonc`                          |
| Pages project   | `sholynk-tech`      | root directory **`apps/web`**, output `public`     |
| D1 database     | `sholynk_tech`      | paste its id into `wrangler.jsonc` (two places)    |
| R2 bucket       | `sholynk-uploads`   | (+ `sholynk-uploads-preview` for dev bindings)     |
| Secrets         | `SESSION_SECRET`, `RESEND_API_KEY` | `wrangler secret put … --env production` |

Full walkthrough, including the `SITE_URL`/`API_ORIGIN` rules and the first-deploy checklist:
**[docs/06-deployment.md](docs/06-deployment.md)**.

## Documentation

- [docs/01-architecture.md](docs/01-architecture.md) — request paths, rendering, security model
- [docs/02-file-structure.md](docs/02-file-structure.md) — the repository map (enforced by `check:structure`)
- [docs/03-database.md](docs/03-database.md) — schema, conventions, seed provenance
- [docs/04-frontend-design.md](docs/04-frontend-design.md) — the design system, scripts and dashboard
- [docs/06-deployment.md](docs/06-deployment.md) — deploying to Cloudflare

## Non-negotiables this codebase keeps

1. **D1 is the live source of truth.** No route reads content from checked-in JSON; the seed SQL
   is an import, not a fallback.
2. **Long-form articles are server-rendered** at `/articles/<slug>/` from current rows — title,
   description, canonical, Open Graph, JSON-LD, TOC and body are in the first HTML response.
3. **Markdown output is sanitized** (marked + sanitize-html allow-list) and body images carry
   intrinsic dimensions so anchors never drift.
4. **Public and protected routes are separate**: reads are public, mutations sit behind the
   session + permission catalogue, and the admin token model of the old CMS is gone.
5. **`robots.txt` and `sitemap.xml` are generated from live data** (Pages Functions → worker).
6. **Slug redirects and canonical URLs are preserved**: renames carry reader history and leave a
   301 behind; legacy `article.html?slug=` links keep working.
7. **No frontend framework** — static HTML/CSS/vanilla JS, the same pixel design as the original
   site, deployed without a bundler.

## License

MIT © Sholynk Technology.
