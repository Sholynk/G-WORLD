/**
 * Repository — quizzes, questions, options and attempts.
 *
 * Security-relevant rule implemented here: `listQuestionsForStudent()` never
 * selects `is_correct`, so correctness flags cannot leak into a page load or an
 * API response, even if a route forgets to strip them. Only
 * `listQuestionsWithAnswers()` — used by the grader and by administrators — sees
 * the answer key.
 */
import type { Db } from '../client.js';
import type { AttemptStatus, PublicationStatus, QuestionType } from '@g-world/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface QuizRow {
  id: string;
  course_id: string | null;
  module_id: string | null;
  lesson_id: string | null;
  title: string;
  description: string | null;
  pass_mark_percent: number;
  max_attempts: number;
  time_limit_minutes: number | null;
  shuffle_questions: number;
  show_answers: 'never' | 'after_submit' | 'after_pass';
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
}

export interface QuestionRow {
  id: string;
  quiz_id: string;
  question_type: QuestionType;
  prompt: string;
  explanation: string | null;
  points: number;
  position: number;
}

export interface OptionRow {
  id: string;
  question_id: string;
  label: string;
  is_correct: number;
  position: number;
}

export interface QuestionWithOptions extends QuestionRow {
  options: OptionRow[];
}

export interface AttemptRow {
  id: string;
  quiz_id: string;
  user_id: string;
  enrollment_id: string | null;
  attempt_number: number;
  status: AttemptStatus;
  score_points: number;
  max_points: number;
  score_percent: number;
  passed: number;
  started_at: string;
  submitted_at: string | null;
  graded_at: string | null;
  time_spent_seconds: number;
}

export interface AttemptDetailRow extends AttemptRow {
  quiz_title: string;
  pass_mark_percent: number;
  max_attempts: number;
  course_id: string | null;
  course_title: string | null;
  user_email: string;
  student_number: string | null;
  student_name: string | null;
}

const ATTEMPT_DETAIL_SELECT = `
  SELECT qa.id, qa.quiz_id, qa.user_id, qa.enrollment_id, qa.attempt_number, qa.status,
         qa.score_points, qa.max_points, qa.score_percent, qa.passed, qa.started_at,
         qa.submitted_at, qa.graded_at, qa.time_spent_seconds,
         q.title AS quiz_title, q.pass_mark_percent, q.max_attempts,
         q.course_id AS course_id, c.title AS course_title,
         u.email AS user_email, sp.student_number AS student_number,
         COALESCE(sp.display_name, sp.full_name) AS student_name
    FROM quiz_attempts qa
    JOIN quizzes q ON q.id = qa.quiz_id
    JOIN users u ON u.id = qa.user_id
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN courses c ON c.id = q.course_id`;

/* ------------------------------------------------------------------------- */
/* Quiz authoring                                                             */
/* ------------------------------------------------------------------------- */

export async function findQuizById(db: Db, id: string): Promise<QuizRow | null> {
  return db.first<QuizRow>(
    `SELECT id, course_id, module_id, lesson_id, title, description, pass_mark_percent, max_attempts,
            time_limit_minutes, shuffle_questions, show_answers, status, created_at, updated_at
       FROM quizzes WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function listQuizzesForCourse(
  db: Db,
  courseId: string,
  publishedOnly = false,
): Promise<(QuizRow & { question_count: number })[]> {
  const statusClause = publishedOnly ? `AND q.status = 'published'` : '';
  return db.all<QuizRow & { question_count: number }>(
    `SELECT q.id, q.course_id, q.module_id, q.lesson_id, q.title, q.description, q.pass_mark_percent,
            q.max_attempts, q.time_limit_minutes, q.shuffle_questions, q.show_answers, q.status,
            q.created_at, q.updated_at,
            (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count
       FROM quizzes q
      WHERE q.course_id = ? ${statusClause}
      ORDER BY q.created_at ASC`,
    [courseId],
  );
}

export async function listQuizzesForLesson(db: Db, lessonId: string): Promise<QuizRow[]> {
  return db.all<QuizRow>(
    `SELECT id, course_id, module_id, lesson_id, title, description, pass_mark_percent, max_attempts,
            time_limit_minutes, shuffle_questions, show_answers, status, created_at, updated_at
       FROM quizzes WHERE lesson_id = ? ORDER BY created_at ASC`,
    [lessonId],
  );
}

/** Quizzes reachable from a course: attached to the course, a module or a lesson. */
export async function listCourseQuizzes(db: Db, courseId: string, publishedOnly = true): Promise<QuizRow[]> {
  const statusClause = publishedOnly ? `AND q.status = 'published'` : '';
  return db.all<QuizRow>(
    `SELECT q.id, q.course_id, q.module_id, q.lesson_id, q.title, q.description, q.pass_mark_percent,
            q.max_attempts, q.time_limit_minutes, q.shuffle_questions, q.show_answers, q.status,
            q.created_at, q.updated_at
       FROM quizzes q
       LEFT JOIN modules m ON m.id = q.module_id
      WHERE (q.course_id = ? OR m.course_id = ?) ${statusClause}
      ORDER BY q.created_at ASC`,
    [courseId, courseId],
  );
}

export interface CreateQuizInput {
  courseId?: string | null;
  moduleId?: string | null;
  lessonId?: string | null;
  title: string;
  description?: string | null;
  passMarkPercent?: number;
  maxAttempts?: number;
  timeLimitMinutes?: number | null;
  shuffleQuestions?: boolean;
  showAnswers?: 'never' | 'after_submit' | 'after_pass';
  status?: PublicationStatus;
  createdBy?: string | null;
}

export interface QuizQuestionInput {
  prompt: string;
  questionType?: QuestionType;
  explanation?: string | null;
  points?: number;
  position?: number;
  options: { label: string; isCorrect?: boolean; position?: number }[];
}

/**
 * Creates a quiz together with its questions and options in one batch.
 * `position` is derived from the array order when not supplied, so the editor
 * can post a plain list.
 */
export async function createQuiz(
  db: Db,
  input: CreateQuizInput,
  questions: readonly QuizQuestionInput[] = [],
): Promise<{ quizId: string; questionCount: number }> {
  const quizId = newId(ID_PREFIXES.quiz);
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO quizzes (id, course_id, module_id, lesson_id, title, description, pass_mark_percent,
                            max_attempts, time_limit_minutes, shuffle_questions, show_answers, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quizId,
        input.courseId ?? null,
        input.moduleId ?? null,
        input.lessonId ?? null,
        input.title,
        input.description ?? null,
        input.passMarkPercent ?? 70,
        input.maxAttempts ?? 3,
        input.timeLimitMinutes ?? null,
        input.shuffleQuestions ? 1 : 0,
        input.showAnswers ?? 'after_submit',
        input.status ?? 'draft',
        input.createdBy ?? null,
      ],
    ),
  ];

  questions.forEach((question, questionIndex) => {
    const questionId = newId(ID_PREFIXES.question);
    statements.push(
      db.prepare(
        `INSERT INTO quiz_questions (id, quiz_id, question_type, prompt, explanation, points, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          questionId,
          quizId,
          question.questionType ?? 'single_choice',
          question.prompt,
          question.explanation ?? null,
          question.points ?? 1,
          question.position ?? questionIndex,
        ],
      ),
    );
    question.options.forEach((option, optionIndex) => {
      statements.push(
        db.prepare(
          `INSERT INTO quiz_options (id, question_id, label, is_correct, position) VALUES (?, ?, ?, ?, ?)`,
          [
            newId(ID_PREFIXES.option),
            questionId,
            option.label,
            option.isCorrect ? 1 : 0,
            option.position ?? optionIndex,
          ],
        ),
      );
    });
  });

  await db.batch(statements);
  return { quizId, questionCount: questions.length };
}

export async function updateQuiz(
  db: Db,
  id: string,
  input: Partial<Omit<CreateQuizInput, 'createdBy'>>,
): Promise<number> {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  const push = (column: string, value: string | number | null) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (input.title !== undefined) push('title', input.title);
  if (input.description !== undefined) push('description', input.description);
  if (input.passMarkPercent !== undefined) push('pass_mark_percent', input.passMarkPercent);
  if (input.maxAttempts !== undefined) push('max_attempts', input.maxAttempts);
  if (input.timeLimitMinutes !== undefined) push('time_limit_minutes', input.timeLimitMinutes);
  if (input.shuffleQuestions !== undefined) push('shuffle_questions', input.shuffleQuestions ? 1 : 0);
  if (input.showAnswers !== undefined) push('show_answers', input.showAnswers);
  if (input.status !== undefined) push('status', input.status);

  if (!assignments.length) return 0;
  params.push(id);
  return db.changes(`UPDATE quizzes SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function deleteQuiz(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM quizzes WHERE id = ?`, [id]);
}

/* ------------------------------------------------------------------------- */
/* Questions and options                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Answer-key view: includes `is_correct`. Use only for grading and for
 * administrator screens — never for a student payload.
 */
export async function listQuestionsWithAnswers(db: Db, quizId: string): Promise<QuestionWithOptions[]> {
  const questions = await db.all<QuestionRow>(
    `SELECT id, quiz_id, question_type, prompt, explanation, points, position
       FROM quiz_questions WHERE quiz_id = ? ORDER BY position ASC`,
    [quizId],
  );
  if (questions.length === 0) return [];

  const options = await db.all<OptionRow>(
    `SELECT o.id, o.question_id, o.label, o.is_correct, o.position
       FROM quiz_options o
       JOIN quiz_questions q ON q.id = o.question_id
      WHERE q.quiz_id = ?
      ORDER BY o.position ASC`,
    [quizId],
  );

  const byQuestion = new Map<string, OptionRow[]>();
  for (const option of options) {
    const list = byQuestion.get(option.question_id) ?? [];
    list.push(option);
    byQuestion.set(option.question_id, list);
  }

  return questions.map((question) => ({ ...question, options: byQuestion.get(question.id) ?? [] }));
}

/**
 * Student-safe view: correctness flags and explanations are omitted entirely
 * by the SELECT, and positions are shuffled when the quiz is configured that way.
 */
export async function listQuestionsForStudent(
  db: Db,
  quizId: string,
  shuffle = false,
): Promise<{ id: string; question_type: QuestionType; prompt: string; points: number; position: number; options: { id: string; label: string }[] }[]> {
  const questions = await db.all<QuestionRow>(
    `SELECT id, quiz_id, question_type, prompt, NULL AS explanation, points, position
       FROM quiz_questions WHERE quiz_id = ? ORDER BY position ASC`,
    [quizId],
  );
  const options = await db.all<{ id: string; question_id: string; label: string; position: number }>(
    `SELECT o.id, o.question_id, o.label, o.position
       FROM quiz_options o
       JOIN quiz_questions q ON q.id = o.question_id
      WHERE q.quiz_id = ?
      ORDER BY o.position ASC`,
    [quizId],
  );

  const byQuestion = new Map<string, { id: string; label: string }[]>();
  for (const option of options) {
    const list = byQuestion.get(option.question_id) ?? [];
    list.push({ id: option.id, label: option.label });
    byQuestion.set(option.question_id, list);
  }

  const result = questions.map((question) => ({
    id: question.id,
    question_type: question.question_type,
    prompt: question.prompt,
    points: question.points,
    position: question.position,
    options: byQuestion.get(question.id) ?? [],
  }));

  return shuffle ? shuffleArray(result) : result;
}

/** Fisher–Yates with an injected random source (testable). */
export function shuffleArray<T>(items: T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = a;
  }
  return copy;
}

/* ------------------------------------------------------------------------- */
/* Attempts                                                                   */
/* ------------------------------------------------------------------------- */

export async function countAttempts(db: Db, quizId: string, userId: string): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM quiz_attempts WHERE quiz_id = ? AND user_id = ?`, [
    quizId,
    userId,
  ]);
}

export async function findActiveAttempt(db: Db, quizId: string, userId: string): Promise<AttemptRow | null> {
  return db.first<AttemptRow>(
    `SELECT id, quiz_id, user_id, enrollment_id, attempt_number, status, score_points, max_points,
            score_percent, passed, started_at, submitted_at, graded_at, time_spent_seconds
       FROM quiz_attempts
      WHERE quiz_id = ? AND user_id = ? AND status = 'in_progress'
      ORDER BY attempt_number DESC LIMIT 1`,
    [quizId, userId],
  );
}

export async function createAttempt(
  db: Db,
  input: { quizId: string; userId: string; enrollmentId?: string | null; attemptNumber: number },
): Promise<string> {
  const id = newId(ID_PREFIXES.attempt);
  await db.run(
    `INSERT INTO quiz_attempts (id, quiz_id, user_id, enrollment_id, attempt_number, status)
     VALUES (?, ?, ?, ?, ?, 'in_progress')`,
    [id, input.quizId, input.userId, input.enrollmentId ?? null, input.attemptNumber],
  );
  return id;
}

export async function findAttemptById(db: Db, id: string): Promise<AttemptDetailRow | null> {
  return db.first<AttemptDetailRow>(`${ATTEMPT_DETAIL_SELECT} WHERE qa.id = ? LIMIT 1`, [id]);
}

export async function findAttemptForUser(
  db: Db,
  id: string,
  userId: string,
): Promise<AttemptDetailRow | null> {
  return db.first<AttemptDetailRow>(`${ATTEMPT_DETAIL_SELECT} WHERE qa.id = ? AND qa.user_id = ? LIMIT 1`, [
    id,
    userId,
  ]);
}

export interface AttemptAnswerInput {
  questionId: string;
  selectedOptionIds?: readonly string[];
  answerText?: string | null;
  isCorrect?: boolean;
  pointsAwarded?: number;
}

/** Persists the graded result and its per-question answers in one batch. */
export async function submitAttempt(
  db: Db,
  input: {
    attemptId: string;
    scorePoints: number;
    maxPoints: number;
    scorePercent: number;
    passed: boolean;
    timeSpentSeconds?: number;
    answers: readonly AttemptAnswerInput[];
  },
): Promise<void> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE quiz_attempts
          SET status = 'graded', score_points = ?, max_points = ?, score_percent = ?, passed = ?,
              submitted_at = ?, graded_at = ?, time_spent_seconds = ?
        WHERE id = ? AND status = 'in_progress'`,
      [
        input.scorePoints,
        input.maxPoints,
        input.scorePercent,
        input.passed ? 1 : 0,
        now,
        now,
        Math.max(0, Math.floor(input.timeSpentSeconds ?? 0)),
        input.attemptId,
      ],
    ),
  ];

  for (const answer of input.answers) {
    statements.push(
      db.prepare(
        `INSERT INTO quiz_answers (id, attempt_id, question_id, selected_option_ids, answer_text,
                                   is_correct, points_awarded, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (attempt_id, question_id) DO UPDATE SET
           selected_option_ids = excluded.selected_option_ids,
           answer_text = excluded.answer_text,
           is_correct = excluded.is_correct,
           points_awarded = excluded.points_awarded,
           updated_at = excluded.updated_at`,
        [
          newId(ID_PREFIXES.answer),
          input.attemptId,
          answer.questionId,
          JSON.stringify(answer.selectedOptionIds ?? []),
          answer.answerText ?? null,
          answer.isCorrect ? 1 : 0,
          answer.pointsAwarded ?? 0,
          now,
          now,
        ],
      ),
    );
  }

  await db.batch(statements);
}

export async function abandonAttempt(db: Db, attemptId: string): Promise<number> {
  return db.changes(`UPDATE quiz_attempts SET status = 'abandoned' WHERE id = ? AND status = 'in_progress'`, [
    attemptId,
  ]);
}

export async function listAttemptsForUser(db: Db, userId: string, quizId?: string): Promise<AttemptDetailRow[]> {
  if (quizId) {
    return db.all<AttemptDetailRow>(
      `${ATTEMPT_DETAIL_SELECT} WHERE qa.user_id = ? AND qa.quiz_id = ?
        ORDER BY qa.attempt_number DESC`,
      [userId, quizId],
    );
  }
  return db.all<AttemptDetailRow>(
    `${ATTEMPT_DETAIL_SELECT} WHERE qa.user_id = ? ORDER BY qa.started_at DESC LIMIT 100`,
    [userId],
  );
}

export interface AdminAttemptFilters {
  quizId?: string | null;
  userId?: string | null;
  passed?: boolean | null;
  status?: AttemptStatus | null;
  page: number;
  perPage: number;
}

export async function listAttemptsForAdmin(
  db: Db,
  filters: AdminAttemptFilters,
): Promise<{ items: AttemptDetailRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filters.quizId) {
    conditions.push(`qa.quiz_id = ?`);
    params.push(filters.quizId);
  }
  if (filters.userId) {
    conditions.push(`qa.user_id = ?`);
    params.push(filters.userId);
  }
  if (filters.passed !== null && filters.passed !== undefined) {
    conditions.push(`qa.passed = ?`);
    params.push(filters.passed ? 1 : 0);
  }
  if (filters.status) {
    conditions.push(`qa.status = ?`);
    params.push(filters.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await db.count(
    `SELECT COUNT(*) AS total FROM quiz_attempts qa ${where}`,
    params,
  );
  const items = await db.all<AttemptDetailRow>(
    `${ATTEMPT_DETAIL_SELECT} ${where} ORDER BY qa.started_at DESC LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );
  return { items, total };
}

/** Answers of one attempt, joined with the (administrator-only) answer key. */
export interface AttemptAnswerRow {
  id: string;
  question_id: string;
  prompt: string;
  question_type: QuestionType;
  points: number;
  selected_option_ids: string;
  answer_text: string | null;
  is_correct: number;
  points_awarded: number;
  explanation: string | null;
}

export async function listAttemptAnswers(db: Db, attemptId: string): Promise<AttemptAnswerRow[]> {
  return db.all<AttemptAnswerRow>(
    `SELECT a.id, a.question_id, q.prompt, q.question_type, q.points, q.explanation,
            a.selected_option_ids, a.answer_text, a.is_correct, a.points_awarded
       FROM quiz_answers a
       JOIN quiz_questions q ON q.id = a.question_id
      WHERE a.attempt_id = ?
      ORDER BY q.position ASC`,
    [attemptId],
  );
}

/** Correct option ids for a set of questions — used by the grader. */
export async function correctOptionIdsForQuiz(
  db: Db,
  quizId: string,
): Promise<Map<string, string[]>> {
  const rows = await db.all<{ question_id: string; id: string; is_correct: number }>(
    `SELECT o.question_id, o.id, o.is_correct
       FROM quiz_options o
       JOIN quiz_questions q ON q.id = o.question_id
      WHERE q.quiz_id = ?`,
    [quizId],
  );
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.is_correct) continue;
    const list = map.get(row.question_id) ?? [];
    list.push(row.id);
    map.set(row.question_id, list);
  }
  return map;
}

export interface QuizStats {
  attempts: number;
  passes: number;
  passRate: number;
  averageScore: number;
}

export async function quizStats(db: Db, quizId: string): Promise<QuizStats> {
  const row = await db.first<{ attempts: number; passes: number; average_score: number | null }>(
    `SELECT COUNT(*) AS attempts,
            SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) AS passes,
            ROUND(AVG(score_percent)) AS average_score
       FROM quiz_attempts
      WHERE quiz_id = ? AND status IN ('submitted','graded')`,
    [quizId],
  );
  const attempts = Number(row?.attempts ?? 0);
  const passes = Number(row?.passes ?? 0);
  return {
    attempts,
    passes,
    passRate: attempts ? Math.round((passes / attempts) * 100) : 0,
    averageScore: Number(row?.average_score ?? 0),
  };
}

/** Whether a learner has passed any quiz attached to a lesson (completion rule). */
export async function hasPassedLessonQuiz(db: Db, lessonId: string, userId: string): Promise<boolean> {
  return db.exists(
    `SELECT 1 AS found
       FROM quiz_attempts qa
       JOIN quizzes q ON q.id = qa.quiz_id
      WHERE q.lesson_id = ? AND qa.user_id = ? AND qa.passed = 1
      LIMIT 1`,
    [lessonId, userId],
  );
}
