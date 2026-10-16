/**
 * Admin page — enrolments.
 *
 * Progress is derived from lesson records, so "Recalculate" re-reads them rather
 * than being trusted to change a number. "Remind" queues a notification through
 * the API's email pipeline.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDateTime, formatNumber, formatRelative } from '../../core/format.js';
import { statusBadge } from '../../components/progress.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { pageError } from '../_shared.js';
import { describePage, filterValues, requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const form = qs('[data-enrolment-filters]');
  const tableHost = qs('[data-enrolment-table]');
  const countLabel = qs('[data-enrolment-count]');
  const paginationHost = qs('[data-pagination]');

  let page = 1;

  async function load() {
    tableHost.setAttribute('aria-busy', 'true');
    const data = await api.get('/admin/enrollments', {
      query: { ...filterValues(form), page, per_page: 25 },
      signal,
    });

    countLabel.textContent = describePage(data.pagination, 'enrolment');

    renderTable(tableHost, {
      caption: 'Enrolments',
      columns: [
        {
          key: 'student',
          label: 'Student',
          render: (row) => el('div', {
            class: 'stack-sm',
            children: [
              el('span', { text: row.student?.name ?? row.student?.email ?? '—' }),
              el('span', { class: 'subtle', text: row.student?.student_number ?? '' }),
            ],
          }),
        },
        { key: 'course', label: 'Course', render: (row) => row.course?.title ?? row.course_id ?? '—' },
        {
          key: 'progress_percent',
          label: 'Progress',
          numeric: true,
          render: (row) =>
            el('span', {
              class: 'stack-sm',
              children: [
                el('span', { text: `${row.progress_percent ?? 0}%` }),
                el('span', { class: 'subtle', text: `${formatNumber(row.lessons_completed)} / ${formatNumber(row.total_lessons)} lessons` }),
              ],
            }),
        },
        { key: 'status', label: 'Status', render: (row) => statusBadge(row.status) },
        {
          key: 'last_activity_at',
          label: 'Last activity',
          render: (row) => (row.last_activity_at ? el('span', { text: formatRelative(row.last_activity_at), attrs: { title: formatDateTime(row.last_activity_at) } }) : '—'),
        },
        {
          key: 'certificates_issued',
          label: 'Certificate',
          render: (row) => (row.certificates_issued ? el('span', { class: 'badge badge--success', text: 'Issued' }) : '—'),
        },
      ],
      rows: data.items ?? [],
      emptyMessage: 'No enrolments match those filters.',
      actions: (row) => [
        {
          label: 'Recalculate',
          onClick: async () => {
            try {
              const result = await api.post(`/admin/enrollments/${encodeURIComponent(row.id)}/recalculate`, {});
              toastSuccess(
                result?.progress_percent !== undefined
                  ? `Progress is now ${result.progress_percent}%.`
                  : 'Progress recalculated.',
              );
              await load();
            } catch (error) {
              toastError(error.message);
            }
          },
        },
        {
          label: 'Remind',
          tone: 'ghost',
          onClick: async () => {
            try {
              await api.post(`/admin/enrollments/${encodeURIComponent(row.id)}/remind`, {});
              toastSuccess('A reminder was queued for that learner.');
            } catch (error) {
              toastError(error.message);
            }
          },
        },
      ],
    });

    renderPagination(paginationHost, {
      page: data.pagination.page,
      perPage: data.pagination.per_page,
      total: data.pagination.total,
      itemNoun: 'enrolment',
      onPage: (next) => {
        page = next;
        load().catch((error) => pageError(error, () => load()));
      },
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    page = 1;
    load().catch((error) => pageError(error, () => load()));
  });

  try {
    await load();
  } catch (error) {
    pageError(error, () => load());
  }
}
