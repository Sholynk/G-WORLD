/** Registered authors are scoped independently of the legacy role catalogue. */
import type { MiddlewareHandler } from 'hono';
import type { PermissionKey } from '@sholynk/shared';
import type { AppContext, AppEnv } from '../env.js';
import { createDb } from '../db/client.js';
import { forbidden, notFound } from '../lib/errors.js';
import { requirePermission } from './auth.js';

export interface AuthorScope { userId: string; authorId: number; name: string; slug: string }
// A request can cross the boundary, permission adapter and resource guard.
// Resolve once per request, never across requests (suspension must be immediate).
const requestScopes = new WeakMap<AppContext, Promise<AuthorScope | null>>();
export async function authorScope(c: AppContext): Promise<AuthorScope | null> {
  const auth = c.get('auth');
  if (!auth) return null;
  let scope = requestScopes.get(c);
  if (!scope) {
    scope = resolveAuthorScope(c, auth.userId);
    requestScopes.set(c, scope);
  }
  return scope;
}
async function resolveAuthorScope(c: AppContext, userId: string): Promise<AuthorScope | null> {
  const row = await createDb(c.env.DB).first<{
    author_id: number; name: string; slug: string; review: string; status: string; verified: string | null;
  }>(`SELECT a.author_id, p.name, p.slug, a.status AS review, u.status, u.email_verified_at AS verified
    FROM author_applications a JOIN authors p ON p.id = a.author_id JOIN users u ON u.id = a.user_id WHERE a.user_id = ?`, [userId]);
  if (!row) return null;
  if (row.review !== 'approved' || row.status !== 'active' || !row.verified) throw forbidden('Approved, active author access is required.');
  return { userId, authorId: row.author_id, name: row.name, slug: row.slug };
}

/** Deliberate allowlist: new owner endpoints are NOT implicitly granted. */
export function authorRouteAllowed(method: string, path: string): boolean {
  const routes: [string, RegExp][] = [
    ['GET', /^\/(accounts\/capabilities|author\/(profile|analytics))$/],
    ['PATCH', /^\/author\/profile$/],
    ['POST', /^\/(articles|images)$/],
    ['PUT', /^\/articles\/\d+$/],
    ['PATCH', /^\/(articles|images)\/\d+$/],
    ['DELETE', /^\/(articles|images|comments)\/\d+$/],
    ['GET', /^\/comments$/],
    ['POST', /^\/articles\/\d+\/sources$/],
    ['DELETE', /^\/articles\/\d+\/sources\/\d+$/],
  ];
  return routes.some(([verb, pattern]) => verb === method && pattern.test(path));
}
export const authorBoundary: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (await authorScope(c)) {
    const path = c.req.path.slice(c.req.path.indexOf('/admin') + '/admin'.length).replace(/\/$/, '');
    if (!authorRouteAllowed(c.req.method, path)) throw forbidden('This area is reserved for the website owner.');
  }
  await next();
};

/** Only use on handlers which enforce ownership of their resource. */
export function requireScopedPermission(permission: PermissionKey): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (['article.submit', 'article.write', 'media.write', 'engagement.moderate'].includes(permission) && await authorScope(c)) {
      await next(); return;
    }
    await requirePermission(permission)(c, next);
  };
}

export async function assertResourceOwner(c: AppContext, table: 'articles' | 'images', id: number): Promise<void> {
  const scope = await authorScope(c);
  if (scope && !(await createDb(c.env.DB).exists(`SELECT 1 AS found FROM ${table} WHERE id = ? AND owner_user_id = ?`, [id, scope.userId]))) {
    throw notFound(`${table === 'articles' ? 'Article' : 'Image'} not found`);
  }
}
