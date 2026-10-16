-- ===========================================================================
-- G WORLD — Seed 003: demo assessments (quizzes, questions, assignments)
-- ---------------------------------------------------------------------------
-- DEVELOPMENT ONLY. Applied by: npm run db:seed:local
--
-- Question correctness flags are stored in the database and are never sent to a
-- learner before their attempt is graded (see db/repositories/quizzes.ts).
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Quizzes
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO quizzes (id, course_id, module_id, lesson_id, title, description, pass_mark_percent, max_attempts, time_limit_minutes, show_answers, status) VALUES
  ('qz_hc_final', 'crs_html_css', NULL, NULL, 'HTML & CSS Foundations — final quiz',
   'Ten minutes, four questions. You need 70% to pass and unlock your certificate.', 70, 3, 10, 'after_submit', 'published'),

  ('qz_js_fetch', NULL, NULL, 'lsn_js_3_1', 'Checkpoint: fetching data',
   'Complete this quiz with 60% or more to finish the lesson.', 60, 5, NULL, 'after_submit', 'published'),

  ('qz_data_final', 'crs_data_basics', NULL, NULL, 'Data Analysis Foundations — final quiz',
   'Covers data hygiene and honest summarising.', 75, 2, 15, 'after_pass', 'published'),

  ('qz_sec_final', 'crs_security_essentials', NULL, NULL, 'Security Essentials — final quiz',
   'Authentication and access control.', 70, 3, 10, 'after_submit', 'draft');

-- ---------------------------------------------------------------------------
-- Questions + options
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO quiz_questions (id, quiz_id, question_type, prompt, explanation, points, position) VALUES
  ('qq_hc_1', 'qz_hc_final', 'single_choice', 'Which element describes the page''s main heading?', 'Exactly one <h1> per page keeps the outline clear for assistive technology.', 1, 0),
  ('qq_hc_2', 'qz_hc_final', 'multiple_choice', 'Which of these are CSS layout systems?', 'Flexbox handles one axis; Grid handles two. Neither is "better" — they solve different problems.', 2, 1),
  ('qq_hc_3', 'qz_hc_final', 'true_false', 'Setting lang="en" on <html> helps screen readers pronounce content correctly.', 'The language attribute selects pronunciation rules and translation behaviour.', 1, 2),
  ('qq_hc_4', 'qz_hc_final', 'short_answer', 'Which CSS property makes padding count inside an element''s declared width?', 'box-sizing: border-box is the setting almost every modern stylesheet resets to.', 2, 3),

  ('qq_js_1', 'qz_js_fetch', 'single_choice', 'What should you check before calling response.json()?', 'A failed response still has a body — it is usually an error message, not your data.', 1, 0),
  ('qq_js_2', 'qz_js_fetch', 'multiple_choice', 'Which HTTP methods are safe to retry without changing server state?', 'GET and HEAD are safe and idempotent. Retrying a POST blindly can duplicate work.', 2, 1),

  ('qq_data_1', 'qz_data_final', 'single_choice', 'Nine people earn ₦50,000 and one earns ₦5,000,000. Which summary describes the group best?', 'A skewed distribution is better described by the median.', 1, 0),
  ('qq_data_2', 'qz_data_final', 'true_false', 'Storing dates as text like "12/03/2026" is safe because everyone reads it the same way.', 'Ambiguous date formats break sorting and mean different things in different countries.', 1, 1),

  ('qq_sec_1', 'qz_sec_final', 'single_choice', 'How should a session token be stored server-side?', 'Hashing the token means a database leak cannot be replayed as a session.', 1, 0),
  ('qq_sec_2', 'qz_sec_final', 'multiple_choice', 'Which cookie flags should a session cookie carry?', 'HttpOnly blocks script access, Secure keeps it on TLS, SameSite limits cross-site sending.', 2, 1);

INSERT OR IGNORE INTO quiz_options (id, question_id, label, is_correct, position) VALUES
  ('qo_hc_1a', 'qq_hc_1', '<h1>', 1, 0),
  ('qo_hc_1b', 'qq_hc_1', '<heading>', 0, 1),
  ('qo_hc_1c', 'qq_hc_1', '<title>', 0, 2),
  ('qo_hc_1d', 'qq_hc_1', '<header>', 0, 3),

  ('qo_hc_2a', 'qq_hc_2', 'Flexbox', 1, 0),
  ('qo_hc_2b', 'qq_hc_2', 'Grid', 1, 1),
  ('qo_hc_2c', 'qq_hc_2', 'Floats', 0, 2),
  ('qo_hc_2d', 'qq_hc_2', 'Tables', 0, 3),

  ('qo_hc_3a', 'qq_hc_3', 'True', 1, 0),
  ('qo_hc_3b', 'qq_hc_3', 'False', 0, 1),

  ('qo_hc_4a', 'qq_hc_4', 'box-sizing', 1, 0),
  ('qo_hc_4b', 'qq_hc_4', 'display', 0, 1),
  ('qo_hc_4c', 'qq_hc_4', 'overflow', 0, 2),

  ('qo_js_1a', 'qq_js_1', 'response.ok', 1, 0),
  ('qo_js_1b', 'qq_js_1', 'document.readyState', 0, 1),
  ('qo_js_1c', 'qq_js_1', 'Nothing — json() always works', 0, 2),

  ('qo_js_2a', 'qq_js_2', 'GET', 1, 0),
  ('qo_js_2b', 'qq_js_2', 'HEAD', 1, 1),
  ('qo_js_2c', 'qq_js_2', 'POST', 0, 2),
  ('qo_js_2d', 'qq_js_2', 'DELETE', 0, 3),

  ('qo_data_1a', 'qq_data_1', 'The median (₦50,000)', 1, 0),
  ('qo_data_1b', 'qq_data_1', 'The mean (₦545,000)', 0, 1),
  ('qo_data_1c', 'qq_data_1', 'The mode of the emails', 0, 2),

  ('qo_data_2a', 'qq_data_2', 'True', 0, 0),
  ('qo_data_2b', 'qq_data_2', 'False', 1, 1),

  ('qo_sec_1a', 'qq_sec_1', 'As a hash of the token', 1, 0),
  ('qo_sec_1b', 'qq_sec_1', 'As plain text so it can be compared quickly', 0, 1),
  ('qo_sec_1c', 'qq_sec_1', 'In the same row as the password hash', 0, 2),

  ('qo_sec_2a', 'qq_sec_2', 'HttpOnly', 1, 0),
  ('qo_sec_2b', 'qq_sec_2', 'Secure', 1, 1),
  ('qo_sec_2c', 'qq_sec_2', 'SameSite', 1, 2),
  ('qo_sec_2d', 'qq_sec_2', 'Cache-Control: no-store on the HTML', 0, 3);

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO assignments (id, course_id, module_id, lesson_id, title, instructions_md, max_points, pass_mark_percent, due_at, allow_late, submission_type, status) VALUES
  ('asg_hc_project', 'crs_html_css', NULL, NULL, 'Build a responsive course card',
   '## Brief

Build a single page displaying three course cards that:

1. use semantic HTML (`<article>` for each card)
2. lay out with CSS Grid and reflow to one column below 640px
3. pass a keyboard tab-through with visible focus
4. include an `<h1>` and one heading level below it only

### What to submit

Paste your HTML and CSS in the box below, or link to a public repository. You will get written feedback within three working days.',
   100, 60, '2027-01-15T23:59:00.000Z', 1, 'mixed', 'published'),

  ('asg_js_quiz_app', 'crs_js_fundamentals', NULL, NULL, 'Write a five-question practice app',
   '## Brief

Build a small page that asks five questions, tracks the score and shows a final message. No frameworks — HTML, CSS and JavaScript only.

Explain in two or three sentences what you would change if you had another week.',
   100, 60, '2027-02-01T23:59:00.000Z', 1, 'mixed', 'published'),

  ('asg_data_brief', 'crs_data_basics', NULL, NULL, 'One-page findings brief',
   'Take any public dataset you find interesting, ask one question of it, and write a one-page brief: the question, the method, one chart, and what you would caution the reader about.',
   50, 70, '2027-02-20T23:59:00.000Z', 0, 'text', 'published');
