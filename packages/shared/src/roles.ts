/**
 * G WORLD — role and permission catalogue.
 *
 * This file is the TypeScript mirror of `database/migrations/0007_reference_data.sql`.
 * The database remains the runtime source of truth (permissions are loaded per
 * session and enforced by the API), but keeping a typed catalogue here gives us:
 *   - compile-time safety when asserting `requirePermission('course.write')`
 *   - a parity test that fails if the SQL catalogue and this file drift apart
 *
 * Do not add a permission here without adding it to a migration.
 */

export const ROLE_KEYS = ['public', 'student', 'admin', 'super_admin'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Higher rank == more privileged. Used for "at least admin" style checks. */
export const ROLE_RANK: Record<RoleKey, number> = {
  public: 0,
  student: 10,
  admin: 50,
  super_admin: 90,
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  public: 'Public visitor',
  student: 'Student',
  admin: 'Administrator',
  super_admin: 'Super administrator',
};

export const PERMISSION_DOMAINS = [
  'general',
  'user',
  'content',
  'learning',
  'assessment',
  'certificate',
  'analytics',
  'security',
] as const;
export type PermissionDomain = (typeof PERMISSION_DOMAINS)[number];

export interface PermissionDefinition {
  readonly key: string;
  readonly name: string;
  readonly domain: PermissionDomain;
  readonly description: string;
}

export const PERMISSIONS = [
  { key: 'course.read', name: 'Read courses', domain: 'content', description: 'View published courses, modules and lessons.' },
  { key: 'course.write', name: 'Manage courses', domain: 'content', description: 'Create, update, publish and archive courses.' },
  { key: 'department.write', name: 'Manage departments', domain: 'content', description: 'Create, update, publish and archive departments.' },
  { key: 'subject.write', name: 'Manage subjects', domain: 'content', description: 'Create, update, publish and archive subjects.' },
  { key: 'module.write', name: 'Manage modules', domain: 'content', description: 'Create, update, publish and archive course modules.' },
  { key: 'lesson.write', name: 'Manage lessons', domain: 'content', description: 'Create, update, publish and archive lessons, videos and resources.' },
  { key: 'skill.write', name: 'Manage skills', domain: 'content', description: 'Maintain the skill vocabulary and course skill links.' },
  { key: 'user.read.any', name: 'Read any user', domain: 'user', description: 'View student accounts and profiles.' },
  { key: 'user.write.any', name: 'Manage any user', domain: 'user', description: 'Suspend, reactivate or edit student accounts.' },
  { key: 'user.role.write', name: 'Assign roles', domain: 'security', description: 'Change a user role. Super administrator only.' },
  { key: 'admin.manage', name: 'Manage administrators', domain: 'security', description: 'Create or remove administrator accounts and grant permissions.' },
  { key: 'enrollment.read.any', name: 'Read any enrollment', domain: 'learning', description: 'View all enrollments and learner progress.' },
  { key: 'enrollment.own', name: 'Manage own enrollment', domain: 'learning', description: 'Enrol in courses and manage own enrollments.' },
  { key: 'progress.own', name: 'Track own progress', domain: 'learning', description: 'Record own lesson progress and completion.' },
  { key: 'assessment.read.any', name: 'Read any assessment', domain: 'assessment', description: 'View quiz and assignment results across the platform.' },
  { key: 'assessment.write', name: 'Manage assessments', domain: 'assessment', description: 'Create quizzes, questions and assignments; grade submissions.' },
  { key: 'assessment.take', name: 'Take assessments', domain: 'assessment', description: 'Attempt quizzes and submit assignments.' },
  { key: 'certificate.own.read', name: 'Read own certificates', domain: 'certificate', description: 'View and download own certificates.' },
  { key: 'certificate.write', name: 'Manage certificates', domain: 'certificate', description: 'Issue, revoke and correct certificate records.' },
  { key: 'qr.own.read', name: 'View own QR code', domain: 'security', description: 'Display own student identity QR code.' },
  { key: 'qr.scan', name: 'Scan / look up QR codes', domain: 'security', description: 'Look up a student identity or certificate from a scanned code.' },
  { key: 'analytics.read', name: 'Read analytics', domain: 'analytics', description: 'View platform learning analytics and reports.' },
  { key: 'audit.read', name: 'Read audit logs', domain: 'analytics', description: 'Review the platform audit trail.' },
  { key: 'settings.write', name: 'Manage platform settings', domain: 'security', description: 'Change platform configuration and feature flags.' },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

/**
 * Default grants, mirroring migration 0007. Tests assert that the database
 * grants and this map are identical.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<RoleKey, readonly PermissionKey[]> = {
  public: [],
  student: [
    'course.read',
    'enrollment.own',
    'progress.own',
    'assessment.take',
    'certificate.own.read',
    'qr.own.read',
  ],
  admin: [
    'course.read', 'enrollment.own', 'progress.own', 'assessment.take',
    'certificate.own.read', 'qr.own.read',
    'course.write', 'department.write', 'subject.write', 'module.write',
    'lesson.write', 'skill.write',
    'user.read.any', 'user.write.any',
    'enrollment.read.any', 'assessment.read.any', 'assessment.write',
    'certificate.write', 'qr.scan', 'analytics.read', 'audit.read',
  ],
  super_admin: PERMISSION_KEYS,
};

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** True when `role` outranks or equals `minimum`. */
export function roleAtLeast(role: RoleKey, minimum: RoleKey): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function permissionSetForRole(role: RoleKey): Set<PermissionKey> {
  return new Set(ROLE_PERMISSION_DEFAULTS[role]);
}

export function roleHasPermission(role: RoleKey, permission: PermissionKey): boolean {
  return ROLE_PERMISSION_DEFAULTS[role].includes(permission);
}
