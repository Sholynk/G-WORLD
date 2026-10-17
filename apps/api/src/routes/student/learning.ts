/**
 * Routes — lesson activity and learner-side certificates.
 *
 * `POST /lessons/:lessonId/start` records that a lesson was opened; it is
 * deliberately cheap (one upsert) because the player calls it on every visit.
 *
 * `POST /lessons/:lessonId/complete` runs the learning engine
 * (services/learning.ts): rule check → progress write → recalculation →
 * certificate issuance when the course is finished. The response tells the UI
 * exactly what changed, so it can celebrate a completion or explain a refusal
 * without guessing.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { completeLessonSchema, idSchema } from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as certificateRepo from '../../db/repositories/certificates.js';
import * as analyticsRepo from '../../db/repositories/analytics.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import { completeLesson, recalculateEnrollment, startLesson } from '../../services/learning.js';
import { ensureCertificateQr } from '../../services/qr.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parseJson, parseParam } from '../../middleware/validate.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { ok } from '../helpers.js';
import { toCertificateDto } from '../../schemas/mappers.js';

export const studentLearningRoutes = new Hono<AppEnv>();



studentLearningRoutes.post('/lessons/:lessonId/start', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const lessonId = parseParam(c, 'lessonId', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const payload = await parseJson(
    c,
    z.object({ seconds_spent: z.coerce.number().int().min(0).max(86_400).optional() }),
  ).catch(() => ({ seconds_spent: undefined }));

  const result = await startLesson(db, auth, { lessonId, secondsSpent: payload.seconds_spent });
  return ok(c, result);
});

studentLearningRoutes.post('/lessons/:lessonId/complete', requireVerified(), async (c) => {
  const auth = c.get('auth')!;
  const lessonId = parseParam(c, 'lessonId', idSchema);
  const input = await parseJson(c, completeLessonSchema);
  if (input.lesson_id && input.lesson_id !== lessonId) {
    throw badRequest('The lesson id in the body does not match the request path');
  }
  const { seconds_spent } = input;
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const result = await completeLesson(db, c.get('config'), c.get('logger'), auth, {
    lessonId,
    secondsSpent: seconds_spent,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.lessonCompleted,
    actorUserId: auth.userId,
    entityType: 'lesson',
    entityId: lessonId,
    description: result.course_completed ? 'Completed a lesson and the whole course' : 'Completed a lesson',
    metadata: {
      progress_percent: result.progress.progress_percent,
      course_completed: result.course_completed,
      certificate_issued: Boolean(result.certificate?.issued),
    },
  });

  if (result.course_completed) {
    await audit(c, {
      action: AUDIT_ACTIONS.enrollmentCompleted,
      actorUserId: auth.userId,
      entityType: 'enrollment',
      entityId: null,
      description: 'Course completed',
      metadata: { lesson_id: lessonId },
    });
  }

  return ok(c, result, {
    notices: result.certificate?.issued
      ? ['Certificate issued — see your certificates page.']
      : undefined,
  });
});

/** Recomputes progress for an enrollment after external changes. */
studentLearningRoutes.post('/me/enrollments/:enrollmentId/recalculate', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const enrollmentId = parseParam(c, 'enrollmentId', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const result = await recalculateEnrollment(db, c.get('config'), c.get('logger'), auth, enrollmentId);
  return ok(c, {
    progress_percent: result.summary.progressPercent,
    lessons_completed: result.summary.completedLessons,
    total_lessons: result.summary.totalLessons,
    is_complete: result.summary.isComplete,
    next_lesson_id: result.summary.nextLessonId,
    course_completed: result.course_completed,
  });
});

/* ------------------------------ certificates ------------------------------ */

studentLearningRoutes.get('/me/certificates', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);
  const certificates = await certificateRepo.listCertificatesForUser(db, auth.userId);
  return ok(c, certificates.map((row) => toCertificateDto(row)));
});

studentLearningRoutes.get('/me/certificates/:certificateId', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const certificateId = parseParam(c, 'certificateId', idSchema);
  const db = createDb(c.env.DB);

  const certificate = await certificateRepo.findCertificateById(db, certificateId);
  // Ownership check: a certificate id is not a capability — it must belong to the
  // caller (or the caller must be staff, which this route is not).
  if (!certificate || certificate.user_id !== auth.userId) throw notFound('Certificate not found');

  // `verification_url` is built from public config, not from the request host, so
  // a spoofed Host header cannot produce a misleading link.
  const verificationUrl = `${c.get('config').appBaseUrl.replace(/\/+$/, '')}/verify.html?code=${encodeURIComponent(
    certificate.verification_code,
  )}`;

  return ok(c, {
    ...toCertificateDto(certificate),
    verification_url: verificationUrl,
    course: {
      id: certificate.course_id,
      title: certificate.course_title,
      slug: certificate.course_slug,
      department_name: certificate.department_name,
      subject_name: certificate.subject_name,
    },
  });
});

/**
 * The certificate's QR code, rendered as SVG.
 *
 * The code is issued with the certificate and its payload is the public
 * verification URL, so scanning it opens the page anybody can check. The image
 * is generated on demand — nothing binary is stored in the database.
 */
studentLearningRoutes.get('/me/certificates/:certificateId/qr.svg', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const certificateId = parseParam(c, 'certificateId', idSchema);
  const db = createDb(c.env.DB);

  const certificate = await certificateRepo.findCertificateById(db, certificateId);
  if (!certificate || certificate.user_id !== auth.userId) throw notFound('Certificate not found');

  const qr = await ensureCertificateQr(db, c.get('config'), {
    userId: auth.userId,
    certificateId: certificate.id,
    verificationCode: certificate.verification_code,
  });

  return c.body(qr.svg, 200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
});

/** Learning-activity timeline (used by the dashboard sparkline and profile page). */
studentLearningRoutes.get('/me/activity', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);

  const [activity, enrollments] = await Promise.all([
    analyticsRepo.recentLessonActivity(db, auth.userId, 30),
    enrollmentRepo.listEnrollmentsForUser(db, auth.userId),
  ]);

  return ok(c, {
    daily: activity,
    enrollments: enrollments.map((row) => ({
      enrollment_id: row.id,
      course_title: row.course_title,
      status: row.status,
      progress_percent: Number(row.progress_percent ?? 0),
      enrolled_at: row.enrolled_at,
      last_activity_at: row.last_activity_at,
      completed_at: row.completed_at,
    })),
  });
});
