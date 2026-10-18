-- ===========================================================================
-- Sholynk Tech — Migration 0002: Platform and security data
-- ---------------------------------------------------------------------------
-- Sessions, single-use tokens, notifications, the email outbox, the audit
-- trail and the rate-limit counters all live here.
-- Raw tokens are NEVER stored: only their SHA-256 hash, so a database leak
-- cannot be replayed against the platform.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- user_sessions — database-backed sessions.
-- `token_hash` = SHA-256 of the opaque value held in the httpOnly cookie.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at        TEXT NOT NULL,
  revoked_at        TEXT,
  revoked_reason    TEXT,
  ip_hash           TEXT,
  user_agent        TEXT,
  CHECK (expires_at > created_at),
  CHECK (length(token_hash) = 64)
);

-- ---------------------------------------------------------------------------
-- notifications — in-app notices for editors and administrators.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  type        TEXT NOT NULL DEFAULT 'info' CHECK (type IN (
                'info', 'success', 'warning', 'error', 'editorial', 'announcement')),
  title       TEXT NOT NULL,
  body        TEXT,
  link_url    TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(title) BETWEEN 1 AND 160)
);

-- ---------------------------------------------------------------------------
-- email_verification_tokens — single-use, expiring account verification.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(token_hash) = 64)
);

-- ---------------------------------------------------------------------------
-- password_reset_tokens — single-use, short-lived password resets.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,
  requested_ip_hash TEXT,
  expires_at        TEXT NOT NULL,
  consumed_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(token_hash) = 64)
);

-- ---------------------------------------------------------------------------
-- email_messages — outbox + delivery log for every outbound email.
-- With EMAIL_PROVIDER=console (development) rows are written with
-- status='logged', which makes the verification/reset flow fully testable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_messages (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  to_email     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body_text    TEXT NOT NULL,
  template     TEXT,
  provider     TEXT NOT NULL DEFAULT 'console' CHECK (provider IN ('console', 'resend')),
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                 'queued', 'logged', 'sent', 'failed')),
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_message_id TEXT,
  sent_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- audit_logs — append-only record of privileged and security-relevant actions.
-- Rows are never updated or deleted by application code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  actor_role    TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  description   TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  status        TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failure')),
  ip_hash       TEXT,
  user_agent    TEXT,
  request_id    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- rate_limits — D1-backed fixed-window limiter. One row per (key, window).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  window_start TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  blocked_until TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user      ON user_sessions (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry    ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evt_user           ON email_verification_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_evt_expiry         ON email_verification_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_prt_user           ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expiry         ON password_reset_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_email_status       ON email_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor        ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity       ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created      ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits (expires_at);
