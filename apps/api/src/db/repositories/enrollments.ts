/**
 * Repository — enrollments.
 *
 * An enrollment is the join between a learner and a course, and it carries the
 * denormalised progress counters that every list view needs. The counters are
 * written by the progress engine (db/repositories/progress.ts) from authoritative
 * `lesson_progress` rows, never incremented blindly — so a double-click on
 * "mark complete" cannot inflate progress.
 */
import type { Db } from '../client.js';
import type { EnrollmentStatus } from '@g-world/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface EnrollmentRow {
  id: string;
  user_id: string;
  course_id: string;
  status: EnrollmentStatus;
  progress_percent: number;
  lessons_completed: number;
  total_lessons: number;
  last_lesson_id: string | null;
  enrolled_at: string;
  last_activity_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  certificate_issued_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnrollmentDetailRow extends EnrollmentRow {
  course_title: string;
  course_slug: string;
  course_thumbnail_url: string | null;
  course_difficulty: string;
  subject_name: string;
  department_name: string;
  student_name: string;
  student_number: string | null;
  user_email: string;
  certificates_issued: number;
  average_quiz_score: number | null;
}

const ENROLLMENT_DETAIL_SELECT = `
  SELECT e.id, e.user_id, e.course_id, e.status, e.progress_percent, e.lessons_completed,
         e.total_lessons, e.last_lesson_id, e.enrolled_at, e.last_activity_at, e.completed_at,
         e.cancelled_at, e.certificate_issued_at, e.created_at, e.updated_at,
         c.title AS course_title, c.slug AS course_slug, c.thumbnail_url AS course_thumbnail_url,
         c.difficulty AS course_difficulty,
         s.name AS subject_name, d.name AS department_name,
         (SELECT COUNT(*) FROM certificates cert WHERE cert.enrollment_id = e.id) AS certificates_issued,
         (SELECT ROUND(AVG(qa.score_percent)) FROM quiz_attempts qa
            WHERE qa.user_id = e.user_id AND qa.status IN ('submitted','graded')
              AND qa.quiz_id IN (SELECT q.id FROM quizzes q WHERE q.course_id = e.course_id)) AS average_quiz_score,
         u.email AS user_email,
         COALESCE(sp.display_name, sp.full_name, substr(u.email, 1, instr(u.email, '@') - 1)) AS student_name,
         sp.student_number AS student_number
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN departments d ON d.id = s.department_id
    JOIN users u ON u.id = e.user_id
    LEFT JOIN student_profiles sp ON sp.user_id = e.user_id`;

export async function createEnrollment(
  db: Db,
  input: { userId: string; courseId: string; totalLessons?: number },
): Promise<string> {
  const id = newId(ID_PREFIXES.enrollment);
  await db.run(
    `INSERT INTO enrollments (id, user_id, course_id, status, total_lessons, last_activity_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
    [id, input.userId, input.courseId, input.totalLessons ?? 0, new Date().toISOString()],
  );
  return id;
}

export async function findEnrollment(
  db: Db,
  userId: string,
  courseId: string,
): Promise<EnrollmentRow | null> {
  return db.first<EnrollmentRow>(
    `SELECT id, user_id, course_id, status, progress_percent, lessons_completed, total_lessons,
            last_lesson_id, enrolled_at, last_activity_at, completed_at, cancelled_at,
            certificate_issued_at, created_at, updated_at
       FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1`,
    [userId, courseId],
  );
}

export async function findEnrollmentById(db: Db, id: string): Promise<EnrollmentDetailRow | null> {
  return db.first<EnrollmentDetailRow>(`${ENROLLMENT_DETAIL_SELECT} WHERE e.id = ? LIMIT 1`, [id]);
}

/** Learner view of one enrollment (course context included). */
export async function findEnrollmentForUser(
  db: Db,
  enrollmentId: string,
  userId: string,
): Promise<EnrollmentDetailRow | null> {
  return db.first<EnrollmentDetailRow>(
    `${ENROLLMENT_DETAIL_SELECT} WHERE e.id = ? AND e.user_id = ? LIMIT 1`,
    [enrollmentId, userId],
  );
}

/**
 * Ownership probe used by every learner endpoint that takes an enrollment id.
 * Returning the row (rather than a boolean) lets the handler distinguish
 * "not enrolled" (403/404) from "not yours", and keeps the query indexed.
 */
export async function findEnrollmentForCourseByUser(
  db: Db,
  courseId: string,
  userId: string,
): Promise<EnrollmentRow | null> {
  return findEnrollment(db, userId, courseId);
}

export async function listEnrollmentsForUser(db: Db, userId: string): Promise<EnrollmentDetailRow[]> {
  return db.all<EnrollmentDetailRow>(
    `${ENROLLMENT_DETAIL_SELECT}
      WHERE e.user_id = ?
      ORDER BY COALESCE(e.last_activity_at, e.enrolled_at) DESC`,
    [userId],
  );
}

export interface AdminEnrollmentFilters {
  q?: string | null;
  status?: EnrollmentStatus | null;
  courseId?: string | null;
  userId?: string | null;
  page: number;
  perPage: number;
}

export async function listEnrollmentsForAdmin(
  db: Db,
  filters: AdminEnrollmentFilters,
): Promise<{ items: EnrollmentDetailRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.status) {
    conditions.push(`e.status = ?`);
    params.push(filters.status);
  }
  if (filters.courseId) {
    conditions.push(`e.course_id = ?`);
    params.push(filters.courseId);
  }
  if (filters.userId) {
    conditions.push(`e.user_id = ?`);
    params.push(filters.userId);
  }
  if (filters.q) {
    conditions.push(`(u.email LIKE ? COLLATE NOCASE OR c.title LIKE ? COLLATE NOCASE
                      OR sp.student_number LIKE ? COLLATE NOCASE OR sp.display_name LIKE ? COLLATE NOCASE)`);
    const term = `%${filters.q}%`;
    params.push(term, term, term, term);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.count(
    `SELECT COUNT(*) AS total
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       ${where}`,
    params,
  );

  const items = await db.all<EnrollmentDetailRow>(
    `${ENROLLMENT_DETAIL_SELECT} ${where}
      ORDER BY COALESCE(e.last_activity_at, e.enrolled_at) DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );

  return { items, total };
}

export interface ProgressUpdate {
  enrollmentId: string;
  completedLessons: number;
  totalLessons: number;
  progressPercent: number;
  status?: EnrollmentStatus;
  lastLessonId?: string | null;
  completedAt?: string | null;
}

/**
 * Writes the recalculated progress. The status transition to `completed` is
 * applied here (and only here) so every path that finishes a course — lesson
 * completion, quiz pass, assignment grade — ends in the same state.
 */
export async function updateProgress(db: Db, update: ProgressUpdate): Promise<number> {
  const now = new Date().toISOString();
  const assignments = [
    'progress_percent = ?',
    'lessons_completed = ?',
    'total_lessons = ?',
    'last_activity_at = ?',
  ];
  const params: (string | number | null)[] = [
    update.progressPercent,
    update.completedLessons,
    update.totalLessons,
    now,
  ];

  if (update.status !== undefined) {
    assignments.push('status = ?');
    params.push(update.status);
  }
  if (update.lastLessonId !== undefined) {
    assignments.push('last_lesson_id = ?');
    params.push(update.lastLessonId);
  }
  if (update.completedAt !== undefined) {
    assignments.push('completed_at = ?');
    params.push(update.completedAt);
  }

  params.push(update.enrollmentId);
  return db.changes(`UPDATE enrollments SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function setStatus(
  db: Db,
  enrollmentId: string,
  status: EnrollmentStatus,
  extra?: { cancelledAt?: string | null; completedAt?: string | null },
): Promise<number> {
  const assignments = ['status = ?'];
  const params: (string | null)[] = [status];
  if (extra?.cancelledAt !== undefined) {
    assignments.push('cancelled_at = ?');
    params.push(extra.cancelledAt);
  }
  if (extra?.completedAt !== undefined) {
    assignments.push('completed_at = ?');
    params.push(extra.completedAt);
  }
  params.push(enrollmentId);
  return db.changes(`UPDATE enrollments SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function markCertificateIssued(db: Db, enrollmentId: string): Promise<number> {
  return db.changes(`UPDATE enrollments SET certificate_issued_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    enrollmentId,
  ]);
}

export async function countEnrollmentsForUser(db: Db, userId: string): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM enrollments WHERE user_id = ?`, [userId]);
}

export interface EnrollmentStats {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  averageProgress: number;
  completionsLast30Days: number;
}

export async function enrollmentStats(db: Db): Promise<EnrollmentStats> {
  const row = await db.first<Record<string, number | null>>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
       ROUND(AVG(progress_percent)) AS average_progress,
       SUM(CASE WHEN completed_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') THEN 1 ELSE 0 END)
         AS completions_last_30_days
     FROM enrollments`,
  );
  return {
    total: Number(row?.total ?? 0),
    active: Number(row?.active ?? 0),
    completed: Number(row?.completed ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
    averageProgress: Number(row?.average_progress ?? 0),
    completionsLast30Days: Number(row?.completions_last_30_days ?? 0),
  };
}

/** Courses the learner has not enrolled in yet (dashboard recommendations). */
export async function listRecommendedCourses(db: Db, userId: string, limit = 3): Promise<
  { id: string; title: string; slug: string; summary: string | null; department_name: string; difficulty: string; estimated_minutes: number; thumbnail_url: string | null }[]
> {
  return db.all(
    `SELECT v.id, v.title, v.slug, v.summary, v.department_name, v.difficulty, v.estimated_minutes, v.thumbnail_url
       FROM v_published_courses v
      WHERE NOT EXISTS (
              SELECT 1 FROM enrollments e
               WHERE e.course_id = v.id AND e.user_id = ?
            )
        AND v.enrollment_open = 1
      ORDER BY v.is_featured DESC, v.enrollment_count DESC
      LIMIT ?`,
    [userId, limit],
  );
}
