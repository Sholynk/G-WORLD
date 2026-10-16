-- ===========================================================================
-- G WORLD — Migration 0004: Domain D — Learning and assessment
-- ---------------------------------------------------------------------------
-- Enrollment, per-lesson progress, quizzes, assignments, certificates and
-- course reviews. Every derived learner-facing number (progress percent,
-- pass/fail, certificate eligibility) is computed on the server from these
-- tables and stored back so lists stay cheap to render.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- enrollments — a student's participation in a course. Unique per pair, so a
-- duplicate enrolment request is a database-level conflict, not just a check.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  course_id        TEXT NOT NULL REFERENCES courses (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                     'active', 'completed', 'cancelled', 'expired')),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  lessons_completed INTEGER NOT NULL DEFAULT 0 CHECK (lessons_completed >= 0),
  total_lessons    INTEGER NOT NULL DEFAULT 0 CHECK (total_lessons >= 0),
  last_lesson_id   TEXT REFERENCES lessons (id) ON DELETE SET NULL ON UPDATE CASCADE,
  enrolled_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_activity_at TEXT,
  completed_at     TEXT,
  cancelled_at     TEXT,
  expires_at       TEXT,
  certificate_issued_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, course_id),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- lesson_progress — one row per (enrollment, lesson).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_progress (
  id            TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL REFERENCES enrollments (id) ON DELETE CASCADE ON UPDATE CASCADE,
  lesson_id     TEXT NOT NULL REFERENCES lessons (id) ON DELETE CASCADE ON UPDATE CASCADE,
  status        TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
                  'not_started', 'in_progress', 'completed')),
  seconds_spent  INTEGER NOT NULL DEFAULT 0 CHECK (seconds_spent >= 0),
  last_viewed_at TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (enrollment_id, lesson_id),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- quizzes — attachable to a course, module or lesson (exactly one scope).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quizzes (
  id                TEXT PRIMARY KEY,
  course_id         TEXT REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE,
  module_id         TEXT REFERENCES modules (id) ON DELETE CASCADE ON UPDATE CASCADE,
  lesson_id         TEXT REFERENCES lessons (id) ON DELETE CASCADE ON UPDATE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  pass_mark_percent INTEGER NOT NULL DEFAULT 70 CHECK (pass_mark_percent BETWEEN 1 AND 100),
  max_attempts      INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 50),
  time_limit_minutes INTEGER CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  shuffle_questions INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_questions IN (0, 1)),
  show_answers      TEXT NOT NULL DEFAULT 'after_submit' CHECK (show_answers IN (
                      'never', 'after_submit', 'after_pass')),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by        TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (CASE WHEN course_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN module_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN lesson_id IS NULL THEN 0 ELSE 1 END) = 1
  )
);

-- ---------------------------------------------------------------------------
-- quiz_questions / quiz_options — authoring data. `is_correct` must never be
-- serialised to a student before their attempt is submitted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_questions (
  id            TEXT PRIMARY KEY,
  quiz_id       TEXT NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE ON UPDATE CASCADE,
  question_type TEXT NOT NULL DEFAULT 'single_choice' CHECK (question_type IN (
                  'single_choice', 'multiple_choice', 'true_false', 'short_answer')),
  prompt        TEXT NOT NULL,
  explanation   TEXT,
  points        INTEGER NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 100),
  position      INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (quiz_id, position)
);

CREATE TABLE IF NOT EXISTS quiz_options (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES quiz_questions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  label       TEXT NOT NULL,
  is_correct  INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  position    INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- quiz_attempts — one row per attempt. Scoring is server-side only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id             TEXT PRIMARY KEY,
  quiz_id        TEXT NOT NULL REFERENCES quizzes (id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  enrollment_id  TEXT REFERENCES enrollments (id) ON DELETE SET NULL ON UPDATE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  status         TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
                   'in_progress', 'submitted', 'graded', 'expired', 'abandoned')),
  score_points   INTEGER NOT NULL DEFAULT 0 CHECK (score_points >= 0),
  max_points     INTEGER NOT NULL DEFAULT 0 CHECK (max_points >= 0),
  score_percent  INTEGER NOT NULL DEFAULT 0 CHECK (score_percent BETWEEN 0 AND 100),
  passed         INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  submitted_at   TEXT,
  graded_at      TEXT,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (quiz_id, user_id, attempt_number),
  CHECK (status NOT IN ('submitted', 'graded') OR submitted_at IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- quiz_answers — selected option ids are stored as JSON so a question may be
-- single- or multi-select without a second join table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_answers (
  id                  TEXT PRIMARY KEY,
  attempt_id          TEXT NOT NULL REFERENCES quiz_attempts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  question_id         TEXT NOT NULL REFERENCES quiz_questions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  selected_option_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_option_ids)),
  answer_text         TEXT,
  is_correct          INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  points_awarded      INTEGER NOT NULL DEFAULT 0 CHECK (points_awarded >= 0),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (attempt_id, question_id)
);

-- ---------------------------------------------------------------------------
-- assignments / assignment_submissions — written or file-based work review.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  id          TEXT PRIMARY KEY,
  course_id   TEXT REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE,
  module_id   TEXT REFERENCES modules (id) ON DELETE CASCADE ON UPDATE CASCADE,
  lesson_id   TEXT REFERENCES lessons (id) ON DELETE CASCADE ON UPDATE CASCADE,
  title       TEXT NOT NULL,
  instructions_md TEXT NOT NULL DEFAULT '',
  max_points  INTEGER NOT NULL DEFAULT 100 CHECK (max_points BETWEEN 1 AND 1000),
  pass_mark_percent INTEGER NOT NULL DEFAULT 60 CHECK (pass_mark_percent BETWEEN 1 AND 100),
  due_at      TEXT,
  allow_late  INTEGER NOT NULL DEFAULT 1 CHECK (allow_late IN (0, 1)),
  submission_type TEXT NOT NULL DEFAULT 'text' CHECK (submission_type IN ('text', 'file', 'link', 'mixed')),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (CASE WHEN course_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN module_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN lesson_id IS NULL THEN 0 ELSE 1 END) = 1
  )
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id              TEXT PRIMARY KEY,
  assignment_id   TEXT NOT NULL REFERENCES assignments (id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  enrollment_id   TEXT REFERENCES enrollments (id) ON DELETE SET NULL ON UPDATE CASCADE,
  attempt_number  INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  submission_text TEXT,
  link_url        TEXT,
  r2_key          TEXT,
  status          TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
                    'submitted', 'graded', 'returned', 'resubmit_requested')),
  score_points    INTEGER CHECK (score_points IS NULL OR score_points >= 0),
  feedback        TEXT,
  graded_by       TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  graded_at       TEXT,
  submitted_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (assignment_id, user_id, attempt_number),
  CHECK (submission_text IS NOT NULL OR link_url IS NOT NULL OR r2_key IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- certificates — issued automatically when a course completes. `verification_code`
-- is a short public code; `certificate_number` is the human-readable document id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificates (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  course_id          TEXT NOT NULL REFERENCES courses (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  enrollment_id      TEXT NOT NULL UNIQUE REFERENCES enrollments (id) ON DELETE CASCADE ON UPDATE CASCADE,
  certificate_number TEXT NOT NULL UNIQUE,
  verification_code  TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  grade              TEXT CHECK (grade IS NULL OR grade IN ('pass', 'merit', 'distinction')),
  final_score_percent INTEGER CHECK (final_score_percent IS NULL OR final_score_percent BETWEEN 0 AND 100),
  issued_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at         TEXT,
  revoked_at         TEXT,
  revoked_reason     TEXT,
  issued_by          TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, course_id)
);

-- ---------------------------------------------------------------------------
-- course_reviews — scaffolded for the post-MVP review feature. Published by an
-- administrator after moderation; rating drives the catalog's average rating.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_reviews (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title      TEXT,
  body       TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  moderated_by TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  moderated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user      ON enrollments (user_id, status, enrolled_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrollments_course    ON enrollments (course_id, status);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_enr   ON lesson_progress (enrollment_id, status);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_lesson ON lesson_progress (lesson_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_course        ON quizzes (course_id, status);
CREATE INDEX IF NOT EXISTS idx_quizzes_module        ON quizzes (module_id, status);
CREATE INDEX IF NOT EXISTS idx_quizzes_lesson        ON quizzes (lesson_id, status);
CREATE INDEX IF NOT EXISTS idx_questions_quiz        ON quiz_questions (quiz_id, position);
CREATE INDEX IF NOT EXISTS idx_options_question      ON quiz_options (question_id, position);
CREATE INDEX IF NOT EXISTS idx_attempts_quiz_user    ON quiz_attempts (quiz_id, user_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_user         ON quiz_attempts (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_answers_attempt       ON quiz_answers (attempt_id);
CREATE INDEX IF NOT EXISTS idx_assignments_course    ON assignments (course_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON assignment_submissions (assignment_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_user      ON assignment_submissions (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_certificates_user     ON certificates (user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_certificates_course   ON certificates (course_id);
CREATE INDEX IF NOT EXISTS idx_certificates_verify   ON certificates (verification_code);
CREATE INDEX IF NOT EXISTS idx_reviews_course        ON course_reviews (course_id, status, created_at DESC);
