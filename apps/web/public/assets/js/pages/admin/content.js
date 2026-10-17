/**
 * Admin page — content.
 *
 * The content of a course is its modules, its lessons and the videos inside
 * them. The page follows the same pattern as course management: a toolbar
 * with a course select, and a table of what that course contains.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDuration, humanize } from '../../core/format.js';
import { renderTable } from '../../components/table.js';
import { pageError, setBusy } from '../_shared.js';
import { requireStaff } from './_shared.js';
import { skeletonTable } from '../../components/skeleton.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const host = qs('[data-content-table]');
  if (host) skeletonTable(host, 4, 4);
  const select = qs('[data-content-course]');
  if (!host) return;

  /** Flattens the module tree into one row per lesson. */
  function lessonRows(modules) {
    const rows = [];
    for (const module of modules ?? []) {
      for (const lesson of module.lessons ?? []) {
        rows.push({
          id: lesson.id,
          title: lesson.title,
          module: `Module ${module.position} · ${module.title}`,
          minutes: lesson.estimated_minutes,
          videos: lesson.video_count,
          resources: lesson.resource_count,
          status: lesson.status,
        });
      }
    }
    return rows;
  }

  async function load(courseId) {
    if (!courseId) {
      renderTable(host, {
        columns: [{ key: 'title', label: 'Lesson' }],
        rows: [],
        emptyMessage: 'Choose a course to see its lessons.',
      });
      setBusy(host, false);
      return;
    }

    try {
      const data = await api.get(`/admin/courses/${encodeURIComponent(courseId)}/curriculum`, { signal });
      const rows = lessonRows(data.modules);

      renderTable(host, {
        caption: data.course?.title ? `Lessons in ${data.course.title}` : undefined,
        columns: [
          { key: 'title', label: 'Lesson' },
          { key: 'module', label: 'Module' },
          { key: 'minutes', label: 'Duration', render: (row) => formatDuration(row.minutes) },
          { key: 'videos', label: 'Videos', numeric: true },
          { key: 'resources', label: 'Resources', numeric: true },
          {
            key: 'status',
            label: 'Status',
            render: (row) => el('span', { class: 'tag', text: humanize(row.status) }),
          },
        ],
        rows,
        emptyMessage: 'This course has no lessons yet.',
        actions: (row) => [
          {
            label: 'Edit',
            onClick: () => {
              window.location.assign(`/admin/course-editor.html?lesson=${encodeURIComponent(row.id)}`);
            },
          },
        ],
      });
      setBusy(host, false);
    } catch (error) {
      setBusy(host, false);
      pageError(error, () => load(courseId));
    }
  }

  try {
    const courses = await api.get('/admin/courses', { signal, query: { per_page: 100 } });
    for (const course of courses.items ?? []) {
      select.append(el('option', { text: course.title, attrs: { value: course.id } }));
    }
    select.addEventListener('change', () => load(select.value));

    // Start on the first course so the table is never an empty shell.
    if (courses.items?.length) select.value = courses.items[0].id;
    await load(select.value);
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal, session: current }));
  }
}
