/**
 * Repository — analytics and reporting queries.
 *
 * These read models power the public home page counters and the administrator
 * dashboard. Everything is aggregated in SQL (SQLite is good at this) so the
 * Worker never loads thousands of rows to count them in JavaScript.
 */
import type { Db } from '../client.js';

export interface PlatformOverview {
  departments: number;
  subjects: number;
  courses: number;
  publishedCourses: number;
  lessons: number;
  publishedLessons: number;
  students: number;
  enrollments: number;
  activeEnrollments: number;
  completions: number;
  certificates: number;
  quizzes: number;
  assignments: number;
  averageProgressPercent: number;
  averageQuizScore: number;
}

/** Single overview row for the admin KPIs and the public "at a glance" strip. */
export async function platformOverview(db: Db): Promise<PlatformOverview> {
  const row = await db.first<Record<string, number | null>>(
    `SELECT
       (SELECT COUNT(*) FROM departments) AS departments,
       (SELECT COUNT(*) FROM subjects) AS subjects,
       (SELECT COUNT(*) FROM courses) AS courses,
       (SELECT COUNT(*) FROM courses WHERE status = 'published') AS published_courses,
       (SELECT COUNT(*) FROM lessons) AS lessons,
       (SELECT COUNT(*) FROM lessons WHERE status = 'published') AS published_lessons,
       (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'student') AS students,
       (SELECT COUNT(*) FROM enrollments) AS enrollments,
       (SELECT COUNT(*) FROM enrollments WHERE status = 'active') AS active_enrollments,
       (SELECT COUNT(*) FROM enrollments WHERE status = 'completed') AS completions,
       (SELECT COUNT(*) FROM certificates WHERE revoked_at IS NULL) AS certificates,
       (SELECT COUNT(*) FROM quizzes) AS quizzes,
       (SELECT COUNT(*) FROM assignments) AS assignments,
       (SELECT ROUND(AVG(progress_percent)) FROM enrollments) AS average_progress,
       (SELECT ROUND(AVG(score_percent)) FROM quiz_attempts WHERE status IN ('submitted','graded')) AS average_quiz_score`,
  );

  const num = (value: unknown) => Number(value ?? 0);
  return {
    departments: num(row?.departments),
    subjects: num(row?.subjects),
    courses: num(row?.courses),
    publishedCourses: num(row?.published_courses),
    lessons: num(row?.lessons),
    publishedLessons: num(row?.published_lessons),
    students: num(row?.students),
    enrollments: num(row?.enrollments),
    activeEnrollments: num(row?.active_enrollments),
    completions: num(row?.completions),
    certificates: num(row?.certificates),
    quizzes: num(row?.quizzes),
    assignments: num(row?.assignments),
    averageProgressPercent: num(row?.average_progress),
    averageQuizScore: num(row?.average_quiz_score),
  };
}

export interface CoursePerformanceRow {
  course_id: string;
  title: string;
  slug: string;
  department_name: string;
  status: string;
  enrollment_count: number;
  completion_count: number;
  completion_rate: number;
  average_progress: number;
  average_quiz_score: number | null;
}

/**
 * Course performance table.
 *
 * `enrollment_count` counts active + completed enrollments (a cancelled
 * enrollment is not a learner), while `completion_rate` is completed/enrolled so
 * administrators can see which courses lose people.
 */
export async function coursePerformance(db: Db, limit = 25): Promise<CoursePerformanceRow[]> {
  return db.all<CoursePerformanceRow>(
    `SELECT c.id AS course_id, c.title, c.slug, d.name AS department_name, c.status,
            (SELECT COUNT(*) FROM enrollments e
              WHERE e.course_id = c.id AND e.status IN ('active','completed')) AS enrollment_count,
            (SELECT COUNT(*) FROM enrollments e
              WHERE e.course_id = c.id AND e.status = 'completed') AS completion_count,
            CASE
              WHEN (SELECT COUNT(*) FROM enrollments e
                     WHERE e.course_id = c.id AND e.status IN ('active','completed')) = 0 THEN 0
              ELSE ROUND(
                100.0 * (SELECT COUNT(*) FROM enrollments e
                          WHERE e.course_id = c.id AND e.status = 'completed') /
                (SELECT COUNT(*) FROM enrollments e
                  WHERE e.course_id = c.id AND e.status IN ('active','completed'))
              )
            END AS completion_rate,
            COALESCE((SELECT ROUND(AVG(e.progress_percent)) FROM enrollments e
                       WHERE e.course_id = c.id AND e.status IN ('active','completed')), 0) AS average_progress,
            (SELECT ROUND(AVG(qa.score_percent)) FROM quiz_attempts qa
               JOIN quizzes q ON q.id = qa.quiz_id
              WHERE q.course_id = c.id AND qa.status IN ('submitted','graded')) AS average_quiz_score
       FROM courses c
       JOIN subjects s ON s.id = c.subject_id
       JOIN departments d ON d.id = s.department_id
      ORDER BY enrollment_count DESC, c.title ASC
      LIMIT ?`,
    [limit],
  );
}

export interface EnrollmentTrendPoint {
  period: string;
  enrollments: number;
  completions: number;
}

/** Enrollments and completions per month for the last `months` months. */
export async function enrollmentTrend(db: Db, months = 6): Promise<EnrollmentTrendPoint[]> {
  return db.all<EnrollmentTrendPoint>(
    `SELECT strftime('%Y-%m', enrolled_at) AS period,
            COUNT(*) AS enrollments,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completions
       FROM enrollments
      WHERE enrolled_at >= strftime('%Y-%m-01T00:00:00.000Z', 'now', ?)
      GROUP BY period
      ORDER BY period ASC`,
    [`-${Math.max(1, Math.floor(months))} months`],
  );
}

export interface DepartmentPerformanceRow {
  department_id: string;
  department_name: string;
  course_count: number;
  student_count: number;
  average_progress: number;
}

export async function departmentPerformance(db: Db): Promise<DepartmentPerformanceRow[]> {
  return db.all<DepartmentPerformanceRow>(
    `SELECT d.id AS department_id, d.name AS department_name,
            (SELECT COUNT(*) FROM courses c
               JOIN subjects s ON s.id = c.subject_id
              WHERE s.department_id = d.id AND c.status = 'published') AS course_count,
            (SELECT COUNT(DISTINCT e.user_id) FROM enrollments e
               JOIN courses c2 ON c2.id = e.course_id
               JOIN subjects s2 ON s2.id = c2.subject_id
              WHERE s2.department_id = d.id) AS student_count,
            COALESCE((SELECT ROUND(AVG(e.progress_percent)) FROM enrollments e
                        JOIN courses c3 ON c3.id = e.course_id
                        JOIN subjects s3 ON s3.id = c3.subject_id
                       WHERE s3.department_id = d.id), 0) AS average_progress
       FROM departments d
      ORDER BY course_count DESC, d.name ASC`,
  );
}

export interface RecentEnrollmentRow {
  student_name: string | null;
  student_number: string | null;
  user_email: string;
  course_title: string;
  status: string;
  progress_percent: number;
  enrolled_at: string;
}

/** Latest enrollments for the admin dashboard activity list. */
export async function recentEnrollments(db: Db, limit = 8): Promise<RecentEnrollmentRow[]> {
  return db.all<RecentEnrollmentRow>(
    `SELECT COALESCE(sp.display_name, sp.full_name, substr(u.email, 1, instr(u.email, '@') - 1)) AS student_name,
            sp.student_number, u.email AS user_email, c.title AS course_title, e.status,
            e.progress_percent, e.enrolled_at
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
      ORDER BY e.enrolled_at DESC
      LIMIT ?`,
    [limit],
  );
}

/** Public statistics strip on the home page (published content only). */
export interface PublicStats {
  departments: number;
  courses: number;
  lessons: number;
  learners: number;
  certificates: number;
}

export async function publicStats(db: Db): Promise<PublicStats> {
  const row = await db.first<Record<string, number | null>>(
    `SELECT
       (SELECT COUNT(*) FROM departments WHERE status = 'published') AS departments,
       (SELECT COUNT(*) FROM v_published_courses) AS courses,
       (SELECT COUNT(*) FROM lessons l
          JOIN modules m ON m.id = l.module_id
          JOIN courses c ON c.id = m.course_id
         WHERE l.status = 'published' AND m.status = 'published' AND c.status = 'published') AS lessons,
       (SELECT COUNT(DISTINCT user_id) FROM enrollments) AS learners,
       (SELECT COUNT(*) FROM certificates WHERE revoked_at IS NULL) AS certificates`,
  );
  const num = (value: unknown) => Number(value ?? 0);
  return {
    departments: num(row?.departments),
    courses: num(row?.courses),
    lessons: num(row?.lessons),
    learners: num(row?.learners),
    certificates: num(row?.certificates),
  };
}

export interface StudentLearningStats {
  enrolled: number;
  active: number;
  completed: number;
  certificates: number;
  lessonsCompleted: number;
  averageProgress: number;
  minutesLearned: number;
  quizzesPassed: number;
}

/** Per-learner summary for the student dashboard. */
export async function studentLearningStats(db: Db, userId: string): Promise<StudentLearningStats> {
  const row = await db.first<Record<string, number | null>>(
    `SELECT
       (SELECT COUNT(*) FROM enrollments WHERE user_id = ?) AS enrolled,
       (SELECT COUNT(*) FROM enrollments WHERE user_id = ? AND status = 'active') AS active,
       (SELECT COUNT(*) FROM enrollments WHERE user_id = ? AND status = 'completed') AS completed,
       (SELECT COUNT(*) FROM certificates WHERE user_id = ? AND revoked_at IS NULL) AS certificates,
       (SELECT COUNT(*) FROM lesson_progress lp
          JOIN enrollments e ON e.id = lp.enrollment_id
         WHERE e.user_id = ? AND lp.status = 'completed') AS lessons_completed,
       COALESCE((SELECT ROUND(AVG(progress_percent)) FROM enrollments WHERE user_id = ?), 0) AS average_progress,
       COALESCE((SELECT ROUND(SUM(lp.seconds_spent) / 60.0) FROM lesson_progress lp
                   JOIN enrollments e ON e.id = lp.enrollment_id
                  WHERE e.user_id = ?), 0) AS minutes_learned,
       (SELECT COUNT(*) FROM quiz_attempts WHERE user_id = ? AND passed = 1) AS quizzes_passed`,
    [userId, userId, userId, userId, userId, userId, userId, userId],
  );
  const num = (value: unknown) => Number(value ?? 0);
  return {
    enrolled: num(row?.enrolled),
    active: num(row?.active),
    completed: num(row?.completed),
    certificates: num(row?.certificates),
    lessonsCompleted: num(row?.lessons_completed),
    averageProgress: num(row?.average_progress),
    minutesLearned: num(row?.minutes_learned),
    quizzesPassed: num(row?.quizzes_passed),
  };
}

/** Weekly activity heat strip: lessons completed per day for 14 days. */
export async function recentLessonActivity(
  db: Db,
  userId: string,
  days = 14,
): Promise<{ day: string; lessons: number }[]> {
  return db.all<{ day: string; lessons: number }>(
    `SELECT strftime('%Y-%m-%d', lp.completed_at) AS day, COUNT(*) AS lessons
       FROM lesson_progress lp
       JOIN enrollments e ON e.id = lp.enrollment_id
      WHERE e.user_id = ?
        AND lp.status = 'completed'
        AND lp.completed_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
      GROUP BY day
      ORDER BY day ASC`,
    [userId, `-${Math.max(1, Math.floor(days))} days`],
  );
}
