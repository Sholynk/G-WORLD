import type { MiddlewareHandler } from 'hono';
import type { AppContext, AppEnv } from '../env.js';
import { createDb, type Db } from '../db/client.js';
import { reset } from '../db/repositories/rateLimit.js';
import { owner } from '../db/repositories/author-access.js';
import { normalizePassword, verifyPassword } from '../lib/password.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { rateLimit } from './rate-limit.js';

export async function verifyOwnerCode(c: AppContext, code: string | undefined) {
  const designated = await owner(createDb(c.env.DB));
  if (!designated || designated.user_id !== c.get('auth')?.userId) throw forbidden('Only the website owner can perform this action.');
  if (!code || code.length > 128 || !(await verifyPassword(designated.confirmation_hash, code))) {
    await audit(c, { action: 'owner.confirmation.failed', status: 'failure', description: 'Sensitive-action confirmation failed' });
    throw forbidden('Enter your separate owner confirmation code to perform this action.');
  }
  // Limit guesses, not the owner's normal editorial workload. A successful
  // confirmation clears this account/IP's failure window, never another user's.
  const db = createDb(c.env.DB);
  await Promise.all([
    reset(db, `owner.confirmation:ip:${c.get('clientIpHash')}`),
    reset(db, `owner.confirmation:account:${designated.user_id}`),
  ]);
}

export function sensitiveOwnerAction(method: string, path: string): boolean {
  return method === 'DELETE'
    || (['PUT', 'PATCH'].includes(method) && path.endsWith('/settings'))
    || (method === 'POST' && (path.endsWith('/system/maintenance') || path.endsWith('/change-password')));
}

/** Validate per mutation, never cache a successful confirmation in a session. */
export const requireSensitiveOwnerConfirmation: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (sensitiveOwnerAction(c.req.method, c.req.path)) {
    const designated = await owner(createDb(c.env.DB));
    if (designated?.user_id === c.get('auth')?.userId) {
      await rateLimit('owner.confirmation')(c, async () => {});
      await rateLimit('owner.confirmation', 'account')(c, async () => {});
      await verifyOwnerCode(c, c.req.header('X-Owner-Confirmation'));
    }
  }
  await next();
};

/** Keep the two owner secrets distinct when changing/resetting the password too. */
export async function assertOwnerPassword(db: Db, userId: string, password: string) {
  const designated = await owner(db);
  if (designated?.user_id !== userId) return;
  if (normalizePassword(password).length < 12) throw badRequest('Owner passwords must contain at least 12 characters.');
  if (await verifyPassword(designated.confirmation_hash, password)) {
    throw badRequest('Your login password must be different from your separate confirmation code.');
  }
}
