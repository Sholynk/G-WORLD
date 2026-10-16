/**
 * Routes — learner enrollments and dashboard.
 *
 * Every endpoint here is scoped to the authenticated learner: the user id always
 * comes from the session (`auth.userId`), never from the request body or path, so
 * there is no identifier a student could tamper with to reach another account.
 *
 * Enrollment rules enforced server-side:
 *   - the course must be published and open for enrollment
 *   - the learner's email must be verified (requireVerified)
 *   - duplicate enrollment is a 409, backed by UNIQUE (user_id, course_id)
 *   - the lesson total is snapshotted at enrollment time and refreshed whenever
 *     progress is recalculated, so adding a lesson later is handled correctly
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { enrollSchema, idSchema } from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as catalogRepo from '../../db/repositories/catalog.js';
import * as curriculumRepo from '../../db/repositories/curriculum.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import * as progressRepo from '../../db/repositories/progress.js';
import * as analyticsRepo from '../../db/repositories/analytics.js';
import * as certificateRepo from '../../db/repositories/certificates.js';
import * as quizzesRepo from '../../db/repositories/quizzes.js';
import * as assignmentsRepo from '../../db/repositories/assignments.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { conflict, notFound, forbidden } from '../../lib/errors.js';
import { parseJson, parseParam } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { created, ok } from '../helpers.js';
import {
  toAssignmentDto,
  toAttemptDto,
  toCertificateDto,
  toEnrollmentDto,
  toLessonCardDto,
  toModuleDto,
  toQuizDto,
} from '../../schemas/mappers.js';
import { classifySqliteError } from '../../db/client.js';

export const studentEnrollmentRoutes = new Hono<AppEnv>();


/* ------------------------------- enrollment ------------------------------- */

studentEnrollmentRoutes.post(
  '/enrollments',
  requireVerified(),
  rateLimit('enrollment.create'),
  async (c) => {
    const auth = c.get('auth')!;
    const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
    const input = await parseJson(c, enrollSchema);

    const course = await catalogRepo.findCourseById(db, input.course_id);
    if (!course || course.status !== 'published') throw notFound('Course not found');
    if (course.enrollment_open !== 1) {
      throw conflict('This course is not accepting new enrollments right now');
    }

    const existing = await enrollmentRepo.findEnrollment(db, auth.userId, course.id);
    if (existing && existing.status !== 'cancelled') {
      throw conflict('You are already enrolled in this course', [
        { field: 'course_id', message: 'Already enrolled' },
      ]);
    }

    const totalLessons = await curriculumRepo.countPublishedLessons(db, course.id);
    if (totalLessons === 0) {
      throw conflict('This course has no published lessons yet. Try again once lessons are published.');
    }

    let enrollmentId: string;
    try {
      if (existing && existing.status === 'cancelled') {
        // Re-enrollment reuses the row, which preserves the learner's history
        // (previous completions) instead of creating a duplicate record.
        enrollmentId = existing.id;
        await enrollmentRepo.setStatus(db, existing.id, 'active', { cancelledAt: null });
        await enrollmentRepo.updateProgress(db, {
          enrollmentId: existing.id,
          completedLessons: existing.lessons_completed,
          totalLessons,
          progressPercent: existing.progress_percent,
        });
      } else {
        enrollmentId = await enrollmentRepo.createEnrollment(db, {
          userId: auth.userId,
          courseId: course.id,
          totalLessons,
        });
      }
    } catch (error) {
      const info = classifySqliteError(error);
      if (info.kind === 'unique') throw conflict('You are already enrolled in this course');
      throw error;
    }

    const enrollment = await enrollmentRepo.findEnrollmentById(db, enrollmentId);
    await audit(c, {
      action: AUDIT_ACTIONS.enrollmentCreated,
      actorUserId: auth.userId,
      entityType: 'enrollment',
      entityId: enrollmentId,
      description: `Enrolled in “${course.title}”`,
      metadata: { course_id: course.id, total_lessons: totalLessons },
    });

    return created(c, enrollment ? toEnrollmentDto(enrollment, { includeStudent: true }) : { id: enrollmentId });
  },
);

studentEnrollmentRoutes.get('/me/enrollments', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);
  const enrollments = await enrollmentRepo.listEnrollmentsForUser(db, auth.userId);
  return ok(c, enrollments.map((row) => toEnrollmentDto(row, { includeStudent: true })));
});

/** One enrollment with its curriculum and the learner's per-lesson progress. */
studentEnrollmentRoutes.get('/me/enrollments/:enrollmentId', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const enrollmentId = parseParam(c, 'enrollmentId', idSchema);
  const db = createDb(c.env.DB);

  const enrollment = await enrollmentRepo.findEnrollmentForUser(db, enrollmentId, auth.userId);
  if (!enrollment) throw notFound('Enrollment not found');

  const tree = await curriculumRepo.curriculumTree(db, enrollment.course_id, true);
  const progressRows = await progressRepo.listProgressForEnrollment(db, enrollment.id);
  const progressMap: Record<string, string> = {};
  for (const row of progressRows) progressMap[row.lesson_id] = row.status;

  const certificate = await certificateRepo.findCertificateForUser(db, auth.userId, enrollment.course_id);
  const quizzes = await quizzesRepo.listCourseQuizzes(db, enrollment.course_id, true);
  const assignments = await assignmentsRepo.listAssignmentsForCourse(db, enrollment.course_id);

  const lessons = tree.flatMap((module) => module.lessons);
  const nextLesson = lessons.find((lesson) => (progressMap[lesson.id] ?? 'not_started') !== 'completed');

  return ok(c, {
    enrollment: toEnrollmentDto(enrollment, { includeStudent: true }),
    certificate: certificate
      ? { id: certificate.id, certificate_number: certificate.certificate_number, issued_at: certificate.issued_at }
      : null,
    next_lesson_id: nextLesson?.id ?? null,
    progress_map: progressMap,
    curriculum: tree.map((module) => ({
      ...toModuleDto(module, module.lessons),
      lessons: module.lessons.map((lesson) => ({
        ...toLessonCardDto(lesson),
        progress: progressMap[lesson.id] ?? 'not_started',
      })),
    })),
    assessments: {
      quizzes: quizzes.map((quiz) => toQuizDto(quiz, { question_count: Number((quiz as { question_count?: number }).question_count ?? 0) })),
      assignments: assignments.map((assignment) => toAssignmentDto(assignment)),
    },
  });
});

/** Withdrawing is a soft state change: history and certificates are preserved. */
studentEnrollmentRoutes.delete('/me/enrollments/:enrollmentId', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const enrollmentId = parseParam(c, 'enrollmentId', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const enrollment = await enrollmentRepo.findEnrollmentForUser(db, enrollmentId, auth.userId);
  if (!enrollment) throw notFound('Enrollment not found');
  if (enrollment.status === 'completed') {
    throw conflict('Completed courses cannot be withdrawn — your certificate stays available.');
  }

  await enrollmentRepo.setStatus(db, enrollment.id, 'cancelled', { cancelledAt: new Date().toISOString() });
  await audit(c, {
    action: AUDIT_ACTIONS.enrollmentCancelled,
    actorUserId: auth.userId,
    entityType: 'enrollment',
    entityId: enrollment.id,
    description: `Withdrew from “${enrollment.course_title}”`,
  });

  return ok(c, { cancelled: true, enrollment_id: enrollment.id });
});

/** Manual progress recalculation — also repairs counters after admin edits. */
studentEnrollmentRoutes.post('/me/enrollments/:enrollmentId/recalculate', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const enrollmentId = parseParam(c, 'enrollmentId', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const enrollment = await enrollmentRepo.findEnrollmentForUser(db, enrollmentId, auth.userId);
  if (!enrollment) throw notFound('Enrollment not found');

  const result = await progressRepo.recalculate(db, enrollment);
  return ok(c, {
    progress_percent: result.summary.progressPercent,
    lessons_completed: result.summary.completedLessons,
    total_lessons: result.summary.totalLessons,
    is_complete: result.summary.isComplete,
    next_lesson_id: result.summary.nextLessonId,
  });
});

/* -------------------------------- dashboard ------------------------------- */

studentEnrollmentRoutes.get('/me/dashboard', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);

  const [stats, enrollments, activity, certificates, attempts, notificationsCount] = await Promise.all([
    analyticsRepo.studentLearningStats(db, auth.userId),
    enrollmentRepo.listEnrollmentsForUser(db, auth.userId),
    analyticsRepo.recentLessonActivity(db, auth.userId, 14),
    certificateRepo.listCertificatesForUser(db, auth.userId),
    quizzesRepo.listAttemptsForUser(db, auth.userId),
    import('../../db/repositories/notifications.js').then((repo) => repo.unreadCount(db, auth.userId)),
  ]);

  const inProgress = enrollments.filter((row) => row.status === 'active');
  const completed = enrollments.filter((row) => row.status === 'completed');

  // "Continue learning": the most recently touched active enrollment.
  const resume = inProgress[0] ?? null;
  const resumeLessons = resume
    ? await curriculumRepo.listPublishedCourseLessons(db, resume.course_id)
    : [];
  const resumeProgress = resume ? await progressRepo.listProgressForEnrollment(db, resume.id) : [];
  const completedIds = new Set(
    resumeProgress.filter((row) => row.status === 'completed').map((row) => row.lesson_id),
  );
  const nextLesson = resumeLessons.find((lesson) => !completedIds.has(lesson.id)) ?? null;

  const recommendations = await enrollmentRepo.listRecommendedCourses(db, auth.userId, 3);

  return ok(c, {
    student: {
      id: auth.userId,
      name: auth.displayName,
      email: auth.email,
      student_number: auth.studentNumber,
      role: auth.roleKey,
    },
    stats,
    unread_notifications: notificationsCount,
    continue_learning: resume
      ? {
          enrollment_id: resume.id,
          course: { id: resume.course_id, title: resume.course_title, slug: resume.course_slug },
          progress_percent: Number(resume.progress_percent ?? 0),
          next_lesson: nextLesson
            ? { id: nextLesson.id, title: nextLesson.title, module_position: nextLesson.module_position }
            : null,
        }
      : null,
    courses: {
      active: inProgress.slice(0, 6).map((row) => toEnrollmentDto(row, { includeStudent: false })),
      completed: completed.slice(0, 6).map((row) => toEnrollmentDto(row, { includeStudent: false })),
    },
    certificates: certificates.slice(0, 4).map((row) => toCertificateDto(row)),
    recent_attempts: attempts.slice(0, 5).map((row) => toAttemptDto(row, { includeStudent: false })),
    activity,
    recommendations: recommendations.map((course) => ({
      id: course.id,
      title: course.title,
      slug: course.slug,
      summary: course.summary,
      department_name: course.department_name,
      difficulty: course.difficulty,
      estimated_minutes: Number(course.estimated_minutes ?? 0),
      thumbnail_url: course.thumbnail_url,
    })),
  });
});

/** Progress detail of a single course (used by the "my courses" page). */
studentEnrollmentRoutes.get('/me/courses/:courseId/progress', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const courseId = parseParam(c, 'courseId', idSchema);
  const db = createDb(c.env.DB);

  const enrollment = await enrollmentRepo.findEnrollment(db, auth.userId, courseId);
  if (!enrollment) throw forbidden('You are not enrolled in this course');

  const rows = await progressRepo.listProgressForEnrollment(db, enrollment.id);
  const funnel = await progressRepo.lessonFunnel(db, courseId);

  return ok(c, {
    enrollment: enrollment,
    lessons: rows.map((row) => ({
      lesson_id: row.lesson_id,
      title: row.lesson_title,
      module_title: row.module_title,
      status: row.status,
      seconds_spent: Number(row.seconds_spent ?? 0),
      completed_at: row.completed_at,
    })),
    course_lessons: funnel.length,
  });
});
