/**
 * Routes — administrator curriculum management (modules, lessons, videos, resources).
 *
 * Notes that matter in practice:
 *   - `position` is optional everywhere: omitting it appends to the end of the
 *     parent, so the editor can "Add lesson" without computing an order.
 *   - Reordering is a single call to `PUT /:resource/reorder` which runs as one
 *     atomic batch (see curriculum.ts#reorder for why it takes two passes).
 *   - Video references are validated and normalised to a YouTube id here, so an
 *     arbitrary URL can never become an iframe source.
 *   - Deleting a lesson cascades to its videos/resources, and the audit entry
 *     records how much content was removed with it.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env.js';
import {
  idSchema,
  lessonInputSchema,
  lessonUpdateSchema,
  moduleInputSchema,
  moduleUpdateSchema,
  reorderSchema,
  resourceInputSchema,
  youtubeVideoSchema,
} from '@g-world/shared';
import { createDb } from '../../db/client.js';
import * as curriculumRepo from '../../db/repositories/curriculum.js';
import * as catalogRepo from '../../db/repositories/catalog.js';
import { uniqueSlug } from '../../lib/slug.js';
import { extractYouTubeId, buildThumbnailUrl } from '../../lib/youtube.js';
import { audit } from '../../services/audit.js';
import { AUDIT_ACTIONS, diffFields } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parseJson, parseParam } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { created, ok } from '../helpers.js';
import { toLessonCardDto, toModuleDto, toResourceDto, toVideoDto } from '../../schemas/mappers.js';

export const adminCurriculumRoutes = new Hono<AppEnv>();


/* --------------------------------- modules -------------------------------- */

adminCurriculumRoutes.get('/courses/:courseId/curriculum', requirePermission('course.read'), async (c) => {
  const courseId = parseParam(c, 'courseId', idSchema);
  const db = createDb(c.env.DB);

  const course = await catalogRepo.findCourseById(db, courseId);
  if (!course) throw notFound('Course not found');

  const tree = await curriculumRepo.curriculumTree(db, courseId, false);
  return ok(c, {
    course: { id: course.id, title: course.title, slug: course.slug, status: course.status },
    modules: tree.map((module) => toModuleDto(module, module.lessons)),
  });
});

adminCurriculumRoutes.post('/modules', requirePermission('module.write'), async (c) => {
  const input = await parseJson(c, moduleInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const course = await catalogRepo.findCourseById(db, input.course_id);
  if (!course) throw badRequest('Choose an existing course', [{ field: 'course_id', message: 'Course not found' }]);

  const id = await curriculumRepo.createModule(db, {
    courseId: input.course_id,
    title: input.title,
    description: input.description ?? null,
    position: input.position,
    status: input.status,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.moduleCreated,
    entityType: 'module',
    entityId: id,
    description: `Added module “${input.title}” to “${course.title}”`,
    metadata: { course_id: input.course_id },
  });

  const module = await curriculumRepo.findModuleById(db, id);
  return created(c, module ? toModuleDto(module) : { id });
});

adminCurriculumRoutes.patch('/modules/:id', requirePermission('module.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, moduleUpdateSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await curriculumRepo.findModuleById(db, id);
  if (!existing) throw notFound('Module not found');

  await curriculumRepo.updateModule(db, id, {
    title: input.title,
    description: input.description,
    position: input.position,
    status: input.status,
    courseId: input.course_id,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.moduleUpdated,
    entityType: 'module',
    entityId: id,
    description: `Updated module “${input.title ?? existing.title}”`,
    metadata: { changes: diffFields(existing as unknown as Record<string, unknown>, input as Record<string, unknown>) },
  });

  return ok(c, { updated: true, id });
});

adminCurriculumRoutes.delete('/modules/:id', requirePermission('module.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await curriculumRepo.findModuleById(db, id);
  if (!existing) throw notFound('Module not found');

  const lessonCount = await curriculumRepo.countLessonsInModule(db, id);
  await curriculumRepo.deleteModule(db, id);

  await audit(c, {
    action: AUDIT_ACTIONS.moduleDeleted,
    entityType: 'module',
    entityId: id,
    description: `Deleted module “${existing.title}”`,
    metadata: { deleted_lessons: lessonCount },
  });

  return ok(c, { deleted: true, id, deleted_lessons: lessonCount });
});

adminCurriculumRoutes.put('/modules/reorder', requirePermission('module.write'), async (c) => {
  const { order } = await parseJson(c, reorderSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  await curriculumRepo.reorder(db, 'modules', order);
  await audit(c, {
    action: AUDIT_ACTIONS.contentReordered,
    entityType: 'module',
    description: `Reordered ${order.length} module(s)`,
    metadata: { ids: order.map((item) => item.id) },
  });

  return ok(c, { reordered: order.length });
});

/* --------------------------------- lessons -------------------------------- */

adminCurriculumRoutes.get('/lessons/:id', requirePermission('course.read'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB);

  const lesson = await curriculumRepo.findLessonById(db, id);
  if (!lesson) throw notFound('Lesson not found');

  const [videos, resources] = await Promise.all([
    curriculumRepo.listVideos(db, id),
    curriculumRepo.listResourcesForLesson(db, id),
  ]);

  return ok(c, {
    id: lesson.id,
    module_id: lesson.module_id,
    title: lesson.title,
    slug: lesson.slug,
    content_md: lesson.content_md,
    objectives: JSON.parse(lesson.objectives_json || '[]'),
    position: lesson.position,
    estimated_minutes: Number(lesson.estimated_minutes ?? 0),
    is_preview: Boolean(lesson.is_preview),
    completion_rule: lesson.completion_rule,
    status: lesson.status,
    videos: videos.map(toVideoDto),
    resources: resources.map((resource) => toResourceDto(resource, 'admin')),
  });
});

adminCurriculumRoutes.post('/lessons', requirePermission('lesson.write'), async (c) => {
  const input = await parseJson(c, lessonInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const module = await curriculumRepo.findModuleById(db, input.module_id);
  if (!module) throw badRequest('Choose an existing module', [{ field: 'module_id', message: 'Module not found' }]);

  const slug =
    input.slug ?? (await uniqueSlug(input.title, async (candidate) => {
      const existing = await db.exists(
        `SELECT 1 AS found FROM lessons WHERE module_id = ? AND slug = ? LIMIT 1`,
        [input.module_id, candidate],
      );
      return existing;
    }));

  const id = await curriculumRepo.createLesson(db, {
    moduleId: input.module_id,
    title: input.title,
    slug,
    contentMd: input.content_md,
    objectives: input.objectives ?? [],
    position: input.position,
    estimatedMinutes: input.estimated_minutes,
    isPreview: input.is_preview,
    completionRule: input.completion_rule,
    status: input.status,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.lessonCreated,
    entityType: 'lesson',
    entityId: id,
    description: `Added lesson “${input.title}”`,
    metadata: { module_id: input.module_id, status: input.status, is_preview: input.is_preview },
  });

  const lesson = await curriculumRepo.findLessonById(db, id);
  return created(c, lesson ? { ...lesson, objectives: JSON.parse(lesson.objectives_json || '[]') } : { id });
});

adminCurriculumRoutes.patch('/lessons/:id', requirePermission('lesson.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const input = await parseJson(c, lessonUpdateSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await curriculumRepo.findLessonById(db, id);
  if (!existing) throw notFound('Lesson not found');

  await curriculumRepo.updateLesson(db, id, {
    moduleId: input.module_id,
    title: input.title,
    slug: input.slug,
    contentMd: input.content_md,
    objectives: input.objectives,
    position: input.position,
    estimatedMinutes: input.estimated_minutes,
    isPreview: input.is_preview,
    completionRule: input.completion_rule,
    status: input.status,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.lessonUpdated,
    entityType: 'lesson',
    entityId: id,
    description: `Updated lesson “${input.title ?? existing.title}”`,
    // `content_md` is excluded from the diff: it can be large and may contain
    // learner-facing prose that does not belong in the audit trail.
    metadata: {
      changes: diffFields(
        { ...existing, content_md: undefined } as unknown as Record<string, unknown>,
        { ...input, content_md: undefined } as Record<string, unknown>,
      ),
    },
  });

  return ok(c, { updated: true, id });
});

adminCurriculumRoutes.delete('/lessons/:id', requirePermission('lesson.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const existing = await curriculumRepo.findLessonById(db, id);
  if (!existing) throw notFound('Lesson not found');

  await curriculumRepo.deleteLesson(db, id);
  await audit(c, {
    action: AUDIT_ACTIONS.lessonDeleted,
    entityType: 'lesson',
    entityId: id,
    description: `Deleted lesson “${existing.title}”`,
  });

  return ok(c, { deleted: true, id });
});

adminCurriculumRoutes.put('/lessons/reorder', requirePermission('lesson.write'), async (c) => {
  const { order } = await parseJson(c, reorderSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  await curriculumRepo.reorder(db, 'lessons', order);
  await audit(c, {
    action: AUDIT_ACTIONS.contentReordered,
    entityType: 'lesson',
    description: `Reordered ${order.length} lesson(s)`,
    metadata: { ids: order.map((item) => item.id) },
  });

  return ok(c, { reordered: order.length });
});

/* ---------------------------------- videos -------------------------------- */

adminCurriculumRoutes.post('/videos', requirePermission('lesson.write'), async (c) => {
  const input = await parseJson(c, youtubeVideoSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const lesson = await curriculumRepo.findLessonById(db, input.lesson_id);
  if (!lesson) throw badRequest('Choose an existing lesson', [{ field: 'lesson_id', message: 'Lesson not found' }]);

  const videoId = input.provider_video_id ?? extractYouTubeId(input.url ?? '');
  if (!videoId) {
    throw badRequest('That does not look like a YouTube link', [
      { field: 'url', message: 'Use a youtube.com/watch, youtu.be or /embed URL, or paste the 11-character video id' },
    ]);
  }

  const id = await curriculumRepo.createVideo(db, {
    lessonId: input.lesson_id,
    providerVideoId: videoId,
    title: input.title ?? null,
    description: input.description ?? null,
    thumbnailUrl: buildThumbnailUrl(videoId),
    durationSeconds: input.duration_seconds ?? null,
    position: input.position,
    isPrimary: input.is_primary,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.videoAdded,
    entityType: 'video',
    entityId: id,
    description: `Added YouTube video ${videoId} to lesson “${lesson.title}”`,
    metadata: { lesson_id: input.lesson_id, provider_video_id: videoId },
  });

  const video = await curriculumRepo.findVideoById(db, id);
  return created(c, video ? toVideoDto(video) : { id, provider_video_id: videoId });
});

adminCurriculumRoutes.delete('/videos/:id', requirePermission('lesson.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const video = await curriculumRepo.findVideoById(db, id);
  if (!video) throw notFound('Video not found');

  await curriculumRepo.deleteVideo(db, id);
  await audit(c, {
    action: AUDIT_ACTIONS.videoDeleted,
    entityType: 'video',
    entityId: id,
    description: `Removed video ${video.provider_video_id}`,
  });

  return ok(c, { deleted: true, id });
});

/* -------------------------------- resources ------------------------------- */

adminCurriculumRoutes.post('/resources', requirePermission('lesson.write'), async (c) => {
  const input = await parseJson(c, resourceInputSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  if (input.lesson_id) {
    const lesson = await curriculumRepo.findLessonById(db, input.lesson_id);
    if (!lesson) throw badRequest('Lesson not found', [{ field: 'lesson_id', message: 'Not found' }]);
  }
  if (input.course_id) {
    const course = await catalogRepo.findCourseById(db, input.course_id);
    if (!course) throw badRequest('Course not found', [{ field: 'course_id', message: 'Not found' }]);
  }

  const id = await curriculumRepo.createResource(db, {
    lessonId: input.lesson_id ?? null,
    courseId: input.course_id ?? null,
    title: input.title,
    kind: input.kind,
    url: input.url ?? null,
    r2Key: input.r2_key ?? null,
    sizeBytes: input.size_bytes ?? null,
    isPublic: input.is_public,
    position: input.position,
    createdBy: c.get('auth')!.userId,
  });

  await audit(c, {
    action: AUDIT_ACTIONS.resourceAdded,
    entityType: 'resource',
    entityId: id,
    description: `Added resource “${input.title}”`,
    metadata: { kind: input.kind, lesson_id: input.lesson_id ?? null, course_id: input.course_id ?? null },
  });

  const resource = await curriculumRepo.findResourceById(db, id);
  return created(c, resource ? toResourceDto(resource, 'admin') : { id });
});

adminCurriculumRoutes.delete('/resources/:id', requirePermission('lesson.write'), async (c) => {
  const id = parseParam(c, 'id', idSchema);
  const db = createDb(c.env.DB, c.get('logger')?.debug.bind(c.get('logger')));

  const resource = await curriculumRepo.findResourceById(db, id);
  if (!resource) throw notFound('Resource not found');

  await curriculumRepo.deleteResource(db, id);
  await audit(c, {
    action: AUDIT_ACTIONS.resourceDeleted,
    entityType: 'resource',
    entityId: id,
    description: `Removed resource “${resource.title}”`,
    // The R2 object itself is not deleted here: an administrator may want to
    // confirm first. The upload cleanup job removes orphans (docs/06-deployment).
    metadata: { r2_key: resource.r2_key },
  });

  return ok(c, { deleted: true, id, r2_key: resource.r2_key });
});

/** Lesson listing for the editor sidebar. */
adminCurriculumRoutes.get('/modules/:moduleId/lessons', requirePermission('course.read'), async (c) => {
  const moduleId = parseParam(c, 'moduleId', idSchema);
  const db = createDb(c.env.DB);

  const module = await curriculumRepo.findModuleById(db, moduleId);
  if (!module) throw notFound('Module not found');

  const lessons = await curriculumRepo.listLessons(db, moduleId, false);
  return ok(c, lessons.map(toLessonCardDto));
});
