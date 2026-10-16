/**
 * Routes — the learner's own account: profile, notifications and QR identity.
 *
 * `/me` always resolves the user from the session. There is no `/users/:id`
 * endpoint for learners, which removes an entire class of IDOR (insecure direct
 * object reference) bugs from the learner-facing API.
 *
 * The QR code endpoint returns SVG generated on the fly (`?format=svg` returns the
 * image itself with the right content type, which is what the `<img>` tag on the
 * profile page uses).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { notificationQuerySchema, updateProfileSchema, idSchema } from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as usersRepo from '../../db/repositories/users.js';
import * as sessionsRepo from '../../db/repositories/sessions.js';
import * as notificationsRepo from '../../db/repositories/notifications.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import * as analyticsRepo from '../../db/repositories/analytics.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { ensureStudentQr } from '../../services/qr.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { parseJson, parseParam, parseQuery } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { ok, okPage } from '../helpers.js';
import { toNotificationDto, toUserProfileDto } from '../../schemas/mappers.js';

export const studentProfileRoutes = new Hono<AppEnv>();

/* --------------------------------- profile -------------------------------- */

studentProfileRoutes.get('/me', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);

  const user = await usersRepo.findById(db, auth.userId);
  if (!user) throw notFound('Account not found');

  const [stats, unread, sessions] = await Promise.all([
    analyticsRepo.studentLearningStats(db, auth.userId),
    notificationsRepo.unreadCount(db, auth.userId),
    sessionsRepo.countActiveSessions(db, auth.userId),
  ]);

  return ok(c, {
    user: toUserProfileDto(user),
    permissions: auth.permissions,
    stats,
    unread_notifications: unread,
    active_sessions: sessions,
  });
});

studentProfileRoutes.patch('/me/profile', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const input = await parseJson(c, updateProfileSchema);

  const changed = await usersRepo.updateProfile(db, auth.userId, input);
  const user = await usersRepo.findById(db, auth.userId);

  await audit(c, {
    action: AUDIT_ACTIONS.userUpdated,
    actorUserId: auth.userId,
    entityType: 'user',
    entityId: auth.userId,
    description: 'Updated own profile',
    // Only the field names are recorded, never the values: a profile can contain
    // personal information that should not be duplicated into the audit trail.
    metadata: { fields: Object.keys(input) },
  });

  return ok(c, {
    updated: changed > 0,
    fields: Object.keys(input),
    user: user ? toUserProfileDto(user) : null,
  });
});

/* ----------------------------- notifications ------------------------------ */

studentProfileRoutes.get('/me/notifications', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const query = parseQuery(c, notificationQuerySchema);
  const db = createDb(c.env.DB);

  const { items, total } = await notificationsRepo.listForUser(db, auth.userId, {
    page: query.page,
    perPage: query.per_page,
    unreadOnly: query.unread_only ?? false,
  });

  return okPage(c, items.map(toNotificationDto), {
    page: query.page,
    perPage: query.per_page,
    total,
  });
});

studentProfileRoutes.post('/me/notifications/:notificationId/read', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const notificationId = parseParam(c, 'notificationId', idSchema);
  const db = createDb(c.env.DB);

  const changed = await notificationsRepo.markRead(db, auth.userId, notificationId);
  if (changed === 0) throw notFound('Notification not found');

  return ok(c, { read: true });
});

studentProfileRoutes.post('/me/notifications/read-all', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);
  const changed = await notificationsRepo.markAllRead(db, auth.userId);
  return ok(c, { marked_read: changed });
});

/* ------------------------------ QR identity ------------------------------- */

studentProfileRoutes.get('/me/qr', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);
  const user = await usersRepo.findById(db, auth.userId);
  if (!user) throw notFound('Account not found');

  const format = c.req.query('format');
  const qr = await ensureStudentQr(db, c.get('config'), auth.userId, {
    label: `G WORLD identity code ${user.student_number ?? ''}`.trim(),
  });

  // Raw SVG response so the profile page can use it directly in an <img> tag.
  if (format === 'svg') {
    return c.body(qr.svg, 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
  }

  const [stats, certificates] = await Promise.all([
    analyticsRepo.studentLearningStats(db, auth.userId),
    import('../../db/repositories/certificates.js').then((repo) =>
      repo.listCertificatesForUser(db, auth.userId),
    ),
  ]);

  return ok(c, {
    code: qr.code,
    payload_url: qr.payloadUrl,
    svg: qr.svg,
    scan_count: qr.scanCount,
    identity: {
      name: user.display_name ?? user.full_name ?? auth.email,
      student_number: user.student_number,
      email: user.email,
      member_since: user.created_at,
      courses_enrolled: stats.enrolled,
      courses_completed: stats.completed,
      certificates: certificates.length,
    },
  });
});

/** Regenerating the identity code revokes the previous one immediately. */
studentProfileRoutes.post('/me/qr/rotate', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const qrRepo = await import('../../db/repositories/qr.js');
  await qrRepo.revokeQrForUser(db, auth.userId, 'student_id');
  const qr = await ensureStudentQr(db, c.get('config'), auth.userId);

  await audit(c, {
    action: AUDIT_ACTIONS.qrIssued,
    actorUserId: auth.userId,
    entityType: 'user',
    entityId: auth.userId,
    description: 'Rotated student identity QR code',
  });

  return ok(c, { code: qr.code, payload_url: qr.payloadUrl, svg: qr.svg, rotated: true });
});

/* ------------------------------ enrollment history ------------------------ */

studentProfileRoutes.get('/me/history', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);
  const enrollments = await enrollmentRepo.listEnrollmentsForUser(db, auth.userId);

  return ok(c, {
    total: enrollments.length,
    enrollments: enrollments
      .slice()
      .sort((a, b) => (b.completed_at ?? b.last_activity_at ?? b.enrolled_at).localeCompare(a.completed_at ?? a.last_activity_at ?? a.enrolled_at))
      .map((row) => ({
        enrollment_id: row.id,
        course_title: row.course_title,
        course_slug: row.course_slug,
        status: row.status,
        progress_percent: Number(row.progress_percent ?? 0),
        enrolled_at: row.enrolled_at,
        completed_at: row.completed_at,
      })),
  });
});

/** Learners may not change their own role — enforced here as a hard 403. */
studentProfileRoutes.all('/me/role', requireAuth(), () => {
  throw forbidden('Roles are assigned by an administrator');
});
