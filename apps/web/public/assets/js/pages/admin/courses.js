/**
 * Admin page — courses.
 *
 * Creating a course is only half the job: it stays invisible to learners until
 * at least one module and lesson are published, which is why every row links
 * straight to the curriculum editor.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatNumber, formatRelative, humanize } from '../../core/format.js';
import { confirmAction } from '../../components/modal.js';
import { statusBadge } from '../../components/progress.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { wireForm } from '../../components/form.js';
import { pageError } from '../_shared.js';
import { describePage, requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const form = qs('[data-course-form]');
  const tableHost = qs('[data-course-table]');
  const paginationHost = qs('[data-pagination]');
  const statusFilter = qs('[data-course-status-filter]');
  const subjectSelect = qs('[data-subject-select]');

  let page = 1;

  async function loadSubjects() {
    const [departments, subjects] = await Promise.all([
      api.get('/admin/departments', { signal }),
      api.get('/admin/subjects', { query: { per_page: 100 }, signal }),
    ]);
    const byId = new Map(departments.map((department) => [department.id, department.name]));
    subjectSelect.replaceChildren(
      ...subjects.map((subject) =>
        el('option', {
          text: `${byId.get(subject.department_id) ?? 'Department'} › ${subject.name}`,
          attrs: { value: subject.id },
        }),
      ),
    );
  }

  async function load() {
    tableHost.setAttribute('aria-busy', 'true');
    const query = { page, per_page: 25 };
    if (statusFilter.value) query.status = statusFilter.value;

    const data = await api.get('/admin/courses', { query, signal });

    renderTable(tableHost, {
      caption: 'Courses',
      columns: [
        {
          key: 'title',
          label: 'Course',
          render: (row) =>
            el('div', {
              class: 'stack-sm',
              children: [
                el('a', { text: row.title, attrs: { href: `/admin/course-editor.html?course=${encodeURIComponent(row.id)}` } }),
                el('span', { class: 'subtle', text: `${row.id} · ${row.slug}` }),
              ],
            }),
        },
        { key: 'department_name', label: 'Department' },
        { key: 'subject', label: 'Subject', render: (row) => row.subject?.name ?? '—' },
        { key: 'difficulty', label: 'Level', render: (row) => humanize(row.difficulty) },
        { key: 'module_count', label: 'Modules', numeric: true, render: (row) => formatNumber(row.module_count) },
        { key: 'lesson_count', label: 'Lessons', numeric: true, render: (row) => formatNumber(row.lesson_count) },
        { key: 'enrollment_count', label: 'Enrolled', numeric: true, render: (row) => formatNumber(row.enrollment_count) },
        { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
        { key: 'updated_at', label: 'Updated', render: (row) => (row.updated_at ? formatRelative(row.updated_at) : '—') },
      ],
      rows: data.items ?? [],
      emptyMessage: 'No courses yet — create one above.',
      actions: (row) => [
        {
          label: 'Edit outline',
          onClick: () => window.location.assign(`/admin/course-editor.html?course=${encodeURIComponent(row.id)}`),
        },
        {
          label: row.status === 'published' ? 'Unpublish' : 'Publish',
          onClick: async () => {
            try {
              await api.patch(`/admin/courses/${encodeURIComponent(row.id)}`, {
                status: row.status === 'published' ? 'draft' : 'published',
              });
              toastSuccess(`${row.title} is now ${row.status === 'published' ? 'a draft' : 'published'}.`);
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
              title: `Delete ${row.title}?`,
              body:
                row.enrollment_count > 0
                  ? `${row.enrollment_count} learners are enrolled. The API will refuse rather than destroy their records.`
                  : 'The course, its modules and lessons are removed. This cannot be undone.',
              confirmLabel: 'Delete course',
              tone: 'danger',
              onConfirm: async () => {
                await api.delete(`/admin/courses/${encodeURIComponent(row.id)}`);
              },
            });
            if (!confirmed) return;
            toastSuccess('Course deleted.');
            await load().catch((error) => toastError(error.message));
          },
        },
      ],
    });

    renderPagination(paginationHost, {
      page: data.pagination.page,
      perPage: data.pagination.per_page,
      total: data.pagination.total,
      itemNoun: 'course',
      onPage: (next) => {
        page = next;
        load().catch((error) => pageError(error, () => load()));
      },
    });
  }

  wireForm(form, async (values, { setStatus }) => {
    setStatus('Creating…');
    const payload = {
      subject_id: values.subject_id,
      title: values.title,
      difficulty: values.difficulty ?? 'beginner',
      status: values.status ?? 'draft',
      estimated_minutes: Number(values.estimated_minutes ?? 0),
      is_featured: Boolean(values.is_featured),
      enrollment_open: Boolean(values.enrollment_open),
      certificate_enabled: Boolean(values.certificate_enabled),
    };
    if (values.summary) payload.summary = values.summary;
    if (values.description) payload.description = values.description;
    if (values.instructor_name) payload.instructor_name = values.instructor_name;

    const created = await api.post('/admin/courses', payload, { signal });
    setStatus(`Created ${created?.title ?? 'the course'}. Add modules and lessons next.`, 'success');
    form.reset();
    await load().catch((error) => toastError(error.message));
  });

  statusFilter.addEventListener('change', () => {
    page = 1;
    load().catch((error) => pageError(error, () => load()));
  });

  try {
    await Promise.all([loadSubjects(), load()]);
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}
