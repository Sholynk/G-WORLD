/**
 * Admin page — students.
 *
 * Search, filter, then act: suspend or reactivate, change role, revoke sessions,
 * or resend a confirmation email. Every action is confirmed, shows its own
 * failure, and re-loads the row from the API afterwards so the table never
 * drifts from the database.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDateTime, formatRelative, humanize } from '../../core/format.js';
import { confirmAction, openModal } from '../../components/modal.js';
import { statusBadge } from '../../components/progress.js';
import { renderTable } from '../../components/table.js';
import { renderPagination } from '../../components/pagination.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { pageError } from '../_shared.js';
import { describePage, filterValues, requireStaff } from './_shared.js';
import { skeletonTable } from '../../components/skeleton.js';

const STATUS_ACTIONS = {
  active: { label: 'Suspend', to: 'suspended' },
  suspended: { label: 'Reactivate', to: 'active' },
  pending_verification: { label: 'Reactivate', to: 'active' },
  deactivated: { label: 'Reactivate', to: 'active' },
};

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const form = qs('[data-student-filters]');
  const tableHost = qs('[data-student-table]');
  if (tableHost) skeletonTable(tableHost, 4, 4);
  const countLabel = qs('[data-student-count]');
  const paginationHost = qs('[data-pagination]');

  let page = 1;

  async function act(request, successMessage) {
    try {
      await request();
      toastSuccess(successMessage);
      await load();
    } catch (error) {
      toastError(error.message);
    }
  }

  async function showDetail(student) {
    try {
      const detail = await api.get(`/admin/students/${encodeURIComponent(student.id)}`, { signal });
      openModal({
        title: detail.user?.profile?.display_name ?? detail.user?.email ?? 'Student',
        confirmLabel: 'Close',
        body: el('div', {
          class: 'stack-sm',
          children: [
            el('dl', {
              class: 'detail-list',
              children: [
                ['Email', detail.user?.email],
                ['Student number', detail.user?.student_number ?? '—'],
                ['Role', humanize(detail.user?.role)],
                ['Status', humanize(detail.user?.status)],
                ['Created', formatDateTime(detail.user?.created_at)],
                ['Last login', detail.user?.last_login_at ? formatDateTime(detail.user.last_login_at) : 'Never'],
              ].map(([term, value]) =>
                el('div', { children: [el('dt', { text: term }), el('dd', { text: String(value ?? '—') })] }),
              ),
            }),
            el('p', { class: 'subtle', text: `${detail.enrollments?.length ?? 0} enrolments · ${detail.certificates?.length ?? 0} certificates · ${detail.sessions?.length ?? 0} active sessions` }),
          ],
        }),
        onConfirm: async () => {},
      });
    } catch (error) {
      toastError(error.message);
    }
  }

  async function load() {
    tableHost.setAttribute('aria-busy', 'true');
    const query = { ...filterValues(form), page, per_page: 25 };
    const data = await api.get('/admin/students', { query, signal });

    countLabel.textContent = describePage(data.pagination, 'account');

    renderTable(tableHost, {
      caption: 'Accounts',
      columns: [
        {
          key: 'email',
          label: 'Account',
          render: (row) => el('div', {
            class: 'stack-sm',
            children: [
              el('a', { text: row.profile?.display_name ?? row.email, attrs: { href: '#', on: { click: (event) => { event.preventDefault(); showDetail(row); } } } }),
              el('span', { class: 'subtle', text: `${row.email} · ${row.student_number ?? '—'}` }),
            ],
          }),
        },
        { key: 'role', label: 'Role', render: (row) => humanize(row.role) },
        {
          key: 'status',
          label: 'Status',
          render: (row) => el('span', {
            class: 'stack-sm',
            children: [
              statusBadge(row.status),
              row.email_verified ? null : el('span', { class: 'subtle', text: 'email unconfirmed' }),
            ].filter(Boolean),
          }),
        },
        {
          key: 'last_login_at',
          label: 'Last login',
          render: (row) => (row.last_login_at ? el('span', { text: formatRelative(row.last_login_at), attrs: { title: formatDateTime(row.last_login_at) } }) : 'Never'),
        },
        { key: 'created_at', label: 'Joined', render: (row) => formatRelative(row.created_at) },
      ],
      rows: data.items ?? [],
      emptyMessage: 'No accounts match those filters.',
      actions: (row) => {
        const actions = [
          { label: 'Details', onClick: () => showDetail(row) },
          {
            label: STATUS_ACTIONS[row.status]?.label ?? 'Activate',
            tone: row.status === 'active' ? 'danger' : 'primary',
            onClick: async () => {
              const target = STATUS_ACTIONS[row.status]?.to ?? 'active';
              const confirmed = await confirmAction({
                title: `${target === 'suspended' ? 'Suspend' : 'Activate'} this account?`,
                body:
                  target === 'suspended'
                    ? 'The account loses access immediately. Every privileged action is written to the audit log.'
                    : 'The account will be able to sign in again.',
                confirmLabel: target === 'suspended' ? 'Suspend account' : 'Activate account',
                tone: target === 'suspended' ? 'danger' : 'primary',
                onConfirm: async () => {
                  await api.patch(`/admin/students/${encodeURIComponent(row.id)}/status`, { status: target });
                },
              });
              if (!confirmed) return;
              toastSuccess(`${row.email} is now ${target}.`);
              await load().catch((error) => toastError(error.message));
            },
          },
          {
            label: 'Role',
            onClick: async () => {
              const next = row.role === 'admin' ? 'student' : 'admin';
              const confirmed = await confirmAction({
                title: `Set role to ${next}?`,
                body:
                  next === 'admin'
                    ? 'Administrators can change the catalogue and moderate accounts.'
                    : 'Administrator permissions are removed immediately.',
                confirmLabel: `Make ${next}`,
                onConfirm: async () => {
                  await api.patch(`/admin/students/${encodeURIComponent(row.id)}/role`, { role: next });
                },
              });
              if (!confirmed) return;
              toastSuccess(`${row.email} is now ${next}.`);
              await load().catch((error) => toastError(error.message));
            },
          },
          {
            label: 'Revoke sessions',
            tone: 'ghost',
            onClick: () =>
              act(
                () => api.post(`/admin/students/${encodeURIComponent(row.id)}/sessions/revoke`, {}),
                'Sessions revoked.',
              ),
          },
          {
            label: 'Resend email',
            tone: 'ghost',
            disabled: Boolean(row.email_verified),
            onClick: () =>
              act(
                () => api.post(`/admin/students/${encodeURIComponent(row.id)}/resend-verification`, {}),
                'Confirmation email queued.',
              ),
          },
        ];
        return actions;
      },
    });

    renderPagination(paginationHost, {
      page: data.pagination.page,
      perPage: data.pagination.per_page,
      total: data.pagination.total,
      itemNoun: 'account',
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
