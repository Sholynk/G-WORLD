/**
 * Routes — administrator content management (departments, subjects, courses, skills).
 *
 * Access control is layered:
 *   - the whole `/admin` router requires at least the administrator role
 *     (routes/admin/index.ts);
 *   - each handler additionally requires the specific permission for the resource
 *     (`department.write`, `course.write`, `skill.write`, …). A future "content
 *     editor" role can therefore be granted `lesson.write` without also gaining
 *     `user.write.any`.
 *
 * Every mutation writes an audit entry containing a field-level diff — so "who
 * unpublished this course, when, and what changed" is always answerable.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import {
  courseInputSchema,
  courseListQuerySchema,
  courseUpdateSchema,
  departmentInputSchema,
  departmentUpdateSchema,
  idSchema,
  skillInputSchema,
  slugSchema,
  subjectInputSchema,
  subjectUpdateSchema,
  updateProfileSchema,
} from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as catalogRepo from '../../db/repositories/catalog.js';
import { uniqueSlug, isValidSlug } from '../../lib/slug.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS, diffFields } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parseJson, parseParam, parseQuery } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { created, ok, okPage } from '../helpers.js';
import { toDepartmentDto, toSkillDto, toSubjectDto } from '../../schemas/mappers.js';

export const adminCatalogRoutes = new Hono<AppEnv>();


/* ------------------------------ departments ------------------------------- */

adminCatalogRoutes.get('/departments', requirePermission('course.read'), async (c) => {
  const db = createDb(c.env.DB);
  const departments = await catalogRepo.listAllDepartments(db);
  return ok(c, departments.map(toDepartmentDto));
});

adminCatalogRoutes.post('/departments', requirePermission('department.write'), async (c) => {
  const auth = c.get('auth')!;
  const input = await parseJson(c, departmentInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const slug =
    input.slug && isValidSlug(input.slug)
      ? input.slug
      : await uniqueSlug(input.name, (candidate) => catalogRepo.departmentSlugExists(db, candidate));
  if (input.slug && (await catalogRepo.departmentSlugExists(db, input.slug))) {
    throw conflict('That URL slug is already in use');
  }

  const id = await catalogRepo.createDepartment(db, {
    name: input.name,
    slug,
    tagline: input.tagline ?? null,
    description: input.description ?? null,
    icon: input.icon ?? null,
    imageUrl: input.image_url ?? null,
    displayOrder: input.display_order,
    status: input.status,
    createdBy: auth.userId,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.departmentCreated,
    entityType: 'department',
    entityId: id,
    description: `Created department “${input.name}”`,
    metadata: { slug, status: input.status },
  });

  const department = await catalogRepo.findDepartmentById(db, id);
  return created(c, department ? toDepartmentDto({ ...department, subject_count: 0, course_count: 0, lesson_count: 0, student_count: 0 }) : { id });
});

adminCatalogRoutes.patch('/departments/:id', requirePermission('department.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, departmentUpdateSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await catalogRepo.findDepartmentById(db, id);
  if (!existing) throw notFound('Department not found');

  if (input.slug && input.slug !== existing.slug && (await catalogRepo.departmentSlugExists(db, input.slug, id))) {
    throw conflict('That URL slug is already in use');
  }

  await catalogRepo.updateDepartment(db, id, {
    name: input.name,
    slug: input.slug,
    tagline: input.tagline,
    description: input.description,
    icon: input.icon,
    imageUrl: input.image_url,
    displayOrder: input.display_order,
    status: input.status,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.departmentUpdated,
    entityType: 'department',
    entityId: id,
    description: `Updated department “${input.name ?? existing.name}”`,
    metadata: { changes: diffFields(existing as unknown as Record<string, unknown>, input as Record<string, unknown>) },
  });

  const updated = await catalogRepo.findDepartmentById(db, id);
  return ok(c, updated ? toDepartmentDto({ ...updated, subject_count: 0, course_count: 0, lesson_count: 0, student_count: 0 }) : null);
});

adminCatalogRoutes.delete('/departments/:id', requirePermission('department.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await catalogRepo.findDepartmentById(db, id);
  if (!existing) throw notFound('Department not found');

  const subjects = await catalogRepo.countSubjectsInDepartment(db, id);
  if (subjects > 0) {
    throw conflict(
      `This department still has ${subjects} subject(s). Move or archive them first, or set the department status to archived.`,
    );
  }

  await catalogRepo.deleteDepartment(db, id);
  await audit(c, {
    action: AUDIT_ACTIONS.departmentDeleted,
    entityType: 'department',
    entityId: id,
    description: `Deleted department “${existing.name}”`,
  });

  return ok(c, { deleted: true, id });
});

/* -------------------------------- subjects -------------------------------- */

adminCatalogRoutes.get('/subjects', requirePermission('course.read'), async (c) => {
  const db = createDb(c.env.DB);
  const departmentId = c.req.query('department_id');
  const subjects = departmentId
    ? (await catalogRepo.listSubjectsByDepartment(db, departmentId, false)).map((subject) => ({
        ...subject,
        department_name: '',
        department_slug: '',
      }))
    : await catalogRepo.listSubjects(db, { publishedOnly: false });
  return ok(c, subjects.map((subject) => toSubjectDto(subject)));
});

adminCatalogRoutes.post('/subjects', requirePermission('subject.write'), async (c) => {
  const auth = c.get('auth')!;
  const input = await parseJson(c, subjectInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const department = await catalogRepo.findDepartmentById(db, input.department_id);
  if (!department) throw badRequest('Choose an existing department', [
    { field: 'department_id', message: 'Department not found' },
  ]);

  const slug =
    input.slug && isValidSlug(input.slug)
      ? input.slug
      : await uniqueSlug(`${department.slug}-${input.name}`, (candidate) =>
          catalogRepo.subjectSlugExists(db, candidate),
        );
  if (input.slug && (await catalogRepo.subjectSlugExists(db, input.slug))) {
    throw conflict('That URL slug is already in use');
  }

  const id = await catalogRepo.createSubject(db, {
    departmentId: input.department_id,
    name: input.name,
    slug,
    description: input.description ?? null,
    icon: input.icon ?? null,
    displayOrder: input.display_order,
    status: input.status,
    createdBy: auth.userId,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.subjectCreated,
    entityType: 'subject',
    entityId: id,
    description: `Created subject “${input.name}”`,
    metadata: { department_id: input.department_id, slug },
  });

  return created(c, { id, slug });
});

adminCatalogRoutes.patch('/subjects/:id', requirePermission('subject.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, subjectUpdateSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await catalogRepo.findSubjectById(db, id);
  if (!existing) throw notFound('Subject not found');

  if (input.department_id) {
    const department = await catalogRepo.findDepartmentById(db, input.department_id);
    if (!department) throw badRequest('Choose an existing department');
  }
  if (input.slug && input.slug !== existing.slug && (await catalogRepo.subjectSlugExists(db, input.slug, id))) {
    throw conflict('That URL slug is already in use');
  }

  await catalogRepo.updateSubject(db, id, {
    name: input.name,
    slug: input.slug,
    departmentId: input.department_id,
    description: input.description,
    icon: input.icon,
    displayOrder: input.display_order,
    status: input.status,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.subjectUpdated,
    entityType: 'subject',
    entityId: id,
    description: `Updated subject “${input.name ?? existing.name}”`,
    metadata: { changes: diffFields(existing as unknown as Record<string, unknown>, input as Record<string, unknown>) },
  });

  return ok(c, { updated: true, id });
});

adminCatalogRoutes.delete('/subjects/:id', requirePermission('subject.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await catalogRepo.findSubjectById(db, id);
  if (!existing) throw notFound('Subject not found');

  const courses = await catalogRepo.countCoursesInSubject(db, id);
  if (courses > 0) {
    throw conflict(`This subject still has ${courses} course(s). Archive them or move them first.`);
  }

  await catalogRepo.deleteSubject(db, id);
  await audit(c, {
    action: AUDIT_ACTIONS.subjectDeleted,
    entityType: 'subject',
    entityId: id,
    description: `Deleted subject “${existing.name}”`,
  });

  return ok(c, { deleted: true, id });
});

/* --------------------------------- courses -------------------------------- */

adminCatalogRoutes.get('/courses', requirePermission('course.read'), async (c) => {
  const query = parseQuery(c, courseListQuerySchema);
  const db = createDb(c.env.DB);
  const status = c.req.query('status');

  const { items, total } = await catalogRepo.listCoursesForAdmin(db, {
    q: query.q ?? null,
    status: status === 'draft' || status === 'published' || status === 'archived' ? status : null,
    subjectId: c.req.query('subject_id') ?? null,
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(
    c,
    items.map((course) => ({
      id: course.id,
      slug: course.slug,
      title: course.title,
      summary: course.summary,
      status: course.status,
      difficulty: course.difficulty,
      estimated_minutes: Number(course.estimated_minutes ?? 0),
      is_featured: Boolean(course.is_featured),
      enrollment_open: Boolean(course.enrollment_open),
      certificate_enabled: Boolean(course.certificate_enabled),
      subject: { id: course.subject_id, name: course.subject_name },
      department_name: course.department_name,
      module_count: Number(course.module_count ?? 0),
      lesson_count: Number(course.lesson_count ?? 0),
      enrollment_count: Number(course.enrollment_count ?? 0),
      published_at: course.published_at,
      created_at: course.created_at,
      updated_at: course.updated_at,
    })),
    { page: query.page, perPage: query.per_page, total },
  );
});

adminCatalogRoutes.get('/courses/:id', requirePermission('course.read'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB);

  const course = await catalogRepo.findCourseById(db, id);
  if (!course) throw notFound('Course not found');

  const [skills, enrollmentCount] = await Promise.all([
    catalogRepo.listCourseSkills(db, id),
    catalogRepo.countEnrollmentsForCourse(db, id),
  ]);

  return ok(c, {
    ...course,
    learning_outcomes: JSON.parse(course.learning_outcomes_json || '[]'),
    prerequisites: JSON.parse(course.prerequisites_json || '[]'),
    skills: {
      acquired: skills.filter((skill) => skill.kind === 'acquired').map((skill) => ({ id: skill.skill_id, name: skill.name })),
      required: skills.filter((skill) => skill.kind === 'required').map((skill) => ({ id: skill.skill_id, name: skill.name })),
    },
    enrollment_count: enrollmentCount,
  });
});

adminCatalogRoutes.post('/courses', requirePermission('course.write'), async (c) => {
  const auth = c.get('auth')!;
  const input = await parseJson(c, courseInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const subject = await catalogRepo.findSubjectById(db, input.subject_id);
  if (!subject) throw badRequest('Choose an existing subject', [{ field: 'subject_id', message: 'Subject not found' }]);

  const slug =
    input.slug && isValidSlug(input.slug)
      ? input.slug
      : await uniqueSlug(input.title, (candidate) => catalogRepo.courseSlugExists(db, candidate));
  if (input.slug && (await catalogRepo.courseSlugExists(db, input.slug))) {
    throw conflict('That URL slug is already in use');
  }

  const id = await catalogRepo.createCourse(db, {
    subjectId: input.subject_id,
    title: input.title,
    slug,
    summary: input.summary ?? null,
    description: input.description ?? null,
    learningOutcomes: input.learning_outcomes ?? [],
    prerequisites: input.prerequisites ?? [],
    difficulty: input.difficulty,
    estimatedMinutes: input.estimated_minutes,
    thumbnailUrl: input.thumbnail_url ?? null,
    instructorName: input.instructor_name ?? null,
    instructorBio: input.instructor_bio ?? null,
    language: input.language,
    status: input.status,
    isFeatured: input.is_featured,
    enrollmentOpen: input.enrollment_open,
    certificateEnabled: input.certificate_enabled,
    createdBy: auth.userId,
  });

  if (input.skills) {
    await catalogRepo.replaceCourseSkills(db, id, input.skills.acquired ?? [], input.skills.required ?? []);
  }

  await audit(c, {
    action: AUDIT_ACTIONS.courseCreated,
    entityType: 'course',
    entityId: id,
    description: `Created course “${input.title}”`,
    metadata: { subject_id: input.subject_id, slug, status: input.status },
  });

  return created(c, { id, slug });
});

adminCatalogRoutes.patch('/courses/:id', requirePermission('course.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, courseUpdateSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await catalogRepo.findCourseById(db, id);
  if (!existing) throw notFound('Course not found');

  if (input.subject_id) {
    const subject = await catalogRepo.findSubjectById(db, input.subject_id);
    if (!subject) throw badRequest('Choose an existing subject');
  }
  if (input.slug && input.slug !== existing.slug && (await catalogRepo.courseSlugExists(db, input.slug, id))) {
    throw conflict('That URL slug is already in use');
  }

  await catalogRepo.updateCourse(db, id, {
    subjectId: input.subject_id,
    title: input.title,
    slug: input.slug,
    summary: input.summary,
    description: input.description,
    learningOutcomes: input.learning_outcomes,
    prerequisites: input.prerequisites,
    difficulty: input.difficulty,
    estimatedMinutes: input.estimated_minutes,
    thumbnailUrl: input.thumbnail_url,
    instructorName: input.instructor_name,
    instructorBio: input.instructor_bio,
    language: input.language,
    status: input.status,
    isFeatured: input.is_featured,
    enrollmentOpen: input.enrollment_open,
    certificateEnabled: input.certificate_enabled,
  });

  if (input.skills) {
    await catalogRepo.replaceCourseSkills(db, id, input.skills.acquired ?? [], input.skills.required ?? []);
  }

  const action =
    input.status === 'published'
      ? AUDIT_ACTIONS.coursePublished
      : input.status === 'archived'
        ? AUDIT_ACTIONS.courseArchived
        : AUDIT_ACTIONS.courseUpdated;

  await audit(c, {
    action,
    entityType: 'course',
    entityId: id,
    description: `Updated course “${existing.title}”${input.status ? ` → ${input.status}` : ''}`,
    metadata: { changes: diffFields(existing as unknown as Record<string, unknown>, input as Record<string, unknown>) },
  });

  return ok(c, { updated: true, id });
});

adminCatalogRoutes.delete('/courses/:id', requirePermission('course.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await catalogRepo.findCourseById(db, id);
  if (!existing) throw notFound('Course not found');

  const enrollments = await catalogRepo.countEnrollmentsForCourse(db, id);
  if (enrollments > 0) {
    throw conflict(
      `${enrollments} learner(s) are enrolled in this course. Archiving keeps their history intact; deleting would destroy it.`,
      [{ field: 'status', message: 'Set status to "archived" instead' }],
    );
  }

  await catalogRepo.deleteCourse(db, id);
  await audit(c, {
    action: AUDIT_ACTIONS.courseDeleted,
    entityType: 'course',
    entityId: id,
    description: `Deleted course “${existing.title}”`,
  });

  return ok(c, { deleted: true, id });
});

/** Course detail by slug — convenient for the admin editor deep links. */
adminCatalogRoutes.get('/courses/by-slug/:slug', requirePermission('course.read'), async (c) => {
  const slug = parseParam(c, 'slug', slugSchema);
  const db = createDb(c.env.DB);
  const course = await db.first<{ id: string }>(`SELECT id FROM courses WHERE slug = ? LIMIT 1`, [slug]);
  if (!course) throw notFound('Course not found');
  return ok(c, { id: course.id });
});

/* ---------------------------------- skills -------------------------------- */

adminCatalogRoutes.get('/skills', requirePermission('course.read'), async (c) => {
  const db = createDb(c.env.DB);
  const skills = await catalogRepo.listSkills(db, c.req.query('q') ?? null);
  return ok(c, skills.map(toSkillDto));
});

adminCatalogRoutes.post('/skills', requirePermission('skill.write'), async (c) => {
  const input = await parseJson(c, skillInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const slug =
    input.slug && isValidSlug(input.slug)
      ? input.slug
      : await uniqueSlug(input.name, (candidate) => catalogRepo.skillSlugExists(db, candidate));
  if (input.slug && (await catalogRepo.skillSlugExists(db, input.slug))) {
    throw conflict('That skill slug already exists');
  }

  const id = await catalogRepo.createSkill(db, {
    name: input.name,
    slug,
    category: input.category ?? null,
    description: input.description ?? null,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.skillCreated,
    entityType: 'skill',
    entityId: id,
    description: `Created skill “${input.name}”`,
  });

  return created(c, { id, slug });
});

adminCatalogRoutes.patch('/skills/:id', requirePermission('skill.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, skillInputSchema.partial());
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await catalogRepo.findSkillById(db, id);
  if (!existing) throw notFound('Skill not found');

  await catalogRepo.updateSkill(db, id, {
    name: input.name,
    slug: input.slug,
    category: input.category,
    description: input.description,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.skillUpdated,
    entityType: 'skill',
    entityId: id,
    description: `Updated skill “${input.name ?? existing.name}”`,
  });

  return ok(c, { updated: true, id });
});

adminCatalogRoutes.delete('/skills/:id', requirePermission('skill.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await catalogRepo.findSkillById(db, id);
  if (!existing) throw notFound('Skill not found');

  await catalogRepo.deleteSkill(db, id);
  await audit(c, {
    action: AUDIT_ACTIONS.skillUpdated,
    entityType: 'skill',
    entityId: id,
    description: `Deleted skill “${existing.name}”`,
  });

  return ok(c, { deleted: true, id });
});

/** Content-editor helper: a course's skills can be set independently. */
adminCatalogRoutes.put('/courses/:id/skills', requirePermission('course.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(
    c,
    z.object({
      acquired: z.array(idSchema).max(40).default([]),
      required: z.array(idSchema).max(40).default([]),
    }),
  );
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const course = await catalogRepo.findCourseById(db, id);
  if (!course) throw notFound('Course not found');

  await catalogRepo.replaceCourseSkills(db, id, input.acquired, input.required);
  await audit(c, {
    action: AUDIT_ACTIONS.courseUpdated,
    entityType: 'course',
    entityId: id,
    description: 'Updated course skills',
    metadata: { acquired: input.acquired.length, required: input.required.length },
  });

  return ok(c, { updated: true });
});

export const catalogProfileSchemaForReuse = updateProfileSchema;
