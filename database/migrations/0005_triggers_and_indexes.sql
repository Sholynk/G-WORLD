-- ===========================================================================
-- Sholynk Tech — Migration 0005: updated_at triggers
-- ---------------------------------------------------------------------------
-- SQLite has no ON UPDATE CURRENT_TIMESTAMP, so `updated_at` is maintained by
-- AFTER UPDATE triggers. Each trigger only fires when a column other than
-- updated_at changed, so the trigger's own UPDATE does not recurse.
--
-- Content tables use the legacy CMS's local UTC format (datetime('now'));
-- platform tables use the ISO-8601 format the API writes elsewhere.
-- ===========================================================================

PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_roles_updated_at
AFTER UPDATE ON roles FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE roles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_permissions_updated_at
AFTER UPDATE ON permissions FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE permissions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_user_profiles_updated_at
AFTER UPDATE ON user_profiles FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE user_profiles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = NEW.user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_articles_updated_at
AFTER UPDATE ON articles FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE articles SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_authors_updated_at
AFTER UPDATE ON authors FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE authors SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_article_sources_updated_at
AFTER UPDATE ON article_sources FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE article_sources SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_settings_updated_at
AFTER UPDATE ON settings FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE settings SET updated_at = datetime('now') WHERE key = NEW.key;
END;

CREATE TRIGGER IF NOT EXISTS trg_reactions_updated_at
AFTER UPDATE ON reactions FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE reactions SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_subscribers_updated_at
AFTER UPDATE ON newsletter_subscribers FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE newsletter_subscribers SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_email_messages_updated_at
AFTER UPDATE ON email_messages FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE email_messages SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
