/**
 * G WORLD — shared status/type vocabularies.
 *
 * Each tuple mirrors a CHECK constraint in database/migrations. Routes use the
 * derived Zod enums so an invalid status is rejected at the API boundary with a
 * field-level error instead of surfacing as a database constraint failure.
 */

export const PUBLICATION_STATUSES = ['draft', 'published', 'archived'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const ACCOUNT_STATUSES = ['pending_verification', 'active', 'suspended', 'deactivated'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ENROLLMENT_STATUSES = ['active', 'completed', 'cancelled', 'expired'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const LESSON_PROGRESS_STATUSES = ['not_started', 'in_progress', 'completed'] as const;
export type LessonProgressStatus = (typeof LESSON_PROGRESS_STATUSES)[number];

export const COMPLETION_RULES = ['view', 'mark_complete', 'quiz_pass'] as const;
export type CompletionRule = (typeof COMPLETION_RULES)[number];

export const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'short_answer'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'graded', 'expired', 'abandoned'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const SUBMISSION_STATUSES = ['submitted', 'graded', 'returned', 'resubmit_requested'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const RESOURCE_KINDS = ['pdf', 'link', 'article', 'download', 'video'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const NOTIFICATION_TYPES = [
  'info', 'success', 'warning', 'error', 'enrollment', 'assessment', 'certificate', 'announcement',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EDUCATION_LEVELS = [
  'secondary', 'undergraduate', 'graduate', 'postgraduate', 'professional', 'other',
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const VIDEO_PROVIDERS = ['youtube'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export const EMAIL_STATUSES = ['queued', 'logged', 'sent', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Numeric constants that mirror CHECK constraints, so code and schema agree. */
export const LIMITS = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  EMAIL_MAX_LENGTH: 254,
  DISPLAY_NAME_MIN: 2,
  DISPLAY_NAME_MAX: 80,
  COURSE_TITLE_MIN: 3,
  COURSE_TITLE_MAX: 180,
  SUMMARY_MAX: 300,
  DESCRIPTION_MAX: 20000,
  LESSON_CONTENT_MAX: 100000,
  QUIZ_POINTS_MIN: 1,
  QUIZ_POINTS_MAX: 100,
  PASS_MARK_MIN: 1,
  PASS_MARK_MAX: 100,
  MAX_ATTEMPTS_MIN: 1,
  MAX_ATTEMPTS_MAX: 50,
  RATING_MIN: 1,
  RATING_MAX: 5,
  PAGE_SIZE_DEFAULT: 12,
  PAGE_SIZE_MAX: 100,
} as const;
