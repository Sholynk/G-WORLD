/**
 * Routes — assignments (learner side).
 *
 * A learner can submit, resubmit (a new attempt row each time, so the history is
 * intact) and read their own feedback. Grading is administrator-only and lives in
 * routes/admin/learning.ts.
 *
 * Deadline handling: a late submission is accepted only when the assignment
 * allows it, and the lateness is recorded so a grader can see it.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { assignmentSubmitSchema, idSchema } from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as assignmentsRepo from '../../db/repositories/assignments.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import * as notificationsRepo from '../../db/repositories/notifications.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { parseJson, parseParam } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { requireVerified } from '../../middleware/auth.js';
import { created, ok } from '../helpers.js';
import { toAssignmentDto, toSubmissionDto } from '../../schemas/mappers.js';

export const assignmentRoutes = new Hono<AppEnv>();


const MAX_ATTEMPTS_PER_ASSIGNMENT = 5;

async function resolveCourseId(
  db: ReturnType<typeof createDb>,
  assignment: { course_id: string | null; module_id: string | null; lesson_id: string | null },
): Promise<string | null> {
  if (assignment.course_id) return assignment.course_id;
  if (assignment.module_id) {
    const row = await db.first<{ course_id: string }>(
      `SELECT course_id FROM modules WHERE id = ? LIMIT 1`,
      [assignment.module_id],
    );
    return row?.course_id ?? null;
  }
  if (assignment.lesson_id) {
    const row = await db.first<{ course_id: string }>(
      `SELECT m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ? LIMIT 1`,
      [assignment.lesson_id],
    );
    return row?.course_id ?? null;
  }
  return null;
}

assignmentRoutes.get('/assignments/:assignmentId', requireVerified(), async (c) => {
  const auth = c.get('auth')!;
  const assignmentId = parseParam(c, 'assignmentId', idSchema);
  const db = createDb(c.env.DB);

  const assignment = await assignmentsRepo.findAssignmentById(db, assignmentId);
  if (!assignment || assignment.status !== 'published') throw notFound('Assignment not found');

  const courseId = await resolveCourseId(db, assignment);
  if (!courseId) throw notFound('This assignment is not attached to a course');

  const enrollment = await enrollmentRepo.findEnrollmentForCourseByUser(db, courseId, auth.userId);
  if (!enrollment || enrollment.status === 'cancelled' || enrollment.status === 'expired') {
    throw forbidden('Enrol in this course to view this assignment');
  }

  const submission = await assignmentsRepo.findSubmission(db, assignmentId, auth.userId);
  const attempts = await assignmentsRepo.countSubmissions(db, assignmentId, auth.userId);
  const dueAt = assignment.due_at ? Date.parse(assignment.due_at) : null;

  return ok(c, {
    assignment: toAssignmentDto(assignment),
    submission: submission
      ? toSubmissionDto((await assignmentsRepo.findSubmissionById(db, submission.id))!, 'student')
      : null,
    attempts_used: attempts,
    attempts_remaining: Math.max(0, MAX_ATTEMPTS_PER_ASSIGNMENT - attempts),
    overdue: dueAt !== null && Date.now() > dueAt,
    can_submit:
      (!(dueAt !== null && Date.now() > dueAt) || assignment.allow_late === 1) &&
      attempts < MAX_ATTEMPTS_PER_ASSIGNMENT &&
      submission?.status !== 'graded',
  });
});

assignmentRoutes.post('/assignments/:assignmentId/submissions', requireVerified(), rateLimit('assessment.submit'), async (c) => {
  const auth = c.get('auth')!;
  const assignmentId = parseParam(c, 'assignmentId', idSchema);
  const input = await parseJson(c, assignmentSubmitSchema);
  if (input.assignment_id && input.assignment_id !== assignmentId) {
    throw badRequest('The assignment id in the body does not match the request path');
  }
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const assignment = await assignmentsRepo.findAssignmentById(db, assignmentId);
  if (!assignment || assignment.status !== 'published') throw notFound('Assignment not found');

  const courseId = await resolveCourseId(db, assignment);
  if (!courseId) throw notFound('This assignment is not attached to a course');

  const enrollment = await enrollmentRepo.findEnrollmentForCourseByUser(db, courseId, auth.userId);
  if (!enrollment || enrollment.status === 'cancelled' || enrollment.status === 'expired') {
    throw forbidden('Enrol in this course to submit this assignment');
  }

  if (assignment.due_at && Date.parse(assignment.due_at) < Date.now() && assignment.allow_late !== 1) {
    throw conflict('The deadline for this assignment has passed and late submissions are not accepted');
  }

  const attempts = await assignmentsRepo.countSubmissions(db, assignmentId, auth.userId);
  if (attempts >= MAX_ATTEMPTS_PER_ASSIGNMENT) {
    throw conflict(`You have reached the maximum of ${MAX_ATTEMPTS_PER_ASSIGNMENT} submissions`);
  }

  const previous = await assignmentsRepo.findSubmission(db, assignmentId, auth.userId);
  if (previous?.status === 'graded') {
    throw conflict('This assignment has already been graded. Contact your instructor to resubmit.');
  }

  const submissionId = await assignmentsRepo.createSubmission(db, {
    assignmentId,
    userId: auth.userId,
    enrollmentId: enrollment.id,
    attemptNumber: attempts + 1,
    submissionText: input.submission_text ?? null,
    linkUrl: input.link_url ?? null,
    r2Key: input.r2_key ?? null,
  });

  await notificationsRepo.createNotification(db, {
    userId: auth.userId,
    type: 'assessment',
    title: `Submission received — ${assignment.title}`,
    body: 'Your work is queued for review. You will be notified when it is graded.',
    linkUrl: '/my-courses.html',
  });

  await audit(c, {
    action: AUDIT_ACTIONS.assignmentSubmitted,
    actorUserId: auth.userId,
    entityType: 'assignment',
    entityId: assignmentId,
    description: `Submitted “${assignment.title}” (attempt ${attempts + 1})`,
    metadata: { course_id: courseId, attempt_number: attempts + 1, late: Boolean(assignment.due_at && Date.parse(assignment.due_at) < Date.now()) },
  });

  const submission = await assignmentsRepo.findSubmissionById(db, submissionId);
  return created(c, submission ? toSubmissionDto(submission, 'student') : { id: submissionId });
});

assignmentRoutes.get('/me/submissions', requireVerified(), async (c) => {
  const auth = c.get('auth')!;
  const db = createDb(c.env.DB);
  const submissions = await assignmentsRepo.listSubmissionsForUser(db, auth.userId);
  return ok(c, submissions.map((submission) => toSubmissionDto(submission, 'student')));
});
