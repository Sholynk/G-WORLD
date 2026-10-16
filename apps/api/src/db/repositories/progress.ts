/**
 * Repository — lesson progress.
 *
 * `lesson_progress` is the authoritative record of what a learner has finished;
 * `enrollments.progress_percent` is a cache of it. `recalculate()` is the only
 * function allowed to write those counters, and it always recomputes from the
 * rows rather than adding to them — that is what makes completing a lesson twice
 * (double submit, retry after a network error) a no-op.
 */
import type { Db } from '../client.js';
import type { LessonProgressStatus } from '@g-world/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';
import { listPublishedCourseLessons } from './curriculum.js';
import { updateProgress, type EnrollmentDetailRow } from './enrollments.js';
import { summarizeProgress, type ProgressLesson, type ProgressSummary } from '../../lib/progress.js';

export interface LessonProgressRow {
  id: string;
  enrollment_id: string;
  lesson_id: string;
  status: LessonProgressStatus;
  seconds_spent: number;
  last_viewed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LessonProgressDetailRow extends LessonProgressRow {
  lesson_title: string;
  lesson_position: number;
  module_id: string;
  module_title: string;
  module_position: number;
}

export async function findProgressRow(
  db: Db,
  enrollmentId: string,
  lessonId: string,
): Promise<LessonProgressRow | null> {
  return db.first<LessonProgressRow>(
    `SELECT id, enrollment_id, lesson_id, status, seconds_spent, last_viewed_at, completed_at,
            created_at, updated_at
       FROM lesson_progress WHERE enrollment_id = ? AND lesson_id = ? LIMIT 1`,
    [enrollmentId, lessonId],
  );
}

export async function listProgressForEnrollment(
  db: Db,
  enrollmentId: string,
): Promise<LessonProgressDetailRow[]> {
  return db.all<LessonProgressDetailRow>(
    `SELECT lp.id, lp.enrollment_id, lp.lesson_id, lp.status, lp.seconds_spent, lp.last_viewed_at,
            lp.completed_at, lp.created_at, lp.updated_at,
            l.title AS lesson_title, l.position AS lesson_position,
            m.id AS module_id, m.title AS module_title, m.position AS module_position
       FROM lesson_progress lp
       JOIN lessons l ON l.id = lp.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE lp.enrollment_id = ?
      ORDER BY m.position ASC, l.position ASC`,
    [enrollmentId],
  );
}

/**
 * Records viewing/progress for a lesson. Called when a lesson is opened (start)
 * and when the learner saves partial progress.
 */
export async function upsertProgress(
  db: Db,
  input: {
    enrollmentId: string;
    lessonId: string;
    status: LessonProgressStatus;
    secondsSpent?: number;
    completedAt?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const id = newId(ID_PREFIXES.lessonProgress);
  const completedAt = input.status === 'completed' ? input.completedAt ?? now : null;

  await db.run(
    `INSERT INTO lesson_progress (id, enrollment_id, lesson_id, status, seconds_spent, last_viewed_at,
                                 completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET
       status = CASE
                  -- 'completed' is sticky: a learner who revisits a finished
                  -- lesson never loses the completion (or their certificate).
                  WHEN lesson_progress.status = 'completed' THEN 'completed'
                  ELSE excluded.status
                END,
       seconds_spent = MAX(lesson_progress.seconds_spent, excluded.seconds_spent),
       last_viewed_at = excluded.last_viewed_at,
       completed_at = COALESCE(lesson_progress.completed_at, excluded.completed_at),
       updated_at = excluded.updated_at`,
    [
      id,
      input.enrollmentId,
      input.lessonId,
      input.status,
      Math.max(0, Math.floor(input.secondsSpent ?? 0)),
      now,
      completedAt,
      now,
      now,
    ],
  );
}

export async function countCompletedLessons(db: Db, enrollmentId: string): Promise<number> {
  return db.count(
    `SELECT COUNT(*) AS total FROM lesson_progress
      WHERE enrollment_id = ? AND status = 'completed'`,
    [enrollmentId],
  );
}

/**
 * Recomputes and stores progress for an enrollment.
 *
 * Returns both the new summary and (when the course just became complete) the
 * information the caller needs to issue a certificate.
 */
export interface RecalculateResult {
  summary: ProgressSummary;
  justCompleted: boolean;
  completedAt: string | null;
}

export async function recalculate(db: Db, enrollment: EnrollmentDetailRow): Promise<RecalculateResult> {
  const lessons = await listPublishedCourseLessons(db, enrollment.course_id);
  const progressRows = await listProgressForEnrollment(db, enrollment.id);

  const progressLessons: ProgressLesson[] = lessons.map((lesson) => ({
    id: lesson.id,
    position: lesson.position,
    status: 'published',
    completionRule: lesson.completion_rule,
  }));

  const summary = summarizeProgress(
    progressLessons,
    progressRows.map((row) => ({ lessonId: row.lesson_id, status: row.status })),
  );

  const wasComplete = enrollment.status === 'completed';
  const shouldComplete = summary.isComplete && summary.totalLessons > 0;
  const completedAt = shouldComplete ? enrollment.completed_at ?? new Date().toISOString() : null;

  await updateProgress(db, {
    enrollmentId: enrollment.id,
    completedLessons: summary.completedLessons,
    totalLessons: summary.totalLessons,
    progressPercent: summary.progressPercent,
    status: shouldComplete ? 'completed' : 'active',
    lastLessonId: enrollment.last_lesson_id,
    completedAt,
  });

  return {
    summary,
    justCompleted: shouldComplete && !wasComplete,
    completedAt,
  };
}

/** Marks the most recently opened lesson, used by the "resume" card. */
export async function touchLastLesson(db: Db, enrollmentId: string, lessonId: string): Promise<void> {
  await db.run(`UPDATE enrollments SET last_lesson_id = ?, last_activity_at = ? WHERE id = ?`, [
    lessonId,
    new Date().toISOString(),
    enrollmentId,
  ]);
}

/** Course-level completion rate, used by admin analytics. */
export async function completionRateForCourse(db: Db, courseId: string): Promise<number> {
  const row = await db.first<{ total: number; completed: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM enrollments WHERE course_id = ?`,
    [courseId],
  );
  const total = Number(row?.total ?? 0);
  if (total === 0) return 0;
  return Math.round((Number(row?.completed ?? 0) / total) * 100);
}

/** Per-lesson drop-off, used by the admin course analytics panel. */
export interface LessonFunnelRow {
  lesson_id: string;
  lesson_title: string;
  position: number;
  module_title: string;
  completed_count: number;
}

export async function lessonFunnel(db: Db, courseId: string): Promise<LessonFunnelRow[]> {
  return db.all<LessonFunnelRow>(
    `SELECT l.id AS lesson_id, l.title AS lesson_title, l.position AS position,
            m.title AS module_title,
            (SELECT COUNT(*) FROM lesson_progress lp
              WHERE lp.lesson_id = l.id AND lp.status = 'completed') AS completed_count
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = ?
      ORDER BY m.position ASC, l.position ASC`,
    [courseId],
  );
}
