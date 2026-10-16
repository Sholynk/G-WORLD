/**
 * Service — the learning engine.
 *
 * Two flows live here so that every entry point (lesson player, quiz submit,
 * admin screen) results in identical state:
 *
 *   `recordLessonActivity()` — opening a lesson, then completing it. Completion
 *     verifies the lesson belongs to the learner's course, applies the lesson's
 *     completion rule, writes progress, recalculates the enrollment and, when the
 *     course becomes complete, issues the certificate.
 *
 *   `resolveLessonAccess()` — the single authority on "may this user read this
 *     lesson". Public preview lessons are readable by everyone; everything else
 *     requires an active enrollment (or staff permission).
 */
import type { Db } from '../db/client.js';
import type { AppConfig } from '../env.js';
import type { Logger } from '../lib/logger.js';
import type { AuthContext } from '../env.js';
import * as curriculumRepo from '../db/repositories/curriculum.js';
import * as enrollmentRepo from '../db/repositories/enrollments.js';
import * as progressRepo from '../db/repositories/progress.js';
import * as quizzesRepo from '../db/repositories/quizzes.js';
import * as notificationsRepo from '../db/repositories/notifications.js';
import { MIN_SECONDS_FOR_COMPLETION, satisfiesCompletionRule, summarizeProgress } from '../lib/progress.js';
import { issueCertificate } from './certificates.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

export type AccessLevel = 'public_preview' | 'enrolled' | 'staff';

export interface LessonAccess {
  allowed: boolean;
  level: AccessLevel | null;
  reason: string | null;
  enrollment: Awaited<ReturnType<typeof enrollmentRepo.findEnrollmentForCourseByUser>>;
  lesson: NonNullable<Awaited<ReturnType<typeof curriculumRepo.findLessonDetail>>>;
}

const STAFF_PERMISSIONS = ['course.write', 'lesson.write'];
const ANY_CONTENT_PERMISSION = ['course.read'];

/**
 * Decides whether the caller may read the full lesson body.
 *
 * Order matters: staff first (so an author can review a draft), then a preview
 * lesson (so the public catalog can show real content), then enrollment.
 */
export async function resolveLessonAccess(
  db: Db,
  auth: AuthContext | null,
  lessonId: string,
): Promise<LessonAccess> {
  const lesson = await curriculumRepo.findLessonDetail(db, lessonId);
  if (!lesson) throw notFound('Lesson not found');

  const isStaff = Boolean(
    auth && STAFF_PERMISSIONS.some((permission) => auth.permissions.includes(permission)),
  );

  if (isStaff) {
    return { allowed: true, level: 'staff', reason: null, enrollment: null, lesson };
  }

  if (lesson.status === 'published' && lesson.is_preview === 1) {
    return { allowed: true, level: 'public_preview', reason: null, enrollment: null, lesson };
  }

  if (lesson.status !== 'published' || lesson.course_status !== 'published') {
    return {
      allowed: false,
      level: null,
      reason: 'This lesson is not published yet.',
      enrollment: null,
      lesson,
    };
  }

  if (!auth) {
    return {
      allowed: false,
      level: null,
      reason: 'Enrol in this course to unlock the lesson.',
      enrollment: null,
      lesson,
    };
  }

  if (!auth.permissions.some((permission) => [...STAFF_PERMISSIONS, ...ANY_CONTENT_PERMISSION].includes(permission))) {
    // A learner without course.read (rare: suspended role) cannot read content.
    return {
      allowed: false,
      level: null,
      reason: 'Your account does not have access to course content.',
      enrollment: null,
      lesson,
    };
  }

  const enrollment = await enrollmentRepo.findEnrollmentForCourseByUser(db, lesson.course_id, auth.userId);
  if (!enrollment || enrollment.status === 'cancelled' || enrollment.status === 'expired') {
    return {
      allowed: false,
      level: null,
      reason: 'Enrol in this course to unlock the lesson.',
      enrollment: enrollment ?? null,
      lesson,
    };
  }

  return { allowed: true, level: 'enrolled', reason: null, enrollment, lesson };
}

/**
 * The enrolment that owns this learner's progress for a lesson.
 *
 * Returns null for a visitor, for someone with no enrolment, and for an
 * enrolment that is cancelled or expired — the three cases that must not be
 * able to write progress.
 *
 * This exists separately from `resolveLessonAccess()` because that function
 * deliberately returns early for *preview* lessons (anyone may read one) and so
 * reports `enrollment: null` even for a learner who is enrolled in the course.
 * Progress writes therefore look the enrolment up from the lesson's course.
 */
export async function findEnrollmentForLesson(
  db: Db,
  auth: AuthContext | null,
  lesson: { course_id: string },
): Promise<Awaited<ReturnType<typeof enrollmentRepo.findEnrollmentForCourseByUser>>> {
  if (!auth) return null;
  const enrollment = await enrollmentRepo.findEnrollmentForCourseByUser(db, lesson.course_id, auth.userId);
  if (!enrollment || enrollment.status === 'cancelled' || enrollment.status === 'expired') return null;
  return enrollment;
}

async function requireEnrollment(
  db: Db,
  auth: AuthContext,
  lesson: { course_id: string },
): Promise<NonNullable<Awaited<ReturnType<typeof enrollmentRepo.findEnrollmentForCourseByUser>>>> {
  const enrollment = await findEnrollmentForLesson(db, auth, lesson);
  if (!enrollment) throw forbidden('Enrol in this course to track progress in this lesson.');
  return enrollment;
}

export interface LessonViewResult {
  access: LessonAccess;
  /**
   * The enrolment that owns this learner's progress, resolved from the lesson's
   * course. Distinct from `access.enrollment`, which is null for a preview
   * lesson because that path returns before any enrolment lookup happens.
   */
  enrollment: Awaited<ReturnType<typeof enrollmentRepo.findEnrollmentForCourseByUser>>;
  videos: Awaited<ReturnType<typeof curriculumRepo.listVideos>>;
  resources: Awaited<ReturnType<typeof curriculumRepo.listResourcesForLesson>>;
  progress: { status: string; seconds_spent: number; completed_at: string | null } | null;
  navigation: {
    previous_lesson_id: string | null;
    next_lesson_id: string | null;
    position: number;
    total: number;
  };
}

/** Loads everything the lesson player needs for one lesson. */
export async function loadLessonView(
  db: Db,
  auth: AuthContext | null,
  lessonId: string,
): Promise<LessonViewResult> {
  const access = await resolveLessonAccess(db, auth, lessonId);

  // Media and resources of a locked lesson are not returned: the preview page
  // must not become a way to watch a whole course for free.
  const videos = access.allowed ? await curriculumRepo.listVideos(db, lessonId) : [];
  const resources = access.allowed
    ? await curriculumRepo.listResourcesForLesson(db, lessonId)
    : [];

  // Resolved from the course, not from `access`: an enrolled learner reading a
  // *preview* lesson must still see their own progress for it.
  const enrollment = await findEnrollmentForLesson(db, auth, access.lesson);

  let progress: LessonViewResult['progress'] = null;
  if (enrollment) {
    const row = await progressRepo.findProgressRow(db, enrollment.id, lessonId);
    progress = row
      ? { status: row.status, seconds_spent: row.seconds_spent, completed_at: row.completed_at }
      : { status: 'not_started', seconds_spent: 0, completed_at: null };
  }

  const courseLessons = access.allowed
    ? await curriculumRepo.listPublishedCourseLessons(db, access.lesson.course_id)
    : [];
  const index = courseLessons.findIndex((lesson) => lesson.id === lessonId);

  return {
    access,
    enrollment,
    videos,
    resources,
    progress,
    navigation: {
      previous_lesson_id: index > 0 ? courseLessons[index - 1]!.id : null,
      next_lesson_id: index >= 0 && index < courseLessons.length - 1 ? courseLessons[index + 1]!.id : null,
      position: index + 1,
      total: courseLessons.length,
    },
  };
}

export interface CompletionResult {
  lesson_id: string;
  status: 'in_progress' | 'completed';
  seconds_spent: number;
  progress: {
    total_lessons: number;
    completed_lessons: number;
    progress_percent: number;
    is_complete: boolean;
    next_lesson_id: string | null;
  };
  course_completed: boolean;
  certificate: {
    issued: boolean;
    certificate_id: string | null;
    certificate_number: string | null;
    already_existed: boolean;
    reasons: string[];
  } | null;
}

/**
 * Completes a lesson.
 *
 * Guards, in order:
 *   1. the learner must be enrolled in the lesson's course;
 *   2. the lesson must be published;
 *   3. a `quiz_pass` lesson can only complete through a passed quiz attempt —
 *      calling this endpoint for one is refused with an explanatory 400;
 *   4. `view`/`mark_complete` lessons require a minimum dwell time, so an
 *      instant double-click on "complete" is rejected.
 */
export async function completeLesson(
  db: Db,
  config: AppConfig,
  logger: Logger,
  auth: AuthContext,
  input: { lessonId: string; secondsSpent?: number },
): Promise<CompletionResult> {
  const access = await resolveLessonAccess(db, auth, input.lessonId);
  if (!access.allowed) {
    throw forbidden(access.reason ?? 'Enrol in this course to track progress in this lesson.');
  }
  const enrollment = await requireEnrollment(db, auth, access.lesson);
  if (access.lesson.status !== 'published') {
    throw badRequest('This lesson is not published yet, so it cannot be completed.');
  }

  const rule = access.lesson.completion_rule;

  if (rule === 'quiz_pass') {
    const passed = await quizzesRepo.hasPassedLessonQuiz(db, input.lessonId, auth.userId);
    if (!passed) {
      throw badRequest('This lesson is completed by passing its quiz. Attempt the quiz to finish it.', [
        { field: 'lesson_id', message: 'A passed quiz attempt is required' },
      ]);
    }
  } else {
    const seconds = Math.max(0, Math.floor(input.secondsSpent ?? 0));
    if (!satisfiesCompletionRule({ rule, secondsSpent: seconds })) {
      throw badRequest(
        `Spend at least ${MIN_SECONDS_FOR_COMPLETION} seconds on the lesson before marking it complete.`,
        [{ field: 'seconds_spent', message: `Minimum ${MIN_SECONDS_FOR_COMPLETION} seconds` }],
      );
    }
  }

  await progressRepo.upsertProgress(db, {
    enrollmentId: enrollment.id,
    lessonId: input.lessonId,
    status: 'completed',
    secondsSpent: input.secondsSpent ?? 0,
  });
  await progressRepo.touchLastLesson(db, enrollment.id, input.lessonId);

  const refreshed = await enrollmentRepo.findEnrollmentById(db, enrollment.id);
  if (!refreshed) throw notFound('Enrollment not found');

  const recalculated = await progressRepo.recalculate(db, refreshed);

  let certificate: CompletionResult['certificate'] = null;
  let courseCompleted = false;

  if (recalculated.justCompleted) {
    courseCompleted = true;
    const course = await curriculumRepo.findLessonDetail(db, input.lessonId);
    const result = await issueCertificate(db, config, logger, {
      userId: auth.userId,
      courseId: access.lesson.course_id,
      enrollmentId: enrollment.id,
      issuedBy: null,
    });
    certificate = {
      issued: result.issued,
      certificate_id: result.certificateId,
      certificate_number: result.certificateNumber,
      already_existed: result.alreadyExisted,
      reasons: result.reasons,
    };

    await notificationsRepo.createNotification(db, {
      userId: auth.userId,
      type: 'success',
      title: 'Course completed',
      body: `You finished “${course?.course_title ?? 'the course'}”. Well done!`,
      linkUrl: '/certificates.html',
    });
  }

  return {
    lesson_id: input.lessonId,
    status: 'completed',
    seconds_spent: input.secondsSpent ?? 0,
    progress: {
      total_lessons: recalculated.summary.totalLessons,
      completed_lessons: recalculated.summary.completedLessons,
      progress_percent: recalculated.summary.progressPercent,
      is_complete: recalculated.summary.isComplete,
      next_lesson_id: recalculated.summary.nextLessonId,
    },
    course_completed: courseCompleted,
    certificate,
  };
}

/** Records that a lesson was opened (start/progress) without completing it. */
export async function startLesson(
  db: Db,
  auth: AuthContext,
  input: { lessonId: string; secondsSpent?: number },
): Promise<{ status: string }> {
  const access = await resolveLessonAccess(db, auth, input.lessonId);
  if (!access.allowed) {
    throw forbidden(access.reason ?? 'Enrol in this course to track progress in this lesson.');
  }
  const enrollment = await requireEnrollment(db, auth, access.lesson);

  await progressRepo.upsertProgress(db, {
    enrollmentId: enrollment.id,
    lessonId: input.lessonId,
    status: 'in_progress',
    secondsSpent: input.secondsSpent ?? 0,
  });
  await progressRepo.touchLastLesson(db, enrollment.id, input.lessonId);

  return { status: 'in_progress' };
}

/**
 * Recomputes progress without completing anything — used after a quiz pass (which
 * may satisfy a `quiz_pass` lesson) and by administrative repairs.
 */
export async function recalculateEnrollment(
  db: Db,
  config: AppConfig,
  logger: Logger,
  auth: AuthContext,
  enrollmentId: string,
) {
  const enrollment = await enrollmentRepo.findEnrollmentForUser(db, enrollmentId, auth.userId);
  if (!enrollment) throw notFound('Enrollment not found');

  const result = await progressRepo.recalculate(db, enrollment);

  if (result.justCompleted) {
    const certificate = await issueCertificate(db, config, logger, {
      userId: enrollment.user_id,
      courseId: enrollment.course_id,
      enrollmentId: enrollment.id,
    });
    return { summary: result.summary, course_completed: true, certificate };
  }

  return { summary: result.summary, course_completed: false, certificate: null };
}

/** Progress map for a whole course, used by the curriculum sidebar. */
export async function courseProgressMap(
  db: Db,
  enrollmentId: string,
): Promise<Record<string, { status: string; seconds_spent: number }>> {
  const rows = await progressRepo.listProgressForEnrollment(db, enrollmentId);
  const map: Record<string, { status: string; seconds_spent: number }> = {};
  for (const row of rows) {
    map[row.lesson_id] = { status: row.status, seconds_spent: Number(row.seconds_spent ?? 0) };
  }
  return map;
}

/** Convenience for dashboards: the lesson the learner should resume. */
export async function nextLessonForEnrollment(db: Db, enrollmentId: string) {
  const enrollment = await enrollmentRepo.findEnrollmentById(db, enrollmentId);
  if (!enrollment) throw notFound('Enrollment not found');

  const lessons = await curriculumRepo.listPublishedCourseLessons(db, enrollment.course_id);
  const progress = await progressRepo.listProgressForEnrollment(db, enrollment.id);

  const summary = summarizeProgress(
    lessons.map((lesson) => ({
      id: lesson.id,
      position: lesson.position,
      status: 'published' as const,
      completionRule: lesson.completion_rule,
    })),
    progress.map((row) => ({ lessonId: row.lesson_id, status: row.status })),
  );

  return {
    summary,
    lesson: lessons.find((lesson) => lesson.id === summary.nextLessonId) ?? null,
  };
}
