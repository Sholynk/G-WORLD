-- ===========================================================================
-- G WORLD — Migration 0003: Domain C — Academic content
-- ---------------------------------------------------------------------------
-- departments -> subjects -> courses -> modules -> lessons -> videos/resources
-- Publication status is tracked at every level; students only ever see
-- published content, and the API enforces that (never the frontend).
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- departments — broad fields of study (Technology, Science, Arts, Business…).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  slug          TEXT NOT NULL UNIQUE,
  tagline       TEXT,
  description   TEXT,
  icon          TEXT,
  image_url     TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (slug GLOB '[a-z0-9]*' AND slug NOT LIKE '% %'),
  CHECK (length(name) BETWEEN 2 AND 120)
);

-- ---------------------------------------------------------------------------
-- subjects — a field within a department. Deleting a department is blocked
-- while subjects reference it (RESTRICT) so academic history stays intact.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id            TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES departments (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  icon          TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (department_id, name)
);

-- ---------------------------------------------------------------------------
-- skills — reusable competency vocabulary (e.g. "javascript", "data-analysis").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  category    TEXT,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- courses — the primary sellable/learnable unit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id                   TEXT PRIMARY KEY,
  subject_id           TEXT NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  title                TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  summary              TEXT,
  description          TEXT,
  learning_outcomes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(learning_outcomes_json)),
  prerequisites_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prerequisites_json)),
  difficulty           TEXT NOT NULL DEFAULT 'beginner' CHECK (difficulty IN (
                         'beginner', 'intermediate', 'advanced')),
  estimated_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
  thumbnail_url        TEXT,
  instructor_name      TEXT,
  instructor_bio       TEXT,
  language             TEXT NOT NULL DEFAULT 'en',
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_featured          INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  enrollment_open      INTEGER NOT NULL DEFAULT 1 CHECK (enrollment_open IN (0, 1)),
  certificate_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (certificate_enabled IN (0, 1)),
  published_at         TEXT,
  created_by           TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (length(title) BETWEEN 3 AND 180),
  CHECK (published_at IS NULL OR status <> 'draft')
);

-- ---------------------------------------------------------------------------
-- course_skills — many-to-many with the direction of the relationship:
--   kind='required' -> skills a learner should already have
--   kind='acquired' -> skills the course teaches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_skills (
  course_id TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE,
  skill_id  TEXT NOT NULL REFERENCES skills (id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind      TEXT NOT NULL DEFAULT 'acquired' CHECK (kind IN ('required', 'acquired')),
  weight    INTEGER NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 5),
  PRIMARY KEY (course_id, skill_id, kind)
);

-- ---------------------------------------------------------------------------
-- modules — ordered sections of a course.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modules (
  id          TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (course_id, position),
  CHECK (length(title) BETWEEN 2 AND 180)
);

-- ---------------------------------------------------------------------------
-- lessons — the smallest learnable unit inside a module.
-- `is_preview` marks lessons visitors may read without enrolling.
-- `completion_rule` tells the progress engine what "completed" means.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessons (
  id                TEXT PRIMARY KEY,
  module_id         TEXT NOT NULL REFERENCES modules (id) ON DELETE CASCADE ON UPDATE CASCADE,
  title             TEXT NOT NULL,
  slug              TEXT,
  content_md        TEXT NOT NULL DEFAULT '',
  objectives_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(objectives_json)),
  position          INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  estimated_minutes INTEGER NOT NULL DEFAULT 0 CHECK (estimated_minutes >= 0),
  is_preview        INTEGER NOT NULL DEFAULT 0 CHECK (is_preview IN (0, 1)),
  completion_rule   TEXT NOT NULL DEFAULT 'mark_complete' CHECK (completion_rule IN (
                      'view', 'mark_complete', 'quiz_pass')),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (module_id, position),
  CHECK (length(title) BETWEEN 2 AND 200)
);

-- ---------------------------------------------------------------------------
-- videos — embedded educational videos. Only whitelisted providers are stored,
-- and `provider_video_id` is validated at the API boundary, so a publisher
-- cannot inject arbitrary iframe sources.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videos (
  id                 TEXT PRIMARY KEY,
  lesson_id          TEXT NOT NULL REFERENCES lessons (id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider           TEXT NOT NULL DEFAULT 'youtube' CHECK (provider IN ('youtube')),
  provider_video_id  TEXT NOT NULL,
  title              TEXT,
  description        TEXT,
  thumbnail_url      TEXT,
  duration_seconds   INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  position           INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  is_primary         INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (lesson_id, provider, provider_video_id)
);

-- ---------------------------------------------------------------------------
-- resources — downloadable or external learning resources, attachable to a
-- lesson OR a course (exactly one of the two must be set). Files live in R2
-- under `r2_key`; external material uses `url`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resources (
  id           TEXT PRIMARY KEY,
  lesson_id    TEXT REFERENCES lessons (id) ON DELETE CASCADE ON UPDATE CASCADE,
  course_id    TEXT REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'link' CHECK (kind IN ('pdf', 'link', 'article', 'download', 'video')),
  url          TEXT,
  r2_key       TEXT,
  size_bytes   INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  is_public    INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  position     INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((lesson_id IS NOT NULL) <> (course_id IS NOT NULL)),
  CHECK (url IS NOT NULL OR r2_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_departments_status   ON departments (status, display_order);
CREATE INDEX IF NOT EXISTS idx_departments_slug     ON departments (slug);
CREATE INDEX IF NOT EXISTS idx_subjects_department  ON subjects (department_id, status, display_order);
CREATE INDEX IF NOT EXISTS idx_subjects_slug        ON subjects (slug);
CREATE INDEX IF NOT EXISTS idx_courses_subject      ON courses (subject_id, status);
CREATE INDEX IF NOT EXISTS idx_courses_status       ON courses (status, is_featured, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_slug         ON courses (slug);
CREATE INDEX IF NOT EXISTS idx_courses_difficulty   ON courses (difficulty);
CREATE INDEX IF NOT EXISTS idx_course_skills_skill  ON course_skills (skill_id, kind);
CREATE INDEX IF NOT EXISTS idx_modules_course       ON modules (course_id, position);
CREATE INDEX IF NOT EXISTS idx_lessons_module       ON lessons (module_id, position);
CREATE INDEX IF NOT EXISTS idx_lessons_status       ON lessons (status, is_preview);
CREATE INDEX IF NOT EXISTS idx_videos_lesson        ON videos (lesson_id, position);
CREATE INDEX IF NOT EXISTS idx_resources_lesson     ON resources (lesson_id, position);
CREATE INDEX IF NOT EXISTS idx_resources_course     ON resources (course_id, position);
