/**
 * Routes — quizzes (learner side).
 *
 * Flow: start an attempt → receive questions without the answer key → submit
 * answers → receive the graded result.
 *
 * Guarantees enforced here, not in the browser:
 *   - the quiz must belong to a course the learner is enrolled in;
 *   - `max_attempts` is counted server-side (and backed by a UNIQUE constraint on
 *     `(quiz_id, user_id, attempt_number)`);
 *   - questions are sent without `is_correct`/`explanation`;
 *   - grading happens on the server with the stored answer key;
 *   - the key is revealed only when the quiz's `show_answers` setting allows it.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { idSchema, startAttemptSchema, submitAttemptSchema } from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as quizzesRepo from '../../db/repositories/quizzes.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import * as progressRepo from '../../db/repositories/progress.js';
import * as notificationsRepo from '../../db/repositories/notifications.js';
import { gradeAttempt, type ScoringQuestion } from '../../lib/scoring.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { recalculateEnrollment } from '../../services/learning.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { parseJson, parseParam } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { created, ok } from '../helpers.js';
import { toAttemptAnswerDto, toAttemptDto, toStudentQuestionDto } from '../../schemas/mappers.js';

export const quizRoutes = new Hono<AppEnv>();


/** Resolves the quiz and proves the caller may take it. */
async function loadQuizForLearner(
  db: ReturnType<typeof createDb>,
  userId: string,
  quizId: string,
  requireEnrollment = true,
) {
  const quiz = await quizzesRepo.findQuizById(db, quizId);
  if (!quiz || quiz.status !== 'published') throw notFound('Quiz not found');

  // A quiz is attached to a course, a module or a lesson; resolve the course id
  // from whichever scope it uses.
  let courseId = quiz.course_id;
  if (!courseId && quiz.lesson_id) {
    const lesson = await db.first<{ course_id: string }>(
      `SELECT m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ? LIMIT 1`,
      [quiz.lesson_id],
    );
    courseId = lesson?.course_id ?? null;
  }
  if (!courseId && quiz.module_id) {
    const module = await db.first<{ course_id: string }>(
      `SELECT course_id FROM modules WHERE id = ? LIMIT 1`,
      [quiz.module_id],
    );
    courseId = module?.course_id ?? null;
  }
  if (!courseId) throw notFound('This quiz is not attached to a course');

  const enrollment = await enrollmentRepo.findEnrollmentForCourseByUser(db, courseId, userId);
  if (requireEnrollment && (!enrollment || enrollment.status === 'cancelled' || enrollment.status === 'expired')) {
    throw forbidden('Enrol in this course to attempt its quizzes');
  }

  return { quiz, courseId, enrollment };
}

quizRoutes.get('/quizzes/:quizId', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const quizId = parseParam(c, 'quizId', idSchema);
  const db = createDb(c.env.DB);

  const { quiz, courseId } = await loadQuizForLearner(db, auth.userId, quizId);
  const attempts = await quizzesRepo.listAttemptsForUser(db, auth.userId, quizId);
  const questions = await quizzesRepo.listQuestionsForStudent(db, quizId, Boolean(quiz.shuffle_questions));

  const graded = attempts.filter((attempt) => attempt.status === 'submitted' || attempt.status === 'graded');
  const attemptsUsed = attempts.length;
  const bestScore = graded.reduce((best, attempt) => Math.max(best, Number(attempt.score_percent)), 0);

  return ok(c, {
    quiz: {
      id: quiz.id,
      course_id: courseId,
      lesson_id: quiz.lesson_id,
      title: quiz.title,
      description: quiz.description,
      pass_mark_percent: Number(quiz.pass_mark_percent),
      max_attempts: Number(quiz.max_attempts),
      time_limit_minutes: quiz.time_limit_minutes,
      show_answers: quiz.show_answers,
      attempts_used: attemptsUsed,
      attempts_remaining: Math.max(0, Number(quiz.max_attempts) - attemptsUsed),
      best_score: bestScore,
      passed: graded.some((attempt) => Boolean(attempt.passed)),
    },
    questions: questions.map(toStudentQuestionDto),
    attempts: attempts.map((attempt) => toAttemptDto(attempt, { includeStudent: false })),
  });
});

quizRoutes.post('/quizzes/:quizId/attempts', requireVerified(), rateLimit('assessment.start'), async (c) => {
  const auth = c.get('auth')!;
  const quizId = parseParam(c, 'quizId', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));
  const body = await parseJson(c, startAttemptSchema);
  if (body.quiz_id && body.quiz_id !== quizId) {
    throw badRequest('The quiz id in the body does not match the request path');
  }

  const { quiz, courseId, enrollment } = await loadQuizForLearner(db, auth.userId, quizId);

  const questions = await quizzesRepo.listQuestionsWithAnswers(db, quizId);
  if (questions.length === 0) throw conflict('This quiz has no questions yet');

  const active = await quizzesRepo.findActiveAttempt(db, quizId, auth.userId);
  if (active) {
    // Resuming an unfinished attempt instead of burning one of the attempts.
    const studentQuestions = await quizzesRepo.listQuestionsForStudent(
      db,
      quizId,
      Boolean(quiz.shuffle_questions),
    );
    return ok(c, {
      attempt: toAttemptDto((await quizzesRepo.findAttemptById(db, active.id))!, { includeStudent: false }),
      questions: studentQuestions.map(toStudentQuestionDto),
      resumed: true,
    });
  }

  const attemptsUsed = await quizzesRepo.countAttempts(db, quizId, auth.userId);
  if (attemptsUsed >= Number(quiz.max_attempts)) {
    throw conflict(`You have used all ${quiz.max_attempts} attempts for this quiz`);
  }

  const attemptId = await quizzesRepo.createAttempt(db, {
    quizId,
    userId: auth.userId,
    enrollmentId: enrollment?.id ?? null,
    attemptNumber: attemptsUsed + 1,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.quizAttemptStarted,
    actorUserId: auth.userId,
    entityType: 'quiz',
    entityId: quizId,
    description: `Started attempt ${attemptsUsed + 1} of “${quiz.title}”`,
    metadata: { course_id: courseId, attempt_number: attemptsUsed + 1 },
  });

  const studentQuestions = await quizzesRepo.listQuestionsForStudent(
    db,
    quizId,
    Boolean(quiz.shuffle_questions),
  );

  return created(c, {
    attempt: toAttemptDto((await quizzesRepo.findAttemptById(db, attemptId))!, { includeStudent: false }),
    questions: studentQuestions.map(toStudentQuestionDto),
    resumed: false,
  });
});

quizRoutes.get('/attempts/:attemptId', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const attemptId = parseParam(c, 'attemptId', idSchema);
  const db = createDb(c.env.DB);

  const attempt = await quizzesRepo.findAttemptForUser(db, attemptId, auth.userId);
  if (!attempt) throw notFound('Attempt not found');

  const quiz = await quizzesRepo.findQuizById(db, attempt.quiz_id);
  const answers = await quizzesRepo.listAttemptAnswers(db, attemptId);
  const isGraded = attempt.status === 'submitted' || attempt.status === 'graded';
  const reveal =
    isGraded &&
    (quiz?.show_answers === 'after_submit' ||
      (quiz?.show_answers === 'after_pass' && Boolean(attempt.passed)));

  const questions = await quizzesRepo.listQuestionsForStudent(db, attempt.quiz_id, false);

  return ok(c, {
    attempt: toAttemptDto(attempt, { includeStudent: false }),
    questions: questions.map(toStudentQuestionDto),
    answers: answers.map((answer) => toAttemptAnswerDto(answer, reveal)),
    show_answers: reveal,
    // While an attempt is in progress the questions are returned without any
    // correctness information, exactly like at start time.
    in_progress: attempt.status === 'in_progress',
  });
});

quizRoutes.post('/attempts/:attemptId/submit', requireVerified(), rateLimit('assessment.submit'), async (c) => {
  const auth = c.get('auth')!;
  const attemptId = parseParam(c, 'attemptId', idSchema);
  const input = await parseJson(c, submitAttemptSchema);
  if (input.attempt_id && input.attempt_id !== attemptId) {
    throw badRequest('The attempt id in the body does not match the request path');
  }
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const attempt = await quizzesRepo.findAttemptForUser(db, attemptId, auth.userId);
  if (!attempt) throw notFound('Attempt not found');
  if (attempt.status !== 'in_progress') throw conflict('This attempt has already been submitted');

  const quiz = await quizzesRepo.findQuizById(db, attempt.quiz_id);
  if (!quiz) throw notFound('Quiz not found');

  const questions = await quizzesRepo.listQuestionsWithAnswers(db, attempt.quiz_id);
  if (questions.length === 0) throw conflict('This quiz has no questions');

  const scoringQuestions: ScoringQuestion[] = questions.map((question) => ({
    id: question.id,
    type: question.question_type,
    points: Number(question.points),
    options: question.options.map((option) => ({ id: option.id, isCorrect: Boolean(option.is_correct) })),
    // Short-answer questions accept the first correct option's label as an
    // accepted answer; administrators can add more by extending the option list.
    acceptedAnswers: question.options.filter((option) => option.is_correct).map((option) => option.label),
  }));

  // The API accepts snake_case JSON; the grader works with a camelCase domain
  // shape. Mapping happens here, once, instead of inside the pure scoring logic.
  const submittedAnswers = input.answers.map((answer) => ({
    questionId: answer.question_id,
    selectedOptionIds: answer.selected_option_ids ?? [],
    answerText: answer.answer_text ?? undefined,
  }));

  const result = gradeAttempt(scoringQuestions, submittedAnswers, {
    passMarkPercent: Number(quiz.pass_mark_percent),
  });

  const submittedQuestionIds = new Set(input.answers.map((answer) => answer.question_id));
  const unknownQuestions = [...submittedQuestionIds].filter(
    (questionId) => !questions.some((question) => question.id === questionId),
  );
  if (unknownQuestions.length > 0) {
    throw badRequest('Submitted answers contain questions that do not belong to this quiz', [
      { field: 'answers', message: `${unknownQuestions.length} unknown question id(s)` },
    ]);
  }

  await quizzesRepo.submitAttempt(db, {
    attemptId,
    scorePoints: result.scorePoints,
    maxPoints: result.maxPoints,
    scorePercent: result.scorePercent,
    passed: result.passed,
    timeSpentSeconds: input.time_spent_seconds,
    answers: result.answers.map((answer) => ({
      questionId: answer.questionId,
      selectedOptionIds: answer.selectedOptionIds,
      answerText: input.answers.find((row) => row.question_id === answer.questionId)?.answer_text ?? null,
      isCorrect: answer.isCorrect,
      pointsAwarded: answer.pointsAwarded,
    })),
  });

  await audit(c, {
    action: AUDIT_ACTIONS.quizAttemptSubmitted,
    actorUserId: auth.userId,
    entityType: 'quiz',
    entityId: attempt.quiz_id,
    description: `Submitted attempt ${attempt.attempt_number} of “${quiz.title}”`,
    metadata: { score_percent: result.scorePercent, passed: result.passed },
  });

  // Passing a quiz can satisfy a `quiz_pass` lesson, so progress is recomputed
  // and a completed course issues its certificate immediately.
  let progressUpdate: unknown = null;
  if (attempt.enrollment_id) {
    const enrollment = await enrollmentRepo.findEnrollmentForUser(db, attempt.enrollment_id, auth.userId);
    if (enrollment) {
      const recalculated = await progressRepo.recalculate(db, enrollment);
      progressUpdate = {
        progress_percent: recalculated.summary.progressPercent,
        lessons_completed: recalculated.summary.completedLessons,
        total_lessons: recalculated.summary.totalLessons,
        is_complete: recalculated.summary.isComplete,
      };
      if (recalculated.justCompleted) {
        const completion = await recalculateEnrollment(
          db,
          c.get('config'),
          c.get('logger'),
          auth,
          enrollment.id,
        );
        progressUpdate = {
          ...(progressUpdate as Record<string, unknown>),
          course_completed: completion.course_completed,
          certificate: completion.certificate,
        };
      }
    }
  }

  if (result.passed) {
    await notificationsRepo.createNotification(db, {
      userId: auth.userId,
      type: 'assessment',
      title: `Quiz passed — ${quiz.title}`,
      body: `You scored ${result.scorePercent}% (pass mark ${quiz.pass_mark_percent}%).`,
      linkUrl: '/my-courses.html',
    });
  }

  const reveal =
    quiz.show_answers === 'after_submit' || (quiz.show_answers === 'after_pass' && result.passed);

  return ok(c, {
    attempt: toAttemptDto((await quizzesRepo.findAttemptById(db, attemptId))!, { includeStudent: false }),
    score: {
      points: result.scorePoints,
      max_points: result.maxPoints,
      percent: result.scorePercent,
      passed: result.passed,
      pass_mark_percent: Number(quiz.pass_mark_percent),
      unanswered: result.unanswered.length,
    },
    answers: reveal
      ? questions.map((question) => {
          const graded = result.answers.find((answer) => answer.questionId === question.id);
          return {
            question_id: question.id,
            prompt: question.prompt,
            correct_option_ids: question.options.filter((option) => option.is_correct).map((option) => option.id),
            selected_option_ids: graded?.selectedOptionIds ?? [],
            is_correct: graded?.isCorrect ?? false,
            points_awarded: graded?.pointsAwarded ?? 0,
            explanation: question.explanation,
          };
        })
      : undefined,
    progress: progressUpdate,
  });
});

quizRoutes.get('/me/attempts', requireAuth(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);
  const attempts = await quizzesRepo.listAttemptsForUser(db, auth.userId);
  return ok(c, attempts.map((attempt) => toAttemptDto(attempt, { includeStudent: false })));
});
