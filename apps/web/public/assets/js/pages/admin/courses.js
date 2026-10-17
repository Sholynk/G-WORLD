/**
 * Admin page — course management.
 *
 * A table of every course in the catalogue with its department, subject and
 * status, and an "Edit" action per row. The "New course" button opens the
 * course editor, which is where a course is actually written.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { humanize } from '../../core/format.js';
import { renderTable } from '../../components/table.js';
import { pageError, setBusy } from '../_shared.js';
import { requireStaff } from './_shared.js';
import { skeletonTable } from '../../components/skeleton.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const host = qs('[data-courses-table]');
  if (host) skeletonTable(host, 4, 4);
  if (!host) return;

  try {
    const data = await api.get('/admin/courses', { signal, query: { per_page: 50 } });

    renderTable(host, {
      columns: [
        {
          key: 'title',
          label: 'Course',
          render: (row) =>
            el('a', {
              text: row.title,
              attrs: { href: `/course.html?slug=${encodeURIComponent(row.slug)}` },
            }),
        },
        { key: 'department_name', label: 'Department' },
        { key: 'subject', label: 'Subject', render: (row) => row.subject?.name ?? '—' },
        {
          key: 'status',
          label: 'Status',
          render: (row) => el('span', { class: 'tag', text: humanize(row.status) }),
        },
      ],
      rows: data.items ?? [],
      emptyMessage: 'No courses yet — create the first one.',
      actions: (row) => [
        {
          label: 'Edit',
          onClick: () => {
            window.location.assign(`/admin/course-editor.html?id=${encodeURIComponent(row.id)}`);
          },
        },
      ],
    });
    setBusy(host, false);
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal, session: current }));
  }
}
