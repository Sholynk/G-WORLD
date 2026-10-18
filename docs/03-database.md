# 03 — Database (D1)

One SQLite database, `sholynk_tech`, bound to the Worker as `DB`. It is the **single runtime
source of truth** for content, settings, reader data and auth. Migrations build the schema;
seeds are development fixtures. No application path reads content from checked-in JSON.

## Conventions

- **D1/SQLite only** — never MySQL syntax. `TEXT` ISO-8601 UTC timestamps on platform tables
  (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`); the editorial tables keep the legacy CMS's local
  `datetime('now')` format (`YYYY-MM-DD HH:MM:SS`, UTC without a zone marker) because the
  analytics windows (`date(created_at) >= date('now','-29 days')`) and the dashboard's
  relative-time formatting were written against it.
- **Ids**: platform entities use prefixed ULIDs (`usr_…`, `ses_…`); editorial content keeps the
  legacy `INTEGER PRIMARY KEY AUTOINCREMENT` so imported rows and reader history keep their ids.
- **Booleans** are `INTEGER 0/1` with CHECKs; **enums** are `TEXT` with CHECK constraints;
  every CHECK has a mirror in `packages/shared/src/status.ts` (`LIMITS` + status tuples).
- **JSON columns** (`tags_json`, `faqs_json`, `key_takeaways_json`, `related_slugs_json`,
  `metadata_json`, …) carry `CHECK (json_valid(…))`.
- `updated_at` is maintained by AFTER UPDATE triggers (migration 0005) — SQLite has no
  `ON UPDATE CURRENT_TIMESTAMP`.
- All access goes through `apps/api/src/db/client.ts` (prepared statements with bound
  parameters only; `batch()` for implicit transactions; slow-query logging with the request id).

## Domain A — users & access (0001)

| Table             | Purpose                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `roles`           | `public(0)`, `editor(10)`, `admin(50)`, `super_admin(90)` — rank-ordered |
| `permissions`     | atomic capabilities (`article.write`, `inbox.read`, …)                |
| `role_permissions`| grants; seeded by 0006, mirrored by `packages/shared/src/roles.ts` (parity-tested) |
| `users`           | email (case-insensitive unique), PBKDF2 hash, role, status, lockout   |
| `user_profiles`   | display/full name, bio, avatar, website, country, timezone            |

## Domain B — platform & security (0002)

`user_sessions` (token **hashes** only), `notifications`, `email_verification_tokens`,
`password_reset_tokens` (single-use, expiring, hashed), `email_messages` (the outbox —
`console` provider rows are `logged`, which makes the whole email flow testable offline),
`audit_logs` (append-only), `rate_limits` (fixed-window counters, hashed keys).

## Domain C — editorial content (0003)

| Table             | Notes                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `articles`        | the publication. `status ∈ published/draft/scheduled/pending`; `hero` + `hero_order` drive the slider; `featured` pins cards; `external_link` marks card-only entries; `canonical_url`/`seo_*` override metadata; `submitter_email`/`submitted_at`/`review_notes` carry the review flow |
| `authors`         | author entities; the house author (`oluwashola-busari`) is seeded and undeletable — every article falls back to it |
| `article_sources` | verified references (type ∈ primary/official/research/journalism/reference/other, DOI, `supports` claim) |
| `settings`        | site metadata key/value (`siteTitle`, `siteDescription`, `siteKeywords`, `homeTagline`); reads merge defaults in memory and never write |
| `images`          | media-library records; bytes live in R2 under the plain `filename`, URL is `/uploads/<filename>`; the row is the serve allow-list |
| `redirects`       | slug history; a rename writes `old_slug → new_slug` and the render route 301s |
| `submissions`     | one row per submit-for-review event (who, when, notes, notified_at)   |

Reader history (`reactions`, `comments`, `article_views`) keys on **`article_slug`, not a
foreign key**, so a rename carries its history across in one transaction
(`repositories/articles.ts → update`) and generated/legacy URLs share one history.

## Domain D — reader engagement (0004)

| Table                     | Integrity rules                                                       |
| ------------------------- | --------------------------------------------------------------------- |
| `reactions`               | `UNIQUE(article_slug, voter_id)`; re-vote toggles off, opposite switches |
| `comments`                | `client_id` idempotency key: a retried submit returns the original row |
| `newsletter_subscribers`  | `email` unique `COLLATE NOCASE`; a repeat signup reactivates the row   |
| `contact_messages`        | `status ∈ new/read/archived`                                          |
| `article_views`           | partial unique index `(slug, viewer_id, viewed_on) WHERE viewer_id != ''` — one counted read per viewer per day; anonymous reads still tally |

## Reference data vs seeds

- **Migration 0006** is *reference* data (roles/permissions/grants) — the application does not
  function without it, so it ships with the schema and is idempotent (`INSERT OR IGNORE`,
  deterministic ids).
- **`database/seeds/`** is *development* data and is never applied to production:
  - `001_demo_users.sql` — the two documented dev accounts (PBKDF2 @ 10 000 iterations to match
    the dev `PASSWORD_ITERATIONS`; the server transparently rehashes at first sign-in).
  - `003_content.sql` — **the migrated publication**, generated by running the legacy CMS's own
    `cms/seed.js` (github.com/Sholynk/sholynk-tech, branch `sholynk-tech`) against a throwaway
    SQLite database and dumping the rows: 6 long-form Markdown stories with full bodies, 47 card
    entries, 4 hero slides (5 hero rows after front-matter placement), 21 source records, the
    house author and the four site settings. Every image path was remapped to the Pages asset
    layout (`assets/brand`, `assets/cards/<category>`, `assets/articles/<topic>`), and
    `tests/unit/seed-content.test.ts` re-applies migrations+seeds in memory to prove every
    referenced image exists on disk with a dimensions-manifest entry.

For production content the same file *is* the import: apply migrations remotely
(`npm run db:migrate:remote`) and execute `003_content.sql` once against the production database
(`wrangler d1 execute sholynk_tech --remote --file database/seeds/003_content.sql --env production`).
It is idempotent (`INSERT OR IGNORE` on the legacy ids) and never overwrites live edits.

## Local lifecycle

```bash
npm run db:reset:local        # wipe .wrangler state → migrate → seed (asks for confirmation)
npm run db:seed:local -- --verify   # re-apply seeds + print row counts
npm run db:console:local -- --command "SELECT slug FROM articles LIMIT 5"
```

A running `wrangler dev` keeps its old database file open — restart `npm run dev` after a reset.
