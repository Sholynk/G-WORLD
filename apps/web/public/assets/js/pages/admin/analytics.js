/**
 * Admin page — analytics.
 *
 * The four totals come from the platform read models (`GET /admin/stats`), the
 * chart from the enrolment trend and the table from the ten most recent
 * enrolments. Each region is filled independently, so a slow aggregate cannot
 * hold up the rest of the page.
 */
import { api } from '../../core/api.js';
import { el, qs } from '../../core/dom.js';
import { formatDate, formatNumber } from '../../core/format.js';
import { countUp } from '../../core/motion.js';
import { renderTable } from '../../components/table.js';
import { pageError, setBusy } from '../_shared.js';
import { requireStaff } from './_shared.js';
import { skeletonStats, skeletonTable } from '../../components/skeleton.js';

const MONTHS_SHOWN = 7;

/** The last seven month keys, oldest first, e.g. `2026-04`. */
function lastMonths(count) {
  const months = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let index = count - 1; index >= 0; index -= 1) {
    const month = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    months.push(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/** "2026-04" → "Apr". */
function monthLabel(period) {
  const [year, month] = String(period).split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short' });
}

export async function init({ signal, session }) {
  const current = await requireStaff(session);
  if (!current) return;

  const statHost = qs('[data-admin-stats]');
  const trendHost = qs('[data-admin-trend]');
  const tableHost = qs('[data-admin-enrollments]');
  if (tableHost) skeletonTable(tableHost, 4, 4);
  if (statHost) skeletonStats(statHost, 4);

  try {
    const [stats, trend] = await Promise.all([
      api.get('/admin/stats', { signal }),
      api.get('/admin/analytics/trend', { signal, query: { months: MONTHS_SHOWN } }),
    ]);

    const overview = stats.overview ?? {};

    statHost.replaceChildren(
      ...[
        ['Users', stats.users?.total ?? overview.students ?? 0],
        ['Enrollments', stats.enrollments?.total ?? overview.enrollments ?? 0],
        ['Active courses', overview.publishedCourses ?? 0],
        ['Certificates issued', stats.certificates?.total ?? overview.certificates ?? 0],
      ].map(([label, value]) =>
        el('div', {
          class: 'stat',
          children: [
            el('p', { class: 'stat__value', text: '0', attrs: { 'data-count': String(value ?? 0) } }),
            el('p', { class: 'stat__label', text: label }),
          ],
        }),
      ),
    );
    setBusy(statHost, false);

    // The totals count up once they are on screen.
    for (const node of statHost.querySelectorAll('[data-count]')) {
      countUp(node, Number(node.getAttribute('data-count') ?? 0));
    }

    // --------------------------------------------------------- chart
    const byPeriod = new Map((trend.months ?? []).map((month) => [month.period, month.enrollments ?? 0]));
    const periods = lastMonths(MONTHS_SHOWN);
    const values = periods.map((period) => byPeriod.get(period) ?? 0);
    const peak = Math.max(...values, 1);

    trendHost.replaceChildren(
      el('div', {
        class: 'chart',
        attrs: { role: 'img', 'aria-label': `Enrollments per month for the last ${MONTHS_SHOWN} months` },
        children: periods.map((period, index) =>
          el('div', {
            class: 'chart__bar',
            attrs: {
              style: `--bar-height: ${Math.max(4, Math.round((values[index] / peak) * 160))}px; --bar-index: ${index}`,
              title: `${monthLabel(period)}: ${formatNumber(values[index])} enrollments`,
            },
          }),
        ),
      }),
      el('div', {
        class: 'chart__axis',
        children: periods.map((period) => el('span', { text: monthLabel(period) })),
      }),
    );
    setBusy(trendHost, false);

    // --------------------------------------------------------- table
    renderTable(tableHost, {
      columns: [
        { key: 'student_name', label: 'Student' },
        { key: 'course_title', label: 'Course' },
        {
          key: 'enrolled_at',
          label: 'Date',
          render: (row) => formatDate(row.enrolled_at),
        },
      ],
      rows: trend.recent_enrollments ?? [],
      emptyMessage: 'No enrollments yet.',
    });
    setBusy(tableHost, false);
  } catch (error) {
    setBusy(statHost, false);
    setBusy(trendHost, false);
    setBusy(tableHost, false);
    pageError(error, () => init({ signal, session: current }));
  }
}
