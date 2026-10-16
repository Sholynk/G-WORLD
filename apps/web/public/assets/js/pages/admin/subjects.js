/**
 * Admin page — subjects.
 *
 * A subject belongs to one department; the select is populated from the
 * catalogue so the ids sent to the API are real ones.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
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

  const tableHost = qs('[data-subject-table]');
  const departmentSelect = qs('[data-department-select]');

  async function loadDepartments() {
    const departments = await api.get('/admin/departments', { signal });
    departmentSelect.replaceChildren(
      ...departments.map((department) => el('option', { text: department.name, attrs: { value: department.id } })),
    );
  }

  async function load() {
    tableHost.setAttribute('aria-busy', 'true');
    const subjects = await api.get('/admin/subjects', { query: { per_page: 100 }, signal });

    renderTable(tableHost, {
      caption: 'Subjects',
      columns: [
        { key: 'name', label: 'Subject' },
        { key: 'department_name', label: 'Department' },
        { key: 'slug', label: 'Slug', render: (row) => el('span', { class: 'mono', text: row.slug }) },
        { key: 'display_order', label: 'Order', numeric: true },
        { key: 'course_count', label: 'Courses', numeric: true },
        { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
      ],
      rows: subjects,
      emptyMessage: 'No subjects yet.',
      actions: (row) => [
        {
          label: row.status === 'published' ? 'Unpublish' : 'Publish',
          onClick: async () => {
            try {
              await api.patch(`/admin/subjects/${encodeURIComponent(row.id)}`, {
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
          label: 'Delete',
          tone: 'danger',
          onClick: async () => {
            const confirmed = await confirmAction({
              title: `Delete ${row.name}?`,
              body:
                row.course_count > 0
                  ? 'This subject still has courses, so the API will refuse until they are moved.'
                  : 'The subject disappears from the catalogue.',
              confirmLabel: 'Delete subject',
              tone: 'danger',
              onConfirm: async () => {
                await api.delete(`/admin/subjects/${encodeURIComponent(row.id)}`);
              },
            });
            if (!confirmed) return;
            toastSuccess('Subject deleted.');
            await load().catch((error) => toastError(error.message));
          },
        },
      ],
    });
  }

  wireForm(qs('[data-subject-form]'), async (values, { setStatus }) => {
    setStatus('Creating…');
    const payload = {
      department_id: values.department_id,
      name: values.name,
      status: values.status ?? 'draft',
    };
    if (values.description) payload.description = values.description;
    const created = await api.post('/admin/subjects', payload, { signal });
    setStatus(`Created ${created?.name ?? 'the subject'}.`, 'success');
    qs('[data-subject-form]').reset();
    await load().catch((error) => toastError(error.message));
  });

  try {
    await Promise.all([loadDepartments(), load()]);
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
