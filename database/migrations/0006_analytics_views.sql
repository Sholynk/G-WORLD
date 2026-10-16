-- ===========================================================================
-- G WORLD — Migration 0006: Read models (views)
-- ---------------------------------------------------------------------------
-- These views exist so the most common joined shapes have exactly one
-- definition. Repositories query them instead of duplicating complex joins in
-- route handlers; the underlying tables stay normalised.
--
-- Performance note: views are not materialised, so each view is written to be
-- index-friendly (correlated subqueries hit indexed columns only). At MVP data
-- volumes this is far cheaper than maintaining summary tables; docs/09 covers
-- when to introduce denormalised counters instead.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- v_published_courses — public catalog and search. Only published content is
-- visible, and publication is required at department, subject and course level.
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_published_courses AS
SELECT
  c.id                                  AS id,
  c.slug                                AS slug,
  c.title                               AS title,
  c.summary                             AS summary,
  c.description                         AS description,
  c.difficulty                          AS difficulty,
  c.estimated_minutes                   AS estimated_minutes,
  c.thumbnail_url                       AS thumbnail_url,
  c.instructor_name                     AS instructor_name,
  c.language                            AS language,
  c.is_featured                         AS is_featured,
  c.enrollment_open                     AS enrollment_open,
  c.certificate_enabled                 AS certificate_enabled,
  c.published_at                        AS published_at,
  s.id                                  AS subject_id,
  s.name                                AS subject_name,
  s.slug                                AS subject_slug,
  d.id                                  AS department_id,
  d.name                                AS department_name,
  d.slug                                AS department_slug,
  d.icon                                AS department_icon,
  (SELECT COUNT(*) FROM modules m
     WHERE m.course_id = c.id AND m.status = 'published')                     AS module_count,
  (SELECT COUNT(*) FROM lessons l
     JOIN modules m2 ON m2.id = l.module_id
    WHERE m2.course_id = c.id AND m2.status = 'published'
      AND l.status = 'published')                                             AS lesson_count,
  (SELECT COUNT(*) FROM enrollments e
    WHERE e.course_id = c.id AND e.status IN ('active', 'completed'))         AS enrollment_count,
  (SELECT ROUND(AVG(r.rating), 2) FROM course_reviews r
    WHERE r.course_id = c.id AND r.status = 'published')                      AS average_rating,
  (SELECT COUNT(*) FROM course_reviews r
    WHERE r.course_id = c.id AND r.status = 'published')                      AS review_count
FROM courses c
JOIN subjects s    ON s.id = c.subject_id
JOIN departments d ON d.id = s.department_id
WHERE c.status = 'published'
  AND s.status = 'published'
  AND d.status = 'published';

-- ---------------------------------------------------------------------------
-- v_course_curriculum — modules with their ordered lessons and counts, used by
-- the course detail page, the lesson player and the admin editor.
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_course_curriculum AS
SELECT
  c.id            AS course_id,
  c.slug          AS course_slug,
  c.title         AS course_title,
  c.status        AS course_status,
  m.id            AS module_id,
  m.title         AS module_title,
  m.description   AS module_description,
  m.position      AS module_position,
  m.status        AS module_status,
  l.id            AS lesson_id,
  l.title         AS lesson_title,
  l.slug          AS lesson_slug,
  l.position      AS lesson_position,
  l.estimated_minutes AS lesson_minutes,
  l.is_preview    AS lesson_is_preview,
  l.completion_rule AS lesson_completion_rule,
  l.status        AS lesson_status,
  (SELECT COUNT(*) FROM videos v WHERE v.lesson_id = l.id)                     AS video_count,
  (SELECT COUNT(*) FROM resources r WHERE r.lesson_id = l.id)                  AS resource_count
FROM courses c
JOIN modules m ON m.course_id = c.id
LEFT JOIN lessons l ON l.module_id = m.id;

-- ---------------------------------------------------------------------------
-- v_enrollment_progress — everything a dashboard or admin enrollment table
-- needs about one learner's course, including quiz average and certificate.
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_enrollment_progress AS
SELECT
  e.id                AS enrollment_id,
  e.status            AS status,
  e.progress_percent  AS progress_percent,
  e.lessons_completed AS lessons_completed,
  e.total_lessons     AS total_lessons,
  e.enrolled_at       AS enrolled_at,
  e.last_activity_at  AS last_activity_at,
  e.completed_at      AS completed_at,
  u.id                AS user_id,
  u.email             AS user_email,
  u.status            AS user_status,
  sp.student_number   AS student_number,
  -- SQLite has no split_part(); derive a fallback display name from the email.
  COALESCE(sp.display_name, sp.full_name, substr(u.email, 1, instr(u.email, '@') - 1)) AS student_name,
  c.id                AS course_id,
  c.title             AS course_title,
  c.slug              AS course_slug,
  c.difficulty        AS course_difficulty,
  s.name              AS subject_name,
  d.name              AS department_name,
  (SELECT COUNT(*) FROM lesson_progress lp
    WHERE lp.enrollment_id = e.id AND lp.status = 'completed')                AS completed_lessons,
  (SELECT COUNT(*) FROM certificates cert WHERE cert.enrollment_id = e.id)    AS certificates_issued,
  (SELECT ROUND(AVG(qa.score_percent)) FROM quiz_attempts qa
    WHERE qa.user_id = e.user_id
      AND qa.status IN ('submitted', 'graded')
      AND qa.quiz_id IN (SELECT q.id FROM quizzes q WHERE q.course_id = e.course_id)) AS average_quiz_score
FROM enrollments e
JOIN users u       ON u.id = e.user_id
LEFT JOIN student_profiles sp ON sp.user_id = u.id
JOIN courses c     ON c.id = e.course_id
JOIN subjects s    ON s.id = c.subject_id
JOIN departments d ON d.id = s.department_id;

-- ---------------------------------------------------------------------------
-- v_quiz_attempt_summary — attempt history for students and instructors.
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_quiz_attempt_summary AS
SELECT
  qa.id             AS attempt_id,
  qa.attempt_number AS attempt_number,
  qa.status         AS status,
  qa.score_points   AS score_points,
  qa.max_points     AS max_points,
  qa.score_percent  AS score_percent,
  qa.passed         AS passed,
  qa.started_at     AS started_at,
  qa.submitted_at   AS submitted_at,
  qa.time_spent_seconds AS time_spent_seconds,
  q.id              AS quiz_id,
  q.title           AS quiz_title,
  q.pass_mark_percent AS pass_mark_percent,
  q.max_attempts    AS max_attempts,
  q.course_id       AS course_id,
  q.lesson_id       AS lesson_id,
  u.id              AS user_id,
  u.email           AS user_email,
  c.title           AS course_title
FROM quiz_attempts qa
JOIN quizzes q ON q.id = qa.quiz_id
JOIN users u   ON u.id = qa.user_id
LEFT JOIN courses c ON c.id = q.course_id;

-- ---------------------------------------------------------------------------
-- v_department_stats — home page counters and admin KPI cards.
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_department_stats AS
SELECT
  d.id          AS department_id,
  d.name        AS department_name,
  d.slug        AS department_slug,
  d.icon        AS icon,
  d.tagline     AS tagline,
  d.status      AS status,
  d.display_order AS display_order,
  (SELECT COUNT(*) FROM subjects s
    WHERE s.department_id = d.id AND s.status = 'published')                  AS subject_count,
  (SELECT COUNT(*) FROM courses c
     JOIN subjects s2 ON s2.id = c.subject_id
    WHERE s2.department_id = d.id AND c.status = 'published')                 AS course_count,
  (SELECT COUNT(*) FROM lessons l
     JOIN modules m ON m.id = l.module_id
     JOIN courses c2 ON c2.id = m.course_id
     JOIN subjects s3 ON s3.id = c2.subject_id
    WHERE s3.department_id = d.id AND l.status = 'published')                 AS lesson_count,
  (SELECT COUNT(DISTINCT e.user_id) FROM enrollments e
     JOIN courses c3 ON c3.id = e.course_id
     JOIN subjects s4 ON s4.id = c3.subject_id
    WHERE s4.department_id = d.id)                                            AS student_count
FROM departments d;

-- ---------------------------------------------------------------------------
-- v_admin_activity — audit log screen: who did what, to which entity, when.
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_admin_activity AS
SELECT
  a.id            AS id,
  a.action        AS action,
  a.entity_type   AS entity_type,
  a.entity_id     AS entity_id,
  a.description   AS description,
  a.status        AS status,
  a.metadata_json AS metadata_json,
  a.request_id    AS request_id,
  a.created_at    AS created_at,
  a.actor_user_id AS actor_user_id,
  a.actor_role    AS actor_role,
  u.email         AS actor_email,
  COALESCE(sp.display_name, sp.full_name, u.email) AS actor_name
FROM audit_logs a
LEFT JOIN users u ON u.id = a.actor_user_id
LEFT JOIN student_profiles sp ON sp.user_id = u.id;
