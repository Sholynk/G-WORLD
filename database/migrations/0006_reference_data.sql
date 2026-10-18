-- ===========================================================================
-- Sholynk Tech — Migration 0006: Reference data (roles, permissions, grants)
-- ---------------------------------------------------------------------------
-- This is *reference* data, not demo data: it is required for the application
-- to function and is therefore part of the migration set (unlike database/seeds,
-- which is development-only content).
--
-- This file is the SQL mirror of packages/shared/src/roles.ts. A unit test
-- (tests/unit/shared-contracts.test.ts) fails if the two drift apart.
--
-- The migration is idempotent (INSERT OR IGNORE + deterministic ids) so it can
-- be re-applied safely and so a later migration can add permissions without
-- rewriting this one.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO roles (id, key, name, description, rank, is_system) VALUES
  ('role_public',      'public',      'Public visitor',      'Unauthenticated reader. Read-only access to published content and engagement widgets.', 0,  1),
  ('role_editor',      'editor',      'Contributing editor', 'Can draft articles and upload media, and submit articles for editorial review.',        10, 1),
  ('role_admin',       'admin',       'Administrator',       'Runs the publication: content, authors, media, moderation, inbox and analytics.',        50, 1),
  ('role_super_admin', 'super_admin', 'Super administrator', 'Full control, including administrator accounts and roles.',                              90, 1);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (id, key, name, domain, description) VALUES
  ('perm_article_read_any',    'article.read.any',    'Read unpublished articles', 'content',    'View drafts, pending and scheduled articles through the API.'),
  ('perm_article_submit',      'article.submit',      'Submit articles',           'content',    'Create and edit own drafts and articles pending review.'),
  ('perm_article_write',       'article.write',       'Manage articles',           'content',    'Create, update, publish, schedule and delete any article.'),
  ('perm_author_write',        'author.write',        'Manage authors',            'content',    'Create, update and delete author profiles.'),
  ('perm_settings_write',      'settings.write',      'Manage site metadata',      'security',   'Change the site title, description, keywords and tagline.'),
  ('perm_media_write',         'media.write',         'Manage media library',      'media',      'Upload, re-caption and delete images.'),
  ('perm_engagement_moderate', 'engagement.moderate', 'Moderate engagement',       'engagement', 'Review and delete reader comments.'),
  ('perm_inbox_read',          'inbox.read',          'Read the inbox',            'inbox',      'View newsletter subscribers and contact messages.'),
  ('perm_inbox_write',         'inbox.write',         'Manage the inbox',          'inbox',      'Update and delete subscriber and contact-message records.'),
  ('perm_analytics_read',      'analytics.read',      'Read analytics',            'analytics',  'View editorial analytics and the live dashboard feed.'),
  ('perm_audit_read',          'audit.read',          'Read audit logs',           'analytics',  'Review the platform audit trail.'),
  ('perm_user_read_any',       'user.read.any',       'Read any user',             'user',       'View editorial accounts.'),
  ('perm_user_write_any',      'user.write.any',      'Manage any user',           'user',       'Suspend, reactivate or edit accounts.'),
  ('perm_user_role_write',     'user.role.write',     'Assign roles',              'security',   'Change a user role. Super administrator only.'),
  ('perm_admin_manage',        'admin.manage',        'Manage administrators',     'security',   'Create or remove administrator accounts and grant permissions.');

-- ---------------------------------------------------------------------------
-- Role → permission grants (mirror of ROLE_PERMISSION_DEFAULTS)
-- ---------------------------------------------------------------------------
-- editor: submit work, upload media
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_editor', id FROM permissions WHERE key IN (
  'article.submit', 'media.write'
);

-- admin: everything editorial and operational
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions WHERE key IN (
  'article.read.any', 'article.submit', 'article.write',
  'author.write', 'settings.write', 'media.write',
  'engagement.moderate', 'inbox.read', 'inbox.write',
  'analytics.read', 'audit.read', 'user.read.any'
);

-- super_admin: admin powers plus account and role management
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_super_admin', id FROM permissions WHERE key IN (
  'article.read.any', 'article.submit', 'article.write',
  'author.write', 'settings.write', 'media.write',
  'engagement.moderate', 'inbox.read', 'inbox.write',
  'analytics.read', 'audit.read',
  'user.read.any', 'user.write.any', 'user.role.write', 'admin.manage'
);
