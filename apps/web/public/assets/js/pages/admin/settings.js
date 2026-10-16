/**
 * Admin page — settings and maintenance.
 *
 * Three read-only views (roles with their permissions, the email outbox) plus
 * the one safe write: the housekeeping job that clears expired sessions, spent
 * tokens and closed rate-limit windows. The nightly cron runs exactly the same
 * service, so running it by hand is never a special case.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDateTime, formatNumber, formatRelative, humanize } from '../../core/format.js';
import { renderTable } from '../../components/table.js';
import { toastError, toastSuccess } from '../../components/toast.js';
import { pageError } from '../_shared.js';
import { requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const roleHost = qs('[data-role-table]');
  const emailHost = qs('[data-email-table]');

  const jobs = [
    api.get('/admin/roles', { signal }).then((data) => {
      const permissionsByRole = new Map(
        (data.roles ?? []).map((role) => [role.key, new Set((role.permissions ?? []).map((permission) => permission.key ?? permission))]),
      );

      renderTable(roleHost, {
        caption: 'Roles',
        columns: [
          { key: 'name', label: 'Role' },
          { key: 'key', label: 'Key', render: (row) => el('span', { class: 'mono', text: row.key }) },
          { key: 'rank', label: 'Rank', numeric: true },
          {
            key: 'permissions',
            label: 'Permissions',
            render: (row) => {
              const keys = permissionsByRole.get(row.key) ?? new Set();
              return el('span', {
                text: keys.size ? `${formatNumber(keys.size)} permissions` : 'None (public)',
                attrs: { title: [...keys].join(', ') },
              });
            },
          },
          { key: 'description', label: 'Description' },
        ],
        rows: data.roles ?? [],
        emptyMessage: 'No roles defined.',
        actions: (row) => [
          {
            label: 'Show permissions',
            tone: 'ghost',
            onClick: () => {
              const keys = [...(permissionsByRole.get(row.key) ?? [])].sort();
              window.alert(keys.length ? `${row.name}:\n\n${keys.join('\n')}` : `${row.name} has no permissions.`);
            },
          },
        ],
      });
    }),

    api.get('/admin/emails', { signal, query: { per_page: 25 } }).then((data) => {
      renderTable(emailHost, {
        caption: 'Recent messages',
        columns: [
          { key: 'to', label: 'To' },
          { key: 'subject', label: 'Subject' },
          { key: 'template', label: 'Template', render: (row) => el('span', { class: 'mono', text: row.template ?? '—' }) },
          { key: 'provider', label: 'Provider' },
          {
            key: 'status',
            label: 'Status',
            render: (row) =>
              el('span', {
                class: `badge ${row.status === 'sent' ? 'badge--success' : row.status === 'failed' ? 'badge--danger' : 'badge--warning'}`,
                text: humanize(row.status),
              }),
          },
          {
            key: 'created_at',
            label: 'Created',
            render: (row) => el('span', { text: formatRelative(row.created_at), attrs: { title: formatDateTime(row.created_at) } }),
          },
        ],
        rows: data.items ?? [],
        emptyMessage: 'No email has been queued yet.',
        actions: (row) =>
          row.error
            ? [
                {
                  label: 'Show error',
                  tone: 'ghost',
                  onClick: () => window.alert(row.error),
                },
              ]
            : [],
      });
    }),
  ];

  const cleanupButton = qs('[data-cleanup]');
  const cleanupStatus = qs('[data-cleanup-status]');

  cleanupButton.addEventListener('click', async () => {
    cleanupButton.disabled = true;
    cleanupStatus.textContent = 'Running…';
    try {
      // The service reports `{deleted: {sessions, tokens, rate_limits}}`.
      const result = await api.post('/admin/maintenance/cleanup', {}, { signal });
      const deleted = result?.deleted ?? result ?? {};
      const parts = Object.entries(deleted)
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => `${formatNumber(value)} ${key.replace(/_/g, ' ')}`);
      cleanupStatus.textContent = parts.length ? `Cleaned: ${parts.join(', ')}.` : 'Cleanup finished.';
      toastSuccess('Cleanup finished.');
    } catch (error) {
      cleanupStatus.textContent = '';
      toastError(error.message);
    } finally {
      cleanupButton.disabled = false;
    }
  });

  const results = await Promise.allSettled(jobs);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) pageError(failed.reason, () => window.location.reload());
}
