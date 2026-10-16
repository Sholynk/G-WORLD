/**
 * Admin page — overview.
 *
 * Four read models feed four regions. Each is fetched independently so a slow
 * analytics aggregate cannot hold up the student counts.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatNumber, formatRelative } from '../../core/format.js';
import { renderTable } from '../../components/table.js';
import { pageError, setBusy } from '../_shared.js';
import { requireStaff } from './_shared.js';

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const statHost = qs('[data-admin-stats]');

  const jobs = [
    api.get('/admin/students-stats', { signal }).then((stats) => {
      statHost.replaceChildren(
        ...[
          ['Accounts', stats.total],
          ['Students', stats.students],
          ['Administrators', stats.admins],
          ['Verified', stats.verified],
          ['Pending email', stats.pending],
          ['Suspended', stats.suspended],
          ['New this month', stats.newThisMonth],
        ].map(([label, value]) =>
          el('div', {
            class: 'stat',
            children: [
              el('p', { class: 'stat__value', text: formatNumber(value ?? 0) }),
              el('p', { class: 'stat__label', text: label }),
            ],
          }),
        ),
      );
      setBusy(statHost, false);
    }),

    api.get('/admin/analytics/trend', { signal, query: { months: 12 } }).then((trend) => {
      const host = qs('[data-admin-trend]');
      const months = trend.months ?? [];
      if (!months.length) {
        host.textContent = 'No enrolment history yet.';
        return;
      }
      const peak = Math.max(...months.map((month) => month.enrollments ?? 0), 1);
      host.replaceChildren(
        el('ul', {
          class: 'list-plain stack-sm',
          children: months.map((month) =>
            el('li', {
              class: 'cluster',
              children: [
                el('span', { class: 'mono', attrs: { style: 'min-inline-size: 6rem' }, text: month.period }),
                el('span', {
                  class: 'progress',
                  attrs: { style: 'flex: 1 1 auto' },
                  children: [
                    el('span', {
                      class: 'progress__bar',
                      attrs: { style: `--progress-value: ${Math.round(((month.enrollments ?? 0) / peak) * 100)}%` },
                    }),
                  ],
                }),
                el('span', {
                  class: 'subtle',
                  text: `${formatNumber(month.enrollments)} enrolled · ${formatNumber(month.completions)} completed`,
                }),
              ],
            }),
          ),
        }),
      );
      setBusy(host, false);
    }),

    api.get('/admin/analytics/courses', { signal, query: { per_page: 8, sort: 'enrollments' } }).then((courses) => {
      renderTable(qs('[data-admin-top-courses]'), {
        caption: 'Most enrolled courses',
        columns: [
          { key: 'title', label: 'Course' },
          { key: 'enrollment_count', label: 'Enrolled', numeric: true, render: (row) => formatNumber(row.enrollment_count) },
          { key: 'completion_rate', label: 'Completion', numeric: true, render: (row) => `${row.completion_rate ?? 0}%` },
          { key: 'average_quiz_score', label: 'Quiz avg', numeric: true, render: (row) => (row.average_quiz_score ? `${row.average_quiz_score}%` : '—') },
        ],
        rows: courses.slice(0, 8),
        emptyMessage: 'No enrolments yet.',
      });
    }),

    api.get('/admin/audit', { signal, query: { per_page: 8 } }).then((data) => {
      renderTable(qs('[data-admin-recent-audit]'), {
        caption: 'Recent privileged actions',
        columns: [
          { key: 'action', label: 'Action' },
          { key: 'actor', label: 'Actor', render: (row) => row.actor?.email ?? row.actor?.name ?? '—' },
          { key: 'created_at', label: 'When', render: (row) => formatRelative(row.created_at) },
        ],
        rows: data.items ?? [],
        emptyMessage: 'Nothing recorded yet.',
      });
    }),
  ];

  const results = await Promise.allSettled(jobs);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) pageError(failed.reason, () => window.location.reload());
}
