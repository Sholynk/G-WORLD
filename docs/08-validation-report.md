# Website validation — 18 October 2026

## Scope and results

Validated this repository locally against the migrated D1 database, local R2,
Worker and same-origin frontend proxy. This is not a production certification.

| Check | Result |
| --- | --- |
| Clean `npm ci`, config, lockfile and structure checks | Pass |
| TypeScript, Pages Functions and browser-script parsing | Pass |
| Unit / SQLite request-stack / DOM tests | 190 passed |
| Live Worker integration tests | 17 passed, none skipped |
| API lifecycle smoke assertions | 82 passed |
| Website HTTP smoke assertions | 45 passed |
| Chromium desktop/mobile page and dashboard-panel checks | 40 passed |
| Worker bundle dry run and frontend build | Pass |
| Full npm dependency audit, including development dependencies | 0 known vulnerabilities |
| Patch whitespace check | Pass |

Browser checks use 390px and 1440px viewports: public pages, error-page templates,
article rendering and legacy redirects, homepage content/search, Login/Register
switching, anonymous admin redirect, legacy demo-admin login, seven dashboard
panels, logout and session revocation. They assert no uncaught JavaScript errors,
horizontal page overflow or broken **loaded** local images. Third-party requests
are intentionally blocked to check offline degradation; fonts/icons/chart CDNs
are not verified by this pass.

An additional local Chromium exercise used a temporary approved-author fixture:
login, all five author panels, profile update, immediate article publication,
public read, deletion and logout passed. The fixture was removed afterward.
Onboarding, sole-owner setup/recovery, approval, two-author isolation and sensitive
owner mutations are covered by the SQLite/Hono and DOM suites. No real owner was
provisioned and no real email was sent.

## Fixes and optimizations

- Updated an obsolete smoke assertion: unknown article engagement returns a
  standard 404, rather than a successful response with an `unknown-article` reason.
- Resolved author scope once per HTTP request instead of querying repeatedly in
  the boundary, permission adapter and ownership guard. Nothing is cached across
  requests; regression tests verify immediate suspension remains effective.
- Fixed the development static-file containment check so similarly prefixed
  sibling directories cannot be served through encoded traversal paths.
- Fixed development proxy handling for same-host preview origins/custom ports,
  while preserving cross-origin and malformed-origin rejection upstream. The
  default upstream origin is `http://localhost:5173`; `DEV_UPSTREAM_ORIGIN` may
  match a deliberately customized local Worker origin allowlist. Production CORS
  policy is unchanged.
- Streamed server-sent events through the development proxy immediately instead
  of buffering the entire response; browser disconnects cancel the upstream stream.
- Removed the unused Cloudflare Vitest worker pool and duplicate test-runner
  dependency, and upgraded Vitest to patched 4.1.x. Full audit is clean.
- Added repeatable Playwright checks (`npm run test:browser`). CI now seeds and
  starts the local site/API before integration tests, builds the Worker, runs both
  smoke suites and installs Chromium for the browser pass.
- Updated the Node engine requirement to 22.13+ to reflect the SQLite-backed
  tests; `.nvmrc` continues to select Node 22.

## Reproduce

```bash
npm ci
npm run db:seed:local -- --verify
npm run dev
```

In a separate terminal:

```bash
npm run verify
npm run build
npm run build:web
npm run test:smoke
npm run test:web
npx playwright install chromium
npm run test:browser
npm audit
git diff --check
```

On Linux, Playwright may require `npx playwright install --with-deps chromium`.
A preinstalled browser can be selected with `BROWSER_EXECUTABLE_PATH`. Browser
checks reject non-local URLs and use only the documented local demo credentials.
Do not provision an owner in the shared demo DB before running legacy smoke tests.

## Release boundary

Changes are intended for the session branch and a reviewable pull request. No
production migration, owner enrollment, email delivery or production Worker/Pages
deployment is part of this validation. Production registration remains disabled.
Before activation, follow `06-deployment.md`: back up and review existing accounts,
apply migrations through 0010, deploy schema-compatible API/frontend together,
verify real mail and private owner setup/recovery in staging, and then deliberately
enable registration. Safari/Firefox, load testing and external-service availability
remain outside this Chromium/local validation pass.
