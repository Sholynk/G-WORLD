-- ===========================================================================
-- Sholynk Tech — Migration 0001: Users and access
-- ---------------------------------------------------------------------------
-- Runtime: Cloudflare D1 (SQLite). Never MySQL syntax.
-- Conventions: TEXT ids for platform entities, TEXT ISO-8601 UTC timestamps,
--              INTEGER 0/1 booleans, CHECK constraints instead of ENUMs.
-- The editorial content tables (articles/authors/…) keep the legacy CMS's
-- INTEGER AUTOINCREMENT ids so imported content and reader history keep their
-- identifiers; platform tables use prefixed ULIDs.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- roles — role catalogue. `rank` is used for "at least this privileged" checks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  description TEXT,
  rank        INTEGER NOT NULL DEFAULT 0 CHECK (rank >= 0),
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(key) BETWEEN 2 AND 32)
);

-- ---------------------------------------------------------------------------
-- permissions — atomic capabilities. Routes assert on these keys, never on
-- hardcoded role names, so a new role can be granted existing powers safely.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  description TEXT,
  domain      TEXT NOT NULL DEFAULT 'general' CHECK (domain IN (
                'general', 'user', 'content', 'engagement', 'media',
                'inbox', 'analytics', 'security')),
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (key LIKE '%.%')
);

-- ---------------------------------------------------------------------------
-- role_permissions — many-to-many grant table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  granted_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  granted_by    TEXT,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- users — every account, including administrators and contributing editors.
-- * email is case-insensitively unique.
-- * password_hash stores "pbkdf2$sha256$<iterations>$<salt_b64>$<hash_b64>".
--   There is no code path that writes a plaintext password.
-- * One role per user (role_id); the role -> permission mapping supplies powers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash         TEXT NOT NULL,
  password_algo         TEXT NOT NULL DEFAULT 'pbkdf2-sha256' CHECK (password_algo IN (
                          'pbkdf2-sha256', 'scrypt', 'argon2id')),
  password_changed_at   TEXT,
  role_id               TEXT NOT NULL REFERENCES roles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending_verification' CHECK (status IN (
                          'pending_verification', 'active', 'suspended', 'deactivated')),
  email_verified_at     TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          TEXT,
  last_login_at         TEXT,
  terms_accepted_at     TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (email LIKE '%_@_%._%'),
  CHECK (length(password_hash) >= 40)
);

-- ---------------------------------------------------------------------------
-- user_profiles — optional account details, 1:1 with users.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  display_name TEXT,
  full_name    TEXT,
  bio          TEXT,
  avatar_url   TEXT,
  website      TEXT,
  country      TEXT,
  timezone     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (display_name IS NULL OR length(display_name) BETWEEN 2 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_users_role_id         ON users (role_id);
CREATE INDEX IF NOT EXISTS idx_users_status          ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_email           ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_created_at      ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON role_permissions (permission_id);
