/**
 * Admin page — departments.
 *
 * Create, rename, reorder, publish and delete. Deletion is refused by the API
 * while a department still has subjects, so the page reports that instead of
 * pretending it worked.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { humanize } from '../../core/format.js';
import { confirmAction } from '../../components/modal.js';
import { statusBadge } from '../../components/progress.js';
import { renderTable } from '../../components/table.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { wireForm } from '../../components/form.js';
import { pageError } from '../_shared.js';
import { requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const tableHost = qs('[data-department-table]');

  async function load() {
    tableHost.setAttribute('aria-busy', 'true');
    const departments = await api.get('/admin/departments', { signal });

    renderTable(tableHost, {
      caption: 'Departments',
      columns: [
        { key: 'name', label: 'Name', render: (row) => el('span', { text: `${row.icon ?? ''} ${row.name}`.trim() }) },
        { key: 'slug', label: 'Slug', render: (row) => el('span', { class: 'mono', text: row.slug }) },
        { key: 'display_order', label: 'Order', numeric: true },
        { key: 'subject_count', label: 'Subjects', numeric: true },
        { key: 'course_count', label: 'Courses', numeric: true },
        { key: 'lesson_count', label: 'Lessons', numeric: true },
        { key: 'student_count', label: 'Learners', numeric: true },
        { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
      ],
      rows: departments,
      emptyMessage: 'No departments yet.',
      actions: (row) => [
        {
          label: row.status === 'published' ? 'Unpublish' : 'Publish',
          onClick: async () => {
            try {
              await api.patch(`/admin/departments/${encodeURIComponent(row.id)}`, {
                status: row.status === 'published' ? 'draft' : 'published',
              });
              toastSuccess(`${row.name} is now ${row.status === 'published' ? 'a draft' : 'published'}.`);
              await load();
            } catch (error) {
              toastError(error.message);
            }
          },
        },
        {
          label: 'Rename',
          tone: 'ghost',
          onClick: async () => {
            const name = window.prompt('New name for this department?', row.name);
            if (!name || name.trim().length < 2) return;
            try {
              await api.patch(`/admin/departments/${encodeURIComponent(row.id)}`, { name: name.trim() });
              toastSuccess('Department renamed.');
              await load();
            } catch (error) {
              toastError(error.message);
            }
          },
        },
        {
          label: 'Delete',
          tone: 'danger',
          onClick: async () => {
            const confirmed = await confirmAction({
              title: `Delete ${row.name}?`,
              body:
                row.subject_count > 0
                  ? 'This department still has subjects, so the API will refuse — move or delete them first.'
                  : 'The department disappears from the catalogue. This cannot be undone.',
              confirmLabel: 'Delete department',
              tone: 'danger',
              onConfirm: async () => {
                await api.delete(`/admin/departments/${encodeURIComponent(row.id)}`);
              },
            });
            if (!confirmed) return;
            toastSuccess('Department deleted.');
            await load().catch((error) => toastError(error.message));
          },
        },
      ],
    });
  }

  wireForm(qs('[data-department-form]'), async (values, { setStatus }) => {
    setStatus('Creating…');
    const payload = {
      name: values.name,
      display_order: Number(values.display_order ?? 0),
      status: values.status ?? 'draft',
    };
    if (values.slug) payload.slug = values.slug;
    if (values.tagline) payload.tagline = values.tagline;
    if (values.description) payload.description = values.description;

    const created = await api.post('/admin/departments', payload, { signal });
    setStatus(`Created ${created?.name ?? 'the department'} (${humanize(created?.status ?? 'draft')}).`, 'success');
    qs('[data-department-form]').reset();
    await load().catch((error) => toastError(error.message));
  });

  try {
    await load();
  } catch (error) {
    pageError(error, () => load());
  }
}
