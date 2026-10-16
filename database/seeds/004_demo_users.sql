-- ===========================================================================
-- G WORLD — Seed 004: development accounts and activity
-- ---------------------------------------------------------------------------
-- ⚠ DEVELOPMENT ONLY — these passwords are public knowledge in this repository.
--    Never apply this file to a production database.
--
--   super administrator : admin@gworld.test   / AdminPassword123!
--   administrator       : staff@gworld.test   / StaffPassword123!
--   student (verified)  : student@gworld.test / StudentPassword123!
--   student (pending)   : pending@gworld.test / StudentPassword123!
--
-- Hashes are PBKDF2-HMAC-SHA256 with 10 000 iterations, matching the
-- PASSWORD_ITERATIONS used by the development environment in wrangler.jsonc.
-- On a production deployment the server transparently re-hashes each of these
-- to the configured strength at first sign-in — but they would still be
-- guessable, which is exactly why this file must never reach production.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, email, password_hash, role_id, status, email_verified_at, last_login_at, terms_accepted_at) VALUES
  ('usr_demo_superadmin', 'admin@gworld.test',
   'pbkdf2$sha256$10000$HY92OxLAUbcQvraI4JWOqw==$2iPtOeRHQgdKpYbjTTWFMo4YH4htmOwoC0HEKxAx7bo=',
   'role_super_admin', 'active', '2026-02-01T08:00:00.000Z', '2026-09-28T07:12:00.000Z', '2026-02-01T08:00:00.000Z'),

  ('usr_demo_admin', 'staff@gworld.test',
   'pbkdf2$sha256$10000$QL2XsnKWRqIiYciU45mSVQ==$zAzGt22aLyssOCzPVT3Dm58zeNarqA0X75kROTlKR6Q=',
   'role_admin', 'active', '2026-02-02T08:00:00.000Z', '2026-09-27T15:40:00.000Z', '2026-02-02T08:00:00.000Z'),

  ('usr_demo_student', 'student@gworld.test',
   'pbkdf2$sha256$10000$sSXzWoQwfQ8LhYHNFEDjWg==$8ENqW6UrsdzfyU6UUu+vLLG8A1W975otR7ABuyU6zYs=',
   'role_student', 'active', '2026-02-10T09:00:00.000Z', '2026-10-14T19:22:00.000Z', '2026-02-10T09:00:00.000Z'),

  ('usr_demo_pending', 'pending@gworld.test',
   'pbkdf2$sha256$10000$sSXzWoQwfQ8LhYHNFEDjWg==$8ENqW6UrsdzfyU6UUu+vLLG8A1W975otR7ABuyU6zYs=',
   'role_student', 'pending_verification', NULL, NULL, '2026-09-20T10:00:00.000Z'),

  ('usr_demo_amara', 'amara@gworld.test',
   'pbkdf2$sha256$10000$sSXzWoQwfQ8LhYHNFEDjWg==$8ENqW6UrsdzfyU6UUu+vLLG8A1W975otR7ABuyU6zYs=',
   'role_student', 'active', '2026-03-01T11:00:00.000Z', '2026-10-01T08:30:00.000Z', '2026-03-01T11:00:00.000Z'),

  ('usr_demo_kwame', 'kwame@gworld.test',
   'pbkdf2$sha256$10000$sSXzWoQwfQ8LhYHNFEDjWg==$8ENqW6UrsdzfyU6UUu+vLLG8A1W975otR7ABuyU6zYs=',
   'role_student', 'active', '2026-03-14T11:00:00.000Z', '2026-09-30T12:05:00.000Z', '2026-03-14T11:00:00.000Z'),

  ('usr_demo_zainab', 'zainab@gworld.test',
   'pbkdf2$sha256$10000$sSXzWoQwfQ8LhYHNFEDjWg==$8ENqW6UrsdzfyU6UUu+vLLG8A1W975otR7ABuyU6zYs=',
   'role_student', 'suspended', '2026-04-02T11:00:00.000Z', '2026-08-11T09:15:00.000Z', '2026-04-02T11:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO student_profiles (user_id, student_number, display_name, full_name, education_level, country, timezone, interests_json, goals) VALUES
  ('usr_demo_superadmin', NULL, 'Platform Owner', 'G WORLD Administrator', 'professional', 'NG', 'Africa/Lagos', '["platform operations","security"]', 'Keep G WORLD running smoothly.'),
  ('usr_demo_admin', NULL, 'Academic Office', 'Academic Administrator', 'professional', 'NG', 'Africa/Lagos', '["curriculum","assessment"]', 'Grow the catalogue and support learners.'),
  ('usr_demo_student', 'GW-2026-A1B2C3', 'Test Student', 'Test Student', 'undergraduate', 'NG', 'Africa/Lagos', '["web-development","data-and-ai"]', 'Become a frontend developer within a year.'),
  ('usr_demo_pending', 'GW-2026-D4E5F6', 'Unverified Learner', NULL, 'secondary', 'GH', 'Africa/Accra', '["science"]', 'Explore what to study.'),
  ('usr_demo_amara', 'GW-2026-G7H8J9', 'Amara N.', 'Amara Nwachukwu', 'graduate', 'NG', 'Africa/Lagos', '["data-and-ai","business-and-finance"]', 'Move into data analytics.'),
  ('usr_demo_kwame', 'GW-2026-K1L2M3', 'Kwame A.', 'Kwame Asante', 'undergraduate', 'GH', 'Africa/Accra', '["web-development"]', 'Build a portfolio.'),
  ('usr_demo_zainab', 'GW-2026-N4P5Q6', 'Zainab I.', 'Zainab Ibrahim', 'secondary', 'NG', 'Africa/Lagos', '["arts-and-design"]', 'Learn design fundamentals.');

-- ---------------------------------------------------------------------------
-- Enrollments + progress (so the dashboards and analytics screens have data)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO enrollments (id, user_id, course_id, status, progress_percent, lessons_completed, total_lessons, last_lesson_id, enrolled_at, last_activity_at, completed_at) VALUES
  -- Test student: one finished course, one in progress
  ('enr_demo_1', 'usr_demo_student', 'crs_html_css', 'completed', 100, 5, 5, 'lsn_hc_3_2',
   '2026-03-05T09:00:00.000Z', '2026-03-20T18:00:00.000Z', '2026-03-20T18:00:00.000Z'),
  ('enr_demo_2', 'usr_demo_student', 'crs_js_fundamentals', 'active', 50, 3, 6, 'lsn_js_2_1',
   '2026-04-01T09:00:00.000Z', '2026-10-14T19:20:00.000Z', NULL),

  -- Amara: two active, one completed
  ('enr_demo_3', 'usr_demo_amara', 'crs_data_basics', 'active', 50, 1, 2, 'lsn_data_2_1',
   '2026-05-02T09:00:00.000Z', '2026-10-01T08:30:00.000Z', NULL),
  ('enr_demo_4', 'usr_demo_amara', 'crs_start_business', 'active', 0, 0, 1, NULL,
   '2026-08-14T09:00:00.000Z', '2026-08-14T09:05:00.000Z', NULL),
  ('enr_demo_5', 'usr_demo_amara', 'crs_html_css', 'completed', 100, 5, 5, 'lsn_hc_3_2',
   '2026-04-10T09:00:00.000Z', '2026-05-30T16:00:00.000Z', '2026-05-30T16:00:00.000Z'),

  -- Kwame: in progress
  ('enr_demo_6', 'usr_demo_kwame', 'crs_js_fundamentals', 'active', 33, 2, 6, 'lsn_js_1_1',
   '2026-06-01T09:00:00.000Z', '2026-09-30T12:05:00.000Z', NULL);

INSERT OR IGNORE INTO lesson_progress (id, enrollment_id, lesson_id, status, seconds_spent, last_viewed_at, completed_at) VALUES
  ('lpr_demo_1', 'enr_demo_1', 'lsn_hc_1_1', 'completed', 900, '2026-03-06T10:00:00.000Z', '2026-03-06T10:00:00.000Z'),
  ('lpr_demo_2', 'enr_demo_1', 'lsn_hc_1_2', 'completed', 1200, '2026-03-08T10:00:00.000Z', '2026-03-08T10:00:00.000Z'),
  ('lpr_demo_3', 'enr_demo_1', 'lsn_hc_2_1', 'completed', 1500, '2026-03-12T10:00:00.000Z', '2026-03-12T10:00:00.000Z'),
  ('lpr_demo_4', 'enr_demo_1', 'lsn_hc_3_1', 'completed', 1800, '2026-03-17T10:00:00.000Z', '2026-03-17T10:00:00.000Z'),
  ('lpr_demo_5', 'enr_demo_1', 'lsn_hc_3_2', 'completed', 1100, '2026-03-20T18:00:00.000Z', '2026-03-20T18:00:00.000Z'),

  ('lpr_demo_6', 'enr_demo_2', 'lsn_js_1_1', 'completed', 1000, '2026-04-02T10:00:00.000Z', '2026-04-02T10:00:00.000Z'),
  ('lpr_demo_7', 'enr_demo_2', 'lsn_js_1_2', 'completed', 1400, '2026-04-09T10:00:00.000Z', '2026-04-09T10:00:00.000Z'),
  ('lpr_demo_8', 'enr_demo_2', 'lsn_js_2_1', 'completed', 1300, '2026-04-16T10:00:00.000Z', '2026-04-16T10:00:00.000Z'),
  ('lpr_demo_9', 'enr_demo_2', 'lsn_js_2_2', 'in_progress', 600, '2026-10-14T19:20:00.000Z', NULL),

  ('lpr_demo_10', 'enr_demo_3', 'lsn_data_1_1', 'completed', 1700, '2026-05-03T10:00:00.000Z', '2026-05-03T10:00:00.000Z'),
  ('lpr_demo_11', 'enr_demo_3', 'lsn_data_2_1', 'in_progress', 400, '2026-10-01T08:30:00.000Z', NULL),

  ('lpr_demo_12', 'enr_demo_5', 'lsn_hc_1_1', 'completed', 800, '2026-04-11T10:00:00.000Z', '2026-04-11T10:00:00.000Z'),
  ('lpr_demo_13', 'enr_demo_5', 'lsn_hc_1_2', 'completed', 950, '2026-04-13T10:00:00.000Z', '2026-04-13T10:00:00.000Z'),
  ('lpr_demo_14', 'enr_demo_5', 'lsn_hc_2_1', 'completed', 1250, '2026-04-20T10:00:00.000Z', '2026-04-20T10:00:00.000Z'),
  ('lpr_demo_15', 'enr_demo_5', 'lsn_hc_3_1', 'completed', 1400, '2026-05-25T10:00:00.000Z', '2026-05-25T10:00:00.000Z'),
  ('lpr_demo_16', 'enr_demo_5', 'lsn_hc_3_2', 'completed', 1000, '2026-05-30T16:00:00.000Z', '2026-05-30T16:00:00.000Z'),

  ('lpr_demo_17', 'enr_demo_6', 'lsn_js_1_1', 'completed', 1100, '2026-06-02T10:00:00.000Z', '2026-06-02T10:00:00.000Z'),
  ('lpr_demo_18', 'enr_demo_6', 'lsn_js_1_2', 'completed', 1600, '2026-06-10T10:00:00.000Z', '2026-06-10T10:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Quiz attempts + a graded assignment submission
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO quiz_attempts (id, quiz_id, user_id, enrollment_id, attempt_number, status, score_points, max_points, score_percent, passed, started_at, submitted_at, graded_at, time_spent_seconds) VALUES
  ('qa_demo_1', 'qz_hc_final', 'usr_demo_student', 'enr_demo_1', 1, 'graded', 6, 6, 100, 1,
   '2026-03-20T17:00:00.000Z', '2026-03-20T17:12:00.000Z', '2026-03-20T17:12:00.000Z', 720),
  ('qa_demo_2', 'qz_hc_final', 'usr_demo_amara', 'enr_demo_5', 1, 'graded', 4, 6, 67, 0,
   '2026-05-30T13:00:00.000Z', '2026-05-30T13:08:00.000Z', '2026-05-30T13:08:00.000Z', 480),
  ('qa_demo_2b', 'qz_hc_final', 'usr_demo_amara', 'enr_demo_5', 2, 'graded', 6, 6, 100, 1,
   '2026-05-30T15:00:00.000Z', '2026-05-30T15:09:00.000Z', '2026-05-30T15:09:00.000Z', 540),
  ('qa_demo_3', 'qz_data_final', 'usr_demo_amara', 'enr_demo_3', 1, 'graded', 1, 2, 50, 0,
   '2026-09-20T10:00:00.000Z', '2026-09-20T10:06:00.000Z', '2026-09-20T10:06:00.000Z', 360);

INSERT OR IGNORE INTO quiz_answers (id, attempt_id, question_id, selected_option_ids, is_correct, points_awarded) VALUES
  ('qan_demo_1', 'qa_demo_1', 'qq_hc_1', '["qo_hc_1a"]', 1, 1),
  ('qan_demo_2', 'qa_demo_1', 'qq_hc_2', '["qo_hc_2a","qo_hc_2b"]', 1, 2),
  ('qan_demo_3', 'qa_demo_1', 'qq_hc_3', '["qo_hc_3a"]', 1, 1),
  ('qan_demo_4', 'qa_demo_1', 'qq_hc_4', '[]', 1, 2),
  ('qan_demo_5', 'qa_demo_2', 'qq_hc_1', '["qo_hc_1a"]', 1, 1),
  ('qan_demo_6', 'qa_demo_2', 'qq_hc_2', '["qo_hc_2a","qo_hc_2c"]', 0, 0),
  ('qan_demo_7', 'qa_demo_2', 'qq_hc_3', '["qo_hc_3a"]', 1, 1),
  ('qan_demo_8', 'qa_demo_2', 'qq_hc_4', '[]', 1, 2),
  ('qan_demo_9', 'qa_demo_3', 'qq_data_1', '["qo_data_1b"]', 0, 0),
  ('qan_demo_10', 'qa_demo_3', 'qq_data_2', '["qo_data_2b"]', 1, 1),
  ('qan_demo_11', 'qa_demo_2b', 'qq_hc_1', '["qo_hc_1a"]', 1, 1),
  ('qan_demo_12', 'qa_demo_2b', 'qq_hc_2', '["qo_hc_2a","qo_hc_2b"]', 1, 2),
  ('qan_demo_13', 'qa_demo_2b', 'qq_hc_3', '["qo_hc_3a"]', 1, 1),
  ('qan_demo_14', 'qa_demo_2b', 'qq_hc_4', '[]', 1, 2);

INSERT OR IGNORE INTO assignment_submissions (id, assignment_id, user_id, enrollment_id, attempt_number, submission_text, status, score_points, feedback, graded_by, graded_at, submitted_at) VALUES
  ('asb_demo_1', 'asg_hc_project', 'usr_demo_student', 'enr_demo_1', 1,
   'Built the card grid with CSS Grid and repeat(auto-fit, minmax(280px, 1fr)). Focus states use :focus-visible with a 2px outline. Repository link in the submission field.',
   'graded', 88, 'Strong, semantic markup and a genuinely responsive grid. Next time check the contrast of the muted caption text — it is close to the 4.5:1 limit.',
   'usr_demo_admin', '2026-04-02T09:00:00.000Z', '2026-03-28T14:20:00.000Z');

-- ---------------------------------------------------------------------------
-- Certificates + QR identity codes
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO certificates (id, user_id, course_id, enrollment_id, certificate_number, verification_code, title, grade, final_score_percent, issued_at, issued_by) VALUES
  ('cert_demo_1', 'usr_demo_student', 'crs_html_css', 'enr_demo_1', 'GW-CERT-2026-A1B2C3', 'XK4T-9QW2-M7PL',
   'Certificate of Completion — HTML & CSS Foundations', 'distinction', 100, '2026-03-20T18:01:00.000Z', NULL),
  ('cert_demo_2', 'usr_demo_amara', 'crs_html_css', 'enr_demo_5', 'GW-CERT-2026-G7H8J9', 'B3NV-6RTY-2QKD',
   'Certificate of Completion — HTML & CSS Foundations', 'distinction', 100, '2026-05-30T16:01:00.000Z', NULL);

INSERT OR IGNORE INTO qr_codes (id, user_id, code, kind, certificate_id, payload_url, scan_count, expires_at) VALUES
  ('qr_demo_1', 'usr_demo_student', 'GW-STUDENT-AB12CD34EF', 'student_id', NULL,
   'http://localhost:5173/verify.html?code=GW-STUDENT-AB12CD34EF', 3, '2028-03-20T18:00:00.000Z'),
  ('qr_demo_2', 'usr_demo_student', 'GW-CERT-XY98ZW76VU', 'certificate', 'cert_demo_1',
   'http://localhost:5173/verify.html?code=XK4T-9QW2-M7PL', 1, NULL),
  ('qr_demo_3', 'usr_demo_amara', 'GW-STUDENT-GH56JK78LM', 'student_id', NULL,
   'http://localhost:5173/verify.html?code=GW-STUDENT-GH56JK78LM', 0, '2028-05-30T16:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO notifications (id, user_id, type, title, body, link_url, read_at, created_at) VALUES
  ('ntf_demo_1', 'usr_demo_student', 'certificate', 'Certificate issued',
   'Your certificate for “HTML & CSS Foundations” is ready.', '/certificates.html', '2026-03-21T08:00:00.000Z', '2026-03-20T18:01:00.000Z'),
  ('ntf_demo_2', 'usr_demo_student', 'assessment', 'Submission graded',
   'Your “Build a responsive course card” submission scored 88/100.', '/my-courses.html', NULL, '2026-04-02T09:00:00.000Z'),
  ('ntf_demo_3', 'usr_demo_student', 'info', 'Keep going — JavaScript Fundamentals',
   'You are 50% of the way through. Your next lesson is waiting.', '/my-courses.html', NULL, '2026-10-14T19:25:00.000Z'),
  ('ntf_demo_4', 'usr_demo_kwame', 'info', 'Welcome to G WORLD',
   'Confirm your email address to activate your account.', '/dashboard.html', '2026-06-01T09:10:00.000Z', '2026-06-01T09:00:00.000Z');

-- ---------------------------------------------------------------------------
-- Audit trail (so the audit screen is not empty in development)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO audit_logs (id, actor_user_id, actor_role, action, entity_type, entity_id, description, metadata_json, status, created_at) VALUES
  ('aud_demo_1', 'usr_demo_superadmin', 'super_admin', 'system.migration.applied', 'system', NULL,
   'Applied migration 0007_reference_data (roles, permissions, role grants).', '{"roles":4,"permissions":24}', 'success', '2026-01-01T00:00:00.000Z'),
  ('aud_demo_2', 'usr_demo_admin', 'admin', 'course.published', 'course', 'crs_html_css',
   'Published course “HTML & CSS Foundations”', '{"status":"published"}', 'success', '2026-03-04T09:00:00.000Z'),
  ('aud_demo_3', 'usr_demo_admin', 'admin', 'course.published', 'course', 'crs_js_fundamentals',
   'Published course “JavaScript Fundamentals”', '{"status":"published"}', 'success', '2026-03-18T09:00:00.000Z'),
  ('aud_demo_4', 'usr_demo_admin', 'admin', 'assignment.graded', 'assignment_submission', 'asb_demo_1',
   'Graded submission from student@gworld.test', '{"score_points":88,"max_points":100,"passed":true}', 'success', '2026-04-02T09:00:00.000Z'),
  ('aud_demo_5', NULL, NULL, 'auth.login.failed', 'user', 'usr_demo_student',
   'Incorrect password', '{"attempts":1,"locked":false}', 'failure', '2026-10-10T22:14:00.000Z');
