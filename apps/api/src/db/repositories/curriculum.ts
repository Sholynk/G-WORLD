/**
 * Repository — curriculum: modules, lessons, videos and resources.
 *
 * The curriculum is a three-level tree (module → lesson → media/resource).
 * Ordering is stored as an integer `position` with a UNIQUE (parent, position)
 * constraint, so two lessons can never claim the same slot; reordering is
 * performed by the API as a two-phase update inside one batch.
 */
import type { Db } from '../client.js';
import type { PublicationStatus, ResourceKind, CompletionRule } from '@g-world/shared';
import { newId, ID_PREFIXES } from '../../lib/ids.js';

/* ------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* ------------------------------------------------------------------------- */

export interface ModuleRow {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  position: number;
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
}

export interface LessonRow {
  id: string;
  module_id: string;
  title: string;
  slug: string | null;
  content_md: string;
  objectives_json: string;
  position: number;
  estimated_minutes: number;
  is_preview: number;
  completion_rule: CompletionRule;
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
}

export interface VideoRow {
  id: string;
  lesson_id: string;
  provider: 'youtube';
  provider_video_id: string;
  title: string | null;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  position: number;
  is_primary: number;
  created_at: string;
}

export interface ResourceRow {
  id: string;
  lesson_id: string | null;
  course_id: string | null;
  title: string;
  kind: ResourceKind;
  url: string | null;
  r2_key: string | null;
  size_bytes: number | null;
  is_public: number;
  position: number;
  created_at: string;
}

export interface CurriculumLessonRow extends LessonRow {
  video_count: number;
  resource_count: number;
}

export interface CurriculumModuleRow extends ModuleRow {
  lessons: CurriculumLessonRow[];
}

export interface LessonDetailRow extends LessonRow {
  module_title: string;
  module_position: number;
  course_id: string;
  course_title: string;
  course_slug: string;
  course_status: PublicationStatus;
  subject_name: string;
  department_name: string;
}

/* ------------------------------------------------------------------------- */
/* Modules                                                                    */
/* ------------------------------------------------------------------------- */

export async function listModules(
  db: Db,
  courseId: string,
  publishedOnly = false,
): Promise<ModuleRow[]> {
  const statusClause = publishedOnly ? `AND status = 'published'` : '';
  return db.all<ModuleRow>(
    `SELECT id, course_id, title, description, position, status, created_at, updated_at
       FROM modules
      WHERE course_id = ? ${statusClause}
      ORDER BY position ASC, title ASC`,
    [courseId],
  );
}

export async function findModuleById(db: Db, id: string): Promise<ModuleRow | null> {
  return db.first<ModuleRow>(
    `SELECT id, course_id, title, description, position, status, created_at, updated_at
       FROM modules WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function nextModulePosition(db: Db, courseId: string): Promise<number> {
  const row = await db.first<{ next: number | null }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM modules WHERE course_id = ?`,
    [courseId],
  );
  return Number(row?.next ?? 0);
}

export async function createModule(
  db: Db,
  input: {
    courseId: string;
    title: string;
    description?: string | null;
    position?: number;
    status?: PublicationStatus;
  },
): Promise<string> {
  const id = newId(ID_PREFIXES.module);
  const position = input.position ?? (await nextModulePosition(db, input.courseId));
  await db.run(
    `INSERT INTO modules (id, course_id, title, description, position, status) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.courseId, input.title, input.description ?? null, position, input.status ?? 'draft'],
  );
  return id;
}

export async function updateModule(
  db: Db,
  id: string,
  input: {
    title?: string;
    description?: string | null;
    position?: number;
    status?: PublicationStatus;
    courseId?: string;
  },
): Promise<number> {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];
  if (input.title !== undefined) {
    assignments.push('title = ?');
    params.push(input.title);
  }
  if (input.description !== undefined) {
    assignments.push('description = ?');
    params.push(input.description);
  }
  if (input.position !== undefined) {
    assignments.push('position = ?');
    params.push(input.position);
  }
  if (input.status !== undefined) {
    assignments.push('status = ?');
    params.push(input.status);
  }
  if (input.courseId !== undefined) {
    assignments.push('course_id = ?');
    params.push(input.courseId);
  }
  if (!assignments.length) return 0;
  params.push(id);
  return db.changes(`UPDATE modules SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function deleteModule(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM modules WHERE id = ?`, [id]);
}

export async function countLessonsInModule(db: Db, moduleId: string): Promise<number> {
  return db.count(`SELECT COUNT(*) AS total FROM lessons WHERE module_id = ?`, [moduleId]);
}

/* ------------------------------------------------------------------------- */
/* Lessons                                                                    */
/* ------------------------------------------------------------------------- */

export async function listLessons(db: Db, moduleId: string, publishedOnly = false): Promise<CurriculumLessonRow[]> {
  const statusClause = publishedOnly ? `AND l.status = 'published'` : '';
  return db.all<CurriculumLessonRow>(
    `SELECT l.id, l.module_id, l.title, l.slug, l.content_md, l.objectives_json, l.position,
            l.estimated_minutes, l.is_preview, l.completion_rule, l.status, l.created_at, l.updated_at,
            (SELECT COUNT(*) FROM videos v WHERE v.lesson_id = l.id) AS video_count,
            (SELECT COUNT(*) FROM resources r WHERE r.lesson_id = l.id) AS resource_count
       FROM lessons l
      WHERE l.module_id = ? ${statusClause}
      ORDER BY l.position ASC, l.title ASC`,
    [moduleId],
  );
}

export async function findLessonById(db: Db, id: string): Promise<LessonRow | null> {
  return db.first<LessonRow>(
    `SELECT id, module_id, title, slug, content_md, objectives_json, position, estimated_minutes,
            is_preview, completion_rule, status, created_at, updated_at
       FROM lessons WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function findLessonDetail(db: Db, lessonId: string): Promise<LessonDetailRow | null> {
  return db.first<LessonDetailRow>(
    `SELECT l.id, l.module_id, l.title, l.slug, l.content_md, l.objectives_json, l.position,
            l.estimated_minutes, l.is_preview, l.completion_rule, l.status, l.created_at, l.updated_at,
            m.title AS module_title, m.position AS module_position,
            c.id AS course_id, c.title AS course_title, c.slug AS course_slug, c.status AS course_status,
            s.name AS subject_name, d.name AS department_name
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
       JOIN subjects s ON s.id = c.subject_id
       JOIN departments d ON d.id = s.department_id
      WHERE l.id = ?
      LIMIT 1`,
    [lessonId],
  );
}

export async function nextLessonPosition(db: Db, moduleId: string): Promise<number> {
  const row = await db.first<{ next: number | null }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM lessons WHERE module_id = ?`,
    [moduleId],
  );
  return Number(row?.next ?? 0);
}

export async function createLesson(
  db: Db,
  input: {
    moduleId: string;
    title: string;
    slug?: string | null;
    contentMd?: string;
    objectives?: string[];
    position?: number;
    estimatedMinutes?: number;
    isPreview?: boolean;
    completionRule?: CompletionRule;
    status?: PublicationStatus;
  },
): Promise<string> {
  const id = newId(ID_PREFIXES.lesson);
  const position = input.position ?? (await nextLessonPosition(db, input.moduleId));
  await db.run(
    `INSERT INTO lessons (id, module_id, title, slug, content_md, objectives_json, position,
                          estimated_minutes, is_preview, completion_rule, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.moduleId,
      input.title,
      input.slug ?? null,
      input.contentMd ?? '',
      JSON.stringify(input.objectives ?? []),
      position,
      input.estimatedMinutes ?? 0,
      input.isPreview ? 1 : 0,
      input.completionRule ?? 'mark_complete',
      input.status ?? 'draft',
    ],
  );
  return id;
}

export async function updateLesson(
  db: Db,
  id: string,
  input: {
    moduleId?: string;
    title?: string;
    slug?: string | null;
    contentMd?: string;
    objectives?: string[];
    position?: number;
    estimatedMinutes?: number;
    isPreview?: boolean;
    completionRule?: CompletionRule;
    status?: PublicationStatus;
  },
): Promise<number> {
  const assignments: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.moduleId !== undefined) {
    assignments.push('module_id = ?');
    params.push(input.moduleId);
  }
  if (input.title !== undefined) {
    assignments.push('title = ?');
    params.push(input.title);
  }
  if (input.slug !== undefined) {
    assignments.push('slug = ?');
    params.push(input.slug);
  }
  if (input.contentMd !== undefined) {
    assignments.push('content_md = ?');
    params.push(input.contentMd);
  }
  if (input.objectives !== undefined) {
    assignments.push('objectives_json = ?');
    params.push(JSON.stringify(input.objectives));
  }
  if (input.position !== undefined) {
    assignments.push('position = ?');
    params.push(input.position);
  }
  if (input.estimatedMinutes !== undefined) {
    assignments.push('estimated_minutes = ?');
    params.push(input.estimatedMinutes);
  }
  if (input.isPreview !== undefined) {
    assignments.push('is_preview = ?');
    params.push(input.isPreview ? 1 : 0);
  }
  if (input.completionRule !== undefined) {
    assignments.push('completion_rule = ?');
    params.push(input.completionRule);
  }
  if (input.status !== undefined) {
    assignments.push('status = ?');
    params.push(input.status);
  }

  if (!assignments.length) return 0;
  params.push(id);
  return db.changes(`UPDATE lessons SET ${assignments.join(', ')} WHERE id = ?`, params);
}

export async function deleteLesson(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM lessons WHERE id = ?`, [id]);
}

/**
 * Every published lesson of a course, ordered by module then lesson. This is the
 * list the progress engine counts, and it is also what the lesson player uses to
 * compute "previous/next".
 */
export async function listPublishedCourseLessons(
  db: Db,
  courseId: string,
): Promise<{ id: string; module_id: string; title: string; position: number; module_position: number; is_preview: number; completion_rule: CompletionRule }[]> {
  return db.all(
    `SELECT l.id, l.module_id, l.title, l.position, m.position AS module_position,
            l.is_preview, l.completion_rule
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = ? AND l.status = 'published' AND m.status = 'published'
      ORDER BY m.position ASC, l.position ASC`,
    [courseId],
  );
}

export async function countPublishedLessons(db: Db, courseId: string): Promise<number> {
  return db.count(
    `SELECT COUNT(*) AS total
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = ? AND l.status = 'published' AND m.status = 'published'`,
    [courseId],
  );
}

/** Full curriculum tree (modules with nested lessons) for a course page. */
export async function curriculumTree(
  db: Db,
  courseId: string,
  publishedOnly = true,
): Promise<CurriculumModuleRow[]> {
  const modules = await listModules(db, courseId, publishedOnly);
  const tree: CurriculumModuleRow[] = [];
  for (const module of modules) {
    const lessons = await listLessons(db, module.id, publishedOnly);
    tree.push({ ...module, lessons });
  }
  return tree;
}

/* ------------------------------------------------------------------------- */
/* Videos                                                                     */
/* ------------------------------------------------------------------------- */

export async function listVideos(db: Db, lessonId: string): Promise<VideoRow[]> {
  return db.all<VideoRow>(
    `SELECT id, lesson_id, provider, provider_video_id, title, description, thumbnail_url,
            duration_seconds, position, is_primary, created_at
       FROM videos WHERE lesson_id = ? ORDER BY position ASC, created_at ASC`,
    [lessonId],
  );
}

export async function createVideo(
  db: Db,
  input: {
    lessonId: string;
    providerVideoId: string;
    title?: string | null;
    description?: string | null;
    thumbnailUrl?: string | null;
    durationSeconds?: number | null;
    position?: number;
    isPrimary?: boolean;
  },
): Promise<string> {
  const id = newId(ID_PREFIXES.video);
  if (input.isPrimary) {
    await db.run(`UPDATE videos SET is_primary = 0 WHERE lesson_id = ?`, [input.lessonId]);
  }
  await db.run(
    `INSERT INTO videos (id, lesson_id, provider, provider_video_id, title, description, thumbnail_url,
                         duration_seconds, position, is_primary)
     VALUES (?, ?, 'youtube', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.lessonId,
      input.providerVideoId,
      input.title ?? null,
      input.description ?? null,
      input.thumbnailUrl ?? null,
      input.durationSeconds ?? null,
      input.position ?? 0,
      input.isPrimary ? 1 : 0,
    ],
  );
  return id;
}

export async function findVideoById(db: Db, id: string): Promise<VideoRow | null> {
  return db.first<VideoRow>(
    `SELECT id, lesson_id, provider, provider_video_id, title, description, thumbnail_url,
            duration_seconds, position, is_primary, created_at
       FROM videos WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function deleteVideo(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM videos WHERE id = ?`, [id]);
}

/* ------------------------------------------------------------------------- */
/* Resources                                                                  */
/* ------------------------------------------------------------------------- */

export async function listResourcesForLesson(db: Db, lessonId: string): Promise<ResourceRow[]> {
  return db.all<ResourceRow>(
    `SELECT id, lesson_id, course_id, title, kind, url, r2_key, size_bytes, is_public, position, created_at
       FROM resources WHERE lesson_id = ? ORDER BY position ASC, title ASC`,
    [lessonId],
  );
}

export async function listResourcesForCourse(db: Db, courseId: string): Promise<ResourceRow[]> {
  return db.all<ResourceRow>(
    `SELECT id, lesson_id, course_id, title, kind, url, r2_key, size_bytes, is_public, position, created_at
       FROM resources WHERE course_id = ? ORDER BY position ASC, title ASC`,
    [courseId],
  );
}

export async function createResource(
  db: Db,
  input: {
    lessonId?: string | null;
    courseId?: string | null;
    title: string;
    kind?: ResourceKind;
    url?: string | null;
    r2Key?: string | null;
    sizeBytes?: number | null;
    isPublic?: boolean;
    position?: number;
    createdBy?: string | null;
  },
): Promise<string> {
  const id = newId(ID_PREFIXES.resource);
  await db.run(
    `INSERT INTO resources (id, lesson_id, course_id, title, kind, url, r2_key, size_bytes,
                            is_public, position, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.lessonId ?? null,
      input.courseId ?? null,
      input.title,
      input.kind ?? 'link',
      input.url ?? null,
      input.r2Key ?? null,
      input.sizeBytes ?? null,
      input.isPublic ? 1 : 0,
      input.position ?? 0,
      input.createdBy ?? null,
    ],
  );
  return id;
}

export async function findResourceById(db: Db, id: string): Promise<ResourceRow | null> {
  return db.first<ResourceRow>(
    `SELECT id, lesson_id, course_id, title, kind, url, r2_key, size_bytes, is_public, position, created_at
       FROM resources WHERE id = ? LIMIT 1`,
    [id],
  );
}

export async function deleteResource(db: Db, id: string): Promise<number> {
  return db.changes(`DELETE FROM resources WHERE id = ?`, [id]);
}

/**
 * Reorders siblings.
 *
 * `UNIQUE (parent, position)` means a naive one-by-one update would collide with
 * the row that still holds the target position (and `CHECK (position >= 0)`
 * rules out negative scratch values). So the batch runs in two phases:
 *
 *   1. move every listed row to `position + 10000` (above the maximum allowed
 *      position of 999, therefore collision-free)
 *   2. write the final positions
 *
 * Both phases execute in one D1 batch, which is atomic: readers never observe
 * the intermediate state.
 */
export async function reorder(
  db: Db,
  table: 'modules' | 'lessons',
  items: readonly { id: string; position: number }[],
): Promise<void> {
  if (items.length === 0) return;
  const OFFSET = 10_000;
  const statements: D1PreparedStatement[] = [];
  for (const item of items) {
    statements.push(db.prepare(`UPDATE ${table} SET position = position + ? WHERE id = ?`, [OFFSET, item.id]));
  }
  for (const item of items) {
    statements.push(db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`, [item.position, item.id]));
  }
  await db.batch(statements);
}
