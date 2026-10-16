/**
 * Page — student dashboard.
 *
 * One request to `/me/dashboard` fills the whole page: totals, the course to
 * continue, recent attempts, certificates, notifications and recommendations.
 * Individual sections degrade on their own when a section is empty.
 */
import { api } from '../core/api.js';
import { el, qs } from '../core/dom.js';
import { formatDateTime, formatDuration, formatNumber, formatPercent, formatRelative } from '../core/format.js';
import { emptyState } from '../components/empty-state.js';
import { courseCard } from '../components/course-card.js';
import { statusBadge, progressBar } from '../components/progress.js';
import { toastError, toastSuccess } from '../components/toast.js';
import { fill, needSession, pageError, setBusy, toggle } from './_shared.js';

export async function init({ signal, session }) {
  const current = await needSession(session);
  if (!current) return; // redirecting to sign-in

  const greeting = humanizeHour();
  fill('[data-dashboard-greeting]', `${greeting}`);
  fill(
    '[data-dashboard-student]',
    `${current.user.profile?.display_name ?? current.user.email} · ${current.user.student_number ?? 'student'} · ${current.user.role}`,
  );

  try {
    const data = await api.get('/me/dashboard', { signal });
    const { stats } = data;

    qs('[data-dashboard-stats]').replaceChildren(
      ...[
        ['Courses', stats.enrolled],
        ['In progress', stats.active],
        ['Completed', stats.completed],
        ['Certificates', stats.certificates],
        ['Lessons done', stats.lessonsCompleted],
        ['Average progress', formatPercent(stats.averageProgress)],
        ['Minutes learned', formatNumber(stats.minutesLearned)],
        ['Quizzes passed', stats.quizzesPassed],
      ].map(([label, value]) =>
        el('div', {
          class: 'stat',
          children: [
            el('p', { class: 'stat__value', text: typeof value === 'number' ? formatNumber(value) : String(value) }),
            el('p', { class: 'stat__label', text: label }),
          ],
        }),
      ),
    );
    setBusy(qs('[data-dashboard-stats]'), false);

    // ------------------------------------------------------- keep learning
    const continueHost = qs('[data-dashboard-continue]');
    const next = data.continue_learning;
    if (next) {
      continueHost.replaceChildren(
        el('div', {
          class: 'card',
          children: [
            el('div', {
              class: 'card__body stack-sm',
              children: [
                el('p', { class: 'card__eyebrow', text: 'Pick up where you left off' }),
                el('h3', { class: 'card__title', text: next.course.title }),
                progressBar(next.progress_percent, {
                  label: 'Course progress',
                  detail: next.next_lesson ? `Next: ${next.next_lesson.title}` : 'All lessons complete',
                }),
                el('div', {
                  class: 'cluster',
                  children: [
                    el('a', {
                      class: 'btn btn--primary',
                      text: next.next_lesson ? 'Resume lesson' : 'Open course',
                      attrs: {
                        href: next.next_lesson
                          ? `/lesson.html?id=${encodeURIComponent(next.next_lesson.id)}&course=${encodeURIComponent(next.course.slug)}`
                          : `/course.html?slug=${encodeURIComponent(next.course.slug)}`,
                      },
                    }),
                    el('a', {
                      class: 'btn btn--ghost',
                      text: 'Course page',
                      attrs: { href: `/course.html?slug=${encodeURIComponent(next.course.slug)}` },
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      );
    } else {
      continueHost.replaceChildren(
        emptyState({
          title: 'Nothing in progress',
          message: 'Enrol in a course and your next lesson will appear here.',
          action: { label: 'Browse courses', href: '/courses.html' },
        }),
      );
    }

    // ------------------------------------------------------------ courses
    // `/me/dashboard` groups enrolments by status (`{active: [...], completed: [...]}`).
    const grouped = data.courses ?? {};
    const rows = Array.isArray(grouped) ? grouped : Object.values(grouped).flat();
    const courseHost = qs('[data-dashboard-courses]');
    courseHost.replaceChildren(
      ...(rows.length
        ? rows.map((row) => enrollmentCard(row))
        : [emptyState({ title: 'No courses yet', message: 'Your enrolments will show up here.', action: { label: 'Find a course', href: '/courses.html' } })]),
    );
    setBusy(courseHost, false);

    // ---------------------------------------------------------- attempts
    const attemptHost = qs('[data-dashboard-attempts]');
    attemptHost.replaceChildren(
      data.recent_attempts?.length
        ? attemptTable(data.recent_attempts)
        : emptyState({ title: 'No quiz attempts yet', message: 'Quizzes appear here once you start one.', icon: '📝' }),
    );
    setBusy(attemptHost, false);

    // ----------------------------------------------------- notifications
    // The dashboard payload counts unread notifications but does not carry them,
    // so the list comes from its own endpoint.
    const notificationHost = qs('[data-dashboard-notifications]');
    const markAll = qs('[data-mark-all-read]');
    const notifications = await api
      .get('/me/notifications', { query: { per_page: 5 }, signal })
      .then((page) => page.items ?? [])
      .catch(() => []);
    if (notifications.length) {
      notificationHost.replaceChildren(
        ...notifications.map((notification) =>
          el('li', {
            class: 'stack-sm',
            children: [
              el('p', {
                class: 'mb-0',
                children: [
                  el('strong', { text: notification.title }),
                  notification.read ? null : el('span', { class: 'badge badge--info', text: 'New' }),
                ],
              }),
              notification.body ? el('p', { class: 'subtle mb-0', text: notification.body }) : null,
              el('p', {
                class: 'subtle mb-0',
                text: formatRelative(notification.created_at),
                attrs: { title: formatDateTime(notification.created_at) },
              }),
            ],
          }),
        ),
      );
      markAll.hidden = data.unread_notifications === 0;
    } else {
      notificationHost.replaceChildren(el('li', { class: 'muted', text: 'No notifications.' }));
      markAll.hidden = true;
    }
    setBusy(notificationHost, false);

    markAll.addEventListener('click', async () => {
      markAll.disabled = true;
      try {
        await api.post('/me/notifications/read-all', {});
        toastSuccess('All notifications marked as read.');
        window.location.reload();
      } catch (error) {
        markAll.disabled = false;
        toastError(error.message);
      }
    });

    // -------------------------------------------------------- certificates
    const certificateHost = qs('[data-dashboard-certificates]');
    certificateHost.replaceChildren(
      ...(data.certificates?.length
        ? data.certificates.map((certificate) =>
            el('li', {
              children: [
                el('a', {
                  text: certificate.title ?? certificate.course?.title ?? certificate.certificate_number,
                  attrs: { href: `/certificate.html?id=${encodeURIComponent(certificate.id)}` },
                }),
                el('span', { class: 'subtle', text: ` · ${formatRelative(certificate.issued_at)}` }),
              ],
            }),
          )
        : [el('li', { class: 'muted', text: 'No certificates yet — finish a course to earn one.' })]),
    );

    // ----------------------------------------------------- recommendations
    const recommendationHost = qs('[data-dashboard-recommendations]');
    recommendationHost.replaceChildren(
      ...(data.recommendations?.length
        ? data.recommendations.map((course) =>
            el('li', {
              children: [
                el('a', {
                  text: course.title,
                  attrs: { href: `/course.html?slug=${encodeURIComponent(course.slug)}` },
                }),
                el('span', {
                  class: 'subtle',
                  text: ` · ${course.department_name ?? ''} ${course.estimated_minutes ? `· ${formatDuration(course.estimated_minutes)}` : ''}`,
                }),
              ],
            }),
          )
        : [el('li', { class: 'muted', text: 'Nothing to suggest yet.' })]),
    );
  } catch (error) {
    pageError(error, () => window.location.reload());
  }
}

function humanizeHour() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Card for an enrolment row (used in "your courses" and reusable elsewhere). */
export function enrollmentCard(row) {
  const course = row.course ?? row;
  const href = `/course.html?slug=${encodeURIComponent(course.slug ?? course.course_slug ?? '')}`;
  return el('article', {
    class: 'card',
    children: [
      el('div', {
        class: 'card__body stack-sm',
        children: [
          el('p', { class: 'card__eyebrow', text: row.status ? String(row.status).replace(/_/g, ' ') : 'course' }),
          el('h3', { class: 'card__title', children: [el('a', { text: course.title ?? course.course_title, attrs: { href } })] }),
          progressBar(row.progress_percent ?? 0, {
            label: 'Progress',
            detail: `${formatNumber(row.lessons_completed ?? 0)} of ${formatNumber(row.total_lessons ?? 0)} lessons`,
          }),
          el('div', {
            class: 'cluster cluster--tight',
            children: [
              statusBadge(row.status ?? 'active'),
              row.last_activity_at ? el('span', { class: 'subtle', text: `Last activity ${formatRelative(row.last_activity_at)}` }) : null,
              row.certificates_issued ? el('span', { class: 'badge badge--success', text: 'Certified' }) : null,
            ],
          }),
          el('div', {
            class: 'cluster',
            children: [
              el('a', {
                class: 'btn btn--sm btn--primary',
                text: row.status === 'completed' ? 'Review course' : 'Continue',
                attrs: {
                  href: row.last_lesson_id
                    ? `/lesson.html?id=${encodeURIComponent(row.last_lesson_id)}&course=${encodeURIComponent(course.slug ?? '')}`
                    : href,
                },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** Compact attempts table (shared with the my-courses page). */
export function attemptTable(rows) {
  return el('table', {
    class: 'table table--compact',
    children: [
      el('thead', {
        children: [
          el('tr', {
            children: ['Quiz', 'Score', 'Result', 'When'].map((label) =>
              el('th', { text: label, attrs: { scope: 'col' } }),
            ),
          }),
        ],
      }),
      el('tbody', {
        children: rows.map((row) =>
          el('tr', {
            children: [
              el('td', { attrs: { 'data-label': 'Quiz' }, text: row.quiz_title ?? row.quiz_id }),
              el('td', {
                attrs: { 'data-label': 'Score' },
                text: row.status === 'in_progress' ? 'In progress' : formatPercent(row.score_percent),
              }),
              el('td', {
                attrs: { 'data-label': 'Result' },
                children: [el('span', { class: `badge ${row.passed ? 'badge--success' : 'badge'}`, text: row.passed ? 'Passed' : row.status === 'in_progress' ? 'Open' : 'Not passed' })],
              }),
              el('td', {
                attrs: { 'data-label': 'When' },
                text: row.submitted_at ? formatRelative(row.submitted_at) : formatRelative(row.started_at),
              }),
            ],
          }),
        ),
      }),
    ],
  });
}
