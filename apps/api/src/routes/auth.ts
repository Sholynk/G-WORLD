/**
 * Routes — authentication.
 *
 * Full account lifecycle: register → verify email → sign in → (reset password)
 * → sign out. Design decisions worth knowing when reading this file:
 *
 *   - **Enumeration.** Sign-in and password-reset responses never reveal whether
 *     an email exists (same message, and sign-in performs a dummy hash so the
 *     timing matches). Registration necessarily reveals existence; that is
 *     documented as an accepted trade-off and mitigated by rate limiting.
 *     Registration is disabled by default (ENABLE_REGISTRATION): editorial
 *     accounts are created by an administrator.
 *   - **Lockout.** Repeated failures lock the account for a window
 *     (`users.locked_until`) *and* hit the IP rate limit, so neither a single IP
 *     nor a single account can be brute forced.
 *   - **Session lifecycle.** Sign-in mints an opaque token stored hashed in
 *     `user_sessions`; sign-out revokes it. A password change or reset revokes
 *     every other session immediately.
 *   - **Verification.** Registration always creates a single-use token and sends
 *     an email; the token is only stored as a hash.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@sholynk/shared';
import { createDb } from '../db/client.js';
import * as usersRepo from '../db/repositories/users.js';
import * as rolesRepo from '../db/repositories/roles.js';
import * as sessionsRepo from '../db/repositories/sessions.js';
import * as tokensRepo from '../db/repositories/tokens.js';
import * as emailRepo from '../db/repositories/email.js';
import * as notificationsRepo from '../db/repositories/notifications.js';
import { audit } from '../services/audit.js';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { dummyVerify, hashPassword, needsRehash, verifyPassword } from '../lib/password.js';
import { expiresAtFromNow, generateToken, hashToken, isExpired, TOKEN_TTL } from '../lib/tokens.js';
import { sendEmail, TEMPLATES } from '../lib/mailer/index.js';
import { clearSessionCookies, setSessionCookies, SESSION_COOKIE, readCookie } from '../lib/cookies.js';
import { parseJson } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/auth.js';
import { created, ok } from './helpers.js';
import {
  accountLocked,
  accountSuspended,
  conflict,
  emailNotVerified,
  featureDisabled,
  internalError,
  invalidCredentials,
  notFound,
} from '../lib/errors.js';
import { toUserProfileDto } from '../schemas/mappers.js';

export const authRoutes = new Hono<AppEnv>();

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

function branding(config: AppEnv['Variables']['config']) {
  return {
    siteName: 'Sholynk Tech',
    appBaseUrl: config.appBaseUrl,
  };
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

authRoutes.post('/register', rateLimit('auth.register'), async (c) => {
  const config = c.get('config');
  const logger = c.get('logger');
  if (!config.features.registration) throw featureDisabled('Registration');

  const input = await parseJson(c, registerSchema);
  const db = createDb(c.env.DB, logger?.debug.bind(logger));

  if (await usersRepo.emailExists(db, input.email)) {
    throw conflict('An account with this email address already exists. Try signing in instead.', [
      { field: 'email', message: 'This email is already registered' },
    ]);
  }

  const editorRole = await rolesRepo.requireRoleByKey(db, 'editor');
  const passwordHash = await hashPassword(input.password, config.passwordIterations);

  const { userId } = await usersRepo.createUser(
    db,
    {
      email: input.email,
      passwordHash,
      roleId: editorRole.id,
      status: 'pending_verification',
      termsAcceptedAt: new Date().toISOString(),
    },
    {
      displayName: input.display_name ?? null,
      fullName: input.full_name ?? null,
    },
  );

  const token = generateToken();
  await tokensRepo.createVerificationToken(
    db,
    userId,
    input.email,
    await hashToken(token),
    expiresAtFromNow(TOKEN_TTL.EMAIL_VERIFICATION_MS),
  );

  const delivery = await sendEmail(
    db,
    config,
    logger,
    input.email,
    {
      userId,
      content: TEMPLATES.verificationEmail({
        toEmail: input.email,
        displayName: input.display_name ?? null,
        token,
        branding: branding(config),
      }),
    },
  );

  await notificationsRepo.createNotification(db, {
    userId,
    type: 'info',
    title: 'Welcome to Sholynk Tech',
    body: 'Confirm your email address to activate your account, then submit your first article for review.',
    linkUrl: '/admin/',
  });

  await audit(c, {
    action: AUDIT_ACTIONS.authRegister,
    actorUserId: userId,
    entityType: 'user',
    entityId: userId,
    description: 'Editor account registered',
    metadata: { email_verified: false, email_delivered: delivery.delivered },
  });

  const profile = await usersRepo.findById(db, userId);

  return created(
    c,
    {
      user: profile ? toUserProfileDto(profile) : { id: userId, email: input.email },
      verification_required: true,
      verification_email_queued: delivery.queued,
      email_delivered: delivery.delivered,
      // Development convenience: exposing the token lets the local flow be
      // exercised without an email provider. It is impossible in production
      // because `devRoutes` defaults to false there (see env.ts).
      ...(config.features.devRoutes ? { debug_verification_token: token } : {}),
    },
    delivery.delivered
      ? ['Check your inbox to confirm your email address.']
      : ['We could not deliver the confirmation email yet; use “Resend email” in a moment.'],
  );
});

/* -------------------------------------------------------------------------- */
/* Email verification                                                          */
/* -------------------------------------------------------------------------- */

authRoutes.post('/verify-email', rateLimit('auth.resend_verification'), async (c) => {
  const config = c.get('config');
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const { token } = await parseJson(c, verifyEmailSchema);

  const record = await tokensRepo.findVerificationToken(db, await hashToken(token));
  if (!record) throw notFound('This verification link is not valid. Request a new one.');

  if (record.consumed_at) {
    throw conflict('This verification link has already been used. You can sign in, or request a new link.');
  }
  if (isExpired(record.expires_at)) {
    throw conflict('This verification link has expired. Request a new one.');
  }

  const consumed = await tokensRepo.consumeVerificationToken(db, await hashToken(token));
  if (!consumed) throw conflict('This verification link has already been used.');

  await usersRepo.markEmailVerified(db, record.user_id);

  const user = await usersRepo.findById(db, record.user_id);
  if (user) {
    await sendEmail(db, config, c.get('logger'), user.email, {
      userId: user.id,
      content: TEMPLATES.welcomeEmail({
        toEmail: user.email,
        displayName: user.display_name,
        branding: branding(config),
      }),
    });
    await notificationsRepo.createNotification(db, {
      userId: user.id,
      type: 'success',
      title: 'Email confirmed',
      body: 'Your account is active. Open the editorial dashboard to submit your first article.',
      linkUrl: '/admin/',
    });
  }

  await audit(c, {
    action: AUDIT_ACTIONS.authEmailVerified,
    actorUserId: record.user_id,
    entityType: 'user',
    entityId: record.user_id,
    description: 'Email address verified',
  });

  return ok(c, { verified: true, email: record.email });
});

authRoutes.post('/resend-verification', rateLimit('auth.resend_verification'), async (c) => {
  const config = c.get('config');
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const { email } = await parseJson(c, resendVerificationSchema);

  // Always the same response: revealing whether an address exists here would
  // turn this endpoint into an account enumeration oracle.
  const user = await usersRepo.findByEmail(db, email);
  let token: string | null = null;

  if (user && !user.email_verified_at && user.status === 'pending_verification') {
    token = generateToken();
    await tokensRepo.createVerificationToken(
      db,
      user.id,
      user.email,
      await hashToken(token),
      expiresAtFromNow(TOKEN_TTL.EMAIL_VERIFICATION_MS),
    );
    await sendEmail(db, config, c.get('logger'), user.email, {
      userId: user.id,
      content: TEMPLATES.verificationEmail({
        toEmail: user.email,
        displayName: user.display_name,
        token,
        branding: branding(config),
      }),
    });
    await audit(c, {
      action: AUDIT_ACTIONS.authEmailVerificationResent,
      actorUserId: user.id,
      entityType: 'user',
      entityId: user.id,
      description: 'Verification email re-sent',
    });
  }

  return ok(c, {
    sent: true,
    message: 'If that address needs verification, a new link is on its way.',
    ...(config.features.devRoutes && token ? { debug_verification_token: token } : {}),
  });
});

/* -------------------------------------------------------------------------- */
/* Sign in / sign out                                                          */
/* -------------------------------------------------------------------------- */

authRoutes.post('/login', rateLimit('auth.login'), async (c) => {
  const config = c.get('config');
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const input = await parseJson(c, loginSchema);

  const credentials = await usersRepo.findCredentialsByEmail(db, input.email);

  // Unknown email: spend comparable time so timing cannot reveal existence.
  if (!credentials) {
    await dummyVerify(input.password, Math.min(config.passwordIterations, 50_000));
    await audit(c, {
      action: AUDIT_ACTIONS.authLoginFailed,
      entityType: 'user',
      description: 'Sign-in attempted with an unknown email',
      status: 'failure',
      metadata: { email_known: false },
    });
    throw invalidCredentials();
  }

  if (credentials.locked_until && !isExpired(credentials.locked_until)) {
    await audit(c, {
      action: AUDIT_ACTIONS.authLoginFailed,
      actorUserId: credentials.id,
      entityType: 'user',
      entityId: credentials.id,
      description: 'Sign-in attempted on a locked account',
      status: 'failure',
    });
    throw accountLocked(credentials.locked_until);
  }

  const passwordOk = await verifyPassword(credentials.password_hash, input.password);
  if (!passwordOk) {
    const { lockedUntil, attempts } = await usersRepo.recordFailedLogin(
      db,
      credentials.id,
      MAX_FAILED_ATTEMPTS,
      LOCK_MINUTES,
    );
    await audit(c, {
      action: AUDIT_ACTIONS.authLoginFailed,
      actorUserId: credentials.id,
      entityType: 'user',
      entityId: credentials.id,
      description: 'Incorrect password',
      status: 'failure',
      metadata: { attempts, locked: Boolean(lockedUntil) },
    });
    if (lockedUntil) throw accountLocked(lockedUntil);
    throw invalidCredentials();
  }

  if (credentials.status === 'suspended' || credentials.status === 'deactivated') {
    await audit(c, {
      action: AUDIT_ACTIONS.authLoginFailed,
      actorUserId: credentials.id,
      entityType: 'user',
      entityId: credentials.id,
      description: 'Sign-in attempted on a suspended account',
      status: 'failure',
    });
    throw accountSuspended();
  }

  if (!credentials.email_verified_at) {
    await audit(c, {
      action: AUDIT_ACTIONS.authLoginFailed,
      actorUserId: credentials.id,
      entityType: 'user',
      entityId: credentials.id,
      description: 'Sign-in attempted before email verification',
      status: 'failure',
    });
    throw emailNotVerified();
  }

  // Transparently upgrade the hash when the configured strength increased.
  if (needsRehash(credentials.password_hash, config.passwordIterations)) {
    const upgraded = await hashPassword(input.password, config.passwordIterations);
    await usersRepo.updatePasswordHash(db, credentials.id, upgraded);
  }

  const token = generateToken();
  const ttlSeconds = (input.remember ? config.sessionTtlHours * 2 : config.sessionTtlHours) * 3600;
  const sessionId = await sessionsRepo.createSession(db, {
    userId: credentials.id,
    tokenHash: await hashToken(token),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    ipHash: c.get('clientIpHash'),
    userAgent: c.req.header('user-agent') ?? null,
  });

  await usersRepo.recordSuccessfulLogin(db, credentials.id);
  await setSessionCookies(c, token, ttlSeconds);

  const profile = await usersRepo.findById(db, credentials.id);

  await audit(c, {
    action: AUDIT_ACTIONS.authLogin,
    actorUserId: credentials.id,
    entityType: 'user',
    entityId: credentials.id,
    description: 'Signed in',
    metadata: { session_id: sessionId, remember: Boolean(input.remember) },
  });

  return ok(c, {
    user: profile ? toUserProfileDto(profile) : { id: credentials.id, email: credentials.email },
    session: { expires_in_seconds: ttlSeconds, id: sessionId },
  });
});

authRoutes.post('/logout', async (c) => {
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const token = readCookie(c.req.header('cookie'), SESSION_COOKIE);
  const auth = c.get('auth');

  if (token) {
    await sessionsRepo.revokeSessionByTokenHash(db, await hashToken(token), 'logout');
  }
  await clearSessionCookies(c);

  if (auth) {
    await audit(c, {
      action: AUDIT_ACTIONS.authLogout,
      actorUserId: auth.userId,
      entityType: 'user',
      entityId: auth.userId,
      description: 'Signed out',
    });
  }

  return ok(c, { signed_out: true });
});

/* -------------------------------------------------------------------------- */
/* Password reset                                                              */
/* -------------------------------------------------------------------------- */

authRoutes.post('/forgot-password', rateLimit('auth.forgot_password'), async (c) => {
  const config = c.get('config');
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const { email } = await parseJson(c, forgotPasswordSchema);

  const user = await usersRepo.findByEmail(db, email);
  let token: string | null = null;

  if (user && user.status !== 'deactivated') {
    token = generateToken();
    await tokensRepo.createResetToken(
      db,
      user.id,
      await hashToken(token),
      expiresAtFromNow(TOKEN_TTL.PASSWORD_RESET_MS),
      c.get('clientIpHash'),
    );
    await sendEmail(db, config, c.get('logger'), user.email, {
      userId: user.id,
      content: TEMPLATES.passwordResetEmail({
        toEmail: user.email,
        displayName: user.display_name,
        token,
        branding: branding(config),
      }),
    });
    await audit(c, {
      action: AUDIT_ACTIONS.authPasswordResetRequested,
      actorUserId: user.id,
      entityType: 'user',
      entityId: user.id,
      description: 'Password reset requested',
    });
  }

  return ok(c, {
    sent: true,
    message: 'If an account exists for that address, a reset link is on its way.',
    ...(config.features.devRoutes && token ? { debug_reset_token: token } : {}),
  });
});

authRoutes.post('/reset-password', rateLimit('auth.reset_password'), async (c) => {
  const config = c.get('config');
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const input = await parseJson(c, resetPasswordSchema);

  const tokenHash = await hashToken(input.token);
  const record = await tokensRepo.findResetToken(db, tokenHash);
  if (!record) throw notFound('This reset link is not valid. Request a new one.');
  if (record.consumed_at) throw conflict('This reset link has already been used. Request a new one.');
  if (isExpired(record.expires_at)) throw conflict('This reset link has expired. Request a new one.');

  const consumed = await tokensRepo.consumeResetToken(db, tokenHash);
  if (!consumed) throw conflict('This reset link has already been used.');

  const hash = await hashPassword(input.password, config.passwordIterations);
  await usersRepo.updatePasswordHash(db, record.user_id, hash);
  // A reset invalidates every existing session: if an attacker had one, it dies
  // with the password they were trying to keep.
  await sessionsRepo.revokeAllUserSessions(db, record.user_id, 'password_reset');

  const user = await usersRepo.findById(db, record.user_id);

  await notificationsRepo.createNotification(db, {
    userId: record.user_id,
    type: 'warning',
    title: 'Password changed',
    body: 'Your password was reset and all other sessions were signed out.',
    linkUrl: '/admin/',
  });

  await audit(c, {
    action: AUDIT_ACTIONS.authPasswordReset,
    actorUserId: record.user_id,
    entityType: 'user',
    entityId: record.user_id,
    description: 'Password reset completed',
  });

  return ok(c, { reset: true, email: user?.email ?? null });
});

/** The signed-in account: profile, role and permissions. */
authRoutes.get('/me', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const profile = await usersRepo.findById(db, auth.userId);
  if (!profile) throw notFound('Account not found');
  return ok(c, {
    user: toUserProfileDto(profile),
    permissions: auth.permissions,
    session: { id: auth.sessionId },
  });
});

/** Authenticated password change: requires the current password. */
authRoutes.post('/change-password', requireAuth(), async (c) => {
  const config = c.get('config');
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const input = await parseJson(c, changePasswordSchema);

  const currentHash = await usersRepo.findPasswordHash(db, auth.userId);
  if (!currentHash) throw internalError(undefined, { reason: 'missing_password_hash' });

  if (!(await verifyPassword(currentHash, input.current_password))) {
    await audit(c, {
      action: AUDIT_ACTIONS.authPasswordChanged,
      actorUserId: auth.userId,
      entityType: 'user',
      entityId: auth.userId,
      description: 'Password change rejected: current password incorrect',
      status: 'failure',
    });
    throw invalidCredentials();
  }

  const hash = await hashPassword(input.new_password, config.passwordIterations);
  await usersRepo.updatePasswordHash(db, auth.userId, hash);
  await sessionsRepo.revokeAllUserSessions(db, auth.userId, 'password_change', auth.sessionId);

  await audit(c, {
    action: AUDIT_ACTIONS.authPasswordChanged,
    actorUserId: auth.userId,
    entityType: 'user',
    entityId: auth.userId,
    description: 'Password changed',
  });

  return ok(c, { changed: true, other_sessions_revoked: true });
});

/* -------------------------------------------------------------------------- */
/* Session management                                                          */
/* -------------------------------------------------------------------------- */

authRoutes.get('/sessions', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const sessions = await sessionsRepo.listUserSessions(db, auth.userId);

  return ok(
    c,
    sessions.map((session) => ({
      id: session.id,
      current: session.id === auth.sessionId,
      created_at: session.created_at,
      last_seen_at: session.last_seen_at,
      expires_at: session.expires_at,
      // The user agent is truncated and returned so a learner can recognise
      // their own devices; IP addresses stay hashed and are never returned.
      device: session.user_agent ?? 'Unknown device',
    })),
  );
});

authRoutes.delete('/sessions/:sessionId', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const sessionId = c.req.param('sessionId');

  const sessions = await sessionsRepo.listUserSessions(db, auth.userId);
  if (!sessions.some((session) => session.id === sessionId)) {
    throw notFound('That session does not belong to your account');
  }

  await sessionsRepo.revokeSession(db, sessionId, 'user_revoked');
  await audit(c, {
    action: 'auth.session.revoked',
    actorUserId: auth.userId,
    entityType: 'session',
    entityId: sessionId,
    description: 'Session revoked by the account owner',
  });

  return ok(c, { revoked: true });
});

/**
 * Development-only helper: clear every rate-limit window.
 *
 * The limits are deliberately tight (sign-in: 10 per 15 minutes per IP), which
 * is correct for production and painful while iterating — `scripts/smoke-test.mjs`
 * calls this before its authentication steps so a run starts from a clean slate.
 * Disabled whenever `ENABLE_DEV_ROUTES` is not true, which includes every
 * production deployment.
 */
authRoutes.post('/dev/reset-limits', async (c) => {
  const config = c.get('config');
  if (!config.features.devRoutes) throw featureDisabled('Development routes');
  const db = createDb(c.env.DB);
  const cleared = await db.changes('DELETE FROM rate_limits');
  return ok(c, { cleared, scope: 'rate_limits' });
});

/**
 * Development-only helper: restore the demo accounts to the passwords printed in
 * `database/seeds/001_demo_users.sql`.
 *
 * Needed because anything (a person, a test) that changes a demo password leaves
 * the seeded hash stale — the seed files use `INSERT OR IGNORE`, so re-running
 * them will not overwrite an existing row.
 */
authRoutes.post('/dev/reset-demo-accounts', async (c) => {
  const config = c.get('config');
  if (!config.features.devRoutes) throw featureDisabled('Development routes');
  const db = createDb(c.env.DB);
  const demoAccounts = [
    { email: 'admin@sholynk.test', password: 'AdminPassword123!' },
    { email: 'editor@sholynk.test', password: 'EditorPassword123!' },
  ];

  const updated: string[] = [];
  for (const account of demoAccounts) {
    const credentials = await usersRepo.findCredentialsByEmail(db, account.email);
    if (!credentials) continue;
    const hash = await hashPassword(account.password, config.passwordIterations);
    await usersRepo.updatePasswordHash(db, credentials.id, hash);
    updated.push(account.email);
  }

  return ok(c, { updated, iterations: config.passwordIterations });
});

/** Development-only helper: read the most recent outbound email body. */
authRoutes.get('/dev/outbox', async (c) => {
  const config = c.get('config');
  if (!config.features.devRoutes) throw featureDisabled('Development routes');
  const db = createDb(c.env.DB);
  const { items } = await emailRepo.listEmails(db, { page: 1, perPage: 10 });
  return ok(
    c,
    items.map((item) => ({
      to: item.to_email,
      subject: item.subject,
      template: item.template,
      status: item.status,
      body: item.body_text,
      created_at: item.created_at,
    })),
  );
});
