/**
 * Page — progress.
 *
 * One row per enrolment: how many lessons are done, how many quizzes were
 * passed out of the ones the course has, and where the enrolment stands.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { humanize } from '../core/format.js';
import { renderTable } from '../components/table.js';
import { needSession, pageError, setBusy } from './_shared.js';

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return;

  const host = qs('[data-progress-table]');
  if (!host) return;

  try {
    const [enrollments, attempts] = await Promise.all([
      api.get('/me/enrollments', { signal }),
      api.get('/me/attempts', { signal }),
    ]);

    const rows = enrollments ?? [];

    // How many quizzes each course has, and how many the learner passed.
    const details = await Promise.all(
      rows.slice(0, 12).map((enrollment) =>
        api.get(`/me/enrollments/${encodeURIComponent(enrollment.id)}`, { signal }).catch(() => null),
      ),
    );

    const quizTotals = new Map();
    details.forEach((detail, index) => {
      const courseId = rows[index]?.course?.id;
      const total = detail?.assessments?.quizzes?.length ?? 0;
      if (courseId) quizTotals.set(courseId, total);
    });

    const passed = new Map();
    for (const attempt of attempts ?? []) {
      const courseId = attempt.course?.id;
      if (!courseId || !attempt.passed) continue;
      passed.set(courseId, (passed.get(courseId) ?? 0) + 1);
    }

    renderTable(host, {
      columns: [
        {
          key: 'course',
          label: 'Course',
          render: (row) =>
            el('a', {
              text: row.course?.title ?? 'Course',
              attrs: { href: `/course.html?slug=${encodeURIComponent(row.course?.slug ?? '')}` },
            }),
        },
        {
          key: 'lessons',
          label: 'Lessons',
          numeric: true,
          render: (row) => `${row.lessons_completed ?? 0} / ${row.total_lessons ?? 0}`,
        },
        {
          key: 'quizzes',
          label: 'Quizzes',
          numeric: true,
          render: (row) => {
            const courseId = row.course?.id;
            const total = quizTotals.get(courseId) ?? 0;
            return `${passed.get(courseId) ?? 0} / ${total}`;
          },
        },
        {
          key: 'status',
          label: 'Status',
          render: (row) => el('span', { class: 'tag', text: humanize(row.status) }),
        },
      ],
      rows,
      emptyMessage: 'Enrol in a course and your progress will appear here.',
    });
    setBusy(host, false);
  } catch (error) {
    setBusy(host, false);
    pageError(error, () => init({ signal, session: current }));
  }
}
