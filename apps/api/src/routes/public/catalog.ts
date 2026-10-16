/**
 * Routes — public catalog (no authentication required).
 *
 * These endpoints are the shop window: they only ever read published content, and
 * they query the `v_published_courses` / `v_department_stats` views so
 * "published" means published at every level of the hierarchy (department,
 * subject and course).
 *
 * Visitor experiences supported here:
 *   - browse departments and subjects
 *   - list/search courses with filters, sorting and pagination
 *   - read a course description, its curriculum outline and its preview lessons
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { courseListQuerySchema, idSchema, slugSchema } from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as catalogRepo from '../../db/repositories/catalog.js';
import * as curriculumRepo from '../../db/repositories/curriculum.js';
import { normalizeSearchTerm } from '../../lib/text.js';
import { notFound } from '../../lib/errors.js';
import { parseParam, parseQuery } from '../../middleware/validate.js';
import { ok, okPage } from '../helpers.js';
import {
  toDepartmentDto,
  toLessonPreviewDto,
  toModuleDto,
  toPublicCourseCardDto,
  toPublicCourseDto,
  toSubjectDto,
} from '../../schemas/mappers.js';

export const catalogRoutes = new Hono<AppEnv>();


/* ------------------------------ departments ------------------------------- */

catalogRoutes.get('/departments', async (c) => {
  const db = createDb(c.env.DB);
  const departments = await catalogRepo.listPublishedDepartments(db);
  return ok(c, departments.map(toDepartmentDto));
});

catalogRoutes.get('/departments/:slug', async (c) => {
  const db = createDb(c.env.DB);
  const slug = parseParam(c, 'slug', slugSchema);
  const department = await catalogRepo.findDepartmentBySlug(db, slug);
  if (!department) throw notFound('Department not found');

  const subjects = await catalogRepo.listSubjectsByDepartment(db, department.id, true);
  const { items: courses } = await catalogRepo.listPublishedCourses(db, {
    departmentSlug: slug,
    page: 1,
    perPage: 24,
    sort: 'newest',
  });

  const stats = (await catalogRepo.listPublishedDepartments(db)).find((row) => row.id === department.id);

  return ok(c, {
    department: toDepartmentDto(
      stats ?? {
        ...department,
        subject_count: subjects.length,
        course_count: courses.length,
        lesson_count: 0,
        student_count: 0,
      },
    ),
    subjects: subjects.map((subject) =>
      toSubjectDto({
        ...subject,
        department_name: department.name,
        department_slug: department.slug,
      }),
    ),
    courses: courses.map(toPublicCourseCardDto),
  });
});

/* -------------------------------- subjects -------------------------------- */

catalogRoutes.get('/subjects', async (c) => {
  const db = createDb(c.env.DB);
  const subjects = await catalogRepo.listSubjects(db, { publishedOnly: true });
  return ok(c, subjects.map((subject) => toSubjectDto(subject)));
});

catalogRoutes.get('/subjects/:slug', async (c) => {
  const db = createDb(c.env.DB);
  const slug = parseParam(c, 'slug', slugSchema);
  const subject = await catalogRepo.findSubjectBySlug(db, slug);
  if (!subject) throw notFound('Subject not found');

  const { items: courses } = await catalogRepo.listPublishedCourses(db, {
    subjectSlug: slug,
    page: 1,
    perPage: 24,
    sort: 'newest',
  });

  return ok(c, {
    subject: toSubjectDto(subject),
    courses: courses.map(toPublicCourseCardDto),
  });
});

/* --------------------------------- courses -------------------------------- */

catalogRoutes.get('/courses', async (c) => {
  const db = createDb(c.env.DB);
  const query = parseQuery(c, courseListQuerySchema);

  const { items, total } = await catalogRepo.listPublishedCourses(db, {
    q: normalizeSearchTerm(query.q),
    departmentSlug: query.department ?? null,
    subjectSlug: query.subject ?? null,
    difficulty: query.difficulty ?? null,
    featured: query.featured ?? null,
    sort: query.sort,
    page: query.page,
    perPage: query.per_page,
  });

  return okPage(
    c,
    items.map(toPublicCourseCardDto),
    { page: query.page, perPage: query.per_page, total },
  );
});

catalogRoutes.get('/courses/featured', async (c) => {
  const db = createDb(c.env.DB);
  const { items } = await catalogRepo.listPublishedCourses(db, {
    featured: true,
    page: 1,
    perPage: 6,
    sort: 'popular',
  });

  // If nothing is explicitly featured yet, fall back to the newest published
  // courses so the home page is never empty on a fresh install.
  if (items.length === 0) {
    const fallback = await catalogRepo.listPublishedCourses(db, { page: 1, perPage: 6, sort: 'newest' });
    return ok(c, { items: fallback.items.map(toPublicCourseCardDto), fallback: true });
  }

  return ok(c, { items: items.map(toPublicCourseCardDto), fallback: false });
});

catalogRoutes.get('/courses/:slug', async (c) => {
  const db = createDb(c.env.DB);
  const slug = parseParam(c, 'slug', slugSchema);

  const course = await catalogRepo.findPublishedCourseBySlug(db, slug);
  if (!course) throw notFound('Course not found');

  const tree = await curriculumRepo.curriculumTree(db, course.id, true);
  const skills = await catalogRepo.listCourseSkills(db, course.id);
  const courseResources = await curriculumRepo.listResourcesForCourse(db, course.id);

  return ok(c, {
    course: toPublicCourseDto(course),
    curriculum: tree.map((module) => toModuleDto(module, module.lessons)),
    skills: {
      acquired: skills
        .filter((skill) => skill.kind === 'acquired')
        .map(({ skill_id, name, slug, category }) => ({ id: skill_id, name, slug, category })),
      required: skills
        .filter((skill) => skill.kind === 'required')
        .map(({ skill_id, name, slug, category }) => ({ id: skill_id, name, slug, category })),
    },
    resources: courseResources
      .filter((resource) => resource.is_public === 1)
      .map((resource) => ({
        id: resource.id,
        title: resource.title,
        kind: resource.kind,
        url: resource.url,
      })),
  });
});

/**
 * Public lesson preview.
 *
 * Only lessons explicitly flagged `is_preview` are readable without enrolling.
 * The flag is set per lesson by an administrator, so publishing a course does not
 * accidentally expose all of its content — and the lesson body is returned as an
 * excerpt rather than in full.
 */
catalogRoutes.get('/lessons/:lessonId/preview', async (c) => {
  const db = createDb(c.env.DB);
  const lessonId = parseParam(c, 'lessonId', idSchema);

  const lesson = await curriculumRepo.findLessonDetail(db, lessonId);
  if (!lesson || lesson.status !== 'published' || lesson.is_preview !== 1) {
    throw notFound('No preview is available for this lesson');
  }

  const videos = await curriculumRepo.listVideos(db, lessonId);
  return ok(c, toLessonPreviewDto(lesson, videos));
});
