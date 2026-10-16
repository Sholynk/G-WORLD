-- ===========================================================================
-- G WORLD — Migration 0005: Triggers and supporting indexes
-- ---------------------------------------------------------------------------
-- SQLite has no ON UPDATE CURRENT_TIMESTAMP, so `updated_at` is maintained by
-- AFTER UPDATE triggers. Because each trigger only fires when a column other
-- than updated_at changed, the trigger's own UPDATE does not recurse.
--
-- Triggers are intentionally limited to timestamp bookkeeping: business rules
-- (progress, certificates, audit logging) live in application code where they
-- are unit-tested and can be audited per request.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_roles_updated_at
AFTER UPDATE ON roles FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE roles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_permissions_updated_at
AFTER UPDATE ON permissions FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE permissions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_student_profiles_updated_at
AFTER UPDATE ON student_profiles FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE student_profiles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = NEW.user_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_qr_codes_updated_at
AFTER UPDATE ON qr_codes FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE qr_codes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_email_messages_updated_at
AFTER UPDATE ON email_messages FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE email_messages SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_departments_updated_at
AFTER UPDATE ON departments FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE departments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_subjects_updated_at
AFTER UPDATE ON subjects FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE subjects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_courses_updated_at
AFTER UPDATE ON courses FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE courses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_modules_updated_at
AFTER UPDATE ON modules FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE modules SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_lessons_updated_at
AFTER UPDATE ON lessons FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE lessons SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_videos_updated_at
AFTER UPDATE ON videos FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE videos SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_resources_updated_at
AFTER UPDATE ON resources FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE resources SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_enrollments_updated_at
AFTER UPDATE ON enrollments FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE enrollments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_lesson_progress_updated_at
AFTER UPDATE ON lesson_progress FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE lesson_progress SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_quizzes_updated_at
AFTER UPDATE ON quizzes FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE quizzes SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_questions_updated_at
AFTER UPDATE ON quiz_questions FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE quiz_questions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_attempts_updated_at
AFTER UPDATE ON quiz_attempts FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE quiz_attempts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_submissions_updated_at
AFTER UPDATE ON assignment_submissions FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE assignment_submissions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_certificates_updated_at
AFTER UPDATE ON certificates FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE certificates SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_course_reviews_updated_at
AFTER UPDATE ON course_reviews FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE course_reviews SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_assignments_updated_at
AFTER UPDATE ON assignments FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE assignments SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- Referential-integrity guards.
-- `qr_codes.certificate_id` cannot carry a FOREIGN KEY inside its CREATE TABLE
-- because certificates are created in a later migration than qr_codes, so the
-- relationship is enforced with triggers instead (both tables exist by now).
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_qr_certificate_insert
BEFORE INSERT ON qr_codes FOR EACH ROW
WHEN NEW.certificate_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.id = NEW.certificate_id)
BEGIN
  SELECT RAISE(ABORT, 'qr_codes.certificate_id must reference an existing certificate');
END;

CREATE TRIGGER IF NOT EXISTS trg_qr_certificate_update
BEFORE UPDATE OF certificate_id ON qr_codes FOR EACH ROW
WHEN NEW.certificate_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.id = NEW.certificate_id)
BEGIN
  SELECT RAISE(ABORT, 'qr_codes.certificate_id must reference an existing certificate');
END;

-- ---------------------------------------------------------------------------
-- Additional supporting indexes discovered while writing the query layer.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_lock           ON users (locked_until);
CREATE INDEX IF NOT EXISTS idx_sessions_active      ON user_sessions (user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_user  ON email_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_language     ON courses (language, status);
CREATE INDEX IF NOT EXISTS idx_modules_status       ON modules (status);
CREATE INDEX IF NOT EXISTS idx_lessons_module_status ON lessons (module_id, status);
CREATE INDEX IF NOT EXISTS idx_qr_kind_code         ON qr_codes (kind, code);
CREATE INDEX IF NOT EXISTS idx_cert_grade           ON certificates (grade);
