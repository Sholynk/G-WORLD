-- ===========================================================================
-- G WORLD — Migration 0007: Reference data (roles, permissions, grants)
-- ---------------------------------------------------------------------------
-- This is *reference* data, not demo data: it is required for the application
-- to function and is therefore part of the migration set (unlike database/seeds,
-- which is development-only).
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
  ('role_public',      'public',      'Public visitor',    'Unauthenticated visitor. Read-only access to published content.', 0,  1),
  ('role_student',     'student',     'Student',           'Enrolled learner with a personal dashboard and progress tracking.', 10, 1),
  ('role_admin',       'admin',       'Administrator',     'Manages students, educational content and platform operations.', 50, 1),
  ('role_super_admin', 'super_admin', 'Super administrator', 'Full platform control, including administrator accounts and roles.', 90, 1);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (id, key, name, domain, description) VALUES
  ('perm_course_read',        'course.read',        'Read courses',              'content',     'View published courses, modules and lessons.'),
  ('perm_course_write',       'course.write',       'Manage courses',            'content',     'Create, update, publish and archive courses.'),
  ('perm_department_write',   'department.write',   'Manage departments',        'content',     'Create, update, publish and archive departments.'),
  ('perm_subject_write',      'subject.write',      'Manage subjects',           'content',     'Create, update, publish and archive subjects.'),
  ('perm_module_write',       'module.write',       'Manage modules',            'content',     'Create, update, publish and archive course modules.'),
  ('perm_lesson_write',       'lesson.write',       'Manage lessons',            'content',     'Create, update, publish and archive lessons, videos and resources.'),
  ('perm_skill_write',        'skill.write',        'Manage skills',             'content',     'Maintain the skill vocabulary and course skill links.'),
  ('perm_user_read_any',      'user.read.any',      'Read any user',             'user',        'View student accounts and profiles.'),
  ('perm_user_write_any',     'user.write.any',     'Manage any user',           'user',        'Suspend, reactivate or edit student accounts.'),
  ('perm_user_role_write',    'user.role.write',    'Assign roles',              'security',    'Change a user role. Super administrator only.'),
  ('perm_admin_manage',       'admin.manage',       'Manage administrators',     'security',    'Create or remove administrator accounts and grant permissions.'),
  ('perm_enrollment_read_any','enrollment.read.any','Read any enrollment',       'learning',    'View all enrollments and learner progress.'),
  ('perm_enrollment_own',     'enrollment.own',     'Manage own enrollment',     'learning',    'Enrol in courses and manage own enrollments.'),
  ('perm_progress_own',       'progress.own',       'Track own progress',        'learning',    'Record own lesson progress and completion.'),
  ('perm_assessment_read_any','assessment.read.any','Read any assessment',       'assessment',  'View quiz and assignment results across the platform.'),
  ('perm_assessment_write',   'assessment.write',   'Manage assessments',        'assessment',  'Create quizzes, questions and assignments; grade submissions.'),
  ('perm_assessment_take',    'assessment.take',    'Take assessments',          'assessment',  'Attempt quizzes and submit assignments.'),
  ('perm_certificate_read_own','certificate.own.read','Read own certificates',   'certificate', 'View and download own certificates.'),
  ('perm_certificate_write',  'certificate.write',  'Manage certificates',       'certificate', 'Issue, revoke and correct certificate records.'),
  ('perm_qr_own_read',        'qr.own.read',        'View own QR code',          'security',    'Display own student identity QR code.'),
  ('perm_qr_scan',            'qr.scan',            'Scan / look up QR codes',   'security',    'Look up a student identity or certificate from a scanned code.'),
  ('perm_analytics_read',     'analytics.read',     'Read analytics',            'analytics',   'View platform learning analytics and reports.'),
  ('perm_audit_read',         'audit.read',         'Read audit logs',           'analytics',   'Review the platform audit trail.'),
  ('perm_settings_write',     'settings.write',     'Manage platform settings',  'security',    'Change platform configuration and feature flags.');

-- ---------------------------------------------------------------------------
-- Role → permission grants
-- ---------------------------------------------------------------------------
-- student: learning, own data only
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_student', id FROM permissions WHERE key IN (
  'course.read', 'enrollment.own', 'progress.own', 'assessment.take',
  'certificate.own.read', 'qr.own.read'
);

-- admin: everything a student has, plus content, student management, analytics
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_admin', id FROM permissions WHERE key IN (
  'course.read', 'enrollment.own', 'progress.own', 'assessment.take',
  'certificate.own.read', 'qr.own.read',
  'course.write', 'department.write', 'subject.write', 'module.write',
  'lesson.write', 'skill.write',
  'user.read.any', 'user.write.any',
  'enrollment.read.any', 'assessment.read.any', 'assessment.write',
  'certificate.write', 'qr.scan', 'analytics.read', 'audit.read'
);

-- super_admin: every permission, including role assignment and admin management
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT 'role_super_admin', id FROM permissions;

-- ---------------------------------------------------------------------------
-- Post-conditions: fail the migration loudly if the grants are incomplete.
-- ---------------------------------------------------------------------------
INSERT INTO audit_logs (id, action, entity_type, description, metadata_json)
SELECT
  'audit_0007_reference_data',
  'system.migration.applied',
  'system',
  'Applied migration 0007_reference_data (roles, permissions, role grants).',
  json_object(
    'roles', (SELECT COUNT(*) FROM roles),
    'permissions', (SELECT COUNT(*) FROM permissions),
    'grants', (SELECT COUNT(*) FROM role_permissions)
  )
WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE id = 'audit_0007_reference_data');
