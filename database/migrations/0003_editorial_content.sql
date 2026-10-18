-- ===========================================================================
-- Sholynk Tech — Migration 0003: Editorial content
-- ---------------------------------------------------------------------------
-- The publication's content tables, ported from the legacy Sholynk CMS
-- (cms/lib/db.js) to D1. The database is the single runtime source of truth
-- for articles, authors, references, media records, URL redirects and site
-- metadata. Version-controlled seed SQL (database/seeds) can bootstrap a new
-- installation but normal operation never overwrites live rows.
--
-- Timestamps in these tables use SQLite's local `datetime('now')` format
-- ("YYYY-MM-DD HH:MM:SS", UTC, no zone marker) exactly like the legacy CMS,
-- because analytics queries (date(created_at) >= date('now','-29 days')) and
-- the dashboard's relative-time formatting were written against it.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- articles — every story, card entry and hero placement on the site.
-- status: published | draft | scheduled | pending (awaiting editorial review).
-- Reader history (views/reactions/comments) is keyed by slug, not by FK.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'Technology',
  description     TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  img             TEXT NOT NULL DEFAULT '',
  alt             TEXT NOT NULL DEFAULT '',
  author          TEXT NOT NULL DEFAULT 'Sholynk Editorial',
  author_slug     TEXT NOT NULL DEFAULT '',
  published_at    TEXT NOT NULL DEFAULT (date('now')),
  reading_time    TEXT NOT NULL DEFAULT '5 min read',
  featured        INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  status          TEXT NOT NULL DEFAULT 'published' CHECK (status IN (
                    'published', 'draft', 'scheduled', 'pending')),
  hero            INTEGER NOT NULL DEFAULT 0 CHECK (hero IN (0, 1)),
  hero_order      INTEGER,
  external_link   TEXT,
  seo_title       TEXT,
  seo_description TEXT,
  content_type    TEXT NOT NULL DEFAULT 'article' CHECK (content_type IN (
                    'article', 'news', 'guide', 'opinion', 'review', 'analysis')),
  subcategory     TEXT NOT NULL DEFAULT '',
  tags_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  hook            TEXT NOT NULL DEFAULT '',
  direct_answer   TEXT NOT NULL DEFAULT '',
  key_takeaways_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(key_takeaways_json)),
  faqs_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(faqs_json)),
  related_slugs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(related_slugs_json)),
  canonical_url   TEXT,
  scheduled_at    TEXT,
  review_notes    TEXT NOT NULL DEFAULT '',
  submitter_email TEXT NOT NULL DEFAULT '',
  submitted_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(slug) BETWEEN 1 AND 120),
  CHECK (length(title) BETWEEN 1 AND 200)
);

-- ---------------------------------------------------------------------------
-- authors — author entities every article is attributed to. The house author
-- (site owner) is seeded and cannot be deleted by the API.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS authors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  bio         TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  image_alt   TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(slug) BETWEEN 1 AND 120),
  CHECK (length(name) BETWEEN 1 AND 120)
);

-- ---------------------------------------------------------------------------
-- article_sources — verified references/research behind an article.
-- type: primary | official | research | journalism | reference | other.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_sources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  publisher    TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'journalism' CHECK (type IN (
                 'primary', 'official', 'research', 'journalism', 'reference', 'other')),
  doi          TEXT NOT NULL DEFAULT '',
  accessed_at  TEXT NOT NULL DEFAULT '',
  supports     TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- settings — site metadata key/value store (title, description, keywords,
-- homepage tagline). Seeded once; the admin dashboard edits these live.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- images — media library records. The bytes live in the R2 bucket; this table
-- stores the metadata (and the public /uploads/<filename> URL).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  filename     TEXT NOT NULL UNIQUE,
  url          TEXT NOT NULL,
  alt          TEXT NOT NULL DEFAULT '',
  mime_type    TEXT NOT NULL DEFAULT '',
  size_bytes   INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  width        INTEGER,
  height       INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- redirects — slug history. When an article is renamed the old slug keeps
-- working with a 301 and reader history moves with the article.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS redirects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  old_slug   TEXT NOT NULL UNIQUE,
  new_slug   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- submissions — editorial review trail: one row per "submitted for review"
-- event, so reviewers can see what was sent, by whom and when.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id      INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  article_slug    TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  author_name     TEXT NOT NULL DEFAULT '',
  submitter_email TEXT NOT NULL DEFAULT '',
  submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at     TEXT,
  notes           TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_articles_category   ON articles (category);
CREATE INDEX IF NOT EXISTS idx_articles_status     ON articles (status);
CREATE INDEX IF NOT EXISTS idx_articles_hero       ON articles (hero, hero_order);
CREATE INDEX IF NOT EXISTS idx_articles_published  ON articles (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_author     ON articles (author_slug);
CREATE INDEX IF NOT EXISTS idx_sources_article     ON article_sources (article_id, id);
CREATE INDEX IF NOT EXISTS idx_submissions_article ON submissions (article_id, id);
