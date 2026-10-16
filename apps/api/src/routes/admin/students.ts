/**
 * Routes — administrator student management.
 *
 * Guard rails that matter:
 *   - Listing and reading students requires `user.read.any`; changing status
 *     requires `user.write.any`; changing a role requires `user.role.write`
 *     (super administrator only by default).
 *   - Status changes revoke the affected user's sessions immediately, so a
 *     suspension takes effect on the next request rather than at cookie expiry.
 *   - Role changes revoke sessions too (permissions are cached per request, but a
 *     fresh session makes the change unambiguous) and are audited with the old and
 *     new role.
 *   - A super administrator cannot demote or suspend themselves, which prevents an
 *     accidental lock-out of the last administrator account.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import {
  adminUserListQuerySchema,
  assignRoleSchema,
  idSchema,
  updateUserStatusSchema,
} from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as usersRepo from '../../db/repositories/users.js';
import * as rolesRepo from '../../db/repositories/roles.js';
import * as sessionsRepo from '../../db/repositories/sessions.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import * as certificateRepo from '../../db/repositories/certificates.js';
import * as progressRepo from '../../db/repositories/progress.js';
import * as notificationsRepo from '../../db/repositories/notifications.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { parseJson, parseParam, parseQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { ok, okPage } from '../helpers.js';
import { toAdminUserDto, toCertificateDto, toEnrollmentDto } from '../../schemas/mappers.js';
import { sendEmail, TEMPLATES } from '../../lib/mailer/index.js';

export const adminStudentRoutes = new Hono<AppEnv>();


adminStudentRoutes.get('/students', requirePermission('user.read.any'), async (c) => {
  const query = parseQuery(c, adminUserListQuerySchema);
  const db = createDb(c.env.DB);

  const { items, total } = await usersRepo.listUsers(db, {
    q: query.q,
    status: query.status,
    role: query.role,
    verified: query.verified,
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(c, items.map(toAdminUserDto), {
    page: query.page,
    perPage: query.per_page,
    total,
  });
});

/** One student with everything an administrator needs to help them. */
adminStudentRoutes.get('/students/:id', requirePermission('user.read.any'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB);

  const user = await usersRepo.findById(db, id);
  if (!user) throw notFound('Student not found');

  const [enrollments, certificates, sessions, activity] = await Promise.all([
    enrollmentRepo.listEnrollmentsForUser(db, id),
    certificateRepo.listCertificatesForUser(db, id),
    sessionsRepo.listUserSessions(db, id),
    progressRepo.completionRateForCourse(db, '__none__').then(() => []),
  ]);

  // Per-course progress funnel for this learner, computed from their enrollments.
  const progressDetail = await Promise.all(
    enrollments.slice(0, 10).map(async (enrollment) => ({
      enrollment_id: enrollment.id,
      course_title: enrollment.course_title,
      status: enrollment.status,
      progress_percent: Number(enrollment.progress_percent ?? 0),
      lessons_completed: Number(enrollment.lessons_completed ?? 0),
      total_lessons: Number(enrollment.total_lessons ?? 0),
      last_activity_at: enrollment.last_activity_at,
    })),
  );

  return ok(c, {
    user: toAdminUserDto(user),
    enrollments: enrollments.map((row) => toEnrollmentDto(row, { includeStudent: false })),
    progress: progressDetail,
    certificates: certificates.map((row) => toCertificateDto(row)),
    sessions: sessions.map((session) => ({
      id: session.id,
      created_at: session.created_at,
      last_seen_at: session.last_seen_at,
      expires_at: session.expires_at,
      device: session.user_agent ?? 'Unknown device',
    })),
    activity,
  });
});

adminStudentRoutes.patch('/students/:id/status', requirePermission('user.write.any'), async (c) => {
  const auth = c.get('auth')!;
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, updateUserStatusSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const user = await usersRepo.findById(db, id);
  if (!user) throw notFound('Student not found');

  if (id === auth.userId && ['suspended', 'deactivated'].includes(input.status)) {
    throw forbidden('You cannot suspend or deactivate your own account');
  }

  // A suspended/deactivated account loses all access immediately.
  const revokeSessions = input.status === 'suspended' || input.status === 'deactivated';
  await usersRepo.setStatus(db, id, input.status);
  if (revokeSessions) {
    await sessionsRepo.revokeAllUserSessions(db, id, `status:${input.status}`);
  }

  await notificationsRepo.createNotification(db, {
    userId: id,
    type: input.status === 'suspended' ? 'warning' : 'info',
    title: `Account status updated to ${input.status.replace(/_/g, ' ')}`,
    body: input.reason ?? null,
    linkUrl: '/settings.html',
  });

  await audit(c, {
    action: AUDIT_ACTIONS.userStatusChanged,
    entityType: 'user',
    entityId: id,
    description: `Changed account status of ${user.email} to ${input.status}`,
    metadata: { from: user.status, to: input.status, reason: input.reason ?? null, sessions_revoked: revokeSessions },
  });

  // A learner without a usable account is told why by email as well.
  if (user.email && input.status !== 'pending_verification') {
    await sendEmail(db, c.get('config'), c.get('logger'), user.email, {
      userId: id,
      content: {
        subject: `Your G WORLD account status is now ${input.status.replace(/_/g, ' ')}`,
        template: 'account_status',
        text: `Hello,\n\nAn administrator changed the status of your G WORLD account to "${input.status}".\n${
          input.reason ? `Reason: ${input.reason}\n` : ''
        }\nIf you believe this is a mistake, contact support.\n\n— G WORLD`,
        html: `<p>Hello,</p><p>An administrator changed the status of your G WORLD account to <strong>${input.status}</strong>.</p>${
          input.reason ? `<p>Reason: ${input.reason}</p>` : ''
        }<p>If you believe this is a mistake, contact support.</p>`,
      },
    });
  }

  return ok(c, { updated: true, status: input.status });
});

adminStudentRoutes.patch('/students/:id/role', requirePermission('user.role.write'), async (c) => {
  const auth = c.get('auth')!;
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, assignRoleSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const user = await usersRepo.findById(db, id);
  if (!user) throw notFound('Student not found');

  if (id === auth.userId && input.role !== 'super_admin') {
    throw forbidden('You cannot remove your own super administrator role');
  }
  if (user.role_key === 'super_admin' && input.role !== 'super_admin') {
    const remaining = await usersRepo.countUsersWithRole(db, 'super_admin', id);
    if (remaining === 0) {
      throw conflict('The platform must keep at least one super administrator');
    }
  }

  const role = await rolesRepo.findRoleByKey(db, input.role);
  if (!role) throw badRequest('Unknown role', [{ field: 'role', message: 'Role not found' }]);

  await usersRepo.setRole(db, id, role.id);
  await sessionsRepo.revokeAllUserSessions(db, id, 'role_changed');

  await audit(c, {
    action: AUDIT_ACTIONS.userRoleChanged,
    entityType: 'user',
    entityId: id,
    description: `Changed role of ${user.email}: ${user.role_key} → ${input.role}`,
    metadata: { from: user.role_key, to: input.role, reason: input.reason ?? null },
  });

  return ok(c, { updated: true, role: input.role });
});

/** Force sign-out of one user (or all of their sessions) during an incident. */
adminStudentRoutes.post('/students/:id/sessions/revoke', requirePermission('user.write.any'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const user = await usersRepo.findById(db, id);
  if (!user) throw notFound('Student not found');

  const revoked = await sessionsRepo.revokeAllUserSessions(db, id, 'admin_revoked');
  await audit(c, {
    action: 'user.sessions.revoked',
    entityType: 'user',
    entityId: id,
    description: `Revoked ${revoked} session(s) for ${user.email}`,
    metadata: { revoked },
  });

  return ok(c, { revoked });
});

/** Resend a verification email on a student's behalf. */
adminStudentRoutes.post('/students/:id/resend-verification', requirePermission('user.write.any'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const user = await usersRepo.findById(db, id);
  if (!user) throw notFound('Student not found');
  if (user.email_verified_at) throw conflict('That account is already verified');

  const { generateToken, hashToken, expiresAtFromNow, TOKEN_TTL } = await import('../../lib/tokens.js');
  const tokensRepo = await import('../../db/repositories/tokens.js');

  const token = generateToken();
  await tokensRepo.createVerificationToken(
    db,
    id,
    user.email,
    await hashToken(token),
    expiresAtFromNow(TOKEN_TTL.EMAIL_VERIFICATION_MS),
  );
  await sendEmail(db, c.get('config'), c.get('logger'), user.email, {
    userId: id,
    content: TEMPLATES.verificationEmail({
      toEmail: user.email,
      displayName: user.display_name,
      token,
      branding: { siteName: 'G WORLD', appBaseUrl: c.get('config').appBaseUrl },
    }),
  });

  await audit(c, {
    action: AUDIT_ACTIONS.authEmailVerificationResent,
    entityType: 'user',
    entityId: id,
    description: `Resent verification email to ${user.email}`,
  });

  return ok(c, {
    sent: true,
    ...(c.get('config').features.devRoutes ? { debug_verification_token: token } : {}),
  });
});

/** Administrator directory statistics. */
adminStudentRoutes.get('/students-stats', requirePermission('user.read.any'), async (c) => {
  const db = createDb(c.env.DB);
  const stats = await usersRepo.userStats(db);
  return ok(c, stats);
});
