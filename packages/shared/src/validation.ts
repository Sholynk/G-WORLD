/**
 * G WORLD — request validation schemas (Zod 4).
 *
 * These schemas are the contract between the frontend, the API and the tests:
 *   - the API validates body/query/params with them (422 + field errors)
 *   - integration tests import the same objects to build valid payloads
 *   - the shape of every payload is therefore documented in exactly one place
 *
 * Validation is deliberately strict: unknown keys are stripped, strings are
 * trimmed, and every length/range bound matches a CHECK constraint in the SQL
 * migrations so a schema change cannot be forgotten on either side.
 */
import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
  ATTEMPT_STATUSES,
  DIFFICULTY_LEVELS,
  EDUCATION_LEVELS,
  ENROLLMENT_STATUSES,
  LESSON_PROGRESS_STATUSES,
  LIMITS,
  PUBLICATION_STATUSES,
  QUESTION_TYPES,
  RESOURCE_KINDS,
  SUBMISSION_STATUSES,
  COMPLETION_RULES,
} from './status.js';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

export const idSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Identifiers may contain letters, digits, dash and underscore only');

/**
 * Normalisation happens *before* the format check on purpose: phones and
 * password managers routinely hand us " student@example.com" and a user should
 * not be told their address is invalid because of a stray space.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.EMAIL_MAX_LENGTH, `Email must be at most ${LIMITS.EMAIL_MAX_LENGTH} characters`)
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(LIMITS.PASSWORD_MIN_LENGTH, `Password must be at least ${LIMITS.PASSWORD_MIN_LENGTH} characters`)
  .max(LIMITS.PASSWORD_MAX_LENGTH, `Password must be at most ${LIMITS.PASSWORD_MAX_LENGTH} characters`)
  .refine((value) => /[a-z]/.test(value), 'Include at least one lowercase letter')
  .refine((value) => /[A-Z]/.test(value) || /[0-9]/.test(value), 'Include at least one uppercase letter or digit');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single dashes');

export const displayNameSchema = z
  .string()
  .trim()
  .min(LIMITS.DISPLAY_NAME_MIN)
  .max(LIMITS.DISPLAY_NAME_MAX);

export const urlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https:\/\/[^\s]+$/i.test(value) || /^\/[^\s]*$/.test(value), {
    message: 'Use an https:// URL or a site-relative path',
  });

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const intFromQuery = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

/* -------------------------------------------------------------------------- */
/* Pagination + listing                                                        */
/* -------------------------------------------------------------------------- */

export const paginationQuerySchema = z.object({
  page: intFromQuery(1, 1, 10_000),
  per_page: intFromQuery(LIMITS.PAGE_SIZE_DEFAULT, 1, LIMITS.PAGE_SIZE_MAX),
});

export const sortQuerySchema = z.object({
  sort: z
    .enum(['newest', 'oldest', 'title', 'popular', 'duration', 'difficulty'])
    .default('newest'),
});

export const courseListQuerySchema = paginationQuerySchema.merge(sortQuerySchema).extend({
  q: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  subject: z.string().trim().max(120).optional(),
  difficulty: z.enum(DIFFICULTY_LEVELS).optional(),
  featured: z.coerce.boolean().optional(),
});

export const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(2, 'Enter at least two characters').max(120),
  type: z.enum(['all', 'course', 'subject', 'department', 'lesson']).default('all'),
});

/* -------------------------------------------------------------------------- */
/* Authentication                                                              */
/* -------------------------------------------------------------------------- */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  display_name: displayNameSchema.optional(),
  full_name: optionalText(120),
  education_level: z.enum(EDUCATION_LEVELS).optional(),
  country: optionalText(80),
  interests: z.array(z.string().trim().min(2).max(60)).max(12).optional(),
  accepted_terms: z.literal(true, { message: 'You must accept the terms to register' }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(LIMITS.PASSWORD_MAX_LENGTH),
  remember: z.boolean().optional().default(false),
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const resendVerificationSchema = z.object({ email: emailSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(LIMITS.PASSWORD_MAX_LENGTH),
  new_password: passwordSchema,
});

export const updateProfileSchema = z
  .object({
    display_name: displayNameSchema.optional(),
    full_name: optionalText(120),
    education_level: z.enum(EDUCATION_LEVELS).nullable().optional(),
    country: optionalText(80),
    timezone: optionalText(64),
    interests: z.array(z.string().trim().min(2).max(60)).max(12).optional(),
    goals: optionalText(1000),
    bio: optionalText(1000),
    avatar_url: urlSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

/* -------------------------------------------------------------------------- */
/* Academic content (admin authoring)                                          */
/* -------------------------------------------------------------------------- */

export const departmentInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema.optional(),
  tagline: optionalText(160),
  description: optionalText(5000),
  icon: optionalText(64),
  image_url: urlSchema.nullable().optional(),
  display_order: z.coerce.number().int().min(0).max(9999).default(0),
  status: z.enum(PUBLICATION_STATUSES).default('draft'),
});

export const departmentUpdateSchema = departmentInputSchema.partial();

export const subjectInputSchema = z.object({
  department_id: idSchema,
  name: z.string().trim().min(2).max(120),
  slug: slugSchema.optional(),
  description: optionalText(5000),
  icon: optionalText(64),
  display_order: z.coerce.number().int().min(0).max(9999).default(0),
  status: z.enum(PUBLICATION_STATUSES).default('draft'),
});

export const subjectUpdateSchema = subjectInputSchema.partial().omit({ department_id: true }).extend({
  department_id: idSchema.optional(),
});

export const courseInputSchema = z.object({
  subject_id: idSchema,
  title: z.string().trim().min(LIMITS.COURSE_TITLE_MIN).max(LIMITS.COURSE_TITLE_MAX),
  slug: slugSchema.optional(),
  summary: optionalText(LIMITS.SUMMARY_MAX),
  description: optionalText(LIMITS.DESCRIPTION_MAX),
  learning_outcomes: z.array(z.string().trim().min(3).max(300)).max(30).optional(),
  prerequisites: z.array(z.string().trim().min(3).max(300)).max(30).optional(),
  difficulty: z.enum(DIFFICULTY_LEVELS).default('beginner'),
  estimated_minutes: z.coerce.number().int().min(0).max(100_000).default(0),
  thumbnail_url: urlSchema.nullable().optional(),
  instructor_name: optionalText(120),
  instructor_bio: optionalText(2000),
  language: z.string().trim().length(2).default('en'),
  status: z.enum(PUBLICATION_STATUSES).default('draft'),
  is_featured: z.coerce.boolean().default(false),
  enrollment_open: z.coerce.boolean().default(true),
  certificate_enabled: z.coerce.boolean().default(true),
  skills: z
    .object({
      acquired: z.array(idSchema).max(40).optional(),
      required: z.array(idSchema).max(40).optional(),
    })
    .optional(),
});

export const courseUpdateSchema = courseInputSchema.partial();

export const moduleInputSchema = z.object({
  course_id: idSchema,
  title: z.string().trim().min(2).max(180),
  description: optionalText(5000),
  position: z.coerce.number().int().min(0).max(999).optional(),
  status: z.enum(PUBLICATION_STATUSES).default('draft'),
});

export const moduleUpdateSchema = moduleInputSchema.partial().omit({ course_id: true }).extend({
  course_id: idSchema.optional(),
});

export const lessonInputSchema = z.object({
  module_id: idSchema,
  title: z.string().trim().min(2).max(200),
  slug: slugSchema.optional(),
  content_md: z.string().max(LIMITS.LESSON_CONTENT_MAX).default(''),
  objectives: z.array(z.string().trim().min(3).max(300)).max(20).optional(),
  position: z.coerce.number().int().min(0).max(999).optional(),
  estimated_minutes: z.coerce.number().int().min(0).max(10_000).default(0),
  is_preview: z.coerce.boolean().default(false),
  completion_rule: z.enum(COMPLETION_RULES).default('mark_complete'),
  status: z.enum(PUBLICATION_STATUSES).default('draft'),
});

export const lessonUpdateSchema = lessonInputSchema.partial().omit({ module_id: true }).extend({
  module_id: idSchema.optional(),
});

export const reorderSchema = z.object({
  order: z.array(z.object({ id: idSchema, position: z.coerce.number().int().min(0).max(9999) })).min(1).max(500),
});

/** Accepts a bare YouTube id, watch URL, share URL, embed URL or shorts URL. */
export const youtubeVideoSchema = z.object({
  lesson_id: idSchema,
  url: z.string().trim().min(5).max(2048).optional(),
  provider_video_id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{6,20}$/, 'Expected an 11-character YouTube video id')
    .optional(),
  title: optionalText(200),
  description: optionalText(2000),
  duration_seconds: z.coerce.number().int().min(0).max(86_400).optional(),
  position: z.coerce.number().int().min(0).max(999).default(0),
  is_primary: z.coerce.boolean().default(false),
}).refine((value) => Boolean(value.url) !== Boolean(value.provider_video_id), {
  message: 'Provide either a YouTube URL or a provider video id',
});

export const resourceInputSchema = z
  .object({
    lesson_id: idSchema.optional(),
    course_id: idSchema.optional(),
    title: z.string().trim().min(2).max(200),
    kind: z.enum(RESOURCE_KINDS).default('link'),
    url: urlSchema.optional(),
    r2_key: z.string().trim().max(512).optional(),
    size_bytes: z.coerce.number().int().min(0).max(5_000_000_000).optional(),
    is_public: z.coerce.boolean().default(false),
    position: z.coerce.number().int().min(0).max(999).default(0),
  })
  .refine((value) => Boolean(value.lesson_id) !== Boolean(value.course_id), {
    message: 'A resource belongs either to a lesson or to a course',
  });

export const skillInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema.optional(),
  category: optionalText(80),
  description: optionalText(1000),
});

/* -------------------------------------------------------------------------- */
/* Learning                                                                    */
/* -------------------------------------------------------------------------- */

export const enrollSchema = z.object({ course_id: idSchema });

export const lessonProgressSchema = z.object({
  lesson_id: idSchema,
  status: z.enum(LESSON_PROGRESS_STATUSES).optional(),
  seconds_spent: z.coerce.number().int().min(0).max(86_400).optional(),
});

/**
 * Completing a lesson: the lesson is identified by the path
 * (`POST /api/v1/lessons/:lessonId/complete`). `lesson_id` may be repeated in
 * the body but must match the path.
 */
export const completeLessonSchema = z.object({
  /** Optional echo of the path parameter; rejected when it contradicts the path. */
  lesson_id: idSchema.optional(),
  seconds_spent: z.coerce.number().int().min(0).max(86_400).optional(),
});

/* -------------------------------------------------------------------------- */
/* Assessments                                                                 */
/* -------------------------------------------------------------------------- */

export const quizInputSchema = z
  .object({
    course_id: idSchema.optional(),
    module_id: idSchema.optional(),
    lesson_id: idSchema.optional(),
    title: z.string().trim().min(3).max(200),
    description: optionalText(2000),
    pass_mark_percent: z.coerce.number().int().min(LIMITS.PASS_MARK_MIN).max(LIMITS.PASS_MARK_MAX).default(70),
    max_attempts: z.coerce.number().int().min(LIMITS.MAX_ATTEMPTS_MIN).max(LIMITS.MAX_ATTEMPTS_MAX).default(3),
    time_limit_minutes: z.coerce.number().int().min(1).max(600).nullable().optional(),
    shuffle_questions: z.coerce.boolean().default(false),
    show_answers: z.enum(['never', 'after_submit', 'after_pass']).default('after_submit'),
    status: z.enum(PUBLICATION_STATUSES).default('draft'),
    questions: z
      .array(
        z.object({
          prompt: z.string().trim().min(3).max(2000),
          question_type: z.enum(QUESTION_TYPES).default('single_choice'),
          explanation: optionalText(2000),
          points: z.coerce.number().int().min(LIMITS.QUIZ_POINTS_MIN).max(LIMITS.QUIZ_POINTS_MAX).default(1),
          position: z.coerce.number().int().min(0).max(999).optional(),
          options: z
            .array(
              z.object({
                label: z.string().trim().min(1).max(500),
                is_correct: z.coerce.boolean().default(false),
                position: z.coerce.number().int().min(0).max(999).optional(),
              }),
            )
            .min(2)
            .max(10),
        }),
      )
      .max(100)
      .optional(),
  })
  .refine(
    (value) =>
      [value.course_id, value.module_id, value.lesson_id].filter((scope) => Boolean(scope)).length === 1,
    { message: 'A quiz belongs to exactly one of course, module or lesson' },
  )
  .refine(
    (value) =>
      !value.questions ||
      value.questions.every((question) =>
        question.question_type === 'short_answer' ||
        question.options.some((option) => option.is_correct),
      ),
    { message: 'Each choice-based question needs at least one correct option' },
  );

export const quizUpdateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: optionalText(2000),
  pass_mark_percent: z.coerce.number().int().min(LIMITS.PASS_MARK_MIN).max(LIMITS.PASS_MARK_MAX).optional(),
  max_attempts: z.coerce.number().int().min(LIMITS.MAX_ATTEMPTS_MIN).max(LIMITS.MAX_ATTEMPTS_MAX).optional(),
  time_limit_minutes: z.coerce.number().int().min(1).max(600).nullable().optional(),
  shuffle_questions: z.coerce.boolean().optional(),
  show_answers: z.enum(['never', 'after_submit', 'after_pass']).optional(),
  status: z.enum(PUBLICATION_STATUSES).optional(),
});

/**
 * Starting an attempt: the quiz is identified by the request path
 * (`POST /api/v1/quizzes/:quizId/attempts`). `quiz_id` may be repeated in the
 * body for symmetry with the other endpoints, but it must match the path — a
 * contradiction is rejected rather than silently ignored.
 */
export const startAttemptSchema = z.object({ quiz_id: idSchema.optional() });

export const submitAttemptSchema = z.object({
  /** Optional echo of the path parameter; rejected when it contradicts the path. */
  attempt_id: idSchema.optional(),
  time_spent_seconds: z.coerce.number().int().min(0).max(86_400).optional(),
  answers: z
    .array(
      z.object({
        question_id: idSchema,
        selected_option_ids: z.array(idSchema).max(10).optional(),
        answer_text: z.string().trim().max(4000).optional(),
      }),
    )
    .max(200),
});

export const assignmentInputSchema = z
  .object({
    course_id: idSchema.optional(),
    module_id: idSchema.optional(),
    lesson_id: idSchema.optional(),
    title: z.string().trim().min(3).max(200),
    instructions_md: z.string().max(20_000).default(''),
    max_points: z.coerce.number().int().min(1).max(1000).default(100),
    pass_mark_percent: z.coerce.number().int().min(1).max(100).default(60),
    due_at: z.iso.datetime({ offset: true }).nullable().optional(),
    allow_late: z.coerce.boolean().default(true),
    submission_type: z.enum(['text', 'file', 'link', 'mixed']).default('text'),
    status: z.enum(PUBLICATION_STATUSES).default('draft'),
  })
  .refine(
    (value) =>
      [value.course_id, value.module_id, value.lesson_id].filter((scope) => Boolean(scope)).length === 1,
    { message: 'An assignment belongs to exactly one of course, module or lesson' },
  );

export const assignmentSubmitSchema = z.object({
  /** Optional echo of the path parameter; rejected when it contradicts the path. */
  assignment_id: idSchema.optional(),
  submission_text: z.string().trim().max(20_000).optional(),
  link_url: urlSchema.optional(),
  r2_key: z.string().trim().max(512).optional(),
}).refine(
  (value) => Boolean(value.submission_text || value.link_url || value.r2_key),
  { message: 'Provide text, a link or a file key' },
);

export const gradeSubmissionSchema = z.object({
  submission_id: idSchema,
  score_points: z.coerce.number().int().min(0).max(1000),
  feedback: optionalText(5000),
  status: z.enum(['graded', 'returned', 'resubmit_requested']).default('graded'),
});

/* -------------------------------------------------------------------------- */
/* Administration                                                              */
/* -------------------------------------------------------------------------- */

export const adminUserListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  role: z.enum(['student', 'admin', 'super_admin', 'public']).optional(),
  verified: z.coerce.boolean().optional(),
});

export const adminEnrollmentListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(ENROLLMENT_STATUSES).optional(),
  course_id: idSchema.optional(),
  user_id: idSchema.optional(),
});

export const adminAttemptListQuerySchema = paginationQuerySchema.extend({
  quiz_id: idSchema.optional(),
  user_id: idSchema.optional(),
  passed: z.coerce.boolean().optional(),
  status: z.enum(ATTEMPT_STATUSES).optional(),
});

export const adminSubmissionListQuerySchema = paginationQuerySchema.extend({
  assignment_id: idSchema.optional(),
  user_id: idSchema.optional(),
  status: z.enum(SUBMISSION_STATUSES).optional(),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(ACCOUNT_STATUSES),
  reason: optionalText(500),
});

export const assignRoleSchema = z.object({
  role: z.enum(['public', 'student', 'admin', 'super_admin']),
  reason: optionalText(500),
});

export const auditQuerySchema = paginationQuerySchema.extend({
  actor: idSchema.optional(),
  action: z.string().trim().max(120).optional(),
  entity_type: z.string().trim().max(60).optional(),
  entity_id: idSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const certificateIssueSchema = z.object({
  user_id: idSchema,
  course_id: idSchema,
  grade: z.enum(['pass', 'merit', 'distinction']).optional(),
  final_score_percent: z.coerce.number().int().min(0).max(100).optional(),
});

export const certificateRevokeSchema = z.object({
  certificate_id: idSchema,
  reason: z.string().trim().min(3).max(500),
});

export const qrLookupSchema = z.object({
  code: z.string().trim().min(3).max(120),
});

export const uploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  content_type: z.enum([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  size_bytes: z.coerce.number().int().min(1).max(25_000_000),
  scope: z.enum(['resource', 'avatar', 'submission']).default('resource'),
});

export const notificationQuerySchema = paginationQuerySchema.extend({
  unread_only: z.coerce.boolean().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DepartmentInput = z.infer<typeof departmentInputSchema>;
export type CourseInput = z.infer<typeof courseInputSchema>;
export type LessonInput = z.infer<typeof lessonInputSchema>;
export type QuizInput = z.infer<typeof quizInputSchema>;
export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;
export type CourseListQuery = z.infer<typeof courseListQuerySchema>;
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
