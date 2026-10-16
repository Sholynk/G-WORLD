/**
 * Repository — assignments and submissions.
 *
 * Submissions are append-mostly: a learner's attempt history is kept (unique per
 * attempt number), and grading never rewrites the learner's text — the score,
 * feedback and status are separate columns, so an appeal can be reviewed against
 * exactly what was submitted.
 */
import type { Db } from '../client.js';
import type { PublicationStatus, SubmissionStatus } from '@g-world/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

export interface AssignmentRow {
  id: string;
  course_id: string | null;
  module_id: string | null;
  lesson_id: string | null;
  title: string;
  instructions_md: string;
  max_points: number;
  pass_mark_percent: number;
  due_at: string | null;
  allow_late: number;
  submission_type: 'text' | 'file' | 'link' | 'mixed';
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
}

export interface SubmissionRow {
  id: string;
  assignment_id: string;
  user_id: string;
  enrollment_id: string | null;
  attempt_number: number;
  submission_text: string | null;
  link_url: string | null;
  r2_key: string | null;
  status: SubmissionStatus;
  score_points: number | null;
  feedback: string | null;
  graded_by: string | null;
  graded_at: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

export interface SubmissionDetailRow extends SubmissionRow {
  assignment_title: string;
  max_points_allowed: number;
  pass_mark_percent: number;
  course_id: string | null;
  course_title: string | null;
  user_email: string;
  student_number: string | null;
  student_name: string | null;
}

const SUBMISSION_DETAIL_SELECT = `
  SELECT s.id, s.assignment_id, s.user_id, s.enrollment_id, s.attempt_number, s.submission_text,
         s.link_url, s.r2_key, s.status, s.score_points, s.feedback, s.graded_by, s.graded_at,
         s.submitted_at, s.created_at, s.updated_at,
         a.title AS assignment_title, a.max_points AS max_points_allowed, a.pass_mark_percent,
         a.course_id AS course_id, c.title AS course_title,
         u.email AS user_email, sp.student_number, COALESCE(sp.display_name, sp.full_name) AS student_name
    FROM assignment_submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    LEFT JOIN courses c ON c.id = a.course_id`;

/* ------------------------------- assignments ------------------------------- */

export async function findAssignmentById(db: Db, id: string): Promise<AssignmentRow | null> {
  return db.first<AssignmentRow>(
    `SELECT id, course_id, module_id, lesson_id, title, instructions_md, max_points, pass_mark_percent,
            due_at, allow_late, submission_type, status, created_at, updated_at
       FROM assignments WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function listAssignmentsForCourse(db: Db, courseId: string): Promise<AssignmentRow[]> {
  return db.all<AssignmentRow>(
    `SELECT a.id, a.course_id, a.module_id, a.lesson_id, a.title, a.instructions_md, a.max_points,
            a.pass_mark_percent, a.due_at, a.allow_late, a.submission_type, a.status,
            a.created_at, a.updated_at
       FROM assignments a
       LEFT JOIN modules m ON m.id = a.module_id
      WHERE a.course_id = ? OR m.course_id = ?
      ORDER BY a.created_at ASC`,
    [courseId, courseId],
  );
}

export async function listAssignmentsForLesson(db: Db, lessonId: string): Promise<AssignmentRow[]> {
  return db.all<AssignmentRow>(
    `SELECT id, course_id, module_id, lesson_id, title, instructions_md, max_points, pass_mark_percent,
            due_at, allow_late, submission_type, status, created_at, updated_at
       FROM assignments WHERE lesson_id = ? ORDER BY created_at ASC`,
    [lessonId],
  );
}

export interface CreateAssignmentInput {
  courseId?: string | null;
  moduleId?: string | null;
  lessonId?: string | null;
  title: string;
  instructionsMd?: string;
  maxPoints?: number;
  passMarkPercent?: number;
  dueAt?: string | null;
  allowLate?: boolean;
  submissionType?: 'text' | 'file' | 'link' | 'mixed';
  status?: PublicationStatus;
  createdBy?: string | null;
}

export async function createAssignment(db: Db, input: CreateAssignmentInput): Promise<string> {
  const id = newId(ID_PREFIXES.assignment);
  await db.run(
    `INSERT INTO assignments (id, course_id, module_id, lesson_id, title, instructions_md, max_points,
                              pass_mark_percent, due_at, allow_late, submission_type, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.courseId ?? null,
      input.moduleId ?? null,
      input.lessonId ?? null,
      input.title,
      input.instructionsMd ?? '',
      input.maxPoints ?? 100,
      input.passMarkPercent ?? 60,
      input.dueAt ?? null,
      input.allowLate === false ? 0 : 1,
      input.submissionType ?? 'text',
      input.status ?? 'draft',
      input.createdBy ?? null,
    ],
  );
  return id;
}

export async function updateAssignment(
  db: Db,
  id: string,
  input: Partial<Omit<CreateAssignmentInput, 'createdBy'>>,
): Promise<number> {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  const push = (column: string, value: string | number | null) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (input.title !== undefined) push('title', input.title);
  if (input.instructionsMd !== undefined) push('instructions_md', input.instructionsMd);
  if (input.maxPoints !== undefined) push('max_points', input.maxPoints);
  if (input.passMarkPercent !== undefined) push('pass_mark_percent', input.passMarkPercent);
  if (input.dueAt !== undefined) push('due_at', input.dueAt);
  if (input.allowLate !== undefined) push('allow_late', input.allowLate ? 1 : 0);
  if (input.submissionType !== undefined) push('submission_type', input.submissionType);
  if (input.status !== undefined) push('status', input.status);

  if (!assignments.length) return 0;
  params.push(id);
  return db.changes(`UPDATE assignments SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function deleteAssignment(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM assignments WHERE id = ?`, [id]);
}

/* ------------------------------- submissions ------------------------------- */

export async function countSubmissions(db: Db, assignmentId: string, userId: string): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM assignment_submissions WHERE assignment_id = ? AND user_id = ?`, [
    assignmentId,
    userId,
  ]);
}

export async function findSubmission(
  db: Db,
  assignmentId: string,
  userId: string,
): Promise<SubmissionRow | null> {
  return db.first<SubmissionRow>(
    `SELECT id, assignment_id, user_id, enrollment_id, attempt_number, submission_text, link_url, r2_key,
            status, score_points, feedback, graded_by, graded_at, submitted_at, created_at, updated_at
       FROM assignment_submissions
      WHERE assignment_id = ? AND user_id = ?
      ORDER BY attempt_number DESC LIMIT 1`,
    [assignmentId, userId],
  );
}

export async function findSubmissionById(db: Db, id: string): Promise<SubmissionDetailRow | null> {
  return db.first<SubmissionDetailRow>(`${SUBMISSION_DETAIL_SELECT} WHERE s.id = ? LIMIT 1`, [id]);
}

export async function createSubmission(
  db: Db,
  input: {
    assignmentId: string;
    userId: string;
    enrollmentId?: string | null;
    attemptNumber: number;
    submissionText?: string | null;
    linkUrl?: string | null;
    r2Key?: string | null;
  },
): Promise<string> {
  const id = newId(ID_PREFIXES.submission);
  await db.run(
    `INSERT INTO assignment_submissions (id, assignment_id, user_id, enrollment_id, attempt_number,
                                         submission_text, link_url, r2_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
    [
      id,
      input.assignmentId,
      input.userId,
      input.enrollmentId ?? null,
      input.attemptNumber,
      input.submissionText ?? null,
      input.linkUrl ?? null,
      input.r2Key ?? null,
    ],
  );
  return id;
}

export async function gradeSubmission(
  db: Db,
  input: {
    submissionId: string;
    scorePoints: number;
    feedback?: string | null;
    status: SubmissionStatus;
    gradedBy: string;
  },
): Promise<number> {
  const now = new Date().toISOString();
  return db.changes(
    `UPDATE assignment_submissions
        SET score_points = ?, feedback = ?, status = ?, graded_by = ?, graded_at = ?, updated_at = ?
      WHERE id = ?`,
    [input.scorePoints, input.feedback ?? null, input.status, input.gradedBy, now, now, input.submissionId],
  );
}

export interface AdminSubmissionFilters {
  assignmentId?: string | null;
  userId?: string | null;
  status?: SubmissionStatus | null;
  page: number;
  perPage: number;
}

export async function listSubmissionsForAdmin(
  db: Db,
  filters: AdminSubmissionFilters,
): Promise<{ items: SubmissionDetailRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filters.assignmentId) {
    conditions.push(`s.assignment_id = ?`);
    params.push(filters.assignmentId);
  }
  if (filters.userId) {
    conditions.push(`s.user_id = ?`);
    params.push(filters.userId);
  }
  if (filters.status) {
    conditions.push(`s.status = ?`);
    params.push(filters.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = await db.count(`SELECT COUNT(*) AS total FROM assignment_submissions s ${where}`, params);
  const items = await db.all<SubmissionDetailRow>(
    `${SUBMISSION_DETAIL_SELECT} ${where} ORDER BY s.submitted_at DESC LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );
  return { items, total };
}

export async function listSubmissionsForUser(db: Db, userId: string): Promise<SubmissionDetailRow[]> {
  return db.all<SubmissionDetailRow>(
    `${SUBMISSION_DETAIL_SELECT} WHERE s.user_id = ? ORDER BY s.submitted_at DESC LIMIT 100`,
    [userId],
  );
}

export async function countUngradedSubmissions(db: Db): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM assignment_submissions WHERE status = 'submitted'`);
}
