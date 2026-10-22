# 04 — Frontend design

The frontend is a **pixel-faithful port** of the original Sholynk Technology site
(sholynk.github.io/sholynk-tech): the same stylesheet, the same page chrome, the same hero
slider, card mosaic and article reading layout — rebuilt to run against the D1-backed API on
Cloudflare Pages. **No framework, no bundler**: `apps/web/public` is committed exactly as
deployed, in classic browser JavaScript.

## Design tokens (`styles.css` `:root`)

```
--brand-black  #000000      header + footer
--brand-dark   #0f1419      footer legal band, dark surfaces
--brand-deep   #1a1f26
--brand-accent #1d9bf0      the signature blue (links, CTAs, category pills)
--brand-accent-hover #1a8cd8
--muted        #536471
--surface      #ffffff      --surface-soft #f7f9f9
--line         rgba(29,155,240,0.16)
--radius-sm .65rem  --radius-md 1rem  --radius-lg 1.5rem
--container 76rem
```

Typography is **Montserrat** (400–900, Google Fonts); icons are **Font Awesome 6.7.2** (cdnjs).
Both are the original third parties — the `_headers` CSP allow-lists exactly them plus
`cdn.jsdelivr.net` (the admin PDF importer's pdf.js still loads from jsDelivr; the dashboard's
Chart.js now ships from this deployment as `admin/vendor/chart.umd.js`, so the graphs render even
where third-party CDNs are blocked). There are
**no inline scripts anywhere** (the legacy contact-form script was extracted to
`contact-form.js`) so `script-src` stays `'self' + jsdelivr`; JSON-LD `<script
type="application/ld+json">` blocks are inert data and remain.

## Page inventory

| Page                       | Scripts                                             | Notes |
| -------------------------- | --------------------------------------------------- | ----- |
| `index.html`               | config, cms-client, script, cookie-consent, index   | hero slider + search + filters + card mosaic + pagination, all from live `/api/v1` reads |
| `article.html`             | + engagement, article                               | the SSR shell: the Worker replaces `<head>`, `<article class="article-page">` and `<section class="related-section">`; opened statically it shows a graceful "must be served by the application" state |
| `about/contact/help_&_support/privacy_policy` | script, cookie-consent (+ contact-form) | static marketing copy; a Pages Function rewrites canonical/OG URLs to the serving origin |
| `login.html` / `reset.html`| script, login/reset                                 | session auth in the site's own visual language (`.auth-*` section of styles.css) |
| `403/404/500.html`         | error.js                                            | root-absolute asset paths (they can be served at any URL depth) |
| `admin/index.html`         | Chart.js (vendored `admin/vendor/`), pdf-extract, admin | the editorial dashboard |

## Behaviour ports (kept deliberately identical)

- **`index.js`** — hero slides from `?hero=true` (falling back to per-category slides when a
  `?category=` deep link is open), autoplay with pause/prev/next + dots, debounced search
  (250 ms), category filter pills, 10-per-page pagination, IntersectionObserver card reveals,
  mosaic column balancing on resize, the `assets/brand/hero-fallback.jpeg` image error fallback,
  and the explicit *"Content is unavailable right now"* state when the API cannot be reached —
  content is never faked from a static copy.
- **`script.js`** — skip link, nav active-state normalisation (including category deep links),
  off-canvas mobile sidebar (inert + backdrop + escape), direction-aware auto-hiding header,
  scroll-to-top, newsletter form enhancement posting urlencoded to `/api/v1/subscriptions`.
- **`engagement.js`** — localStorage holds only the anonymous voter id; like/dislike with
  optimistic paint + server reconciliation, one-vote rule enforced server-side, comments with
  `clientId` idempotency, read tracking that waits for real attention (25 % scroll or 12 s dwell)
  before counting a view.
- **`cookie-consent.js`** — first-party `sholynk_consent` (+ prefs) cookies, essential/functional/
  analytics categories, reopen from the footer or the privacy page.
- **`cms-client.js`** — the API client. Differences from the legacy file are exactly three: the
  base path is `/api/v1` (from `config.js` when present), errors unwrap the platform envelope, and
  unsafe requests attach the `X-CSRF-Token` double-submit header when a session cookie exists.

## Server-rendered articles

`lib/article-page.ts` (Worker) reproduces the legacy renderer: breadcrumb + kicker + standfirst
masthead, hero figure, quick-answer and key-takeaways callouts, sticky rail (TOC from the third
`<h2>` up + author card), body with sanitized Markdown and intrinsic image dimensions, FAQ and
Sources sections, share row (X/Facebook/WhatsApp/copy), the engagement mount, the inline author
card and end navigation — wrapped in the shared shell with `../../`-localised assets and a full
schema.org graph (Article + BreadcrumbList + FAQPage; Organization stays "Sholynk Technology",
the site name is "Sholynk Tech").

## Admin dashboard (`/admin/`)

The legacy dashboard, session-based:

- **Auth**: the token field is gone. `admin.js` boots by calling `GET /api/v1/auth/me`; a 401
  redirects to `/login.html?next=/admin/`. Mutations carry the CSRF header; a 401 anywhere bounces
  back to sign-in. The header shows the signed-in user + **Sign out**.
- **Tabs**: Dashboard (metrics, five Chart.js graphs with hidden text equivalents, author/top-
  article tables, live activity feed, the SSE "Live" badge), Articles (list + full editorial form:
  statuses, scheduling, hero placement, SEO overrides, tags/takeaways/FAQs/sources, validation
  panel, review banner), Authors, Media library (R2 uploads), Comments (moderation), **Inbox**
  (new: newsletter subscribers + contact messages with read/archived states), Site metadata.
- **Editorial policy is server-side**: an editor's "Publish" becomes *Submit for review*
  (`pending` + email to `EDITOR_EMAIL`); publishing/scheduling/deleting needs `article.write`.
- **PDF import runs in the browser** (`pdf-extract.js`, pdf.js from jsDelivr): title/teaser/body/
  tags/category heuristics ported from the legacy `pdf-import.js`. The manuscript never reaches
  the server until the author saves.
- **Visual design**: `admin.css` is its own design system, deliberately distinct from the public
  site's black-and-blue chrome — deep-navy header with a gradient brand tile, sticky blurred tab
  strip, soft indigo accents (`#3157f6`) on a cool `#f2f5fb` canvas, layered cards with hover
  lift, tonal metric washes, chip-style status pills, refined tables/forms/dialogs and a dark
  toast. The tab strip follows the WAI-ARIA tabs pattern (roving tabindex, Arrow/Home/End).
- Charts degrade gracefully: metric cards and tables stay live without Chart.js.

## Performance & accessibility invariants

- Single H1 per page; hero slides use H2 (the legacy reasoning is preserved in code comments).
- All reader-generated text is inserted with `textContent` — never parsed as HTML.
- Body images carry intrinsic `width`/`height` (dimensions manifest) so TOC anchors never drift.
- `prefers-reduced-motion` disables animations site-wide and stops dashboard chart re-animation.
- HTML is `no-cache`, assets cache for a week, the admin tree is `no-store` + `noindex`.
