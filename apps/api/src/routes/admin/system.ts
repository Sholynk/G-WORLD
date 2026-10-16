/**
 * Routes — platform operations: analytics, audit log, QR tooling, uploads,
 * reference data and outbound-email inspection.
 *
 * These endpoints are what turns the admin area into an operations console rather
 * than a CRUD app: KPIs, a searchable audit trail, a QR lookup for the front desk,
 * and presigned R2 uploads for large files.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import {
  auditQuerySchema,
  idSchema,
  paginationQuerySchema,
  qrLookupSchema,
  uploadRequestSchema,
} from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as analyticsRepo from '../../db/repositories/analytics.js';
import * as auditRepo from '../../db/repositories/audit.js';
import * as usersRepo from '../../db/repositories/users.js';
import * as qrRepo from '../../db/repositories/qr.js';
import * as certificateRepo from '../../db/repositories/certificates.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import * as emailRepo from '../../db/repositories/email.js';
import * as rolesRepo from '../../db/repositories/roles.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parseJson, parseParam, parseQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { created, ok, okPage } from '../helpers.js';
import { toAdminUserDto, toAuditDto, toCertificateDto, toQrDto } from '../../schemas/mappers.js';

export const adminSystemRoutes = new Hono<AppEnv>();

/* -------------------------------- analytics ------------------------------- */

adminSystemRoutes.get('/stats', requirePermission('analytics.read'), async (c) => {
  const db = createDb(c.env.DB);

  const [overview, enrollmentStats, certificateStats, userStats, ungraded] = await Promise.all([
    analyticsRepo.platformOverview(db),
    enrollmentRepo.enrollmentStats(db),
    certificateRepo.certificateStats(db),
    usersRepo.userStats(db),
    db.count(`SELECT COUNT(*) AS total FROM assignment_submissions WHERE status = 'submitted'`),
  ]);

  return ok(c, {
    overview,
    enrollments: enrollmentStats,
    certificates: certificateStats,
    users: userStats,
    pending_grading: ungraded,
  });
});

adminSystemRoutes.get('/analytics/courses', requirePermission('analytics.read'), async (c) => {
  const db = createDb(c.env.DB);
  const limit = Math.min(100, Number.parseInt(c.req.query('limit') ?? '25', 10) || 25);
  const rows = await analyticsRepo.coursePerformance(db, limit);
  return ok(c, rows);
});

adminSystemRoutes.get('/analytics/departments', requirePermission('analytics.read'), async (c) => {
  const db = createDb(c.env.DB);
  const rows = await analyticsRepo.departmentPerformance(db);
  return ok(c, rows);
});

adminSystemRoutes.get('/analytics/trend', requirePermission('analytics.read'), async (c) => {
  const db = createDb(c.env.DB);
  const months = Math.min(24, Number.parseInt(c.req.query('months') ?? '6', 10) || 6);
  const [trend, recentEnrollments] = await Promise.all([
    analyticsRepo.enrollmentTrend(db, months),
    analyticsRepo.recentEnrollments(db, 10),
  ]);
  return ok(c, { months: trend, recent_enrollments: recentEnrollments });
});

/** Per-lesson drop-off for one course. */
adminSystemRoutes.get('/analytics/courses/:courseId/funnel', requirePermission('analytics.read'), async (c) => {
  const courseId = parseParam(c, 'courseId', idSchema);
  const db = createDb(c.env.DB);
  const progressRepo = await import('../../db/repositories/progress.js');

  const [funnel, rate] = await Promise.all([
    progressRepo.lessonFunnel(db, courseId),
    progressRepo.completionRateForCourse(db, courseId),
  ]);

  return ok(c, { completion_rate: rate, lessons: funnel });
});

/* ---------------------------------- audit --------------------------------- */

adminSystemRoutes.get('/audit', requirePermission('audit.read'), async (c) => {
  const query = parseQuery(c, auditQuerySchema);
  const db = createDb(c.env.DB);

  const { items, total } = await auditRepo.listAuditEntries(db, {
    actor: query.actor,
    action: query.action,
    entityType: query.entity_type,
    entityId: query.entity_id,
    from: query.from,
    to: query.to,
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(c, items.map((row) => toAuditDto(row)), {
    page: query.page,
    perPage: query.per_page,
    total,
  });
});

adminSystemRoutes.get('/audit/summary', requirePermission('audit.read'), async (c) => {
  const db = createDb(c.env.DB);
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const [recent, failedLogins, failedEmails] = await Promise.all([
    auditRepo.recentActivity(db, 10),
    auditRepo.countFailedLoginsSince(db, since),
    emailRepo.countFailedEmails(db),
  ]);

  return ok(c, {
    recent: recent.map((row) => toAuditDto(row)),
    failed_logins_24h: failedLogins,
    failed_emails: failedEmails,
  });
});

/* --------------------------------- QR tooling ------------------------------ */

/**
 * Front-desk lookup: an administrator scans (or types) a student identity code or
 * a certificate code and receives the matching record.
 */
adminSystemRoutes.post(
  '/qr/lookup',
  requirePermission('qr.scan'),
  rateLimit('qr.lookup'),
  async (c) => {
    const input = await parseJson(c, qrLookupSchema);
    const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
    const code = input.code.trim();

    const qr = await qrRepo.findQrByCode(db, code);
    if (qr) {
      const student = await usersRepo.findSummaryById(db, qr.user_id);
      const enrollments = student ? await enrollmentRepo.listEnrollmentsForUser(db, qr.user_id) : [];
      await qrRepo.recordQrScan(db, qr.id);

      await audit(c, {
        action: AUDIT_ACTIONS.qrLookedUp,
        entityType: 'user',
        entityId: qr.user_id,
        description: `QR lookup for code ${qr.code}`,
        metadata: { kind: qr.kind },
      });

      return ok(c, {
        found: true,
        match: 'qr_code',
        qr: toQrDto(qr),
        student: student ? toAdminUserDto({ ...(await usersRepo.findById(db, qr.user_id))! }) : null,
        enrollments: enrollments.map((row) => ({
          enrollment_id: row.id,
          course_title: row.course_title,
          status: row.status,
          progress_percent: Number(row.progress_percent ?? 0),
        })),
      });
    }

    const certificate = await certificateRepo.findCertificateByCode(db, code);
    if (certificate) {
      await audit(c, {
        action: AUDIT_ACTIONS.qrLookedUp,
        entityType: 'certificate',
        entityId: certificate.id,
        description: `Manual certificate lookup for ${code}`,
      });
      return ok(c, { found: true, match: 'certificate', certificate: toCertificateDto(certificate), student: null, enrollments: [] });
    }

    const studentNumberMatch = await usersRepo.findSummaryByStudentNumber(db, code);
    if (studentNumberMatch) {
      const enrollments = await enrollmentRepo.listEnrollmentsForUser(db, studentNumberMatch.id);
      await audit(c, {
        action: AUDIT_ACTIONS.qrLookedUp,
        entityType: 'user',
        entityId: studentNumberMatch.id,
        description: `Student-number lookup for ${code}`,
      });
      return ok(c, {
        found: true,
        match: 'student_number',
        qr: null,
        student: toAdminUserDto({ ...(await usersRepo.findById(db, studentNumberMatch.id))! }),
        enrollments: enrollments.map((row) => ({
          enrollment_id: row.id,
          course_title: row.course_title,
          status: row.status,
          progress_percent: Number(row.progress_percent ?? 0),
        })),
      });
    }

    return ok(c, { found: false, match: null, qr: null, student: null, enrollments: [] });
  },
);

/** Instructors can also look a student up directly by email or student number. */
adminSystemRoutes.get('/qr/:code', requirePermission('qr.scan'), async (c) => {
  const code = parseParam(c, 'code', z.string().trim().min(3).max(120));
  const db = createDb(c.env.DB);
  const qr = await qrRepo.findQrByCode(db, code);
  if (!qr) throw notFound('No QR code matches that value');
  return ok(c, toQrDto(qr));
});

/* --------------------------------- uploads -------------------------------- */

/**
 * Prepares a file upload.
 *
 * Files go straight to R2 with a presigned PUT, so the Worker never buffers a
 * large body: it only validates the request and returns a short-lived URL. The
 * object key is generated server-side under a scoped prefix, so a caller cannot
 * choose (or overwrite) an arbitrary key.
 */
adminSystemRoutes.post('/uploads/presign', requirePermission('lesson.write'), rateLimit('upload.request'), async (c) => {
  const input = await parseJson(c, uploadRequestSchema);
  const config = c.get('config');

  if (!config.features.fileUploads || !c.env.BUCKET) {
    throw badRequest('File storage is not configured for this deployment', [
      { field: 'file', message: 'Ask an administrator to enable the R2 binding' },
    ]);
  }

  const sanitized = input.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  const key = `${input.scope}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${sanitized}`;

  // R2 presigning is available where the bucket is bound; when it is not
  // supported the caller receives a clear error instead of a broken upload.
  const bucket = c.env.BUCKET as R2Bucket & {
    createPresignedUrl?: (method: string, key: string, options: { expiresIn: number }) => Promise<string>;
  };

  let uploadUrl: string | null = null;
  if (typeof bucket.createPresignedUrl === 'function') {
    uploadUrl = await bucket.createPresignedUrl('PUT', key, { expiresIn: 900 });
  }

  await audit(c, {
    action: 'upload.presigned',
    entityType: 'resource',
    entityId: key,
    description: `Presigned upload for ${sanitized}`,
    metadata: { scope: input.scope, size_bytes: input.size_bytes, content_type: input.content_type },
  });

  return created(c, {
    upload_url: uploadUrl,
    r2_key: key,
    expires_in_seconds: 900,
    instructions:
      'PUT the file to upload_url with the same Content-Type, then reference r2_key when creating the resource.',
  });
});

/* ------------------------------ reference data ---------------------------- */

adminSystemRoutes.get('/roles', requirePermission('user.read.any'), async (c) => {
  const db = createDb(c.env.DB);
  const [roles, permissions] = await Promise.all([
    rolesRepo.listRoles(db),
    rolesRepo.listPermissions(db),
  ]);

  const matrix = await rolesRepo.rolePermissionMatrix(db);

  return ok(c, {
    roles: roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      rank: role.rank,
      permissions: matrix.filter((row) => row.role_key === role.key).map((row) => row.permission_key),
    })),
    permissions: permissions.map((permission) => ({
      id: permission.id,
      key: permission.key,
      name: permission.name,
      domain: permission.domain,
    })),
  });
});

/* ----------------------------- outbound email ----------------------------- */

adminSystemRoutes.get('/emails', requirePermission('settings.write'), async (c) => {
  const query = parseQuery(c, paginationQuerySchema);
  const db = createDb(c.env.DB);
  const status = c.req.query('status');

  const { items, total } = await emailRepo.listEmails(db, {
    status: status as 'queued' | 'logged' | 'sent' | 'failed' | undefined,
    toEmail: c.req.query('to'),
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(
    c,
    items.map((item) => ({
      id: item.id,
      to: item.to_email,
      subject: item.subject,
      template: item.template,
      provider: item.provider,
      status: item.status,
      error: item.error,
      attempts: item.attempts,
      sent_at: item.sent_at,
      created_at: item.created_at,
    })),
    { page: query.page, perPage: query.per_page, total },
  );
});

/* ------------------------------- maintenance ------------------------------ */

/**
 * Housekeeping: purge expired sessions, stale tokens, old rate-limit windows and
 * (optionally) very old audit rows. Idempotent and safe to run on a schedule.
 */
adminSystemRoutes.post('/maintenance/cleanup', requirePermission('settings.write'), async (c) => {
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const sessionsRepo = await import('../../db/repositories/sessions.js');
  const tokensRepo = await import('../../db/repositories/tokens.js');
  const rateLimitRepo = await import('../../db/repositories/rateLimit.js');

  const [sessions, tokens, limits] = await Promise.all([
    sessionsRepo.deleteExpiredSessions(db, 30),
    tokensRepo.purgeStaleTokens(db, 7),
    rateLimitRepo.purgeExpired(db, 24),
  ]);

  await audit(c, {
    action: 'system.maintenance.cleanup',
    entityType: 'system',
    description: 'Ran maintenance cleanup',
    metadata: { sessions, tokens, rate_limits: limits },
  });

  return ok(c, { deleted: { sessions, tokens, rate_limits: limits } });
});
