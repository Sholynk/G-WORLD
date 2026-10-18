-- ===========================================================================
-- Sholynk Tech — Seed 001: development accounts
-- ---------------------------------------------------------------------------
-- ⚠ DEVELOPMENT ONLY — these passwords are public knowledge in this repository.
--    Never apply this file to a production database.
--
--   super administrator : admin@sholynk.test  / AdminPassword123!
--   contributing editor : editor@sholynk.test / EditorPassword123!
--
-- Hashes are PBKDF2-HMAC-SHA256 with 10 000 iterations, matching the
-- PASSWORD_ITERATIONS used by the development environment in wrangler.jsonc.
-- On a production deployment the server transparently re-hashes each of these
-- to the configured strength at first sign-in — but they would still be
-- guessable, which is exactly why this file must never reach production.
--
-- The publication's content itself lives in 003_content.sql (generated from
-- the legacy CMS seed), and the house author profile lives there too.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, email, password_hash, role_id, status, email_verified_at, terms_accepted_at) VALUES
  ('usr_sholynk_admin', 'admin@sholynk.test',
   'pbkdf2$sha256$10000$08dlDkr5Hv+bPHSMRVPVZg==$vgHKNPlMzaePcAwP3xDBhXfgwuAxACClonRQDsY2ckc=',
   'role_super_admin', 'active', '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z'),

  ('usr_sholynk_editor', 'editor@sholynk.test',
   'pbkdf2$sha256$10000$XTnnk7ovx083zPwbcUrZEg==$/oy8/cn2CQjUu5dXLuBBKaRFfGPk6KWc7ddXQMq1vxc=',
   'role_editor', 'active', '2026-10-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO user_profiles (user_id, display_name, full_name, bio, country, timezone) VALUES
  ('usr_sholynk_admin', 'Sholynk Admin', 'Oluwashola Busari',
   'Founder of Sholynk Technology; runs the publication and the CMS.', 'NG', 'Africa/Lagos'),
  ('usr_sholynk_editor', 'Sholynk Editor', NULL,
   'Contributing editor account used to exercise the submit-for-review flow.', 'NG', 'Africa/Lagos');
