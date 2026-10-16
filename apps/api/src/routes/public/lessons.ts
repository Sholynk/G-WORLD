/**
 * Routes — the lesson player (read side).
 *
 * `GET /lessons/:lessonId` is intentionally *not* behind `requireAuth`: whether
 * the caller may read the body depends on the lesson and the caller's enrollment,
 * and `resolveLessonAccess()` is the single place that decides. A signed-out
 * visitor receiving a 403 with a clear "enrol to unlock" reason is a better
 * experience than a generic 401, and it lets the lesson page render a paywall-style
 * preview with the lesson outline.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import { idSchema, slugSchema } from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as enrollmentRepo from '../../db/repositories/enrollments.js';
import * as curriculumRepo from '../../db/repositories/curriculum.js';
import { loadLessonView, courseProgressMap } from '../../services/learning.js';
import { parseParam } from '../../middleware/validate.js';
import { ok } from '../helpers.js';
import {
  toEnrollmentDto,
  toLessonCardDto,
  toLessonDetailDto,
  toLessonPreviewDto,
  toModuleDto,
  toPublicCourseDto,
} from '../../schemas/mappers.js';
import { findPublishedCourseBySlug } from '../../db/repositories/catalog.js';
import { forbidden, notFound } from '../../lib/errors.js';

export const lessonViewRoutes = new Hono<AppEnv>();



/**
 * Lesson payload for the player.
 *
 * Three outcomes, all explicit:
 *   - `access.allowed` true  → full content, media, progress and navigation
 *   - preview lesson         → excerpt + media, plus a `locked` notice
 *   - otherwise              → 403 with a reason the page can display
 */
lessonViewRoutes.get('/lessons/:lessonId', async (c) => {
  const db = createDb(c.env.DB);
  const lessonId = parseParam(c, 'lessonId', idSchema);
  const auth = c.get('auth');

  const view = await loadLessonView(db, auth, lessonId);
  const { access, videos, resources, progress, navigation } = view;

  if (!access.allowed) {
    const preview = access.lesson.status === 'published' && access.lesson.is_preview === 1;
    if (preview) {
      return ok(c, {
        locked: true,
        reason: access.reason,
        lesson: toLessonPreviewDto(access.lesson, await curriculumRepo.listVideos(db, lessonId)),
        navigation,
      });
    }
    // A learner who is enrolled but whose enrollment was cancelled falls here.
    throw forbidden(access.reason ?? 'You do not have access to this lesson');
  }

  const audience = access.level === 'staff' ? 'admin' : 'enrolled';
  const courseTree = audience === 'admin' ? await curriculumRepo.curriculumTree(db, access.lesson.course_id, false) : null;
  const progressMap = view.enrollment ? await courseProgressMap(db, view.enrollment.id) : {};

  return ok(c, {
    locked: false,
    access_level: access.level,
    lesson: toLessonDetailDto(access.lesson, videos, resources, audience),
    progress,
    progress_map: progressMap,
    navigation,
    enrollment: view.enrollment
      ? toEnrollmentDto((await enrollmentRepo.findEnrollmentById(db, view.enrollment.id))!, {
          includeStudent: false,
        })
      : null,
    curriculum: courseTree
      ? courseTree.map((module) => toModuleDto(module, module.lessons))
      : undefined,
  });
});

/** Curriculum outline of one course, including the caller's progress when known. */
lessonViewRoutes.get('/courses/:slug/curriculum', async (c) => {
  const db = createDb(c.env.DB);
  const slug = parseParam(c, 'slug', slugSchema);
  const auth = c.get('auth');

  const course = await findPublishedCourseBySlug(db, slug);
  if (!course) throw notFound('Course not found');

  const tree = await curriculumRepo.curriculumTree(db, course.id, true);
  const enrollment = auth ? await enrollmentRepo.findEnrollmentForCourseByUser(db, course.id, auth.userId) : null;
  const progressMap = enrollment ? await courseProgressMap(db, enrollment.id) : {};

  return ok(c, {
    course: toPublicCourseDto(course),
    enrollment: enrollment
      ? toEnrollmentDto((await enrollmentRepo.findEnrollmentById(db, enrollment.id))!, { includeStudent: false })
      : null,
    progress_map: progressMap,
    modules: tree.map((module) => ({
      ...toModuleDto(module, module.lessons),
      lessons: module.lessons.map((lesson) => ({
        ...toLessonCardDto(lesson),
        unlocked: Boolean(enrollment) || lesson.is_preview === 1,
        progress: progressMap[lesson.id]?.status ?? 'not_started',
      })),
    })),
  });
});
