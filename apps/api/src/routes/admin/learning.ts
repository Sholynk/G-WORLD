/**
 * Routes — administrator learning oversight.
 *
 * Covers enrollments, quiz attempts, assignment grading and certificates. These
 * are the operations an academic administrator needs daily: "who is stuck?", "who
 * needs feedback?", "issue or revoke a certificate".
 *
 * Grading is deliberately manual for assignments (a human awards points and
 * writes feedback) while quizzes stay fully automatic — the split matches how the
 * two assessment types are used in practice.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import {
  adminAttemptListQuerySchema,
  adminEnrollmentListQuerySchema,
  adminSubmissionListQuerySchema,
  certificateIssueSchema,
  certificateRevokeSchema,
  gradeSubmissionSchema,
  idSchema,
  paginationQuerySchema,
} from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import * as quizzesRepo from '../../db/repositories/quizzes.js';
import * as assignmentsRepo from '../../db/repositories/assignments.js';
import * as certificateRepo from '../../db/repositories/certificates.js';
import * as notificationsRepo from '../../db/repositories/notifications.js';
import * as progressRepo from '../../db/repositories/progress.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { issueCertificate, revokeCertificate, canOverrideEligibility } from '../../services/certificates.js';
import { gradeAssignment } from '../../lib/scoring.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parseJson, parseParam, parseQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { created, ok, okPage } from '../helpers.js';
import {
  toAttemptAnswerDto,
  toAttemptDto,
  toCertificateDto,
  toEnrollmentDto,
  toSubmissionDto,
} from '../../schemas/mappers.js';
import { sendEmail, TEMPLATES } from '../../lib/mailer/index.js';

export const adminLearningRoutes = new Hono<AppEnv>();


/* ------------------------------- enrollments ------------------------------ */

adminLearningRoutes.get('/enrollments', requirePermission('enrollment.read.any'), async (c) => {
  const query = parseQuery(c, adminEnrollmentListQuerySchema);
  const db = createDb(c.env.DB);

  const { items, total } = await enrollmentRepo.listEnrollmentsForAdmin(db, {
    q: query.q,
    status: query.status,
    courseId: query.course_id,
    userId: query.user_id,
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(c, items.map((row) => toEnrollmentDto(row, { includeStudent: true })), {
    page: query.page,
    perPage: query.per_page,
    total,
  });
});

/** Nudge a stalled learner; the notification links straight to the lesson. */
adminLearningRoutes.post('/enrollments/:id/remind', requirePermission('enrollment.read.any'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const enrollment = await enrollmentRepo.findEnrollmentById(db, id);
  if (!enrollment) throw notFound('Enrollment not found');

  await notificationsRepo.createNotification(db, {
    userId: enrollment.user_id,
    type: 'info',
    title: `Keep going — ${enrollment.course_title}`,
    body: `You are ${enrollment.progress_percent}% of the way through. Continue with your next lesson.`,
    linkUrl: `/my-courses.html?enrollment=${encodeURIComponent(enrollment.id)}`,
  });

  await audit(c, {
    action: 'enrollment.reminder.sent',
    entityType: 'enrollment',
    entityId: id,
    description: `Sent progress reminder to ${enrollment.user_email}`,
  });

  return ok(c, { sent: true });
});

/** Recalculate one learner's progress (repair tool after content edits). */
adminLearningRoutes.post('/enrollments/:id/recalculate', requirePermission('enrollment.read.any'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const enrollment = await enrollmentRepo.findEnrollmentById(db, id);
  if (!enrollment) throw notFound('Enrollment not found');

  const result = await progressRepo.recalculate(db, enrollment);
  await audit(c, {
    action: 'enrollment.recalculated',
    entityType: 'enrollment',
    entityId: id,
    description: `Recalculated progress for ${enrollment.user_email}`,
    metadata: { progress_percent: result.summary.progressPercent, completed: result.summary.completedLessons },
  });

  return ok(c, {
    progress_percent: result.summary.progressPercent,
    lessons_completed: result.summary.completedLessons,
    total_lessons: result.summary.totalLessons,
    is_complete: result.summary.isComplete,
  });
});

/* --------------------------------- attempts ------------------------------- */

adminLearningRoutes.get('/attempts', requirePermission('assessment.read.any'), async (c) => {
  const query = parseQuery(c, adminAttemptListQuerySchema);
  const db = createDb(c.env.DB);

  const { items, total } = await quizzesRepo.listAttemptsForAdmin(db, {
    quizId: query.quiz_id,
    userId: query.user_id,
    passed: query.passed,
    status: query.status,
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(c, items.map((row) => toAttemptDto(row, { includeStudent: true })), {
    page: query.page,
    perPage: query.per_page,
    total,
  });
});

adminLearningRoutes.get('/attempts/:id', requirePermission('assessment.read.any'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB);

  const attempt = await quizzesRepo.findAttemptById(db, id);
  if (!attempt) throw notFound('Attempt not found');

  const answers = await quizzesRepo.listAttemptAnswers(db, id);
  const questions = await quizzesRepo.listQuestionsWithAnswers(db, attempt.quiz_id);
  const stats = await quizzesRepo.quizStats(db, attempt.quiz_id);

  return ok(c, {
    attempt: toAttemptDto(attempt, { includeStudent: true }),
    answers: answers.map((answer) => toAttemptAnswerDto(answer, true)),
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      type: question.question_type,
      points: question.points,
      explanation: question.explanation,
      correct_option_ids: question.options.filter((option) => option.is_correct).map((option) => option.id),
    })),
    quiz_stats: stats,
  });
});

/* ------------------------------- submissions ------------------------------ */

adminLearningRoutes.get('/submissions', requirePermission('assessment.read.any'), async (c) => {
  const query = parseQuery(c, adminSubmissionListQuerySchema);
  const db = createDb(c.env.DB);

  const { items, total } = await assignmentsRepo.listSubmissionsForAdmin(db, {
    assignmentId: query.assignment_id,
    userId: query.user_id,
    status: query.status,
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(c, items.map((row) => toSubmissionDto(row, 'admin')), {
    page: query.page,
    perPage: query.per_page,
    total,
  });
});

/** Grading: server computes the percentage and pass/fail from the stored rubric. */
adminLearningRoutes.post('/submissions/grade', requirePermission('assessment.write'), async (c) => {
  const auth = c.get('auth')!;
  const input = await parseJson(c, gradeSubmissionSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const submission = await assignmentsRepo.findSubmissionById(db, input.submission_id);
  if (!submission) throw notFound('Submission not found');

  if (input.score_points > Number(submission.max_points_allowed)) {
    throw badRequest(`Score cannot exceed ${submission.max_points_allowed} points`, [
      { field: 'score_points', message: `Maximum ${submission.max_points_allowed}` },
    ]);
  }

  await assignmentsRepo.gradeSubmission(db, {
    submissionId: input.submission_id,
    scorePoints: input.score_points,
    feedback: input.feedback ?? null,
    status: input.status,
    gradedBy: auth.userId,
  });

  const { scorePercent, passed } = gradeAssignment(
    input.score_points,
    Number(submission.max_points_allowed),
    Number(submission.pass_mark_percent),
  );

  await notificationsRepo.createNotification(db, {
    userId: submission.user_id,
    type: 'assessment',
    title: `Graded — ${submission.assignment_title}`,
    body: `Score: ${input.score_points}/${submission.max_points_allowed} (${scorePercent}%)${passed ? ' — passed' : ''}.`,
    linkUrl: '/my-courses.html',
  });

  await sendEmail(db, c.get('config'), c.get('logger'), submission.user_email, {
    userId: submission.user_id,
    content: TEMPLATES.assignmentGradedEmail({
      toEmail: submission.user_email,
      displayName: submission.student_name,
      assignmentTitle: submission.assignment_title,
      scorePoints: input.score_points,
      maxPoints: Number(submission.max_points_allowed),
      feedback: input.feedback ?? null,
      branding: { siteName: 'G WORLD', appBaseUrl: c.get('config').appBaseUrl },
    }),
  });

  await audit(c, {
    action: AUDIT_ACTIONS.assignmentGraded,
    entityType: 'assignment_submission',
    entityId: input.submission_id,
    description: `Graded submission from ${submission.user_email}`,
    metadata: { score_points: input.score_points, max_points: submission.max_points_allowed, passed, status: input.status },
  });

  return ok(c, {
    graded: true,
    submission_id: input.submission_id,
    score_points: input.score_points,
    max_points: Number(submission.max_points_allowed),
    score_percent: scorePercent,
    passed,
  });
});

/** Create an assignment (administrator authoring). */
adminLearningRoutes.post('/assignments', requirePermission('assessment.write'), async (c) => {
  const { assignmentInputSchema } = await import('@g-world/shared');
  const auth = c.get('auth')!;
  const input = await parseJson(c, assignmentInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const id = await assignmentsRepo.createAssignment(db, {
    courseId: input.course_id ?? null,
    moduleId: input.module_id ?? null,
    lessonId: input.lesson_id ?? null,
    title: input.title,
    instructionsMd: input.instructions_md,
    maxPoints: input.max_points,
    passMarkPercent: input.pass_mark_percent,
    dueAt: input.due_at ?? null,
    allowLate: input.allow_late,
    submissionType: input.submission_type,
    status: input.status,
    createdBy: auth.userId,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.assignmentCreated,
    entityType: 'assignment',
    entityId: id,
    description: `Created assignment “${input.title}”`,
    metadata: { course_id: input.course_id ?? null, lesson_id: input.lesson_id ?? null },
  });

  return created(c, { id });
});

adminLearningRoutes.get('/assignments', requirePermission('assessment.read.any'), async (c) => {
  const query = parseQuery(c, paginationQuerySchema);
  const db = createDb(c.env.DB);
  const courseId = c.req.query('course_id');

  const items = courseId
    ? await assignmentsRepo.listAssignmentsForCourse(db, courseId)
    : await db.all<Awaited<ReturnType<typeof assignmentsRepo.listAssignmentsForCourse>>[number]>(
        `SELECT id, course_id, module_id, lesson_id, title, instructions_md, max_points, pass_mark_percent,
                due_at, allow_late, submission_type, status, created_at, updated_at
           FROM assignments ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [query.per_page, (query.page - 1) * query.per_page],
      );

  const total = courseId
    ? items.length
    : await db.count(`SELECT COUNT(*) AS total FROM assignments`);

  const withCounts = await Promise.all(
    items.map(async (item) => {
      const submissions = await db.count(
        `SELECT COUNT(*) AS total FROM assignment_submissions WHERE assignment_id = ?`,
        [item.id],
      );
      return {
        id: item.id,
        course_id: item.course_id,
        lesson_id: item.lesson_id,
        title: item.title,
        max_points: Number(item.max_points),
        pass_mark_percent: Number(item.pass_mark_percent),
        due_at: item.due_at,
        status: item.status,
        submission_count: submissions,
      };
    }),
  );

  return okPage(c, withCounts, { page: query.page, perPage: query.per_page, total });
});

adminLearningRoutes.patch('/assignments/:id', requirePermission('assessment.write'), async (c) => {
  const { assignmentInputSchema } = await import('@g-world/shared');
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, assignmentInputSchema.partial());
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await assignmentsRepo.findAssignmentById(db, id);
  if (!existing) throw notFound('Assignment not found');

  await assignmentsRepo.updateAssignment(db, id, {
    title: input.title,
    instructionsMd: input.instructions_md,
    maxPoints: input.max_points,
    passMarkPercent: input.pass_mark_percent,
    dueAt: input.due_at,
    allowLate: input.allow_late,
    submissionType: input.submission_type,
    status: input.status,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.assignmentCreated,
    entityType: 'assignment',
    entityId: id,
    description: `Updated assignment “${input.title ?? existing.title}”`,
  });

  return ok(c, { updated: true, id });
});

/* ------------------------------ quiz authoring ---------------------------- */

adminLearningRoutes.post('/quizzes', requirePermission('assessment.write'), async (c) => {
  const { quizInputSchema } = await import('@g-world/shared');
  const auth = c.get('auth')!;
  const input = await parseJson(c, quizInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const result = await quizzesRepo.createQuiz(
    db,
    {
      courseId: input.course_id ?? null,
      moduleId: input.module_id ?? null,
      lessonId: input.lesson_id ?? null,
      title: input.title,
      description: input.description ?? null,
      passMarkPercent: input.pass_mark_percent,
      maxAttempts: input.max_attempts,
      timeLimitMinutes: input.time_limit_minutes ?? null,
      shuffleQuestions: input.shuffle_questions,
      showAnswers: input.show_answers,
      status: input.status,
      createdBy: auth.userId,
    },
    (input.questions ?? []).map((question) => ({
      prompt: question.prompt,
      questionType: question.question_type,
      explanation: question.explanation ?? null,
      points: question.points,
      position: question.position,
      options: question.options.map((option) => ({
        label: option.label,
        isCorrect: option.is_correct,
        position: option.position,
      })),
    })),
  );

  await audit(c, {
    action: AUDIT_ACTIONS.quizCreated,
    entityType: 'quiz',
    entityId: result.quizId,
    description: `Created quiz “${input.title}” with ${result.questionCount} question(s)`,
    metadata: { course_id: input.course_id ?? null, lesson_id: input.lesson_id ?? null },
  });

  return created(c, { id: result.quizId, question_count: result.questionCount });
});

adminLearningRoutes.get('/quizzes', requirePermission('assessment.read.any'), async (c) => {
  const db = createDb(c.env.DB);
  const courseId = c.req.query('course_id');
  const lessonId = c.req.query('lesson_id');

  if (lessonId) {
    const quizzes = await quizzesRepo.listQuizzesForLesson(db, lessonId);
    return ok(c, quizzes.map((quiz) => toQuizSummary(quiz)));
  }
  if (courseId) {
    const quizzes = await quizzesRepo.listQuizzesForCourse(db, courseId, false);
    return ok(c, quizzes.map((quiz) => toQuizSummary(quiz)));
  }

  const rows = await db.all<Record<string, unknown>>(
    `SELECT q.id, q.course_id, q.module_id, q.lesson_id, q.title, q.description, q.pass_mark_percent,
            q.max_attempts, q.time_limit_minutes, q.shuffle_questions, q.show_answers, q.status,
            q.created_at, q.updated_at,
            (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count
       FROM quizzes q ORDER BY q.created_at DESC LIMIT 100`,
  );
  return ok(c, rows.map((row) => toQuizSummary(row as never)));
});

adminLearningRoutes.get('/quizzes/:id', requirePermission('assessment.read.any'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB);

  const quiz = await quizzesRepo.findQuizById(db, id);
  if (!quiz) throw notFound('Quiz not found');

  const [questions, stats] = await Promise.all([
    quizzesRepo.listQuestionsWithAnswers(db, id),
    quizzesRepo.quizStats(db, id),
  ]);

  return ok(c, {
    quiz: toQuizSummary({ ...quiz, question_count: questions.length } as never),
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      type: question.question_type,
      explanation: question.explanation,
      points: Number(question.points),
      position: question.position,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label,
        is_correct: Boolean(option.is_correct),
        position: option.position,
      })),
    })),
    stats,
  });
});

adminLearningRoutes.patch('/quizzes/:id', requirePermission('assessment.write'), async (c) => {
  const { quizUpdateSchema } = await import('@g-world/shared');
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, quizUpdateSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await quizzesRepo.findQuizById(db, id);
  if (!existing) throw notFound('Quiz not found');

  await quizzesRepo.updateQuiz(db, id, {
    title: input.title,
    description: input.description,
    passMarkPercent: input.pass_mark_percent,
    maxAttempts: input.max_attempts,
    timeLimitMinutes: input.time_limit_minutes,
    shuffleQuestions: input.shuffle_questions,
    showAnswers: input.show_answers,
    status: input.status,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.quizUpdated,
    entityType: 'quiz',
    entityId: id,
    description: `Updated quiz “${input.title ?? existing.title}”`,
  });

  return ok(c, { updated: true, id });
});

adminLearningRoutes.delete('/quizzes/:id', requirePermission('assessment.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const quiz = await quizzesRepo.findQuizById(db, id);
  if (!quiz) throw notFound('Quiz not found');

  const attempts = await db.count(`SELECT COUNT(*) AS total FROM quiz_attempts WHERE quiz_id = ?`, [id]);
  if (attempts > 0) {
    throw conflict(
      `${attempts} attempt(s) exist for this quiz. Archive it (status = archived) instead of deleting, so learner history stays intact.`,
    );
  }

  await quizzesRepo.deleteQuiz(db, id);
  await audit(c, {
    action: AUDIT_ACTIONS.quizDeleted,
    entityType: 'quiz',
    entityId: id,
    description: `Deleted quiz “${quiz.title}”`,
  });

  return ok(c, { deleted: true, id });
});

function toQuizSummary(row: {
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
  show_answers: string;
  status: string;
  created_at: string;
  updated_at: string;
  question_count?: number;
}) {
  return {
    id: row.id,
    course_id: row.course_id,
    module_id: row.module_id,
    lesson_id: row.lesson_id,
    title: row.title,
    description: row.description,
    pass_mark_percent: Number(row.pass_mark_percent),
    max_attempts: Number(row.max_attempts),
    time_limit_minutes: row.time_limit_minutes === null ? null : Number(row.time_limit_minutes),
    shuffle_questions: Boolean(row.shuffle_questions),
    show_answers: row.show_answers,
    status: row.status,
    question_count: Number(row.question_count ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/* ------------------------------ certificates ------------------------------ */

adminLearningRoutes.get('/certificates', requirePermission('certificate.write'), async (c) => {
  const query = parseQuery(c, paginationQuerySchema);
  const db = createDb(c.env.DB);

  const { items, total } = await certificateRepo.listCertificatesForAdmin(db, {
    q: c.req.query('q') ?? null,
    courseId: c.req.query('course_id') ?? null,
    userId: c.req.query('user_id') ?? null,
    revoked: c.req.query('revoked') ? c.req.query('revoked') === 'true' : null,
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(c, items.map((row) => toCertificateDto(row)), {
    page: query.page,
    perPage: query.per_page,
    total,
  });
});

adminLearningRoutes.post('/certificates', requirePermission('certificate.write'), async (c) => {
  const auth = c.get('auth')!;
  const input = await parseJson(c, certificateIssueSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const enrollment = await enrollmentRepo.findEnrollment(db, input.user_id, input.course_id);
  if (!enrollment) throw notFound('That learner is not enrolled in this course');

  const override = await canOverrideEligibility(db, auth.roleKey);

  const result = await issueCertificate(db, c.get('config'), c.get('logger'), {
    userId: input.user_id,
    courseId: input.course_id,
    enrollmentId: enrollment.id,
    grade: input.grade ?? null,
    finalScorePercent: input.final_score_percent ?? null,
    issuedBy: auth.userId,
    manualOverride: override,
  });

  if (!result.issued) {
    throw conflict(`Certificate not issued: ${result.reasons.join(' ')}`);
  }

  await audit(c, {
    action: AUDIT_ACTIONS.certificateIssued,
    entityType: 'certificate',
    entityId: result.certificateId,
    description: `Issued certificate ${result.certificateNumber}`,
    metadata: {
      user_id: input.user_id,
      course_id: input.course_id,
      manual_override: override,
      already_existed: result.alreadyExisted,
    },
  });

  return created(c, {
    certificate_id: result.certificateId,
    certificate_number: result.certificateNumber,
    verification_code: result.verificationCode,
    already_existed: result.alreadyExisted,
  });
});

adminLearningRoutes.post('/certificates/revoke', requirePermission('certificate.write'), async (c) => {
  const input = await parseJson(c, certificateRevokeSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const certificate = await certificateRepo.findCertificateById(db, input.certificate_id);
  if (!certificate) throw notFound('Certificate not found');
  if (certificate.revoked_at) throw conflict('This certificate is already revoked');

  await revokeCertificate(db, input.certificate_id, input.reason);

  await notificationsRepo.createNotification(db, {
    userId: certificate.user_id,
    type: 'warning',
    title: 'Certificate revoked',
    body: `Your certificate ${certificate.certificate_number} was revoked. Reason: ${input.reason}`,
    linkUrl: '/certificates.html',
  });

  await audit(c, {
    action: AUDIT_ACTIONS.certificateRevoked,
    entityType: 'certificate',
    entityId: input.certificate_id,
    description: `Revoked certificate ${certificate.certificate_number}`,
    metadata: { reason: input.reason },
  });

  return ok(c, { revoked: true, certificate_id: input.certificate_id });
});
