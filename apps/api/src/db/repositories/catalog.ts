/**
 * Repository — catalog: departments, subjects, courses and skills.
 *
 * Read paths:
 *   - public/visitor reads only ever touch `v_published_courses` and filter with
 *     `status = 'published'`, so an unpublished draft can never leak through a
 *     forgotten WHERE clause in a route.
 *   - administrator reads use the base tables (they must see drafts).
 *
 * Write paths are split into `create…`, `update…` helpers that take already
 * validated input (see schemas/departments.ts) and return the affected row count
 * so a caller can distinguish "updated" from "not found".
 */
import type { Db } from '../client.js';
import type { DifficultyLevel, PublicationStatus } from '@g-world/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

/* ------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* ------------------------------------------------------------------------- */

export interface DepartmentRow {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  icon: string | null;
  image_url: string | null;
  display_order: number;
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
}

export interface DepartmentStatsRow extends DepartmentRow {
  subject_count: number;
  course_count: number;
  lesson_count: number;
  student_count: number;
}

export interface SubjectRow {
  id: string;
  department_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  display_order: number;
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
}

export interface SubjectWithDepartmentRow extends SubjectRow {
  department_name: string;
  department_slug: string;
  course_count: number;
}

export interface CourseRow {
  id: string;
  subject_id: string;
  title: string;
  slug: string;
  summary: string | null;
  description: string | null;
  learning_outcomes_json: string;
  prerequisites_json: string;
  difficulty: DifficultyLevel;
  estimated_minutes: number;
  thumbnail_url: string | null;
  instructor_name: string | null;
  instructor_bio: string | null;
  language: string;
  status: PublicationStatus;
  is_featured: number;
  enrollment_open: number;
  certificate_enabled: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicCourseRow extends CourseRow {
  subject_name: string;
  subject_slug: string;
  department_id: string;
  department_name: string;
  department_slug: string;
  department_icon: string | null;
  module_count: number;
  lesson_count: number;
  enrollment_count: number;
  average_rating: number | null;
  review_count: number;
}

export interface SkillRow {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
}

/* ------------------------------------------------------------------------- */
/* Departments                                                                */
/* ------------------------------------------------------------------------- */

export async function listPublishedDepartments(db: Db): Promise<DepartmentStatsRow[]> {
  return db.all<DepartmentStatsRow>(
    `SELECT department_id AS id, department_name AS name, department_slug AS slug, tagline, icon,
            NULL AS description, NULL AS image_url, display_order, status,
            NULL AS created_at, NULL AS updated_at,
            subject_count, course_count, lesson_count, student_count
       FROM v_department_stats
      WHERE status = 'published'
      ORDER BY display_order ASC, name ASC`,
  );
}

/** Administrator list: every department, published or not, with counts. */
export async function listAllDepartments(db: Db): Promise<DepartmentStatsRow[]> {
  return db.all<DepartmentStatsRow>(
    `SELECT d.id, d.name, d.slug, d.tagline, d.description, d.icon, d.image_url, d.display_order,
            d.status, d.created_at, d.updated_at,
            COALESCE(s.subject_count, 0) AS subject_count,
            COALESCE(s.course_count, 0) AS course_count,
            COALESCE(s.lesson_count, 0) AS lesson_count,
            COALESCE(s.student_count, 0) AS student_count
       FROM departments d
       LEFT JOIN v_department_stats s ON s.department_id = d.id
      ORDER BY d.display_order ASC, d.name ASC`,
  );
}

export async function findDepartmentById(db: Db, id: string): Promise<DepartmentRow | null> {
  return db.first<DepartmentRow>(
    `SELECT id, name, slug, tagline, description, icon, image_url, display_order, status,
            created_at, updated_at
       FROM departments WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function findDepartmentBySlug(
  db: Db,
  slug: string,
  publishedOnly = true,
): Promise<DepartmentRow | null> {
  const statusClause = publishedOnly ? `AND status = 'published'` : '';
  return db.first<DepartmentRow>(
    `SELECT id, name, slug, tagline, description, icon, image_url, display_order, status,
            created_at, updated_at
       FROM departments WHERE slug = ? ${statusClause} LIMIT 1`,
    [slug],
  );
}

export async function departmentSlugExists(db: Db, slug: string, excludeId?: string): Promise<boolean> {
  if (excludeId) {
    return db.exists(`SELECT 1 AS found FROM departments WHERE slug = ? AND id <> ? LIMIT 1`, [slug, excludeId]);
  }
  return db.exists(`SELECT 1 AS found FROM departments WHERE slug = ? LIMIT 1`, [slug]);
}

export interface CreateDepartmentInput {
  name: string;
  slug: string;
  tagline?: string | null;
  description?: string | null;
  icon?: string | null;
  imageUrl?: string | null;
  displayOrder?: number;
  status?: PublicationStatus;
  createdBy?: string | null;
}

export async function createDepartment(db: Db, input: CreateDepartmentInput): Promise<string> {
  const id = newId(ID_PREFIXES.department);
  await db.run(
    `INSERT INTO departments (id, name, slug, tagline, description, icon, image_url, display_order,
                              status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.slug,
      input.tagline ?? null,
      input.description ?? null,
      input.icon ?? null,
      input.imageUrl ?? null,
      input.displayOrder ?? 0,
      input.status ?? 'draft',
      input.createdBy ?? null,
    ],
  );
  return id;
}

export type DepartmentUpdateInput = Partial<Omit<CreateDepartmentInput, 'slug'>> & { slug?: string };

export async function updateDepartment(
  db: Db,
  id: string,
  input: DepartmentUpdateInput,
): Promise<number> {
  const columns: Record<string, string | number | null> = {
    name: input.name ?? undefined,
    slug: input.slug ?? undefined,
    tagline: input.tagline,
    description: input.description,
    icon: input.icon,
    image_url: input.imageUrl,
    display_order: input.displayOrder,
    status: input.status,
  } as Record<string, string | number | null>;

  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    params.push(value);
  }
  if (!assignments.length) return 0;
  params.push(id);
  return db.changes(`UPDATE departments SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function deleteDepartment(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM departments WHERE id = ?`, [id]);
}

export async function countSubjectsInDepartment(db: Db, departmentId: string): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM subjects WHERE department_id = ?`, [departmentId]);
}

/* ------------------------------------------------------------------------- */
/* Subjects                                                                   */
/* ------------------------------------------------------------------------- */

export async function listSubjectsByDepartment(
  db: Db,
  departmentId: string,
  publishedOnly = true,
): Promise<(SubjectRow & { course_count: number })[]> {
  const statusClause = publishedOnly ? `AND s.status = 'published'` : '';
  return db.all<SubjectRow & { course_count: number }>(
    `SELECT s.id, s.department_id, s.name, s.slug, s.description, s.icon, s.display_order,
            s.status, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM courses c
              WHERE c.subject_id = s.id ${publishedOnly ? `AND c.status = 'published'` : ''}) AS course_count
       FROM subjects s
      WHERE s.department_id = ? ${statusClause}
      ORDER BY s.display_order ASC, s.name ASC`,
    [departmentId],
  );
}

export async function listSubjects(
  db: Db,
  options: { publishedOnly?: boolean } = {},
): Promise<SubjectWithDepartmentRow[]> {
  const statusClause = options.publishedOnly ? `AND s.status = 'published'` : '';
  return db.all<SubjectWithDepartmentRow>(
    `SELECT s.id, s.department_id, s.name, s.slug, s.description, s.icon, s.display_order,
            s.status, s.created_at, s.updated_at,
            d.name AS department_name, d.slug AS department_slug,
            (SELECT COUNT(*) FROM courses c
              WHERE c.subject_id = s.id ${options.publishedOnly ? `AND c.status = 'published'` : ''}) AS course_count
       FROM subjects s
       JOIN departments d ON d.id = s.department_id
      WHERE 1 = 1 ${statusClause}
      ORDER BY d.display_order ASC, s.display_order ASC, s.name ASC`,
  );
}

export async function findSubjectById(db: Db, id: string): Promise<SubjectRow | null> {
  return db.first<SubjectRow>(
    `SELECT id, department_id, name, slug, description, icon, display_order, status, created_at, updated_at
       FROM subjects WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function findSubjectBySlug(
  db: Db,
  slug: string,
  publishedOnly = true,
): Promise<SubjectWithDepartmentRow | null> {
  const statusClause = publishedOnly ? `AND s.status = 'published' AND d.status = 'published'` : '';
  return db.first<SubjectWithDepartmentRow>(
    `SELECT s.id, s.department_id, s.name, s.slug, s.description, s.icon, s.display_order,
            s.status, s.created_at, s.updated_at,
            d.name AS department_name, d.slug AS department_slug,
            (SELECT COUNT(*) FROM courses c
              WHERE c.subject_id = s.id AND c.status = 'published') AS course_count
       FROM subjects s
       JOIN departments d ON d.id = s.department_id
      WHERE s.slug = ? ${statusClause}
      LIMIT 1`,
    [slug],
  );
}

export async function subjectSlugExists(db: Db, slug: string, excludeId?: string): Promise<boolean> {
  if (excludeId) {
    return db.exists(`SELECT 1 AS found FROM subjects WHERE slug = ? AND id <> ? LIMIT 1`, [slug, excludeId]);
  }
  return db.exists(`SELECT 1 AS found FROM subjects WHERE slug = ? LIMIT 1`, [slug]);
}

export interface CreateSubjectInput {
  departmentId: string;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  displayOrder?: number;
  status?: PublicationStatus;
  createdBy?: string | null;
}

export async function createSubject(db: Db, input: CreateSubjectInput): Promise<string> {
  const id = newId(ID_PREFIXES.subject);
  await db.run(
    `INSERT INTO subjects (id, department_id, name, slug, description, icon, display_order, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.departmentId,
      input.name,
      input.slug,
      input.description ?? null,
      input.icon ?? null,
      input.displayOrder ?? 0,
      input.status ?? 'draft',
      input.createdBy ?? null,
    ],
  );
  return id;
}

export type SubjectUpdateInput = Partial<Omit<CreateSubjectInput, 'slug' | 'departmentId'>> & {
  slug?: string;
  departmentId?: string;
};

export async function updateSubject(db: Db, id: string, input: SubjectUpdateInput): Promise<number> {
  const columns: Record<string, string | number | null | undefined> = {
    name: input.name,
    slug: input.slug,
    department_id: input.departmentId,
    description: input.description,
    icon: input.icon,
    display_order: input.displayOrder,
    status: input.status,
  };

  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    params.push(value);
  }
  if (!assignments.length) return 0;
  params.push(id);
  return db.changes(`UPDATE subjects SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function deleteSubject(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM subjects WHERE id = ?`, [id]);
}

export async function countCoursesInSubject(db: Db, subjectId: string): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM courses WHERE subject_id = ?`, [subjectId]);
}

/* ------------------------------------------------------------------------- */
/* Courses                                                                    */
/* ------------------------------------------------------------------------- */

export interface CourseListFilters {
  q?: string | null;
  departmentSlug?: string | null;
  subjectSlug?: string | null;
  difficulty?: DifficultyLevel | null;
  featured?: boolean | null;
  sort?: 'newest' | 'oldest' | 'title' | 'popular' | 'duration' | 'difficulty';
  page: number;
  perPage: number;
}

const COURSE_SORT: Record<NonNullable<CourseListFilters['sort']>, string> = {
  newest: 'published_at DESC, title ASC',
  oldest: 'published_at ASC, title ASC',
  title: 'title ASC',
  popular: 'enrollment_count DESC, title ASC',
  duration: 'estimated_minutes ASC, title ASC',
  difficulty: `CASE difficulty WHEN 'beginner' THEN 1 WHEN 'intermediate' THEN 2 ELSE 3 END ASC, title ASC`,
};

/**
 * Public catalog query.
 *
 * The LIKE pattern is built from a caller-normalised term (see
 * lib/text.ts#normalizeSearchTerm) and bound as a parameter; `%` and `_` in user
 * input are stripped so a search for `100%` does not turn into a wildcard scan.
 */
export async function listPublishedCourses(
  db: Db,
  filters: CourseListFilters,
): Promise<{ items: PublicCourseRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.q) {
    conditions.push(`(title LIKE ? COLLATE NOCASE OR summary LIKE ? COLLATE NOCASE
                      OR subject_name LIKE ? COLLATE NOCASE OR department_name LIKE ? COLLATE NOCASE)`);
    const term = `%${filters.q}%`;
    params.push(term, term, term, term);
  }
  if (filters.departmentSlug) {
    conditions.push(`department_slug = ?`);
    params.push(filters.departmentSlug);
  }
  if (filters.subjectSlug) {
    conditions.push(`subject_slug = ?`);
    params.push(filters.subjectSlug);
  }
  if (filters.difficulty) {
    conditions.push(`difficulty = ?`);
    params.push(filters.difficulty);
  }
  if (filters.featured) {
    conditions.push(`is_featured = 1`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.count(`SELECT COUNT(*) AS total FROM v_published_courses ${where}`, params);
  const orderBy = COURSE_SORT[filters.sort ?? 'newest'];

  const items = await db.all<PublicCourseRow>(
    `SELECT * FROM v_published_courses ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );

  return { items, total };
}

export async function findPublishedCourseBySlug(db: Db, slug: string): Promise<PublicCourseRow | null> {
  return db.first<PublicCourseRow>(`SELECT * FROM v_published_courses WHERE slug = ? LIMIT 1`, [slug]);
}

/** Administrator view — includes drafts and archived courses. */
export async function findCourseById(db: Db, id: string): Promise<CourseRow | null> {
  return db.first<CourseRow>(
    `SELECT id, subject_id, title, slug, summary, description, learning_outcomes_json,
            prerequisites_json, difficulty, estimated_minutes, thumbnail_url, instructor_name,
            instructor_bio, language, status, is_featured, enrollment_open, certificate_enabled,
            published_at, created_at, updated_at
       FROM courses WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function findCourseWithContext(
  db: Db,
  id: string,
): Promise<(PublicCourseRow & { status: PublicationStatus }) | null> {
  return db.first<PublicCourseRow & { status: PublicationStatus }>(
    `SELECT c.id, c.subject_id, c.title, c.slug, c.summary, c.description, c.learning_outcomes_json,
            c.prerequisites_json, c.difficulty, c.estimated_minutes, c.thumbnail_url, c.instructor_name,
            c.instructor_bio, c.language, c.status, c.is_featured, c.enrollment_open,
            c.certificate_enabled, c.published_at, c.created_at, c.updated_at,
            s.name AS subject_name, s.slug AS subject_slug,
            d.id AS department_id, d.name AS department_name, d.slug AS department_slug, d.icon AS department_icon,
            (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id AND m.status = 'published') AS module_count,
            (SELECT COUNT(*) FROM lessons l JOIN modules m2 ON m2.id = l.module_id
              WHERE m2.course_id = c.id AND l.status = 'published' AND m2.status = 'published') AS lesson_count,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status IN ('active','completed')) AS enrollment_count,
            NULL AS average_rating, 0 AS review_count
       FROM courses c
       JOIN subjects s ON s.id = c.subject_id
       JOIN departments d ON d.id = s.department_id
      WHERE c.id = ?
      LIMIT 1`,
    [id],
  );
}

export interface AdminCourseListFilters {
  q?: string | null;
  status?: PublicationStatus | null;
  subjectId?: string | null;
  page: number;
  perPage: number;
}

export interface AdminCourseRow extends CourseRow {
  subject_name: string;
  department_name: string;
  module_count: number;
  lesson_count: number;
  enrollment_count: number;
}

export async function listCoursesForAdmin(
  db: Db,
  filters: AdminCourseListFilters,
): Promise<{ items: AdminCourseRow[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.q) {
    conditions.push(`(c.title LIKE ? COLLATE NOCASE OR c.slug LIKE ? COLLATE NOCASE)`);
    const term = `%${filters.q}%`;
    params.push(term, term);
  }
  if (filters.status) {
    conditions.push(`c.status = ?`);
    params.push(filters.status);
  }
  if (filters.subjectId) {
    conditions.push(`c.subject_id = ?`);
    params.push(filters.subjectId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = await db.count(
    `SELECT COUNT(*) AS total FROM courses c
       JOIN subjects s ON s.id = c.subject_id
       JOIN departments d ON d.id = s.department_id
       ${where}`,
    params,
  );

  const items = await db.all<AdminCourseRow>(
    `SELECT c.id, c.subject_id, c.title, c.slug, c.summary, c.description, c.learning_outcomes_json,
            c.prerequisites_json, c.difficulty, c.estimated_minutes, c.thumbnail_url, c.instructor_name,
            c.instructor_bio, c.language, c.status, c.is_featured, c.enrollment_open,
            c.certificate_enabled, c.published_at, c.created_at, c.updated_at,
            s.name AS subject_name, d.name AS department_name,
            (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id) AS module_count,
            (SELECT COUNT(*) FROM lessons l JOIN modules m2 ON m2.id = l.module_id WHERE m2.course_id = c.id) AS lesson_count,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status IN ('active','completed')) AS enrollment_count
       FROM courses c
       JOIN subjects s ON s.id = c.subject_id
       JOIN departments d ON d.id = s.department_id
       ${where}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, filters.perPage, (filters.page - 1) * filters.perPage],
  );

  return { items, total };
}

export async function courseSlugExists(db: Db, slug: string, excludeId?: string): Promise<boolean> {
  if (excludeId) {
    return db.exists(`SELECT 1 AS found FROM courses WHERE slug = ? AND id <> ? LIMIT 1`, [slug, excludeId]);
  }
  return db.exists(`SELECT 1 AS found FROM courses WHERE slug = ? LIMIT 1`, [slug]);
}

export interface CreateCourseInput {
  subjectId: string;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  learningOutcomes?: string[];
  prerequisites?: string[];
  difficulty?: DifficultyLevel;
  estimatedMinutes?: number;
  thumbnailUrl?: string | null;
  instructorName?: string | null;
  instructorBio?: string | null;
  language?: string;
  status?: PublicationStatus;
  isFeatured?: boolean;
  enrollmentOpen?: boolean;
  certificateEnabled?: boolean;
  createdBy?: string | null;
}

export async function createCourse(db: Db, input: CreateCourseInput): Promise<string> {
  const id = newId(ID_PREFIXES.course);
  const publishedAt = input.status === 'published' ? new Date().toISOString() : null;
  await db.run(
    `INSERT INTO courses (id, subject_id, title, slug, summary, description, learning_outcomes_json,
                          prerequisites_json, difficulty, estimated_minutes, thumbnail_url,
                          instructor_name, instructor_bio, language, status, is_featured,
                          enrollment_open, certificate_enabled, published_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.subjectId,
      input.title,
      input.slug,
      input.summary ?? null,
      input.description ?? null,
      JSON.stringify(input.learningOutcomes ?? []),
      JSON.stringify(input.prerequisites ?? []),
      input.difficulty ?? 'beginner',
      input.estimatedMinutes ?? 0,
      input.thumbnailUrl ?? null,
      input.instructorName ?? null,
      input.instructorBio ?? null,
      input.language ?? 'en',
      input.status ?? 'draft',
      input.isFeatured ? 1 : 0,
      input.enrollmentOpen === false ? 0 : 1,
      input.certificateEnabled === false ? 0 : 1,
      publishedAt,
      input.createdBy ?? null,
    ],
  );
  return id;
}

export type CourseUpdateInput = Partial<Omit<CreateCourseInput, 'subjectId' | 'slug'>> & {
  subjectId?: string;
  slug?: string;
};

/**
 * Updates a course. `published_at` is set the first time a course becomes
 * published and never moved afterwards (a published course that is edited does
 * not jump to the top of the "newest" list).
 */
export async function updateCourse(db: Db, id: string, input: CourseUpdateInput): Promise<number> {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  const push = (column: string, value: string | number | null) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if (input.subjectId !== undefined) push('subject_id', input.subjectId);
  if (input.title !== undefined) push('title', input.title);
  if (input.slug !== undefined) push('slug', input.slug);
  if (input.summary !== undefined) push('summary', input.summary);
  if (input.description !== undefined) push('description', input.description);
  if (input.learningOutcomes !== undefined) push('learning_outcomes_json', JSON.stringify(input.learningOutcomes));
  if (input.prerequisites !== undefined) push('prerequisites_json', JSON.stringify(input.prerequisites));
  if (input.difficulty !== undefined) push('difficulty', input.difficulty);
  if (input.estimatedMinutes !== undefined) push('estimated_minutes', input.estimatedMinutes);
  if (input.thumbnailUrl !== undefined) push('thumbnail_url', input.thumbnailUrl);
  if (input.instructorName !== undefined) push('instructor_name', input.instructorName);
  if (input.instructorBio !== undefined) push('instructor_bio', input.instructorBio);
  if (input.language !== undefined) push('language', input.language);
  if (input.status !== undefined) {
    push('status', input.status);
    if (input.status === 'published') {
      assignments.push(`published_at = COALESCE(published_at, ?)`);
      params.push(new Date().toISOString());
    }
  }
  if (input.isFeatured !== undefined) push('is_featured', input.isFeatured ? 1 : 0);
  if (input.enrollmentOpen !== undefined) push('enrollment_open', input.enrollmentOpen ? 1 : 0);
  if (input.certificateEnabled !== undefined) push('certificate_enabled', input.certificateEnabled ? 1 : 0);

  if (!assignments.length) return 0;
  params.push(id);
  return db.changes(`UPDATE courses SET ${assignments.join(', ')} WHERE id = ?`, params);
}

/**
 * Deletes a course. Enrollments reference courses with ON DELETE RESTRICT, so a
 * course with learners cannot be deleted by accident — the API surfaces a 409
 * and the administrator archives it instead.
 */
export async function deleteCourse(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM courses WHERE id = ?`, [id]);
}

export async function countEnrollmentsForCourse(db: Db, courseId: string): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM enrollments WHERE course_id = ?`, [courseId]);
}

/* ------------------------------------------------------------------------- */
/* Skills                                                                     */
/* ------------------------------------------------------------------------- */

export async function listSkills(db: Db, q?: string | null): Promise<SkillRow[]> {
  if (q) {
    return db.all<SkillRow>(
      `SELECT id, name, slug, category, description FROM skills
        WHERE name LIKE ? COLLATE NOCASE OR slug LIKE ? COLLATE NOCASE
        ORDER BY name ASC LIMIT 200`,
      [`%${q}%`, `%${q}%`],
    );
  }
  return db.all<SkillRow>(
    `SELECT id, name, slug, category, description FROM skills ORDER BY name ASC LIMIT 500`,
  );
}

export async function findSkillById(db: Db, id: string): Promise<SkillRow | null> {
  return db.first<SkillRow>(
    `SELECT id, name, slug, category, description FROM skills WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function skillSlugExists(db: Db, slug: string, excludeId?: string): Promise<boolean> {
  if (excludeId) {
    return db.exists(`SELECT 1 AS found FROM skills WHERE slug = ? AND id <> ? LIMIT 1`, [slug, excludeId]);
  }
  return db.exists(`SELECT 1 AS found FROM skills WHERE slug = ? LIMIT 1`, [slug]);
}

export async function createSkill(
  db: Db,
  input: { name: string; slug: string; category?: string | null; description?: string | null },
): Promise<string> {
  const id = newId(ID_PREFIXES.skill);
  await db.run(
    `INSERT INTO skills (id, name, slug, category, description) VALUES (?, ?, ?, ?, ?)`,
    [id, input.name, input.slug, input.category ?? null, input.description ?? null],
  );
  return id;
}

export async function updateSkill(
  db: Db,
  id: string,
  input: { name?: string; slug?: string; category?: string | null; description?: string | null },
): Promise<number> {
  const assignments: string[] = [];
  const params: (string | null)[] = [];
  if (input.name !== undefined) {
    assignments.push('name = ?');
    params.push(input.name);
  }
  if (input.slug !== undefined) {
    assignments.push('slug = ?');
    params.push(input.slug);
  }
  if (input.category !== undefined) {
    assignments.push('category = ?');
    params.push(input.category);
  }
  if (input.description !== undefined) {
    assignments.push('description = ?');
    params.push(input.description);
  }
  if (!assignments.length) return 0;
  params.push(id);
  return db.changes(`UPDATE skills SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function deleteSkill(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM skills WHERE id = ?`, [id]);
}

export interface CourseSkillRow {
  skill_id: string;
  name: string;
  slug: string;
  category: string | null;
  kind: 'required' | 'acquired';
  weight: number;
}

export async function listCourseSkills(db: Db, courseId: string): Promise<CourseSkillRow[]> {
  return db.all<CourseSkillRow>(
    `SELECT cs.skill_id, sk.name, sk.slug, sk.category, cs.kind, cs.weight
       FROM course_skills cs
       JOIN skills sk ON sk.id = cs.skill_id
      WHERE cs.course_id = ?
      ORDER BY cs.kind ASC, sk.name ASC`,
    [courseId],
  );
}

/** Replaces the skill links of a course in one atomic batch. */
export async function replaceCourseSkills(
  db: Db,
  courseId: string,
  acquired: string[],
  required: string[],
): Promise<void> {
  const statements = [db.prepare(`DELETE FROM course_skills WHERE course_id = ?`, [courseId])];
  const seen = new Set<string>();
  const rows: D1PreparedStatement[] = [];
  for (const [kind, ids] of [
    ['acquired', acquired],
    ['required', required],
  ] as const) {
    for (const skillId of ids) {
      const key = `${kind}:${skillId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(
        db.prepare(`INSERT INTO course_skills (course_id, skill_id, kind) VALUES (?, ?, ?)`, [
          courseId,
          skillId,
          kind,
        ]),
      );
    }
  }
  await db.batch([...statements, ...rows]);
}

/* ------------------------------------------------------------------------- */
/* Search                                                                     */
/* ------------------------------------------------------------------------- */

export interface SearchHit {
  type: 'course' | 'subject' | 'department' | 'lesson';
  id: string;
  title: string;
  subtitle: string | null;
  slug: string | null;
  url: string;
}

/**
 * Cross-entity public search.
 *
 * Implemented with indexed LIKE queries plus a UNION-style merge in application
 * code, which is honest about its limits: it is a substring match, not ranked
 * full-text search. docs/09 documents the FTS5 upgrade path for when the
 * catalog outgrows this.
 */
export async function search(
  db: Db,
  term: string,
  types: readonly ('course' | 'subject' | 'department' | 'lesson')[],
  limit = 20,
): Promise<SearchHit[]> {
  const pattern = `%${term}%`;
  const hits: SearchHit[] = [];

  if (types.includes('course')) {
    const rows = await db.all<{ id: string; title: string; slug: string; summary: string | null; department_name: string }>(
      `SELECT id, title, slug, summary, department_name
         FROM v_published_courses
        WHERE title LIKE ? COLLATE NOCASE OR summary LIKE ? COLLATE NOCASE
        ORDER BY is_featured DESC, enrollment_count DESC
        LIMIT ?`,
      [pattern, pattern, limit],
    );
    hits.push(
      ...rows.map((row) => ({
        type: 'course' as const,
        id: row.id,
        title: row.title,
        subtitle: row.summary ?? row.department_name,
        slug: row.slug,
        url: `/course.html?slug=${encodeURIComponent(row.slug)}`,
      })),
    );
  }

  if (types.includes('subject')) {
    const rows = await db.all<{ id: string; name: string; slug: string; description: string | null; department_name: string }>(
      `SELECT s.id, s.name, s.slug, s.description, d.name AS department_name
         FROM subjects s
         JOIN departments d ON d.id = s.department_id
        WHERE s.status = 'published' AND d.status = 'published'
          AND (s.name LIKE ? COLLATE NOCASE OR s.description LIKE ? COLLATE NOCASE)
        ORDER BY s.name ASC
        LIMIT ?`,
      [pattern, pattern, limit],
    );
    hits.push(
      ...rows.map((row) => ({
        type: 'subject' as const,
        id: row.id,
        title: row.name,
        subtitle: row.department_name,
        slug: row.slug,
        url: `/courses.html?subject=${encodeURIComponent(row.slug)}`,
      })),
    );
  }

  if (types.includes('department')) {
    const rows = await db.all<{ id: string; name: string; slug: string; tagline: string | null }>(
      `SELECT id, name, slug, tagline FROM departments
        WHERE status = 'published'
          AND (name LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE OR tagline LIKE ? COLLATE NOCASE)
        ORDER BY display_order ASC
        LIMIT ?`,
      [pattern, pattern, pattern, limit],
    );
    hits.push(
      ...rows.map((row) => ({
        type: 'department' as const,
        id: row.id,
        title: row.name,
        subtitle: row.tagline,
        slug: row.slug,
        url: `/courses.html?department=${encodeURIComponent(row.slug)}`,
      })),
    );
  }

  if (types.includes('lesson')) {
    // Only preview lessons are publicly searchable: enrolled content is not
    // discoverable to signed-out visitors.
    const rows = await db.all<{ id: string; title: string; course_title: string; course_slug: string }>(
      `SELECT l.id, l.title, c.title AS course_title, c.slug AS course_slug
         FROM lessons l
         JOIN modules m ON m.id = l.module_id
         JOIN courses c ON c.id = m.course_id
         JOIN subjects s ON s.id = c.subject_id
         JOIN departments d ON d.id = s.department_id
        WHERE l.status = 'published' AND m.status = 'published'
          AND c.status = 'published' AND s.status = 'published' AND d.status = 'published'
          AND l.is_preview = 1
          AND (l.title LIKE ? COLLATE NOCASE OR l.content_md LIKE ? COLLATE NOCASE)
        ORDER BY l.title ASC
        LIMIT ?`,
      [pattern, pattern, limit],
    );
    hits.push(
      ...rows.map((row) => ({
        type: 'lesson' as const,
        id: row.id,
        title: row.title,
        subtitle: row.course_title,
        slug: row.course_slug,
        url: `/course.html?slug=${encodeURIComponent(row.course_slug)}&preview=${encodeURIComponent(row.id)}`,
      })),
    );
  }

  return hits;
}
