/**
 * Sholynk Tech — role and permission catalogue.
 *
 * This file is the TypeScript mirror of `database/migrations/0006_reference_data.sql`.
 * The database remains the runtime source of truth (permissions are loaded per
 * session and enforced by the API), but keeping a typed catalogue here gives us:
 *   - compile-time safety when asserting `requirePermission('article.write')`
 *   - a parity test that fails if the SQL catalogue and this file drift apart
 *
 * Do not add a permission here without adding it to a migration.
 */

export const ROLE_KEYS = ['public', 'editor', 'admin', 'super_admin'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Higher rank == more privileged. Used for "at least admin" style checks. */
export const ROLE_RANK: Record<RoleKey, number> = {
  public: 0,
  editor: 10,
  admin: 50,
  super_admin: 90,
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  public: 'Public visitor',
  editor: 'Contributing editor',
  admin: 'Administrator',
  super_admin: 'Super administrator',
};

export const PERMISSION_DOMAINS = [
  'general',
  'user',
  'content',
  'engagement',
  'media',
  'inbox',
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
  { key: 'article.read.any', name: 'Read unpublished articles', domain: 'content', description: 'View drafts, pending and scheduled articles through the API.' },
  { key: 'article.submit', name: 'Submit articles', domain: 'content', description: 'Create and edit own drafts and articles pending review.' },
  { key: 'article.write', name: 'Manage articles', domain: 'content', description: 'Create, update, publish, schedule and delete any article.' },
  { key: 'author.write', name: 'Manage authors', domain: 'content', description: 'Create, update and delete author profiles.' },
  { key: 'settings.write', name: 'Manage site metadata', domain: 'security', description: 'Change the site title, description, keywords and tagline.' },
  { key: 'media.write', name: 'Manage media library', domain: 'media', description: 'Upload, re-caption and delete images.' },
  { key: 'engagement.moderate', name: 'Moderate engagement', domain: 'engagement', description: 'Review and delete reader comments.' },
  { key: 'inbox.read', name: 'Read the inbox', domain: 'inbox', description: 'View newsletter subscribers and contact messages.' },
  { key: 'inbox.write', name: 'Manage the inbox', domain: 'inbox', description: 'Update and delete subscriber and contact-message records.' },
  { key: 'analytics.read', name: 'Read analytics', domain: 'analytics', description: 'View editorial analytics and the live dashboard feed.' },
  { key: 'audit.read', name: 'Read audit logs', domain: 'analytics', description: 'Review the platform audit trail.' },
  { key: 'user.read.any', name: 'Read any user', domain: 'user', description: 'View editorial accounts.' },
  { key: 'user.write.any', name: 'Manage any user', domain: 'user', description: 'Suspend, reactivate or edit accounts.' },
  { key: 'user.role.write', name: 'Assign roles', domain: 'security', description: 'Change a user role. Super administrator only.' },
  { key: 'admin.manage', name: 'Manage administrators', domain: 'security', description: 'Create or remove administrator accounts and grant permissions.' },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

/**
 * Default grants, mirroring migration 0006. Tests assert that the database
 * grants and this map are identical.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<RoleKey, readonly PermissionKey[]> = {
  public: [],
  editor: ['article.submit', 'media.write'],
  admin: [
    'article.read.any', 'article.submit', 'article.write',
    'author.write', 'settings.write', 'media.write',
    'engagement.moderate', 'inbox.read', 'inbox.write',
    'analytics.read', 'audit.read', 'user.read.any',
  ],
  super_admin: [
    'article.read.any', 'article.submit', 'article.write',
    'author.write', 'settings.write', 'media.write',
    'engagement.moderate', 'inbox.read', 'inbox.write',
    'analytics.read', 'audit.read',
    'user.read.any', 'user.write.any', 'user.role.write', 'admin.manage',
  ],
};

/** True when the value is one of the catalogue's permission keys. */
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** True when the value is one of the catalogue's role keys. */
export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && (ROLE_KEYS as readonly string[]).includes(value);
}

/** True when `role` outranks or equals `minimum`. */
export function roleAtLeast(role: RoleKey, minimum: RoleKey): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function permissionSetForRole(role: RoleKey): Set<PermissionKey> {
  return new Set(ROLE_PERMISSION_DEFAULTS[role] as readonly PermissionKey[]);
}

export function roleHasPermission(role: RoleKey, permission: PermissionKey): boolean {
  return (ROLE_PERMISSION_DEFAULTS[role] as readonly string[]).includes(permission);
}
