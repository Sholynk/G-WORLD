# G-WORLD

A framework on the G-WORLD EDU-PORTAL — an educational platform that teaches students about fields of
study, courses, lessons and certifications.

The repository is an npm-workspaces monorepo with two deployables:

| Workspace | What it is | Deployed to |
| --- | --- | --- |
| `apps/api` | Hono API worker: auth, catalog, curriculum, assessments, certificates, admin | Cloudflare Workers + D1 |
| `apps/web` | Static site (HTML/CSS/vanilla ES modules) plus a `/api/*` Pages Function | Cloudflare Pages |
| `packages/shared` | Roles, permissions, envelopes and Zod schemas shared by both | — |

## Cloudflare Pages settings

The frontend has no bundler — `apps/web/public` is the artifact, and `scripts/build-web.mjs` is the gate
that runs before it is uploaded. Configure the Pages project with the **repository root left empty** or
with **`apps/web`** as the root directory:

| Dashboard field | Root directory = `apps/web` (recommended) | Root directory = repository root |
| --- | --- | --- |
| Framework preset | None | None |
| Build command | `npm run build` | `npm run build:web` |
| Build output directory | `public` | `apps/web/public` |
| Node version | 22 (from `.nvmrc`) | 22 (from `.nvmrc`) |

`apps/web` is recommended because that is where Cloudflare finds `wrangler.toml`, `functions/` (the
`/api/*` proxy) and the output directory together. With the repository root as the build root,
`functions/` is looked for at the root and **`/api/*` is not proxied**.

**Do not use `npx wrangler deploy` as the Pages build/deploy command.** That command deploys a
Workers application and, from this monorepo root, Wrangler cannot identify which workspace app to
ship (the error in the Cloudflare log). For Pages Git integration use the settings in the table:
Cloudflare runs the build command and publishes its output directory itself. For a manual upload,
use `npm run deploy:web` from the repository root.

Two rules that keep the build green:

* **A commit that changes any `package.json` must include the regenerated `package-lock.json`.**
  Cloudflare installs with `npm ci`, which fails with `EUSAGE` when the two disagree — before any build
  step runs. `npm run check:lock` proves they are in sync, offline.
* Set `API_ORIGIN` in `apps/web/wrangler.toml` (or the `API` service binding) to the deployed worker
  origin, otherwise the site deploys but every `/api/*` call answers `502`.
* Clean URLs (`/browse`, `/admin/students`) are served by Pages' own HTML handling. Never add a `200`
  rewrite that targets a `.html` file — Pages redirects it back, forever (ERR_TOO_MANY_REDIRECTS);
  `npm run build:web` fails on that pattern.

See [docs/06-deployment.md](docs/06-deployment.md) for the full walkthrough — worker deploy, D1
migrations, secrets, and what each Cloudflare log line means.

## Quickstart

```bash
npm ci                 # installs every workspace (Cloudflare runs exactly this)
npm run check:lock     # package.json ⇄ package-lock.json, offline
npm run dev            # API worker on :8787 + static site on :5173, one origin
npm run verify         # config + lockfile + structure + typecheck + tests
npm run build:web      # validates the Pages artifact (same gate Cloudflare runs)
```

Local development is single-origin: `scripts/dev-server.mjs` proxies `/api/*` to the worker, so no code
path needs to special-case CORS. `npm run db:reset:local` re-migrates and re-seeds local D1.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/01-architecture.md](docs/01-architecture.md) | System diagram, request lifecycle, module boundaries |
| [docs/02-file-structure.md](docs/02-file-structure.md) | Annotated repository map (`npm run check:structure` keeps it honest) |
| [docs/03-database.md](docs/03-database.md) | Schema domains, tables, relationships, migration rules |
| [docs/06-deployment.md](docs/06-deployment.md) | GitHub → Cloudflare Pages/Workers/D1, build settings, failure modes |

## License

MIT — see [LICENSE](LICENSE).
