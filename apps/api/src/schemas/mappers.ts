/**
 * DTO mappers — database rows to API payloads.
 *
 * Two jobs, both security-relevant:
 *
 *   1. **Shape.** JSON is emitted in snake_case matching the SQL columns, so the
 *      frontend never has to guess a translation and the API reference can list
 *      exact field names.
 *
 *   2. **Redaction.** Every mapper is an allow-list: fields that must not leave
 *      the server (password hashes, `is_correct` answer keys, R2 keys of private
 *      files, internal notes) are simply not copied. A column added to a table in
 *      a future migration is therefore *not* exposed until a mapper is updated —
 *      the safe default.
 */
import type { PublicCourseRow, DepartmentStatsRow, SkillRow, SubjectWithDepartmentRow } from '../db/repositories/catalog.js';
import type {
  CurriculumLessonRow,
  LessonDetailRow,
  ModuleRow,
  ResourceRow,
  VideoRow,
} from '../db/repositories/curriculum.js';
import type { EnrollmentDetailRow } from '../db/repositories/enrollments.js';
import type { CertificateDetailRow, CertificateRow } from '../db/repositories/certificates.js';
import type { AssignmentRow, SubmissionDetailRow } from '../db/repositories/assignments.js';
import type { QuestionRow, AttemptDetailRow, AttemptAnswerRow } from '../db/repositories/quizzes.js';
import type { NotificationRow } from '../db/repositories/notifications.js';
import type { AuditRow } from '../db/repositories/audit.js';
import type { UserRow } from '../db/repositories/users.js';
import type { QrCodeRow } from '../db/repositories/qr.js';
import { excerpt, renderMarkdown } from '../lib/text.js';
import { buildEmbedUrl, buildThumbnailUrl, buildWatchUrl } from '../lib/youtube.js';

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* --------------------------------- catalog -------------------------------- */

export function toDepartmentDto(row: DepartmentStatsRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    description: row.description ?? null,
    icon: row.icon,
    image_url: row.image_url ?? null,
    display_order: row.display_order,
    status: row.status,
    subject_count: Number(row.subject_count ?? 0),
    course_count: Number(row.course_count ?? 0),
    lesson_count: Number(row.lesson_count ?? 0),
    student_count: Number(row.student_count ?? 0),
  };
}

export function toSubjectDto(row: SubjectWithDepartmentRow & { status?: string }) {
  return {
    id: row.id,
    department_id: row.department_id,
    department_name: row.department_name,
    department_slug: row.department_slug,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    display_order: row.display_order,
    status: row.status,
    course_count: Number(row.course_count ?? 0),
  };
}

/** Public course card / detail payload. */
export function toPublicCourseDto(row: PublicCourseRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    difficulty: row.difficulty,
    estimated_minutes: Number(row.estimated_minutes ?? 0),
    thumbnail_url: row.thumbnail_url,
    instructor_name: row.instructor_name,
    language: row.language,
    is_featured: Boolean(row.is_featured),
    enrollment_open: Boolean(row.enrollment_open),
    certificate_enabled: Boolean(row.certificate_enabled),
    published_at: row.published_at,
    subject: { id: row.subject_id, name: row.subject_name, slug: row.subject_slug },
    department: {
      id: row.department_id,
      name: row.department_name,
      slug: row.department_slug,
      icon: row.department_icon,
    },
    module_count: Number(row.module_count ?? 0),
    lesson_count: Number(row.lesson_count ?? 0),
    enrollment_count: Number(row.enrollment_count ?? 0),
    average_rating: row.average_rating === null ? null : Number(row.average_rating),
    review_count: Number(row.review_count ?? 0),
    learning_outcomes: parseJsonArray(row.learning_outcomes_json),
    prerequisites: parseJsonArray(row.prerequisites_json),
  };
}

export function toPublicCourseCardDto(row: PublicCourseRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    difficulty: row.difficulty,
    estimated_minutes: Number(row.estimated_minutes ?? 0),
    thumbnail_url: row.thumbnail_url,
    instructor_name: row.instructor_name,
    is_featured: Boolean(row.is_featured),
    department: { name: row.department_name, slug: row.department_slug, icon: row.department_icon },
    subject: { name: row.subject_name, slug: row.subject_slug },
    module_count: Number(row.module_count ?? 0),
    lesson_count: Number(row.lesson_count ?? 0),
    enrollment_count: Number(row.enrollment_count ?? 0),
  };
}

export function toSkillDto(row: SkillRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    description: row.description,
  };
}

/* ------------------------------- curriculum ------------------------------- */

export function toModuleDto(row: ModuleRow, lessons: CurriculumLessonRow[] = []) {
  return {
    id: row.id,
    course_id: row.course_id,
    title: row.title,
    description: row.description,
    position: row.position,
    status: row.status,
    lesson_count: lessons.length,
    estimated_minutes: lessons.reduce((total, lesson) => total + Number(lesson.estimated_minutes ?? 0), 0),
    lessons: lessons.map((lesson) => toLessonCardDto(lesson)),
  };
}

/** Curriculum listing entry — deliberately excludes `content_md`. */
export function toLessonCardDto(row: CurriculumLessonRow) {
  return {
    id: row.id,
    module_id: row.module_id,
    title: row.title,
    slug: row.slug,
    position: row.position,
    estimated_minutes: Number(row.estimated_minutes ?? 0),
    is_preview: Boolean(row.is_preview),
    completion_rule: row.completion_rule,
    status: row.status,
    video_count: Number(row.video_count ?? 0),
    resource_count: Number(row.resource_count ?? 0),
  };
}

export function toVideoDto(row: VideoRow) {
  return {
    id: row.id,
    provider: row.provider,
    provider_video_id: row.provider_video_id,
    title: row.title,
    description: row.description,
    thumbnail_url: row.thumbnail_url ?? buildThumbnailUrl(row.provider_video_id),
    embed_url: buildEmbedUrl(row.provider_video_id),
    watch_url: buildWatchUrl(row.provider_video_id),
    duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    position: row.position,
    is_primary: Boolean(row.is_primary),
  };
}

/**
 * Resources are redacted per audience: `r2_key` (a storage path) is only exposed
 * to administrators, and private resources are omitted entirely from public
 * payloads by the caller.
 */
export function toResourceDto(row: ResourceRow, audience: 'public' | 'enrolled' | 'admin') {
  const base = {
    id: row.id,
    title: row.title,
    kind: row.kind,
    url: row.kind === 'video' ? row.url : row.url,
    size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
    is_public: Boolean(row.is_public),
    position: row.position,
    lesson_id: row.lesson_id,
    course_id: row.course_id,
  };
  return audience === 'admin' ? { ...base, r2_key: row.r2_key } : base;
}

/** Full lesson payload — only returned to enrolled learners or administrators. */
export function toLessonDetailDto(
  row: LessonDetailRow,
  videos: VideoRow[],
  resources: ResourceRow[],
  audience: 'enrolled' | 'admin',
) {
  return {
    id: row.id,
    module: { id: row.module_id, title: row.module_title, position: row.module_position },
    course: {
      id: row.course_id,
      title: row.course_title,
      slug: row.course_slug,
      status: row.course_status,
      subject_name: row.subject_name,
      department_name: row.department_name,
    },
    title: row.title,
    slug: row.slug,
    content_md: row.content_md,
    /**
     * Server-rendered HTML for the same content.
     *
     * Rendering once on the server means the browser never has to trust-and-parse
     * authored Markdown: `renderMarkdown()` escapes HTML before applying any
     * formatting, so this string is safe to assign to innerHTML (see lib/text.ts).
     * The raw Markdown stays in the payload for editors and for copying.
     */
    content_html: renderMarkdown(row.content_md),
    objectives: parseJsonArray(row.objectives_json),
    position: row.position,
    estimated_minutes: Number(row.estimated_minutes ?? 0),
    is_preview: Boolean(row.is_preview),
    completion_rule: row.completion_rule,
    videos: videos.map(toVideoDto),
    resources: resources.map((resource) => toResourceDto(resource, audience)),
  };
}

/** Public preview of a lesson: title, objectives and media, but no full text. */
export function toLessonPreviewDto(row: LessonDetailRow, videos: VideoRow[]) {
  return {
    id: row.id,
    title: row.title,
    course: { title: row.course_title, slug: row.course_slug },
    module_title: row.module_title,
    estimated_minutes: Number(row.estimated_minutes ?? 0),
    objectives: parseJsonArray(row.objectives_json),
    excerpt: excerpt(row.content_md, 280),
    videos: videos.map(toVideoDto),
  };
}

/* --------------------------------- users --------------------------------- */

/** Public/self projection of a user — no hashes, locks or audit fields. */
export function toUserProfileDto(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role_key,
    status: row.status,
    email_verified: row.email_verified_at !== null,
    email_verified_at: row.email_verified_at,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    profile: {
      student_number: row.student_number,
      display_name: row.display_name,
      full_name: row.full_name,
      education_level: row.education_level,
      country: row.country,
      timezone: row.timezone,
      interests: parseJsonArray(row.interests_json),
      goals: row.goals,
      bio: row.bio,
      avatar_url: row.avatar_url,
    },
  };
}

/** Administrator view of a student: adds moderation-relevant fields only. */
export function toAdminUserDto(row: UserRow) {
  return {
    ...toUserProfileDto(row),
    failed_login_attempts: Number(row.failed_login_attempts ?? 0),
    locked_until: row.locked_until,
    role_rank: Number(row.role_rank ?? 0),
    updated_at: row.updated_at,
  };
}

/* ------------------------------- learning -------------------------------- */

export function toEnrollmentDto(row: EnrollmentDetailRow, options: { includeStudent?: boolean } = {}) {
  const base = {
    id: row.id,
    status: row.status,
    progress_percent: Number(row.progress_percent ?? 0),
    lessons_completed: Number(row.lessons_completed ?? 0),
    total_lessons: Number(row.total_lessons ?? 0),
    enrolled_at: row.enrolled_at,
    last_activity_at: row.last_activity_at,
    completed_at: row.completed_at,
    certificate_issued_at: row.certificate_issued_at,
    last_lesson_id: row.last_lesson_id,
    course: {
      id: row.course_id,
      title: row.course_title,
      slug: row.course_slug,
      thumbnail_url: row.course_thumbnail_url,
      difficulty: row.course_difficulty,
      subject_name: row.subject_name,
      department_name: row.department_name,
    },
    certificates_issued: Number(row.certificates_issued ?? 0),
    average_quiz_score: row.average_quiz_score === null ? null : Number(row.average_quiz_score),
  };

  if (!options.includeStudent) return base;
  return {
    ...base,
    student: {
      id: row.user_id,
      email: row.user_email,
      name: row.student_name,
      student_number: row.student_number,
    },
  };
}

export function toCertificateDto(row: CertificateDetailRow | CertificateRow & Partial<CertificateDetailRow>) {
  return {
    id: row.id,
    certificate_number: row.certificate_number,
    verification_code: row.verification_code,
    title: row.title,
    grade: row.grade,
    final_score_percent: row.final_score_percent === null ? null : Number(row.final_score_percent),
    issued_at: row.issued_at,
    revoked_at: row.revoked_at ?? null,
    valid: !row.revoked_at,
    course: 'course_title' in row && row.course_title
      ? { id: row.course_id, title: row.course_title, slug: row.course_slug ?? null }
      : { id: row.course_id, title: null, slug: null },
    holder: 'holder_email' in row && row.holder_email
      ? { name: row.holder_name ?? null, student_number: row.student_number ?? null }
      : undefined,
  };
}

/** Public verification payload — see lib/certificates.ts for the rationale. */
export function toPublicVerificationDto(row: CertificateDetailRow) {
  return {
    type: 'certificate' as const,
    valid: !row.revoked_at,
    certificate_number: row.certificate_number,
    verification_code: row.verification_code,
    course_title: row.course_title,
    holder_name: row.holder_name ?? 'G WORLD learner',
    student_number: row.student_number,
    grade: row.grade,
    issued_at: row.issued_at,
    revoked_at: row.revoked_at,
    department_name: row.department_name,
  };
}

/* ------------------------------ assessments ------------------------------ */

export function toQuizDto(
  row: {
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
  },
  extra: { question_count?: number; attempts_used?: number } = {},
) {
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    question_count: extra.question_count,
    attempts_used: extra.attempts_used,
  };
}

/**
 * Student-facing question payload: no `is_correct`, no `explanation`, no answer
 * key of any kind. Options are returned in their authored order (the repository
 * shuffles only when the quiz asks for it).
 */
export function toStudentQuestionDto(question: {
  id: string;
  question_type: string;
  prompt: string;
  points: number;
  options: { id: string; label: string }[];
}) {
  return {
    id: question.id,
    type: question.question_type,
    prompt: question.prompt,
    points: Number(question.points),
    options: question.options.map((option) => ({ id: option.id, label: option.label })),
  };
}

/** Administrator question payload: includes the answer key. */
export function toAdminQuestionDto(question: QuestionRow & { options: { id: string; label: string; is_correct: number; position: number }[] }) {
  return {
    id: question.id,
    type: question.question_type,
    prompt: question.prompt,
    explanation: question.explanation,
    points: Number(question.points),
    position: question.position,
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      is_correct: Boolean(option.is_correct),
      position: option.position,
    })),
  };
}

export function toAttemptDto(row: AttemptDetailRow, options: { includeStudent?: boolean } = {}) {
  const base = {
    id: row.id,
    quiz_id: row.quiz_id,
    quiz_title: row.quiz_title,
    attempt_number: Number(row.attempt_number),
    status: row.status,
    score_points: Number(row.score_points ?? 0),
    max_points: Number(row.max_points ?? 0),
    score_percent: Number(row.score_percent ?? 0),
    passed: Boolean(row.passed),
    pass_mark_percent: Number(row.pass_mark_percent ?? 0),
    started_at: row.started_at,
    submitted_at: row.submitted_at,
    time_spent_seconds: Number(row.time_spent_seconds ?? 0),
    course: row.course_id ? { id: row.course_id, title: row.course_title } : null,
  };
  if (!options.includeStudent) return base;
  return {
    ...base,
    student: {
      id: row.user_id,
      email: row.user_email,
      name: row.student_name,
      student_number: row.student_number,
    },
  };
}

export function toAttemptAnswerDto(row: AttemptAnswerRow, reveal: boolean) {
  const selected: string[] = parseJsonArray(row.selected_option_ids) as string[];
  return {
    question_id: row.question_id,
    prompt: row.prompt,
    type: row.question_type,
    points: Number(row.points),
    points_awarded: Number(row.points_awarded ?? 0),
    selected_option_ids: selected,
    answer_text: row.answer_text,
    // The key is revealed only when the quiz settings allow it and the attempt is
    // already graded — see routes/assessments/quizzes.ts.
    is_correct: reveal ? Boolean(row.is_correct) : undefined,
    explanation: reveal ? row.explanation : undefined,
  };
}

export function toAssignmentDto(row: AssignmentRow, submissionCount?: number) {
  return {
    id: row.id,
    course_id: row.course_id,
    module_id: row.module_id,
    lesson_id: row.lesson_id,
    title: row.title,
    instructions_md: row.instructions_md,
    max_points: Number(row.max_points),
    pass_mark_percent: Number(row.pass_mark_percent),
    due_at: row.due_at,
    allow_late: Boolean(row.allow_late),
    submission_type: row.submission_type,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    submission_count: submissionCount,
  };
}

export function toSubmissionDto(row: SubmissionDetailRow, audience: 'student' | 'admin') {
  const base = {
    id: row.id,
    assignment_id: row.assignment_id,
    assignment_title: row.assignment_title,
    attempt_number: Number(row.attempt_number),
    status: row.status,
    submission_text: row.submission_text,
    link_url: row.link_url,
    score_points: row.score_points === null ? null : Number(row.score_points),
    max_points: Number(row.max_points_allowed ?? 0),
    feedback: row.feedback,
    submitted_at: row.submitted_at,
    graded_at: row.graded_at,
  };
  if (audience === 'student') return base;
  return {
    ...base,
    student: {
      id: row.user_id,
      email: row.user_email,
      name: row.student_name,
      student_number: row.student_number,
    },
    r2_key: row.r2_key,
  };
}

/* ------------------------------ platform -------------------------------- */

export function toNotificationDto(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link_url: row.link_url,
    read: row.read_at !== null,
    created_at: row.created_at,
  };
}

export function toAuditDto(row: AuditRow & { actor_email?: string | null; actor_name?: string | null }) {
  let metadata: unknown = {};
  try {
    metadata = JSON.parse(row.metadata_json ?? '{}');
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    description: row.description,
    status: row.status,
    metadata,
    request_id: row.request_id,
    created_at: row.created_at,
    actor: row.actor_user_id
      ? {
          id: row.actor_user_id,
          role: row.actor_role,
          email: row.actor_email ?? null,
          name: row.actor_name ?? null,
        }
      : null,
  };
}

/** QR code metadata (the SVG itself is rendered on demand). */
export function toQrDto(row: QrCodeRow) {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    payload_url: row.payload_url,
    scan_count: Number(row.scan_count ?? 0),
    last_scanned_at: row.last_scanned_at,
    expires_at: row.expires_at,
    revoked: row.revoked_at !== null,
    created_at: row.created_at,
  };
}
