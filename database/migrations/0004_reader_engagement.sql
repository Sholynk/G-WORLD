-- ===========================================================================
-- Sholynk Tech — Migration 0004: Reader engagement and forms
-- ---------------------------------------------------------------------------
-- Reactions, comments, anonymous read counts, newsletter subscribers and
-- contact messages, ported from the legacy Sholynk CMS.
--
-- Everything here is keyed by article *slug* (not a foreign key) so generated
-- and legacy query-string article URLs share one engagement history, and a
-- rename can carry its history across in one UPDATE (see the articles
-- repository). Readers are anonymous browser ids — no accounts, no IPs, no
-- personal data beyond what they type into a form.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- reactions — one like/dislike per (article, voter). Re-voting the same type
-- removes the row (un-vote); voting the other type switches sides.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_slug TEXT NOT NULL,
  voter_id     TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('like', 'dislike')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_slug, voter_id),
  CHECK (length(article_slug) BETWEEN 1 AND 120),
  CHECK (length(voter_id) BETWEEN 1 AND 64)
);

-- ---------------------------------------------------------------------------
-- comments — reader comments with a client-generated idempotency key so a
-- retried submit never double-posts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_slug TEXT NOT NULL,
  author       TEXT NOT NULL,
  body         TEXT NOT NULL,
  voter_id     TEXT NOT NULL DEFAULT '',
  client_id    TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(article_slug) BETWEEN 1 AND 120),
  CHECK (length(author) BETWEEN 1 AND 60),
  CHECK (length(body) BETWEEN 1 AND 2000)
);

-- ---------------------------------------------------------------------------
-- newsletter_subscribers — case-insensitively unique email; a repeat signup
-- reactivates and refreshes the row instead of failing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (email LIKE '%_@_%._%')
);

-- ---------------------------------------------------------------------------
-- contact_messages — messages from the public contact form.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- article_views — one counted read per viewer per article per day (enforced by
-- the partial unique index; anonymous reads with no viewer id are exempt so
-- they are still tallied).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS article_views (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_slug TEXT NOT NULL,
  viewer_id    TEXT NOT NULL DEFAULT '',
  viewed_on    TEXT NOT NULL DEFAULT (date('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (length(article_slug) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS idx_reactions_slug          ON reactions (article_slug);
CREATE INDEX IF NOT EXISTS idx_reactions_created       ON reactions (created_at);
CREATE INDEX IF NOT EXISTS idx_comments_slug           ON comments (article_slug, id);
CREATE INDEX IF NOT EXISTS idx_comments_client         ON comments (client_id);
CREATE INDEX IF NOT EXISTS idx_comments_created        ON comments (created_at);
CREATE INDEX IF NOT EXISTS idx_subscribers_status      ON newsletter_subscribers (status, id);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages (status, id);
CREATE INDEX IF NOT EXISTS idx_views_slug              ON article_views (article_slug, viewed_on);
CREATE INDEX IF NOT EXISTS idx_views_day               ON article_views (viewed_on);

-- One counted read per viewer, per article, per day. Anonymous reads (no
-- viewer id, e.g. a browser blocking storage) are exempt so they are still
-- tallied.
CREATE UNIQUE INDEX IF NOT EXISTS idx_views_unique
  ON article_views (article_slug, viewer_id, viewed_on) WHERE viewer_id != '';
