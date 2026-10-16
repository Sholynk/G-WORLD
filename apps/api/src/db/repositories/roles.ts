/**
 * Repository — roles and permissions.
 *
 * Permissions are loaded per request from the database (role -> permissions),
 * never from a hardcoded list in a route. That means a super administrator can
 * change what an admin role may do without a deployment, and a compromised
 * frontend cannot widen its own access.
 */
import type { Db } from '../client.js';
import type { PermissionKey, RoleKey } from '@g-world/shared';

export interface RoleRow {
  id: string;
  key: RoleKey;
  name: string;
  description: string | null;
  rank: number;
  is_system: number;
}

export interface PermissionRow {
  id: string;
  key: PermissionKey | string;
  name: string;
  domain: string;
}

export async function findRoleByKey(db: Db, key: RoleKey): Promise<RoleRow | null> {
  return db.first<RoleRow>(
    `SELECT id, key, name, description, rank, is_system FROM roles WHERE key = ? LIMIT 1`,
    [key],
  );
}

export async function requireRoleByKey(db: Db, key: RoleKey): Promise<RoleRow> {
  const role = await findRoleByKey(db, key);
  if (!role) throw new Error(`role "${key}" is missing — run migration 0007_reference_data.sql`);
  return role;
}

export async function listRoles(db: Db): Promise<RoleRow[]> {
  return db.all<RoleRow>(
    `SELECT id, key, name, description, rank, is_system FROM roles ORDER BY rank ASC`,
  );
}

export async function listPermissions(db: Db): Promise<PermissionRow[]> {
  return db.all<PermissionRow>(`SELECT id, key, name, domain FROM permissions ORDER BY key ASC`);
}

/** Permission keys granted to a role — the list the auth middleware caches. */
export async function listPermissionKeysForRole(db: Db, roleId: string): Promise<string[]> {
  const rows = await db.all<{ key: string }>(
    `SELECT p.key AS key
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.key ASC`,
    [roleId],
  );
  return rows.map((row) => row.key);
}

/** Convenience: permission keys for a role key (used by tests and admin UI). */
export async function listPermissionKeysForRoleKey(db: Db, roleKey: RoleKey): Promise<string[]> {
  const role = await findRoleByKey(db, roleKey);
  if (!role) return [];
  return listPermissionKeysForRole(db, role.id);
}

export interface RolePermissionMatrixRow {
  role_key: RoleKey;
  permission_key: string;
}

/** Full role→permission matrix, used by the parity test against @g-world/shared. */
export async function rolePermissionMatrix(db: Db): Promise<RolePermissionMatrixRow[]> {
  return db.all<RolePermissionMatrixRow>(
    `SELECT r.key AS role_key, p.key AS permission_key
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      ORDER BY r.rank ASC, p.key ASC`,
  );
}

export async function grantPermission(
  db: Db,
  roleId: string,
  permissionId: string,
  grantedBy: string | null,
): Promise<void> {
  await db.run(
    `INSERT OR IGNORE INTO role_permissions (role_id, permission_id, granted_by)
     VALUES (?, ?, ?)`,
    [roleId, permissionId, grantedBy],
  );
}

export async function revokePermission(db: Db, roleId: string, permissionId: string): Promise<number> {
  return db.changes(`DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`, [
    roleId,
    permissionId,
  ]);
}
