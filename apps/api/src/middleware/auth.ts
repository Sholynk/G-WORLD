/**
 * Middleware — authentication and authorisation.
 *
 * `resolveAuth` runs on every request and populates `c.get('auth')` when a valid
 * session is presented (cookie or bearer token). It never rejects: public
 * endpoints must keep working for signed-out visitors.
 *
 * The guards below are what actually protect data. They are applied per route in
 * the route files, and they check the database-backed role/permission set — not
 * a claim from the client:
 *
 *   requireAuth()                    → any signed-in user, verified email
 *   requirePermission('course.write') → role has that capability right now
 *   requireRole('admin')             → rank-based "at least this privileged"
 *   requireSelfOrPermission(id)      → own resource, or a staff permission
 *
 * Because every protected route goes through these, hiding a button in the
 * frontend is never the only barrier — an attacker calling the API directly
 * gets exactly the same checks.
 */
import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';
import type { AppContext, AppEnv, AuthContext, Bindings } from '../env.js';
import type { PermissionKey, RoleKey } from '@sholynk/shared';
import { ROLE_RANK, isPermissionKey, isRoleKey } from '@sholynk/shared';
import { createDb } from '../db/client.js';
import * as sessions from '../db/repositories/sessions.js';
import * as roles from '../db/repositories/roles.js';
import * as users from '../db/repositories/users.js';
import { accessAllowed } from '../db/repositories/author-access.js';
import { hashToken } from '../lib/tokens.js';
import { readCookie, SESSION_COOKIE } from '../lib/cookies.js';
import {
  accountSuspended,
  emailNotVerified,
  forbidden,
  sessionExpired,
  unauthenticated,
} from '../lib/errors.js';

/** Extracts the presented session token: cookie first, then bearer header. */
export function presentedToken(c: AppContext): string | null {
  const cookieToken = readCookie(c.req.header('cookie'), SESSION_COOKIE);
  if (cookieToken) return cookieToken;

  const header = c.req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    return token || null;
  }
  return null;
}

export const resolveAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = presentedToken(c);
  if (!token) {
    c.set('auth', null);
    await next();
    return;
  }

  const db = createDb(c.env.DB, c.get('logger')?.debug);
  const tokenHash = await hashToken(token);
  const session = await sessions.findActiveSession(db, tokenHash);

  if (!session) {
    c.set('auth', null);
    await next();
    return;
  }

  if (session.status !== 'active' || !session.email_verified_at || !(await accessAllowed(db, session.user_id))) {
    c.set('auth', null);
    await next();
    return;
  }

  const permissions = await roles.listPermissionKeysForRole(db, session.role_id);
  const auth: AuthContext = {
    userId: session.user_id,
    email: session.email,
    roleKey: session.role_key,
    roleRank: session.role_rank,
    permissions,
    status: session.status,
    emailVerified: session.email_verified_at !== null,
    sessionId: session.id,
    displayName: session.display_name,
  };

  c.set('auth', auth);
  // `last_seen_at` is refreshed at most hourly inside the repository.
  await sessions.touchSession(db, session.id);

  await next();
});

export function authFrom(c: AppContext): AuthContext | null {
  return c.get('auth') ?? null;
}

/** Any authenticated, active user. */
export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw unauthenticated();
    if (auth.status === 'suspended' || auth.status === 'deactivated') throw accountSuspended();
    await next();
  };
}

/** Authenticated *and* email verified — used for enrollment and submissions. */
export function requireVerified(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw unauthenticated();
    if (auth.status === 'suspended' || auth.status === 'deactivated') throw accountSuspended();
    if (!auth.emailVerified) throw emailNotVerified();
    await next();
  };
}

/** Requires a specific permission, resolved from the database per request. */
export function requirePermission(permission: PermissionKey): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw unauthenticated();
    if (auth.status === 'suspended' || auth.status === 'deactivated') throw accountSuspended();
    if (!isPermissionKey(permission)) throw forbidden('Unknown permission');
    if (!auth.permissions.includes(permission)) {
      c.get('logger')?.warn('permission denied', {
        user_id: auth.userId,
        role: auth.roleKey,
        permission,
      });
      throw forbidden();
    }
    await next();
  };
}

/** Convenience for "at least this role" checks (rank-based, hierarchical). */
export function requireRole(minimum: RoleKey): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw unauthenticated();
    if (auth.status === 'suspended' || auth.status === 'deactivated') throw accountSuspended();
    const minimumRank = ROLE_RANK[isRoleKey(minimum) ? minimum : 'admin'];
    if (auth.roleRank < minimumRank) throw forbidden();
    await next();
  };
}

/**
 * Allows access to your own resource, or to anyone holding `staffPermission`.
 * Used by learner endpoints that take a user id, so one student cannot read
 * another's progress by guessing an id.
 */
export function requireSelfOrPermission(
  getId: (c: AppContext) => string | undefined,
  staffPermission: PermissionKey,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) throw unauthenticated();
    const targetId = getId(c);
    const isSelf = Boolean(targetId) && targetId === auth.userId;
    const isStaff = auth.permissions.includes(staffPermission);
    if (!isSelf && !isStaff) throw forbidden();
    await next();
  };
}

/** Resolves the caller's student profile row (id, student number, name). */
export async function loadCurrentUser(c: AppContext) {
  const auth = c.get('auth');
  if (!auth) return null;
  const db = createDb(c.env.DB, c.get('logger')?.debug);
  return users.findById(db, auth.userId);
}

/**
 * Self-service guard for actions that must never be performed by a learner on
 * another account (viewing sessions, notifications, QR codes).
 */
export function currentUserId(c: AppContext): string {
  const auth = c.get('auth');
  if (!auth) throw unauthenticated();
  return auth.userId;
}

export type { Bindings };
