/** Email possession plus an operator-created enrollment, never public bootstrap. */
import { Hono } from 'hono';
import { z } from 'zod';
import { passwordSchema } from '@sholynk/shared';
import type { AppEnv, AppContext } from '../env.js';
import { createDb } from '../db/client.js';
import * as access from '../db/repositories/author-access.js';
import * as security from '../db/repositories/owner-security.js';
import { findPasswordHash } from '../db/repositories/users.js';
import { consume, RATE_LIMIT_RULES } from '../db/repositories/rateLimit.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { hashPassword, normalizePassword, verifyPassword } from '../lib/password.js';
import { forbidden, badRequest, rateLimited, dependencyUnavailable } from '../lib/errors.js';
import { sendEmail } from '../lib/mailer/index.js';
import { clearSessionCookies } from '../lib/cookies.js';
import { parseJson } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { ok } from './helpers.js';

export const ownerSecurityRoutes = new Hono<AppEnv>();
const tokenSchema = z.string().min(20).max(200);
// A long separate code/passphrase, rather than an easily guessed 4-digit PIN.
export const confirmationCodeSchema = z.string().min(12).max(128)
  .refine((value) => normalizePassword(value).trim().length >= 12, 'Use at least 12 non-padding characters');
const setupSchema = z.object({ token: tokenSchema, password: passwordSchema.min(12), confirmation_code: confirmationCodeSchema }).strict();
const recoverySchema = z.object({ token: tokenSchema, current_password: z.string().min(1).max(128), confirmation_code: confirmationCodeSchema }).strict();

async function requireOwner(c: AppContext) {
  const designated = await access.owner(createDb(c.env.DB));
  if (!designated || designated.user_id !== c.get('auth')?.userId) throw forbidden('Only the website owner can perform this action.');
  return designated;
}

async function emailOwnerLink(c: AppContext, userId: string, purpose: security.OwnerTokenPurpose) {
  const db = createDb(c.env.DB);
  const config = c.get('config');
  const origin = new URL(config.appBaseUrl);
  if (config.isProduction && (origin.protocol !== 'https:' || config.email.provider !== 'resend' || !config.email.apiKey)) {
    throw dependencyUnavailable('Owner email delivery requires HTTPS and a configured email provider.');
  }
  // Fixed destination and configured origin: never accept a recipient or base URL from the caller.
  const token = generateToken();
  const hash = await hashToken(token);
  await security.createToken(db, userId, hash, purpose);
  const mode = purpose === 'setup' ? 'owner-setup' : 'owner-code';
  const url = `${origin.origin}/reset.html#${mode}=${encodeURIComponent(token)}`;
  const heading = purpose === 'setup' ? 'Set up your Sholynk Tech owner account' : 'Reset your owner confirmation code';
  const delivery = await sendEmail(db, config, c.get('logger'), access.OWNER_EMAIL, {
    userId, sensitive: true, content: {
      template: `owner_${purpose}`, subject: heading,
      text: `${heading}\n\nOpen this private link: ${url}\n\nIt expires in one hour and can be used once. Never share it. If you did not request this email, ignore it.`,
      // APP_BASE_URL is operator-controlled, but HTML-escape it nonetheless.
      html: `<p>${heading}</p><p>Open this private link (valid for one hour):</p><p>${url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}</p><p>Never share it. If you did not request this email, ignore it.</p>`,
    },
  });
  if (!delivery.delivered) {
    // A provider timeout is ambiguous. Keep the token valid in case the email
    // actually arrived, and permit another request within the rate limit.
    throw dependencyUnavailable('The owner email could not be delivered. Check email configuration, then retry.');
  }
  await audit(c, { action: `owner.${purpose}.requested`, actorUserId: userId, entityType: 'user', entityId: userId,
    description: 'Private owner security email sent' });
}

ownerSecurityRoutes.post('/setup/request', rateLimit('owner.setup.request'), async (c) => {
  await parseJson(c, z.object({}).strict());
  const db = createDb(c.env.DB);
  const enrollment = await security.pendingEnrollment(db);
  if (enrollment) {
    // Also cap globally so IP rotation cannot spam the one owner mailbox.
    const state = await consume(db, 'owner.setup.request:global', RATE_LIMIT_RULES['owner.setup.request']!);
    if (!state.allowed) throw rateLimited(state.retryAfterSeconds);
    await emailOwnerLink(c, enrollment.user_id, 'setup');
  }
  return ok(c, { message: 'If operator provisioning is complete and setup is still pending, an email has been sent to the designated owner.' });
});

ownerSecurityRoutes.post('/setup/complete', rateLimit('owner.setup.complete'), async (c) => {
  const input = await parseJson(c, setupSchema);
  if (normalizePassword(input.password) === normalizePassword(input.confirmation_code)) throw badRequest('Use a confirmation code different from your login password.');
  const db = createDb(c.env.DB);
  const tokenHash = await hashToken(input.token);
  const enrollment = await security.pendingEnrollment(db);
  const token = await security.findToken(db, tokenHash, 'setup');
  if (!enrollment || !token || token.user_id !== enrollment.user_id) throw security.invalidOwnerLink();
  const iterations = c.get('config').passwordIterations;
  const [passwordHash, confirmationHash] = await Promise.all([
    hashPassword(input.password, iterations), hashPassword(input.confirmation_code, iterations),
  ]);
  await security.completeSetup(db, tokenHash, passwordHash, confirmationHash);
  await clearSessionCookies(c);
  await audit(c, { action: 'owner.setup.completed', actorUserId: token.user_id, entityType: 'user', entityId: token.user_id,
    description: 'Owner completed private email setup' });
  return ok(c, { message: 'Owner setup complete. Sign in with your new password.' });
});

ownerSecurityRoutes.post('/code/request', requireAuth(), rateLimit('owner.code.request'), rateLimit('owner.code.request', 'account'), async (c) => {
  await parseJson(c, z.object({}).strict());
  const designated = await requireOwner(c);
  await emailOwnerLink(c, designated.user_id, 'code_recovery');
  return ok(c, { message: 'A private confirmation-code recovery link has been sent to your owner email.' });
});

ownerSecurityRoutes.post('/code/complete', requireAuth(), rateLimit('owner.confirmation'), rateLimit('owner.confirmation', 'account'), async (c) => {
  const designated = await requireOwner(c);
  const input = await parseJson(c, recoverySchema);
  const db = createDb(c.env.DB);
  const tokenHash = await hashToken(input.token);
  const token = await security.findToken(db, tokenHash, 'code_recovery');
  if (!token || token.user_id !== designated.user_id) throw security.invalidOwnerLink();
  const passwordHash = await findPasswordHash(db, designated.user_id);
  if (!passwordHash || !(await verifyPassword(passwordHash, input.current_password))) {
    await audit(c, { action: 'owner.code.recovery.failed', status: 'failure', description: 'Owner code recovery password rejected' });
    throw forbidden('Your current login password is incorrect.');
  }
  if (normalizePassword(input.current_password) === normalizePassword(input.confirmation_code)) throw badRequest('Use a confirmation code different from your login password.');
  await security.recoverCode(db, designated.user_id, tokenHash, await hashPassword(input.confirmation_code, c.get('config').passwordIterations));
  await clearSessionCookies(c);
  await audit(c, { action: 'owner.code.recovered', description: 'Owner confirmation code reset; all sessions revoked' });
  return ok(c, { message: 'Confirmation code updated. All sessions have been signed out. Sign in again.' });
});
